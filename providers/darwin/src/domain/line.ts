// Identité de la ligne (service commercial) publiée pour un train en régime voyageur.

import type { VehicleJourneyLine } from "@bus-tracker/contracts";

import type { TocColors } from "./color.js";
import { deriveColor } from "./color.js";
import type { Regime } from "./regime.js";
import type { Train } from "./train.js";
import { firstPassengerCall, lastPassengerCall } from "./train.js";

export type LineContext = {
	networkRef: string;
	placeName: (tiploc: string) => string;
	/** Nom lisible de l'opérateur (`TocRef.tocname`) : c'est lui qui dérive la couleur (`deriveColor`). */
	operatorName: (toc: string) => string | undefined;
	mapHeadcodeToLineName?: (headcode: string) => string;
	tocColors?: TocColors;
};

/**
 * Rend `undefined` en régime ECS : un train hors service n'est rattaché à aucune ligne. En régime
 * voyageur, l'identité de la ligne se bâtit sur le premier et le dernier arrêt voyageur du train
 */
export function buildLine(train: Train, regime: Regime, context: LineContext): VehicleJourneyLine | undefined {
	if (regime === "ECS") {
		return undefined;
	}

	const first = firstPassengerCall(train);
	const last = lastPassengerCall(train);
	if (first === undefined || last === undefined) {
		return undefined;
	}

	const ref = `${context.networkRef}:Line:${train.toc}:${first.tiploc}>${last.tiploc}`;
	const number =
		context.mapHeadcodeToLineName?.(train.trainId) ??
		`${context.placeName(first.tiploc)} → ${context.placeName(last.tiploc)}`;

	// À défaut de couleur configurée, une couleur dérivée du nom de l'opérateur.
	const brand = context.tocColors?.[train.toc] ?? deriveColor(context.operatorName(train.toc) ?? train.toc);

	return {
		ref,
		number,
		type: "RAIL",
		color: brand.color,
		textColor: brand.textColor,
	};
}
