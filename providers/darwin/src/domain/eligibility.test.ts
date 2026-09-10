import { describe, expect, it } from "vitest";

import type { Call } from "./call.js";
import { type EligibilityOptions, evaluateTrain, findLastPassedIndex } from "./eligibility.js";
import type { Train } from "./train.js";

function makeCall(overrides: Partial<Call> = {}): Call {
	return {
		tag: "IP",
		tiploc: "TIPLOC1",
		activity: "",
		order: 0,
		platformSuppressed: false,
		locationSuppressed: false,
		platformConfirmed: false,
		cancelled: false,
		...overrides,
	};
}

function makeTrain(calls: Call[], overrides: Partial<Train> = {}): Train {
	return {
		rid: "202601010123456",
		uid: "A12345",
		ssd: "2026-01-01",
		trainId: "1A23",
		toc: "GW",
		calls,
		origin: "PADTON",
		destination: "RDNGSTN",
		cancelled: false,
		...overrides,
	};
}

// Date locale explicite : `isRelevantServiceDate` compare dans le fuseau local de la machine, pas
// en UTC — voir service-date.test.ts pour le même choix.
const NOW = new Date(2026, 0, 1, 12, 0, 0).getTime();
const OPTIONS: EligibilityOptions = { showDeparturesWithinMs: 600_000, keepAfterArrivalMs: 300_000 };
const alwaysLocatable = () => true;
const neverLocatable = () => false;

describe("findLastPassedIndex", () => {
	it("rend 0 si aucun point n'est franchi", () => {
		const calls = [makeCall({ order: 0, aimedPublicArrival: NOW + 10_000 }), makeCall({ order: 1 })];
		expect(findLastPassedIndex(calls, NOW)).toBe(0);
	});

	it("rend l'indice le plus élevé dont l'arrivée ou le départ effectif est déjà passé", () => {
		const calls = [
			makeCall({ order: 0, actualArrival: NOW - 20_000, actualDeparture: NOW - 19_000 }),
			makeCall({ order: 1, actualArrival: NOW - 10_000, actualDeparture: NOW - 9_000 }),
			makeCall({ order: 2, aimedPublicArrival: NOW + 10_000 }),
		];
		expect(findLastPassedIndex(calls, NOW)).toBe(1);
	});

	it("un point sans heure connue vaut +∞ et n'est jamais considéré franchi", () => {
		const calls = [makeCall({ order: 0 }), makeCall({ order: 1 })];
		expect(findLastPassedIndex(calls, NOW)).toBe(0);
	});
});

describe("evaluateTrain — les sept motifs de rejet", () => {
	it("CANCELLED — train marqué annulé", () => {
		const train = makeTrain([makeCall({ order: 0, aimedPublicDeparture: NOW })], { cancelled: true });
		expect(evaluateTrain(train, NOW, OPTIONS, alwaysLocatable)).toEqual({ rejectedBecause: "CANCELLED" });
	});

	it("CANCELLED — tous les points annulés, même sans le drapeau du train", () => {
		const train = makeTrain([
			makeCall({ order: 0, cancelled: true, aimedPublicDeparture: NOW }),
			makeCall({ order: 1, cancelled: true }),
		]);
		expect(evaluateTrain(train, NOW, OPTIONS, alwaysLocatable)).toEqual({ rejectedBecause: "CANCELLED" });
	});

	it("un train partiellement annulé reste publiable", () => {
		const calls = [
			makeCall({ order: 0, cancelled: true, aimedPublicDeparture: NOW - 1_000 }),
			makeCall({ order: 1, cancelled: false, aimedPublicArrival: NOW + 1_000 }),
		];
		const train = makeTrain(calls);
		const result = evaluateTrain(train, NOW, OPTIONS, alwaysLocatable);
		expect("rejectedBecause" in result).toBe(false);
	});

	it("BAD_SERVICE_DATE — SSD malformée", () => {
		const train = makeTrain([makeCall({ order: 0 })], { ssd: "not-a-date" });
		expect(evaluateTrain(train, NOW, OPTIONS, alwaysLocatable)).toEqual({ rejectedBecause: "BAD_SERVICE_DATE" });
	});

	it("IRRELEVANT_SERVICE_DATE — SSD bien formée mais hors d'hier/aujourd'hui/demain", () => {
		const train = makeTrain([makeCall({ order: 0 })], { ssd: "2020-01-01" });
		expect(evaluateTrain(train, NOW, OPTIONS, alwaysLocatable)).toEqual({
			rejectedBecause: "IRRELEVANT_SERVICE_DATE",
		});
	});

	it("TOO_EARLY — premier départ théorique au-delà de la fenêtre", () => {
		const train = makeTrain([makeCall({ order: 0, aimedPublicDeparture: NOW + 700_000 })]);
		expect(evaluateTrain(train, NOW, OPTIONS, alwaysLocatable)).toEqual({ rejectedBecause: "TOO_EARLY" });
	});

	it("un premier point sans heure théorique n'est jamais rejeté par la fenêtre avant départ", () => {
		const train = makeTrain([makeCall({ order: 0 }), makeCall({ order: 1, aimedPublicArrival: NOW + 1_000 })]);
		const result = evaluateTrain(train, NOW, OPTIONS, alwaysLocatable);
		expect("rejectedBecause" in result).toBe(false);
	});

	it("TOO_EARLY — un ECS n'a pas d'heure publique mais reste rejeté via son heure de travail", () => {
		const train = makeTrain([makeCall({ order: 0, aimedWorkingDeparture: NOW + 700_000 })]);
		expect(evaluateTrain(train, NOW, OPTIONS, alwaysLocatable)).toEqual({ rejectedBecause: "TOO_EARLY" });
	});

	it("un train déjà parti n'est jamais rejeté par la fenêtre avant départ", () => {
		// Heure théorique de départ largement dépassée : le train a déjà quitté son origine.
		const train = makeTrain([
			makeCall({ order: 0, aimedPublicDeparture: NOW - 3_600_000 }),
			makeCall({ order: 1, aimedPublicArrival: NOW + 1_000 }),
		]);
		const result = evaluateTrain(train, NOW, OPTIONS, alwaysLocatable);
		expect("rejectedBecause" in result).toBe(false);
	});

	it("TOO_LATE — arrivée au dernier point dépassant la fenêtre de rétention", () => {
		const train = makeTrain([
			makeCall({ order: 0, aimedPublicDeparture: NOW - 1_000_000 }),
			makeCall({ order: 1, actualArrival: NOW - 400_000 }),
		]);
		expect(evaluateTrain(train, NOW, OPTIONS, alwaysLocatable)).toEqual({ rejectedBecause: "TOO_LATE" });
	});

	it("NO_CALLS_LEFT — aucun point à publier après troncature", () => {
		// La troncature ne retient que l'indice le plus élevé déjà franchi jusqu'à la fin de la
		// liste : elle ne peut donc jamais vider une liste non vide. Seule une liste déjà vide déclenche
		// ce rejet — sans être classée CANCELLED par vérité vacueuse sur un tableau vide.
		const empty = makeTrain([]);
		expect(evaluateTrain(empty, NOW, OPTIONS, alwaysLocatable)).toEqual({ rejectedBecause: "NO_CALLS_LEFT" });
	});

	it("un train dont tous les points sont déjà franchis reste publié avec son dernier point", () => {
		const train = makeTrain([
			makeCall({ order: 0, actualArrival: NOW - 20_000, actualDeparture: NOW - 19_000 }),
			makeCall({ order: 1, actualArrival: NOW - 10_000, actualDeparture: NOW - 9_000 }),
		]);
		expect(evaluateTrain(train, NOW, OPTIONS, alwaysLocatable)).toEqual({ calls: [train.calls[1]] });
	});

	it("NOT_LOCATABLE — aucun point du train n'a de coordonnée connue", () => {
		const train = makeTrain([makeCall({ order: 0, aimedPublicDeparture: NOW })]);
		expect(evaluateTrain(train, NOW, OPTIONS, neverLocatable)).toEqual({ rejectedBecause: "NOT_LOCATABLE" });
	});
});

describe("evaluateTrain — troncature d'un train à mi-parcours", () => {
	it("la liste publiée démarre au dernier point franchi et conserve les points techniques", () => {
		const calls = [
			makeCall({ tag: "OR", tiploc: "A", order: 0, actualDeparture: NOW - 30_000 }),
			makeCall({ tag: "PP", tiploc: "B", order: 1, aimedWorkingPass: NOW - 20_000 }),
			makeCall({ tag: "IP", tiploc: "C", order: 2, actualArrival: NOW - 10_000, actualDeparture: NOW - 9_000 }),
			makeCall({ tag: "OPIP", tiploc: "D", order: 3, aimedWorkingPass: NOW + 5_000 }),
			makeCall({ tag: "DT", tiploc: "E", order: 4, aimedPublicArrival: NOW + 20_000 }),
		];
		const train = makeTrain(calls);
		const result = evaluateTrain(train, NOW, OPTIONS, alwaysLocatable);
		expect("calls" in result).toBe(true);
		if ("calls" in result) {
			// Le dernier point franchi est l'indice 2 (IP) : la liste commence là, en conservant les
			// points techniques (OPIP) qui suivent.
			expect(result.calls.map((call) => call.tiploc)).toEqual(["C", "D", "E"]);
		}
	});
});

describe("evaluateTrain — régression : un train en retard ne doit pas disparaître", () => {
	it("garde un train dont l'arrivée théorique est dépassée mais dont la prévision est à venir", () => {
		// Terminus théorique il y a 40 min, mais le temps réel annonce l'arrivée dans 10 min : le train
		// roule encore. Une lecture de « arrivée effective » réduite à l'arrivée réelle se rabattrait
		// sur l'heure théorique et écarterait le train alors qu'il est en cours de trajet.
		const train = makeTrain([
			makeCall({ tag: "OR", tiploc: "AAA", order: 0, aimedPublicDeparture: NOW - 7_200_000 }),
			makeCall({
				tag: "DT",
				tiploc: "BBB",
				order: 1,
				aimedWorkingArrival: NOW - 2_400_000,
				expectedArrival: NOW + 600_000,
			}),
		]);

		expect(evaluateTrain(train, NOW, OPTIONS, alwaysLocatable)).not.toHaveProperty("rejectedBecause");
	});

	it("écarte le train une fois son arrivée réelle dépassée de plus de keepAfterArrivalMs", () => {
		const train = makeTrain([
			makeCall({ tag: "OR", tiploc: "AAA", order: 0, aimedPublicDeparture: NOW - 7_200_000 }),
			makeCall({ tag: "DT", tiploc: "BBB", order: 1, actualArrival: NOW - 600_000 }),
		]);

		expect(evaluateTrain(train, NOW, OPTIONS, alwaysLocatable)).toEqual({ rejectedBecause: "TOO_LATE" });
	});
});
