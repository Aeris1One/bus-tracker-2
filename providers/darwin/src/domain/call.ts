import type { VehicleJourneyCallFlags } from "@bus-tracker/contracts";

export const CALL_TAGS = ["OR", "IP", "DT", "OPOR", "OPIP", "OPDT", "PP"] as const;
export const PASSENGER_TAGS = ["OR", "IP", "DT"] as const;

export type CallTag = (typeof CALL_TAGS)[number];

export function isCallTag(value: string): value is CallTag {
	return (CALL_TAGS as readonly string[]).includes(value);
}

export function isPassengerTag(tag: CallTag): boolean {
	return (PASSENGER_TAGS as readonly string[]).includes(tag);
}

export type Call = {
	readonly tag: CallTag;
	readonly tiploc: string;
	readonly activity: string;
	/** Rang absolu dans l'horaire complet, de 0 à n−1. C'est le `stopOrder` publié. */
	readonly order: number;
	// Théorique
	aimedPublicArrival?: number;
	aimedPublicDeparture?: number;
	aimedWorkingArrival?: number;
	aimedWorkingDeparture?: number;
	aimedWorkingPass?: number;
	// Temps réel
	expectedArrival?: number;
	actualArrival?: number;
	expectedDeparture?: number;
	actualDeparture?: number;
	expectedWorking?: number;
	platform?: string;

	// Le quai doit être masqué si `plat.platsup` est vrai **ou** si `suppr` de la location l'est.
	platformSuppressed: boolean;
	locationSuppressed: boolean;
	platformConfirmed: boolean;
	cancelled: boolean;
	lateReason?: number;
	cancelReason?: number;
};

/**
 * Droits de montée et de descente, dans l'ordre prescrit, le premier cas rencontré étant seul
 * appliqué.
 */
export function computeCallFlags(tag: CallTag, activity: string): VehicleJourneyCallFlags[] {
	if (tag === "OPOR" || tag === "OPIP" || tag === "OPDT") {
		return ["NO_PICKUP", "NO_DROP_OFF"];
	}
	// /!\ Comparaison EXACTE sur les chaines trimées. Les codes "-D" et "-U" existent et ne 
	// veulent PAS dire "D" ou "U".
	const cleaned = activity.replaceAll(" ", "");
	if (cleaned === "-" || cleaned === "") {
		return ["NO_PICKUP", "NO_DROP_OFF"];
	}
	if (cleaned === "D") {
		return ["NO_PICKUP"];
	}
	if (cleaned === "U") {
		return ["NO_DROP_OFF"];
	}
	return [];
}

/** Arrivée effective, par ordre de priorité décroissante. */
export function effectiveArrival(call: Call): number | undefined {
	return (
		call.actualArrival ??
		call.expectedArrival ??
		call.aimedWorkingArrival ??
		call.expectedWorking ??
		call.aimedWorkingPass ??
		call.aimedPublicArrival
	);
}

/** Départ effectif, +∞ compris. */
export function effectiveDeparture(call: Call): number | undefined {
	// Si ne arrivée réelle est connue mais aucun départ réel alors le train est à quai.
	if (call.actualArrival !== undefined && call.actualDeparture === undefined) {
		return Number.POSITIVE_INFINITY;
	}
	return (
		call.actualDeparture ??
		call.expectedDeparture ??
		call.aimedWorkingDeparture ??
		call.expectedWorking ??
		call.aimedWorkingPass ??
		call.aimedPublicDeparture
	);
}

/** Le quai n'est publié que s'il est connu ET non masqué. */
export function isPlatformHidden(call: Call): boolean {
	return call.platformSuppressed || call.locationSuppressed;
}
