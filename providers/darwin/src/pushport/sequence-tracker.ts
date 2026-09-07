// Détection de discontinuité du numéro de séquence Push Port.

import { SEQUENCE_MAX, SEQUENCE_WARN_INTERVAL_MS } from "../constants.js";
import { createThrottledLogger } from "../utils/logger.js";

export type SequenceTracker = {
	/** Rend true si une discontinuité vient d'être constatée par CET appel. */
	observe(sequence: number, nowMs: number): boolean;
	clearGap(): void;
	readonly hasGap: boolean;
};

export function createSequenceTracker(): SequenceTracker {
	// État initial « aucun numéro observé », distinct de la valeur 0 : tant qu'aucun message porteur
	// d'un numéro n'a été reçu, aucun contrôle n'est effectué, y compris si le premier numéro reçu
	// n'est pas 0.
	let last: number | undefined;
	let hasGap = false;
	const throttled = createThrottledLogger(SEQUENCE_WARN_INTERVAL_MS);

	return {
		observe(sequence, nowMs) {
			let gapDetected = false;

			if (last !== undefined) {
				// Dès le second numéro observé, le contrôle s'applique
				const isLegitimateWrap = sequence === 0 && last === SEQUENCE_MAX;
				if (sequence !== last + 1 && !isLegitimateWrap) {
					gapDetected = true;
					hasGap = true;
					throttled.warn("sequence-gap", nowMs, "Discontinuité de séquence Push Port : %d après %d", sequence, last);
				}
			}

			// Le dernier numéro est mémorisé dans tous les cas, y compris sur une discontinuité.
			last = sequence;
			return gapDetected;
		},
		clearGap() {
			hasGap = false;
		},
		get hasGap() {
			return hasGap;
		},
	};
}
