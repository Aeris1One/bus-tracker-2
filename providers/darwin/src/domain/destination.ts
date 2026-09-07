// Destination publiée pour un train, éventuellement enrichie d'un libellé « via ».

import type { Regime } from "./regime.js";
import type { Train } from "./train.js";

/** Texte affiché en régime ECS : le seul canal disponible pour signaler l'état hors service. */
const NOT_TAKING_PASSENGERS = "Not taking passengers";

export type ViaLookup = (at: string, dest: string, assocRid: string, origin: string) => string | undefined;
export type Association = {
	mainRid: string;
	assocRid: string;
	tiploc: string;
	wta?: string;
	wtd?: string;
	pta?: string;
	ptd?: string;
};

/**
 * Destination publiée.
 */
export function buildDestination(
	train: Train,
	regime: Regime,
	placeName: (tiploc: string) => string,
	associations: Association[],
	 via: ViaLookup,
): string | undefined {
	if (regime === "ECS") {
		return NOT_TAKING_PASSENGERS;
	}

	const last = train.calls.findLast((call) => !call.cancelled);
	if (last === undefined) {
		return undefined;
	}

	const name = placeName(last.tiploc);

	// Le libellé « via » n'est ajouté que si une association existe pour ce train ET que son
	// TIPLOC est EXACTEMENT celui de ce dernier point.
	const association = associations.find((candidate) => candidate.tiploc === last.tiploc);
	if (association === undefined) {
		return name;
	}

	// Les trois clés sont essayées dans l'ordre, la première trouvée l'emportant.
	const label =
		via(association.tiploc, last.tiploc, association.assocRid, "") ??
		via(association.tiploc, last.tiploc, "", "") ??
		via(association.tiploc, last.tiploc, train.origin, "");

	return label !== undefined ? `${name} ${label}` : name;
}
