// Contrôle qualité des tracés, exécuté en fin de cycle.

import { captureException } from "@bus-tracker/monitoring";
import { QUALITY_BRIDGE_MEAN_METERS, QUALITY_BRIDGE_RATIO, QUALITY_OUT_OF_BAND_RATIO } from "../constants.js";
import type { Counters } from "../state/counters.js";
import { logger } from "../utils/logger.js";

/** Trois seuils, évalués sur le total des tracés construits par routage. */
export function checkShapeQuality(counters: Counters): void {
	const total = counters.get("shape:total");
	if (total === 0) {
		return;
	}

	const bridge = counters.get("shape:bridge");
	const bridgeLength = counters.get("shape:bridge:len");
	const belowBand = counters.get("shape:ratio:<1");
	const aboveBand = counters.get("shape:ratio:>2");

	const bridgeRatio = bridge / total;
	// La longueur moyenne d'un pont n'a de sens que s'il en existe au moins un.
	const bridgeMeanLength = bridge > 0 ? bridgeLength / bridge : 0;
	const outOfBandRatio = (belowBand + aboveBand) / total;

	const breaches: string[] = [];
	if (bridgeRatio > QUALITY_BRIDGE_RATIO) {
		breaches.push(`taux de ponts ${(bridgeRatio * 100).toFixed(2)}% > ${(QUALITY_BRIDGE_RATIO * 100).toFixed(2)}%`);
	}
	if (bridge > 0 && bridgeMeanLength > QUALITY_BRIDGE_MEAN_METERS) {
		breaches.push(`longueur moyenne des ponts ${bridgeMeanLength.toFixed(0)} m > ${QUALITY_BRIDGE_MEAN_METERS} m`);
	}
	if (outOfBandRatio > QUALITY_OUT_OF_BAND_RATIO) {
		breaches.push(
			`tracés hors bande saine (1,0–1,6) ${(outOfBandRatio * 100).toFixed(2)}% > ${(QUALITY_OUT_OF_BAND_RATIO * 100).toFixed(2)}%`,
		);
	}

	if (breaches.length === 0) {
		return;
	}

	const message =
		`qualité des tracés dégradée : ${breaches.join(" ; ")}. ` +
		`Compteurs : shape:total=${total}, shape:bridge=${bridge}, shape:bridge:len=${bridgeLength}, ` +
		`shape:ratio:<1=${belowBand}, shape:ratio:1-1.6=${counters.get("shape:ratio:1-1.6")}, ` +
		`shape:ratio:1.6-2=${counters.get("shape:ratio:1.6-2")}, shape:ratio:>2=${aboveBand}, ` +
		`shape:turns=${counters.get("shape:turns")}, shape:turns:nonzero=${counters.get("shape:turns:nonzero")}.`;

	logger.warning(message);
	captureException(new Error(message));
}
