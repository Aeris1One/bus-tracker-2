import { monitorEventLoopDelay } from "node:perf_hooks";
import type { PostHog } from "posthog-node";

export const METRICS = {
	cycleCount: "provider.cycle.count",
	cycleDuration: "provider.cycle.duration",
	cycleErrors: "provider.cycle.errors",
	journeysPublished: "provider.journeys.published",
	vehiclesActive: "provider.vehicles.active",
	zeroOutputStreak: "provider.zero_output.streak",
	memoryRss: "process.memory.rss",
	memoryHeapUsed: "process.memory.heap.used",
	memoryHeapTotal: "process.memory.heap.total",
	memoryExternal: "process.memory.external",
	eventLoopDelayP50: "process.event_loop.delay.p50",
	eventLoopDelayP99: "process.event_loop.delay.p99",
	uptime: "process.uptime",
} as const;

export type MetricAttributes = Record<string, string>;

export class Metrics {
	readonly #posthog: PostHog | undefined;
	readonly #defaultAttributes: MetricAttributes;

	constructor(posthog: PostHog | undefined, defaultAttributes: MetricAttributes) {
		this.#posthog = posthog;
		this.#defaultAttributes = defaultAttributes;
	}

	#attributes(attributes?: MetricAttributes): MetricAttributes {
		return attributes === undefined ? this.#defaultAttributes : { ...this.#defaultAttributes, ...attributes };
	}

	count(name: string, value = 1, attributes?: MetricAttributes): void {
		this.#posthog?.metrics.count(name, value, { attributes: this.#attributes(attributes) });
	}

	gauge(name: string, value: number, attributes?: MetricAttributes, unit?: string): void {
		this.#posthog?.metrics.gauge(name, value, { unit, attributes: this.#attributes(attributes) });
	}

	histogram(name: string, value: number, unit: string, attributes?: MetricAttributes): void {
		this.#posthog?.metrics.histogram(name, value, { unit, attributes: this.#attributes(attributes) });
	}
}

export function createProcessSampler(metrics: Metrics, intervalMs: number) {
	const eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
	let timer: NodeJS.Timeout | undefined;

	const sample = () => {
		const memory = process.memoryUsage();
		metrics.gauge(METRICS.memoryRss, memory.rss, undefined, "By");
		metrics.gauge(METRICS.memoryHeapUsed, memory.heapUsed, undefined, "By");
		metrics.gauge(METRICS.memoryHeapTotal, memory.heapTotal, undefined, "By");
		metrics.gauge(METRICS.memoryExternal, memory.external, undefined, "By");
		// `percentile()` renvoie des nanosecondes.
		metrics.gauge(METRICS.eventLoopDelayP50, eventLoopDelay.percentile(50) / 1e6, undefined, "ms");
		metrics.gauge(METRICS.eventLoopDelayP99, eventLoopDelay.percentile(99) / 1e6, undefined, "ms");
		metrics.gauge(METRICS.uptime, Math.round(process.uptime()), undefined, "s");
		eventLoopDelay.reset();
	};

	return {
		start() {
			eventLoopDelay.enable();
			// Premier relevé à `intervalMs` et non immédiatement : une latence de 0 ms et une RSS
			// d'avant chauffe ne veulent rien dire.
			timer = setInterval(sample, intervalMs);
			timer.unref();
		},
		stop() {
			if (timer !== undefined) clearInterval(timer);
			timer = undefined;
			sample();
			eventLoopDelay.disable();
		},
	};
}

export type ProcessSampler = ReturnType<typeof createProcessSampler>;
