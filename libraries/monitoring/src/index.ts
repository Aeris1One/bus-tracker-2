import { setTimeout } from "node:timers/promises";
import type { PostHog } from "posthog-node";

import { createClient, installProcessHooks, type MonitoringConfig, readConfig } from "./client.js";
import {
	type CycleSample,
	createZeroOutputTracker,
	positionTypes,
	totalPositionTypeCounts,
	type ZeroOutputTracker,
} from "./cycle.js";
import { captureEventWith, captureExceptionWith } from "./events.js";
import { createProcessSampler, type MetricAttributes, METRICS, Metrics, type ProcessSampler } from "./metrics.js";

export {
	addPositionTypeCounts,
	type CycleOutcome,
	type CycleSample,
	countPositionTypes,
	emptyPositionTypeCounts,
	getPositionType,
	type PositionType,
	type PositionTypeCounts,
	type PositionTypeInput,
	positionTypes,
	totalPositionTypeCounts,
} from "./cycle.js";

const FATAL_SHUTDOWN_TIMEOUT_MS = 5_000;

type MonitoringState = {
	config: MonitoringConfig;
	posthog: PostHog | undefined;
	metrics: Metrics;
	sampler: ProcessSampler;
	zeroOutput: ZeroOutputTracker;
	uninstallHooks: () => void;
};

let state: MonitoringState | undefined;

export function initMonitoring(processorId: string): void {
	// Initialiser qu'une fois
	if (state !== undefined) return;

	const config = readConfig(processorId);
	const posthog = createClient(config);
	const metrics = new Metrics(posthog, { provider: config.provider });
	const sampler = createProcessSampler(metrics, config.sampleIntervalMs);

	state = {
		config,
		posthog,
		metrics,
		sampler,
		zeroOutput: createZeroOutputTracker(),
		uninstallHooks: installProcessHooks(async (reason) => {
			captureException(reason, { fatal: true });
			try {
				await Promise.race([shutdownMonitoring(), setTimeout(FATAL_SHUTDOWN_TIMEOUT_MS)]);
			} finally {
				process.exit(1);
			}
		}),
	};

	sampler.start();
}

export function captureEvent(event: string, properties?: Record<string, unknown>): void {
	if (state === undefined) return;
	captureEventWith(state.posthog, state.config.processorId, event, properties);
}

export function captureException(error: unknown, properties?: Record<string, unknown>): void {
	if (state === undefined) return;
	captureExceptionWith(state.posthog, state.config.processorId, error, properties);
}

export function recordCycle(sample: CycleSample): void {
	if (state === undefined) return;
	const { metrics, zeroOutput } = state;

	const outcome = sample.outcome ?? (sample.errors > 0 ? "error" : "success");
	const phase = sample.phase;
	const phased = phase !== undefined ? { phase } : undefined;
	const attributed: MetricAttributes = phase !== undefined ? { outcome, phase } : { outcome };

	metrics.count(METRICS.cycleCount, 1, attributed);
	metrics.histogram(METRICS.cycleDuration, sample.durationMs, "ms", phased);
	if (sample.errors > 0) metrics.count(METRICS.cycleErrors, sample.errors, attributed);

	// Une phase annexe (rafraîchissement de lignes) ne publie jamais rien : elle ne doit ni
	// écraser la jauge de flotte du dernier cycle nominal, ni compter comme un silence.
	if (phase !== undefined) return;

	// Un cycle en échec ne publie rien : écraser la jauge de flotte avec ses zéros la ferait
	// tomber au moment précis où on la consulte. Le compteur de cycles en erreur et la série de
	// cycles vides disent déjà la panne, la jauge conserve donc le dernier parc connu.
	const publishedTotal = totalPositionTypeCounts(sample.published);
	const failedWithoutOutput = publishedTotal === 0 && sample.errors > 0;

	for (const positionType of positionTypes) {
		const published = sample.published[positionType] ?? 0;
		if (published > 0) metrics.count(METRICS.journeysPublished, published, { position_type: positionType });
		if (!failedWithoutOutput) metrics.gauge(METRICS.vehiclesActive, published, { position_type: positionType });
	}

	const { streak, shouldAlert } = zeroOutput.observe(publishedTotal);
	metrics.gauge(METRICS.zeroOutputStreak, streak);
	if (shouldAlert) captureEvent("provider_zero_output", { consecutiveCycles: streak });
}

/**
 * Arrête l'échantillonneur puis vide les files PostHog. À `await` sur tous les chemins de sortie.
 *
 * Ne rejette jamais : c'est le seul nettoyage garanti des sorties de processus, et ses appelants
 * sont des chemins de terminaison qui ne peuvent rien faire d'un échec sinon l'ignorer. Chaque
 * étape est isolée pour qu'un premier échec ne prive pas les suivantes de leur exécution — sans
 * quoi un `uninstallHooks` en erreur laisserait le timer courir et perdrait la file en attente.
 */
export async function shutdownMonitoring(): Promise<void> {
	if (state === undefined) return;
	const { sampler, posthog, uninstallHooks } = state;
	state = undefined;

	for (const step of [uninstallHooks, () => sampler.stop(), () => posthog?.shutdown()]) {
		try {
			await step();
		} catch (error) {
			console.error("Failed to shut down monitoring cleanly", error);
		}
	}
}
