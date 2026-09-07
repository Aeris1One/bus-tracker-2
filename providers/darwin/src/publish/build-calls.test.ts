import { describe, expect, it } from "vitest";

import type { Call, CallTag } from "../domain/call.js";
import type { Regime } from "../domain/regime.js";
import { createShape, type Shape } from "../domain/shape.js";
import { buildCalls, type CallBuildContext } from "./build-calls.js";

function makeCall(tag: CallTag, order: number, overrides: Partial<Call> = {}): Call {
	return {
		tag,
		tiploc: `TIPLOC${order}`,
		activity: "",
		order,
		platformSuppressed: false,
		locationSuppressed: false,
		platformConfirmed: false,
		cancelled: false,
		...overrides,
	};
}

const COORDINATES: Record<string, { latitude: number; longitude: number }> = {
	TIPLOC0: { latitude: 51.5, longitude: -0.1 },
	TIPLOC1: { latitude: 51.6, longitude: -0.2 },
};

function baseContext(overrides: Partial<CallBuildContext> = {}): CallBuildContext {
	return {
		placeName: (tiploc) => `Nom de ${tiploc}`,
		coordinatesOf: (tiploc) => COORDINATES[tiploc],
		activeShape: undefined,
		suppressDistances: true,
		...overrides,
	};
}

function makeShape(): Shape {
	return createShape("TIPLOC0>TIPLOC1", "redis:key", [
		{ latitude: 51.5, longitude: -0.1, distance: 0, callOrder: 0 },
		{ latitude: 51.6, longitude: -0.2, distance: 1000, callOrder: 1 },
	]);
}

describe("buildCalls — sélection par régime", () => {
	it("régime ECS : tous les points sauf ceux de tag PP", () => {
		const calls = [
			makeCall("PP", 0, { aimedWorkingPass: 1_000 }),
			makeCall("OPOR", 1, { aimedWorkingArrival: 2_000 }),
			makeCall("OR", 2, { aimedPublicDeparture: 3_000 }),
		];
		const { calls: published } = buildCalls(calls, "ECS", baseContext());
		expect(published.map((c) => c.stopOrder)).toEqual([1, 2]);
	});

	it("régime voyageur : uniquement les points OR/IP/DT", () => {
		const calls = [
			makeCall("OPOR", 0, { aimedWorkingArrival: 1_000 }),
			makeCall("OR", 1, { aimedPublicDeparture: 2_000 }),
			makeCall("PP", 2, { aimedWorkingPass: 3_000 }),
			makeCall("DT", 3, { aimedPublicArrival: 4_000 }),
		];
		const { calls: published } = buildCalls(calls, "PASSENGER", baseContext());
		expect(published.map((c) => c.stopOrder)).toEqual([1, 3]);
	});
});

describe("buildCalls — aucune clé à undefined", () => {
	it("un objet publié ne porte jamais de valeur undefined, champ par champ", () => {
		const calls = [makeCall("OR", 5, { aimedPublicDeparture: 1_000 })];
		const { calls: published } = buildCalls(calls, "PASSENGER", baseContext());
		expect(published).toHaveLength(1);
		const call = published[0];
		expect(call).toBeDefined();
		for (const value of Object.values(call as object)) {
			expect(value).not.toBeUndefined();
		}
	});
});

describe("buildCalls — les quatre lignes du tableau des priorités d'heure théorique", () => {
	it("call voyageur, dernier de la liste : arrivée publique prime", () => {
		const calls = [
			makeCall("OR", 0, { aimedPublicDeparture: 100 }),
			makeCall("DT", 1, {
				aimedPublicArrival: 111,
				aimedPublicDeparture: 222,
				aimedWorkingArrival: 333,
				aimedWorkingDeparture: 444,
				aimedWorkingPass: 555,
			}),
		];
		const { calls: published } = buildCalls(calls, "PASSENGER", baseContext());
		expect(published[1]?.aimedTime).toBe(new Date(111).toISOString());
	});

	it("call voyageur, non dernier : départ public prime", () => {
		const calls = [
			makeCall("OR", 0, {
				aimedPublicArrival: 111,
				aimedPublicDeparture: 222,
				aimedWorkingArrival: 333,
				aimedWorkingDeparture: 444,
				aimedWorkingPass: 555,
			}),
			makeCall("DT", 1, { aimedPublicArrival: 999 }),
		];
		const { calls: published } = buildCalls(calls, "PASSENGER", baseContext());
		expect(published[0]?.aimedTime).toBe(new Date(222).toISOString());
	});

	it("call non voyageur (ECS), dernier de la liste : arrivée technique prime", () => {
		const calls = [
			makeCall("OPIP", 0, {
				aimedWorkingArrival: 111,
				aimedWorkingDeparture: 222,
				aimedWorkingPass: 333,
				aimedPublicArrival: 444,
				aimedPublicDeparture: 555,
			}),
		];
		const { calls: published } = buildCalls(calls, "ECS", baseContext());
		expect(published[0]?.aimedTime).toBe(new Date(111).toISOString());
	});

	it("call non voyageur (ECS), non dernier : départ technique prime", () => {
		const calls = [
			makeCall("OPIP", 0, {
				aimedWorkingArrival: 111,
				aimedWorkingDeparture: 222,
				aimedWorkingPass: 333,
				aimedPublicArrival: 444,
				aimedPublicDeparture: 555,
			}),
			makeCall("OPIP", 1, { aimedWorkingPass: 999 }),
		];
		const { calls: published } = buildCalls(calls, "ECS", baseContext());
		expect(published[0]?.aimedTime).toBe(new Date(222).toISOString());
	});
});

describe("buildCalls — omission d'un point sans heure résoluble", () => {
	it("un point sans aucune des cinq heures est purement omis et compté, jamais publié à 1970", () => {
		const calls = [makeCall("OR", 0, {}), makeCall("DT", 1, { aimedPublicArrival: 1_000 })];
		const { calls: published, omitted } = buildCalls(calls, "PASSENGER", baseContext());
		expect(omitted).toBe(1);
		expect(published).toHaveLength(1);
		expect(published[0]?.stopOrder).toBe(1);
	});
});

describe("buildCalls — stopOrder absolu, croissant après troncature", () => {
	it("conserve le rang absolu, non nul, strictement croissant", () => {
		const calls = [
			makeCall("OR", 7, { aimedPublicDeparture: 1_000 }),
			makeCall("IP", 8, { aimedPublicArrival: 2_000, aimedPublicDeparture: 2_100 }),
			makeCall("DT", 9, { aimedPublicArrival: 3_000 }),
		];
		const { calls: published } = buildCalls(calls, "PASSENGER", baseContext());
		const orders = published.map((c) => c.stopOrder);
		expect(orders).toEqual([7, 8, 9]);
		expect(orders.every((order, index) => index === 0 || order > (orders[index - 1] ?? -1))).toBe(true);
	});
});

describe("buildCalls — indicateurs d'office en régime ECS", () => {
	it("NO_PICKUP et NO_DROP_OFF sont ajoutés à chaque point publié, quel que soit le code d'activité", () => {
		const calls = [
			makeCall("IP", 0, { activity: "T", aimedWorkingPass: 1_000 }),
			makeCall("PP", 1, { activity: "-", aimedWorkingPass: 2_000 }),
		];
		const { calls: published } = buildCalls(calls, "ECS", baseContext());
		for (const call of published) {
			expect(call.flags).toEqual(expect.arrayContaining(["NO_PICKUP", "NO_DROP_OFF"]));
			expect(call.flags).toHaveLength(2);
		}
	});

	it("hors ECS, les indicateurs suivent le sans ajout automatique", () => {
		const calls = [makeCall("OR", 0, { activity: "D", aimedPublicDeparture: 1_000 })];
		const { calls: published } = buildCalls(calls, "PASSENGER", baseContext());
		expect(published[0]?.flags).toEqual(["NO_PICKUP"]);
	});
});

describe("buildCalls — coordonnées omises si une seule est connue", () => {
	it("aucune coordonnée publiée quand le lieu n'a que sa latitude", () => {
		const calls = [makeCall("OR", 0, { tiploc: "PARTIAL", aimedPublicDeparture: 1_000 })];
		const context = baseContext({ coordinatesOf: () => undefined });
		const { calls: published } = buildCalls(calls, "PASSENGER", context);
		expect(published[0]?.latitude).toBeUndefined();
		expect(published[0]?.longitude).toBeUndefined();
	});

	it("coordonnées publiées quand les deux sont connues", () => {
		const calls = [makeCall("OR", 0, { aimedPublicDeparture: 1_000 })];
		const { calls: published } = buildCalls(calls, "PASSENGER", baseContext());
		expect(published[0]?.latitude).toBe(COORDINATES.TIPLOC0?.latitude);
		expect(published[0]?.longitude).toBe(COORDINATES.TIPLOC0?.longitude);
	});
});

describe("buildCalls — distance publiée uniquement via le tracé actif", () => {
	it("aucun tracé actif ⇒ aucune distance publiée", () => {
		const calls = [makeCall("OR", 0, { aimedPublicDeparture: 1_000 })];
		const { calls: published } = buildCalls(
			calls,
			"PASSENGER",
			baseContext({ activeShape: undefined, suppressDistances: true }),
		);
		expect(published[0]?.distanceTraveled).toBeUndefined();
	});

	it("tracé actif présent et suppressDistances faux : distance lue sur le tracé, par rang", () => {
		const shape = makeShape();
		const calls = [
			makeCall("OR", 0, { aimedPublicDeparture: 1_000 }),
			makeCall("DT", 1, { aimedPublicArrival: 2_000 }),
		];
		const { calls: published } = buildCalls(
			calls,
			"PASSENGER",
			baseContext({ activeShape: shape, suppressDistances: false }),
		);
		expect(published[0]?.distanceTraveled).toBe(0);
		expect(published[1]?.distanceTraveled).toBe(1000);
	});

	it("suppressDistances vrai malgré un tracé actif ⇒ aucune distance publiée", () => {
		const shape = makeShape();
		const calls = [makeCall("OR", 0, { aimedPublicDeparture: 1_000 })];
		const { calls: published } = buildCalls(
			calls,
			"PASSENGER",
			baseContext({ activeShape: shape, suppressDistances: true }),
		);
		expect(published[0]?.distanceTraveled).toBeUndefined();
	});

	it("point absent du tracé (rang inconnu) : distance omise pour ce seul point", () => {
		const shape = makeShape();
		const calls = [makeCall("OR", 42, { aimedPublicDeparture: 1_000 })];
		const { calls: published } = buildCalls(
			calls,
			"PASSENGER",
			baseContext({ activeShape: shape, suppressDistances: false }),
		);
		expect(published[0]?.distanceTraveled).toBeUndefined();
	});
});

describe("buildCalls — heure prévue facultative", () => {
	it("estDernier : arrivée prévue, à défaut réelle", () => {
		const calls = [makeCall("DT", 0, { aimedPublicArrival: 1_000, expectedArrival: 1_050 })];
		const { calls: published } = buildCalls(calls, "PASSENGER", baseContext());
		expect(published[0]?.expectedTime).toBe(new Date(1_050).toISOString());
	});

	it("non estDernier : départ prévu, à défaut réel", () => {
		const calls = [
			makeCall("OR", 0, { aimedPublicDeparture: 1_000, expectedDeparture: 1_050 }),
			makeCall("DT", 1, { aimedPublicArrival: 2_000 }),
		];
		const { calls: published } = buildCalls(calls, "PASSENGER", baseContext());
		expect(published[0]?.expectedTime).toBe(new Date(1_050).toISOString());
	});

	it("à défaut de tout : heure technique prévue, seule heure des lieux sans arrêt", () => {
		const calls = [makeCall("OPIP", 0, { aimedWorkingPass: 1_000, expectedWorking: 1_010 })];
		const { calls: published } = buildCalls(calls, "ECS", baseContext());
		expect(published[0]?.expectedTime).toBe(new Date(1_010).toISOString());
	});
});

describe("buildCalls — statut, nom et quai", () => {
	it("callStatus SKIPPED pour un point annulé, SCHEDULED sinon", () => {
		const calls = [
			makeCall("OR", 0, { aimedPublicDeparture: 1_000, cancelled: true }),
			makeCall("DT", 1, { aimedPublicArrival: 2_000 }),
		];
		const { calls: published } = buildCalls(calls, "PASSENGER", baseContext());
		expect(published[0]?.callStatus).toBe("SKIPPED");
		expect(published[1]?.callStatus).toBe("SCHEDULED");
	});

	it("stopRef porte le préfixe fixe NR, jamais l'opérateur", () => {
		const calls = [makeCall("OR", 0, { aimedPublicDeparture: 1_000 })];
		const { calls: published } = buildCalls(calls, "PASSENGER", baseContext());
		expect(published[0]?.stopRef).toBe("NR:StopPoint:TIPLOC0");
	});

	it("platformName publié seulement si connu et non masqué", () => {
		const hidden: Regime = "PASSENGER";
		const calls = [
			makeCall("OR", 0, { aimedPublicDeparture: 1_000, platform: "4", locationSuppressed: true }),
			makeCall("DT", 1, { aimedPublicArrival: 2_000, platform: "5", locationSuppressed: false }),
		];
		const { calls: published } = buildCalls(calls, hidden, baseContext());
		expect(published[0]?.platformName).toBeUndefined();
		expect(published[1]?.platformName).toBe("5");
	});
});
