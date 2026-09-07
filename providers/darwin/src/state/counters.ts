// Compteurs internes de journalisation et de télémétrie.

export type Counters = {
	increment(key: string, by?: number): void;
	get(key: string): number;
	snapshot(): Record<string, number>;
	/** Journalise une seule fois par clé dans la vie du process (types de message hors périmètre). */
	seenFirstTime(key: string): boolean;
};

export function createCounters(): Counters {
	const values = new Map<string, number>();
	const seen = new Set<string>();

	return {
		increment(key, by = 1) {
			values.set(key, (values.get(key) ?? 0) + by);
		},
		get(key) {
			return values.get(key) ?? 0;
		},
		snapshot() {
			return Object.fromEntries(values);
		},
		seenFirstTime(key) {
			if (seen.has(key)) {
				return false;
			}
			seen.add(key);
			return true;
		},
	};
}
