import { PostHog } from "posthog-node";

const METRICS_FLUSH_INTERVAL_MS = 10_000;

export type MonitoringConfig = {
	/** `processor-gtfs:rouen` */
	processorId: string;
	/** `gtfs` */
	provider: string;
	sampleIntervalMs: number;
};

/**
 * `processor-gtfs:rouen` → `gtfs`, `processor-rtm` → `rtm`
 */
function getProviderName(processorId: string): string {
	return processorId.replace(/^processor-/, "").split(":")[0] ?? processorId;
}

export function readConfig(processorId: string): MonitoringConfig {
	const sampleIntervalOverride = Number(process.env.MONITORING_SAMPLE_INTERVAL_MS);

	return {
		processorId,
		provider: getProviderName(processorId),
		sampleIntervalMs:
			Number.isFinite(sampleIntervalOverride) && sampleIntervalOverride > 0
				? sampleIntervalOverride
				: METRICS_FLUSH_INTERVAL_MS,
	};
}

/** Construit le client PostHog, ou `undefined` lorsque `POSTHOG_KEY` est absent (monitoring désactivé). */
export function createClient(config: MonitoringConfig): PostHog | undefined {
	const key = process.env.POSTHOG_KEY;
	if (!key) return;

	return new PostHog(key, {
		host: process.env.POSTHOG_HOST,
		flushAt: 1,
		flushInterval: 0,
		metrics: {
			serviceName: config.processorId,
			environment: process.env.NODE_ENV ?? "production",
		},
	});
}

export function installProcessHooks(onFatal: (reason: unknown) => Promise<never>): () => void {
	const handle = (reason: unknown) => void onFatal(reason);

	process.on("unhandledRejection", handle);
	process.on("uncaughtException", handle);

	return () => {
		process.off("unhandledRejection", handle);
		process.off("uncaughtException", handle);
	};
}
