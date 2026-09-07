import { describe, expect, it } from "vitest";

import { TIME_MAX_SHIFTS } from "../constants.js";
import { parseDarwinTime, representativeTime, resolveAimedTimes } from "./time.js";

/** Construit l'epoch (ms) d'une heure locale britannique donnée, pour comparaison dans les tests. */
function londonMs(date: string, hour: number, minute = 0, second = 0): number {
	return Temporal.PlainDate.from(date).toZonedDateTime({
		timeZone: "Europe/London",
		plainTime: new Temporal.PlainTime(hour, minute, second),
	}).epochMilliseconds;
}

describe("parseDarwinTime(raw, serviceDate, reference)", () => {
	it("analyse les trois formats, complétant les composantes manquantes par zéro", () => {
		expect(parseDarwinTime("16", "2026-06-15", undefined)).toBe(londonMs("2026-06-15", 16, 0, 0));
		expect(parseDarwinTime("16:30", "2026-06-15", undefined)).toBe(londonMs("2026-06-15", 16, 30, 0));
		expect(parseDarwinTime("16:30:45", "2026-06-15", undefined)).toBe(londonMs("2026-06-15", 16, 30, 45));
	});

	it.each([undefined, "abc", "16:ab", "16:", "+16", "16.0", "0x10"])("rend undefined sans lever sur %o", (raw) => {
		expect(() => parseDarwinTime(raw, "2026-06-15", undefined)).not.toThrow();
		expect(parseDarwinTime(raw, "2026-06-15", undefined)).toBeUndefined();
	});

	it("tolère les espaces parasites autour des composantes", () => {
		expect(parseDarwinTime(" 16:30 ", "2026-06-15", undefined)).toBe(londonMs("2026-06-15", 16, 30, 0));
		expect(parseDarwinTime("16: 30", "2026-06-15", undefined)).toBe(londonMs("2026-06-15", 16, 30, 0));
		// La tolérance ne relâche pas le contrôle : ces formes restent refusées.
		expect(parseDarwinTime(" + 16 ", "2026-06-15", undefined)).toBeUndefined();
		expect(parseDarwinTime("  ", "2026-06-15", undefined)).toBeUndefined();
	});

	it("rend undefined sans lever sur une chaîne vide", () => {
		expect(() => parseDarwinTime("", "2026-06-15", undefined)).not.toThrow();
		expect(parseDarwinTime("", "2026-06-15", undefined)).toBeUndefined();
	});

	it("un champ heures >= 24 fait avancer la date du quotient, l'heure prise modulo 24", () => {
		const result = parseDarwinTime("25:10", "2026-03-01", undefined);
		expect(result).toBe(londonMs("2026-03-02", 1, 10, 0));
	});

	it("le décalage d'un jour au-dessus du changement d'heure de mars dure 23 heures réelles", () => {
		// Dimanche 29 mars 2026 : passage à l'heure d'été au Royaume-Uni (jour de 23 h).
		const beforeChange = parseDarwinTime("12:00", "2026-03-28", undefined);
		const afterOneDayShift = parseDarwinTime("36:00", "2026-03-28", undefined); // 36h => jour +1, 12:00
		expect(afterOneDayShift).toBe(londonMs("2026-03-29", 12, 0, 0));
		expect(afterOneDayShift! - beforeChange!).toBe(23 * 3_600_000);
		expect(afterOneDayShift! - beforeChange!).not.toBe(24 * 3_600_000);
	});

	it("un décalage d'un jour par bornage au-dessus du changement d'heure d'octobre dure 25 heures réelles", () => {
		// Dimanche 25 octobre 2026 : retour à l'heure d'hiver au Royaume-Uni (jour de 25 h).
		const reference = londonMs("2026-10-24", 12, 0, 0);
		// Ancré sur le 25 octobre à midi, largement au-delà de la tolérance avant (6 h) : un
		// décalage arrière d'un jour de calendrier est nécessaire pour revenir dans la fenêtre.
		const shifted = parseDarwinTime("12:00", "2026-10-25", reference);
		expect(shifted).toBe(londonMs("2026-10-24", 12, 0, 0));

		// Le sens inverse illustre directement l'écart réel de 25 h entre les deux jours civils.
		const day1 = parseDarwinTime("12:00", "2026-10-24", undefined);
		const day2 = parseDarwinTime("12:00", "2026-10-25", undefined);
		expect(day2! - day1!).toBe(25 * 3_600_000);
		expect(day2! - day1!).not.toBe(24 * 3_600_000);
	});

	it("un train partant à 23:50 : l'arrêt de 23:55 reste le même jour, celui de 00:15 bascule au lendemain", () => {
		const serviceDate = "2026-06-15";
		const departure = parseDarwinTime("23:50", serviceDate, undefined);
		expect(departure).toBe(londonMs(serviceDate, 23, 50, 0));

		const nextCallSameEvening = parseDarwinTime("23:55", serviceDate, departure);
		expect(nextCallSameEvening).toBe(londonMs(serviceDate, 23, 55, 0));

		const callAfterMidnight = parseDarwinTime("00:15", serviceDate, departure);
		expect(callAfterMidnight).toBe(londonMs("2026-06-16", 0, 15, 0));
	});

	it("ne boucle pas sur une donnée aberrante : au plus 5 décalages par sens", () => {
		const serviceDate = "2026-06-01";
		const anchor = Temporal.PlainDate.from(serviceDate).toZonedDateTime({
			timeZone: "Europe/London",
			plainTime: new Temporal.PlainTime(0, 0, 0),
		});
		// Référence 100 jours plus tard : bien au-delà de ce que 5 décalages en arrière peuvent
		// rattraper. Le résultat doit s'arrêter après exactement TIME_MAX_SHIFTS décalages, pas
		// converger vers la référence.
		const farReference = anchor.add({ days: 100 }).epochMilliseconds;
		const expected = anchor.add({ days: TIME_MAX_SHIFTS }).epochMilliseconds;
		expect(parseDarwinTime("00:00", serviceDate, farReference)).toBe(expected);
	});

	it("une SSD malformée ne fait pas lever, et rend undefined", () => {
		expect(() => parseDarwinTime("12:00", "ab-c-", undefined)).not.toThrow();
		expect(parseDarwinTime("12:00", "ab-c-", undefined)).toBeUndefined();
	});
});

describe("resolveAimedTimes(raw, serviceDate, reference)", () => {
	it("analyse les cinq heures contre la même référence, puis calcule la référence suivante", () => {
		const serviceDate = "2026-06-15";
		const { times, reference } = resolveAimedTimes(
			{ wta: "10:00", wtd: "10:02", pta: "10:01", ptd: "10:03", wtp: "10:04" },
			serviceDate,
			undefined,
		);
		expect(times.aimedWorkingArrival).toBe(londonMs(serviceDate, 10, 0));
		expect(times.aimedWorkingDeparture).toBe(londonMs(serviceDate, 10, 2));
		expect(times.aimedPublicArrival).toBe(londonMs(serviceDate, 10, 1));
		expect(times.aimedPublicDeparture).toBe(londonMs(serviceDate, 10, 3));
		expect(times.aimedWorkingPass).toBe(londonMs(serviceDate, 10, 4));
		// Priorité : wtd d'abord.
		expect(reference).toBe(londonMs(serviceDate, 10, 2));
	});

	it("conserve la référence précédente quand aucune des cinq heures n'existe", () => {
		const { reference } = resolveAimedTimes({}, "2026-06-15", 123);
		expect(reference).toBe(123);
	});
});

describe("representativeTime(times)", () => {
	it("suit l'ordre wtd ?? wta ?? ptd ?? pta ?? wtp", () => {
		expect(representativeTime({ aimedWorkingDeparture: 1, aimedWorkingArrival: 2 })).toBe(1);
		expect(representativeTime({ aimedWorkingArrival: 2, aimedPublicDeparture: 3 })).toBe(2);
		expect(representativeTime({ aimedPublicDeparture: 3, aimedPublicArrival: 4 })).toBe(3);
		expect(representativeTime({ aimedPublicArrival: 4, aimedWorkingPass: 5 })).toBe(4);
		expect(representativeTime({ aimedWorkingPass: 5 })).toBe(5);
		expect(representativeTime({})).toBeUndefined();
	});
});
