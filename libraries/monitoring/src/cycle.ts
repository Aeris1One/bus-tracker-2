import {
	getPositionType,
	type PositionType,
	type PositionTypeInput,
	positionTypes,
} from "@bus-tracker/contracts/position-type";

export { getPositionType, type PositionType, type PositionTypeInput, positionTypes };

export type PositionTypeCounts = Record<PositionType, number>;

export type CycleOutcome = "success" | "error" | "timeout";

export type CycleSample = {
	durationMs: number;
	/** Véhicules publiés durant ce cycle, par type de position */
	published: PositionTypeCounts;
	errors: number;
	/** `error` ou `success` */
	outcome?: CycleOutcome;
	/** Sous-phase, si le provider l'implémente */
	phase?: string;
};

export function emptyPositionTypeCounts(): PositionTypeCounts {
	return { GPS: 0, ESTIMATED: 0, SCHEDULED: 0 };
}

export function countPositionTypes(journeys: Iterable<PositionTypeInput>): PositionTypeCounts {
	const counts = emptyPositionTypeCounts();
	for (const journey of journeys) {
		counts[getPositionType(journey)] += 1;
	}
	return counts;
}

export function addPositionTypeCounts(a: PositionTypeCounts, b: PositionTypeCounts): PositionTypeCounts {
	return { GPS: a.GPS + b.GPS, ESTIMATED: a.ESTIMATED + b.ESTIMATED, SCHEDULED: a.SCHEDULED + b.SCHEDULED };
}

export function totalPositionTypeCounts(counts: PositionTypeCounts): number {
	return counts.GPS + counts.ESTIMATED + counts.SCHEDULED;
}

/** Cycles consécutifs sans publication avant la première alerte */
const ZERO_OUTPUT_THRESHOLD = 3;
/** Puis une relance toutes les N séries de cycles vides */
const ZERO_OUTPUT_REPEAT_EVERY = 20;

export type ZeroOutputState = { streak: number; shouldAlert: boolean };

export function createZeroOutputTracker() {
	let streak = 0;

	return {
		observe(published: number): ZeroOutputState {
			if (published > 0) {
				streak = 0;
				return { streak, shouldAlert: false };
			}

			streak += 1;
			const shouldAlert =
				streak >= ZERO_OUTPUT_THRESHOLD && (streak - ZERO_OUTPUT_THRESHOLD) % ZERO_OUTPUT_REPEAT_EVERY === 0;
			return { streak, shouldAlert };
		},
	};
}

export type ZeroOutputTracker = ReturnType<typeof createZeroOutputTracker>;
