import { PostHog } from "posthog-node";

/** After this many consecutive cycles publishing 0 entries, report it immediately (bypasses the health flush interval). */
const ZERO_OUTPUT_THRESHOLD = 3;
const DEFAULT_HEALTH_INTERVAL_MS = 180_000;

export type CycleSample = {
	durationMs: number;
	published: number;
	errors: number;
	timedOut?: boolean;
	/** Merged into the next flushed `provider_health` event; last call before a flush wins. */
	properties?: Record<string, unknown>;
};

type HealthAggregate = {
	cycles: number;
	totalDurationMs: number;
	maxDurationMs: number;
	totalPublished: number;
	totalErrors: number;
	timeouts: number;
	windowStartedAt: number;
	properties: Record<string, unknown>;
};

let posthog: PostHog | undefined;
let processorId = "unknown";
let healthIntervalMs = DEFAULT_HEALTH_INTERVAL_MS;
let aggregate = emptyAggregate();
let hasPublishedBefore = false;
let consecutiveZeroPublishedCycles = 0;

function emptyAggregate(): HealthAggregate {
	return {
		cycles: 0,
		totalDurationMs: 0,
		maxDurationMs: 0,
		totalPublished: 0,
		totalErrors: 0,
		timeouts: 0,
		windowStartedAt: Date.now(),
		properties: {},
	};
}

export function initMonitoring(id: string): void {
	processorId = id;
	healthIntervalMs = DEFAULT_HEALTH_INTERVAL_MS;
	aggregate = emptyAggregate();
	hasPublishedBefore = false;
	consecutiveZeroPublishedCycles = 0;
	posthog = undefined;

	const intervalOverride = Number(process.env.MONITORING_HEALTH_INTERVAL_MS);
	if (Number.isFinite(intervalOverride) && intervalOverride > 0) {
		healthIntervalMs = intervalOverride;
	}

	const key = process.env.POSTHOG_KEY;
	if (!key) return;

	posthog = new PostHog(key, {
		host: process.env.POSTHOG_HOST,
		flushAt: 1,
		flushInterval: 0,
	});

	process.on("unhandledRejection", (reason) => {
		captureException(reason);
	});
	process.on("uncaughtException", (error) => {
		captureException(error);
	});
}

export function captureException(error: unknown, properties?: Record<string, unknown>): void {
	if (!posthog) return;
	const err = error instanceof Error ? error : new Error(String(error));
	posthog.captureException(err, processorId, properties);
}

/** Machine telemetry, not user analytics: always sent with person-profile processing disabled. */
export function captureEvent(event: string, properties?: Record<string, unknown>): void {
	if (!posthog) return;
	posthog.capture({
		distinctId: processorId,
		event,
		properties: { ...properties, $process_person_profile: false },
	});
}

/**
 * Cheap, synchronous, meant to be called once per loop iteration by every provider. Aggregates
 * in-process and only calls out to PostHog on a fixed wall-clock interval (`provider_health`), or
 * immediately once output silently drops to zero for `ZERO_OUTPUT_THRESHOLD` consecutive cycles
 * (`provider_zero_output`) — see the volume/cost analysis in the implementation plan for why.
 */
export function recordCycle(sample: CycleSample): void {
	aggregate.cycles += 1;
	aggregate.totalDurationMs += sample.durationMs;
	aggregate.maxDurationMs = Math.max(aggregate.maxDurationMs, sample.durationMs);
	aggregate.totalPublished += sample.published;
	aggregate.totalErrors += sample.errors;
	if (sample.timedOut) aggregate.timeouts += 1;
	if (sample.properties) Object.assign(aggregate.properties, sample.properties);

	if (sample.published > 0) {
		hasPublishedBefore = true;
		consecutiveZeroPublishedCycles = 0;
	} else {
		consecutiveZeroPublishedCycles += 1;
		if (hasPublishedBefore && consecutiveZeroPublishedCycles === ZERO_OUTPUT_THRESHOLD) {
			captureEvent("provider_zero_output", { consecutiveCycles: consecutiveZeroPublishedCycles });
		}
	}

	const now = Date.now();
	if (now - aggregate.windowStartedAt >= healthIntervalMs) {
		flushHealth(now);
	}
}

function flushHealth(now: number): void {
	const { cycles, totalDurationMs, maxDurationMs, totalPublished, totalErrors, timeouts, windowStartedAt, properties } =
		aggregate;
	aggregate = emptyAggregate();

	if (cycles === 0) return;

	captureEvent("provider_health", {
		cycles,
		avgDurationMs: Math.round(totalDurationMs / cycles),
		maxDurationMs,
		totalPublished,
		totalErrors,
		timeouts,
		windowMs: now - windowStartedAt,
		...properties,
	});
}

export async function shutdownMonitoring(): Promise<void> {
	await posthog?.shutdown();
}
