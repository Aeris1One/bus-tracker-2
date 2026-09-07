const PREFIXES = {
	step: "►",
	success: "✓",
	failure: "✗",
	warning: "⚠",
	info: "ℹ",
} as const;

type LogLevel = keyof typeof PREFIXES;

function log(level: LogLevel, message: string, ...args: unknown[]): void {
	console.log(`%s ${PREFIXES[level]} ${message}`, Temporal.Now.instant(), ...args);
}

export const logger = {
	step: (message: string, ...args: unknown[]) => log("step", message, ...args),
	success: (message: string, ...args: unknown[]) => log("success", message, ...args),
	failure: (message: string, ...args: unknown[]) => log("failure", message, ...args),
	warning: (message: string, ...args: unknown[]) => log("warning", message, ...args),
	info: (message: string, ...args: unknown[]) => log("info", message, ...args),
};

/**
 * Journal étranglé : un même `key` ne déclenche un avertissement qu'une fois par `intervalMs`.
 */
export function createThrottledLogger(intervalMs: number) {
	const lastLoggedAtMs = new Map<string, number>();

	return {
		/** Journalise et rend vrai, sauf si `key` a déjà déclenché un avertissement il y a moins de `intervalMs`. */
		warn(key: string, nowMs: number, message: string, ...args: unknown[]): boolean {
			const last = lastLoggedAtMs.get(key);
			if (last !== undefined && nowMs - last < intervalMs) {
				return false;
			}
			lastLoggedAtMs.set(key, nowMs);
			logger.warning(message, ...args);
			return true;
		},
	};
}
