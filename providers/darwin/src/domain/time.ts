// Analyse des heures Darwin et franchissement de minuit.

import {
	DARWIN_TIME_ZONE,
	TIME_BACKWARD_TOLERANCE_MS,
	TIME_FORWARD_TOLERANCE_MS,
	TIME_MAX_SHIFTS,
} from "../constants.js";

/** Instant de référence pour le bornage relatif, en millisecondes ; undefined au premier point. */
export type TimeReference = number | undefined;

export type RawTimes = { pta?: string; ptd?: string; wta?: string; wtd?: string; wtp?: string };

export type AimedTimes = {
	aimedPublicArrival?: number;
	aimedPublicDeparture?: number;
	aimedWorkingArrival?: number;
	aimedWorkingDeparture?: number;
	aimedWorkingPass?: number;
};

/**
 * Découpe "HH", "HH:MM" ou "HH:MM:SS" en trois composantes entières, les manquantes valant "00".
 * Retourne undefined s'il y a aucune ou trop de composantes ("00:00:00:00" ou "abc").
 */
const DIGITS_ONLY = /^\d+$/;

function splitComponents(raw: string): { hours: number; minutes: number; seconds: number } | undefined {
	const parts = raw.split(":");
	if (parts.length === 0 || parts.length > 3) {
		return undefined;
	}
	const [hoursPart = "", minutesPart = "00", secondsPart = "00"] = parts.map((part) => part.trim());
	if (!DIGITS_ONLY.test(hoursPart) || !DIGITS_ONLY.test(minutesPart) || !DIGITS_ONLY.test(secondsPart)) {
		return undefined;
	}
	return { hours: Number(hoursPart), minutes: Number(minutesPart), seconds: Number(secondsPart) };
}

/**
 * Analyse "HH", "HH:MM" ou "HH:MM:SS", ancre sur `serviceDate` et borne dans [reference − 6 h, reference + 18 h].
 * Retourne undefined sur une valeur vide, absente ou non numérique.
 */
export function parseDarwinTime(
	raw: string | undefined,
	serviceDate: string,
	reference: TimeReference,
): number | undefined {
	if (raw === undefined || raw === "") {
		return undefined;
	}
	const components = splitComponents(raw);
	if (components === undefined) {
		return undefined;
	}

	try {
		// Le champ heures peut dépasser 23 : un jour de changement d'heure peut faire 25 heures.
		const dayShift = Math.floor(components.hours / 24);
		const hour = components.hours % 24;

		let date = Temporal.PlainDate.from(serviceDate);
		if (dayShift !== 0) {
			date = date.add({ days: dayShift });
		}

		let zoned = date.toZonedDateTime({
			timeZone: DARWIN_TIME_ZONE,
			plainTime: new Temporal.PlainTime(hour, components.minutes, components.seconds),
		});

		if (reference === undefined) {
			return zoned.epochMilliseconds;
		}

		// Bornage relatif à la référence, au plus TIME_MAX_SHIFTS décalages de calendrier par sens,
		// pour ne jamais boucler sur une donnée aberrante.
		for (let i = 0; i < TIME_MAX_SHIFTS && reference - zoned.epochMilliseconds > TIME_BACKWARD_TOLERANCE_MS; i++) {
			zoned = zoned.add({ days: 1 });
		}
		for (let i = 0; i < TIME_MAX_SHIFTS && zoned.epochMilliseconds - reference > TIME_FORWARD_TOLERANCE_MS; i++) {
			zoned = zoned.subtract({ days: 1 });
		}

		return zoned.epochMilliseconds;
	} catch {
		return undefined;
	}
}

/**
 * Analyse les cinq heures d'un point contre la même référence — celle héritée du point précédent —
 * puis rend la référence à transmettre au point suivant.
 */
export function resolveAimedTimes(
	raw: RawTimes,
	serviceDate: string,
	reference: TimeReference,
): { times: AimedTimes; reference: TimeReference } {
	const aimedPublicArrival = parseDarwinTime(raw.pta, serviceDate, reference);
	const aimedPublicDeparture = parseDarwinTime(raw.ptd, serviceDate, reference);
	const aimedWorkingArrival = parseDarwinTime(raw.wta, serviceDate, reference);
	const aimedWorkingDeparture = parseDarwinTime(raw.wtd, serviceDate, reference);
	const aimedWorkingPass = parseDarwinTime(raw.wtp, serviceDate, reference);

	const times: AimedTimes = {
		aimedPublicArrival,
		aimedPublicDeparture,
		aimedWorkingArrival,
		aimedWorkingDeparture,
		aimedWorkingPass,
	};

	// Priorité de la référence suivante : départ technique, arrivée technique, départ public,
	// arrivée publique, heure de passage technique ; à défaut, la référence précédente est conservée.
	const nextReference =
		aimedWorkingDeparture ??
		aimedWorkingArrival ??
		aimedPublicDeparture ??
		aimedPublicArrival ??
		aimedWorkingPass ??
		reference;

	return { times, reference: nextReference };
}

/** Heure représentative d'un point */
export function representativeTime(times: AimedTimes): number | undefined {
	return (
		times.aimedWorkingDeparture ??
		times.aimedWorkingArrival ??
		times.aimedPublicDeparture ??
		times.aimedPublicArrival ??
		times.aimedWorkingPass
	);
}
