import { emptyPositionTypeCounts } from "@bus-tracker/monitoring";
import { describe, expect, it } from "vitest";

import type { Configuration } from "../configuration/configuration.js";
import { createContext } from "../context.js";
import type { Call, CallTag } from "../domain/call.js";
import type { Train } from "../domain/train.js";
import { buildJourney } from "./build-journey.js";
import type { Publisher } from "./publisher.js";

function makeConfiguration(overrides: Partial<Configuration> = {}): Configuration {
	return {
		id: "national-rail",
		computeDelayMs: 30_000,
		gcsBucket: "bucket",
		kafkaBrokers: [],
		kafkaTopic: "topic",
		kafkaGroupId: "imposed-group",
		kafkaSasl: { username: "", password: "" },
		showDeparturesWithinMs: 600_000,
		keepAfterArrivalMs: 300_000,
		getNetworkRef: (train) => `NR:${train?.toc.trim() || "UNKNOWN"}`,
		...overrides,
	};
}

function noopPublisher(): Publisher {
	return {
		publishJourneys: async () => emptyPositionTypeCounts(),
		publishShapes: async () => {},
		resetKeyRegistry: () => {},
	};
}

function makeCall(tag: CallTag, tiploc: string, order: number, overrides: Partial<Call> = {}): Call {
	return {
		tag,
		tiploc,
		activity: "",
		order,
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
		origin: calls[0]?.tiploc ?? "ORIG",
		destination: calls.at(-1)?.tiploc ?? "DEST",
		cancelled: false,
		...overrides,
	};
}

// Date locale explicite, comme `domain/eligibility.test.ts` : `isRelevantServiceDate` compare dans
// le fuseau local de la machine.
const NOW = new Date(2026, 0, 1, 12, 0, 0).getTime();

/** Aucune clé de l'objet produit ne doit porter `undefined`, récursivement. */
function assertNoUndefinedDeep(value: unknown, path = "journey"): void {
	if (value === undefined) {
		throw new Error(`valeur undefined trouvée à ${path}`);
	}
	if (Array.isArray(value)) {
		for (const [index, item] of value.entries()) {
			assertNoUndefinedDeep(item, `${path}[${index}]`);
		}
		return;
	}
	if (value !== null && typeof value === "object") {
		for (const [key, item] of Object.entries(value)) {
			assertNoUndefinedDeep(item, `${path}.${key}`);
		}
	}
}

describe("buildJourney — train écarté", () => {
	it("rend undefined pour un train annulé", () => {
		const context = createContext(makeConfiguration(), noopPublisher());
		const train = makeTrain([makeCall("OR", "PADTON", 0, { aimedPublicDeparture: NOW })], { cancelled: true });

		expect(buildJourney(context, train, NOW)).toBeUndefined();
	});
});

describe("buildJourney — régime ECS", () => {
	it("ni line, ni distance nulle part, destination fixe, indicateurs forcés, aucune clé undefined", () => {
		const context = createContext(makeConfiguration(), noopPublisher());
		// Un seul lieu coordonné dans tout le train : le critère `Localisable` est satisfait, mais le
		// tracé unique (WHOLE) ne peut jamais atteindre les deux points nécessaires à sa construction —
		// aucune distance n'est donc calculable nulle part pour ce train.
		context.references.mergeCoordinates(new Map([["DEPOT", { latitude: 51.5, longitude: -0.1 }]]));

		const train = makeTrain([
			makeCall("OPOR", "DEPOT", 0, { activity: "T", aimedWorkingDeparture: NOW }),
			makeCall("OPIP", "YARD", 1, { activity: "T", aimedWorkingPass: NOW + 10_000 }),
			makeCall("OPDT", "SIDING", 2, { activity: "T", aimedWorkingArrival: NOW + 20_000 }),
		]);

		const result = buildJourney(context, train, NOW);
		expect(result).toBeDefined();
		const { journey, shapes } = result as NonNullable<typeof result>;

		assertNoUndefinedDeep(journey);
		expect(journey.line).toBeUndefined();
		expect(journey.destination).toBe("Not taking passengers");
		expect(journey.pathRef).toBeUndefined();
		expect(journey.position.distanceTraveled).toBeUndefined();
		expect(journey.calls).toHaveLength(3);
		for (const call of journey.calls ?? []) {
			expect(call.distanceTraveled).toBeUndefined();
			expect(call.flags).toEqual(expect.arrayContaining(["NO_PICKUP", "NO_DROP_OFF"]));
		}
		// Un seul segment (WHOLE) pour un train sans aucune portion voyageur : aucun tracé n'a pu être
		// construit, la carte rendue est donc vide plutôt que de contenir une entrée inutilisable.
		expect(shapes.size).toBe(0);
	});
});

describe("buildJourney — régime voyageur", () => {
	function makePassengerContext() {
		const context = createContext(makeConfiguration(), noopPublisher());
		// `setPlaces` REMPLACE la table des lieux : il doit précéder `mergeCoordinates`, qui ne
		// complète que les lieux déjà connus — l'inverse effacerait les coordonnées.
		context.references.setPlaces(
			new Map([
				["PADTON", { tiploc: "PADTON", name: "London Paddington" }],
				["RDNGSTN", { tiploc: "RDNGSTN", name: "Reading" }],
				["SWINDON", { tiploc: "SWINDON", name: "Swindon" }],
			]),
		);
		context.references.mergeCoordinates(
			new Map([
				["PADTON", { latitude: 51.5, longitude: -0.1 }],
				["RDNGSTN", { latitude: 51.458, longitude: -0.971 }],
				["SWINDON", { latitude: 51.568, longitude: -1.782 }],
			]),
		);
		return context;
	}

	function makePassengerTrain(): Train {
		return makeTrain([
			makeCall("OR", "PADTON", 0, { aimedPublicDeparture: NOW }),
			makeCall("IP", "RDNGSTN", 1, { aimedPublicArrival: NOW + 600_000, aimedPublicDeparture: NOW + 660_000 }),
			makeCall("DT", "SWINDON", 2, { aimedPublicArrival: NOW + 1_200_000 }),
		]);
	}

	it("line et destination présentes, calls tronqués mais stopOrder absolu et croissant, aucune clé undefined", () => {
		const context = makePassengerContext();
		const train = makePassengerTrain();
		const nowMs = NOW + 600_000; // dans la fenêtre voyageurs, à quai à Reading.

		const result = buildJourney(context, train, nowMs);
		expect(result).toBeDefined();
		const { journey } = result as NonNullable<typeof result>;

		assertNoUndefinedDeep(journey);
		expect(journey.line).toBeDefined();
		expect(journey.line?.ref).toBe("NR:GW:Line:GW:PADTON>SWINDON");
		expect(journey.destination).toBe("Swindon");

		// Troncature en tête : le premier call (OR, déjà franchi) n'apparaît plus, donc le rang publié
		// ne démarre pas à 0, mais reste le rang ABSOLU dans l'horaire complet.
		const orders = (journey.calls ?? []).map((c) => c.stopOrder);
		expect(orders[0]).toBeGreaterThan(0);
		expect(orders.every((order, index) => index === 0 || order > (orders[index - 1] ?? -1))).toBe(true);
	});

	it("aucun point de tag technique ou PP n'est publié", () => {
		const context = makePassengerContext();
		const train = makeTrain([
			makeCall("OPOR", "DEPOT", 0, { aimedWorkingDeparture: NOW - 100_000 }),
			makeCall("OR", "PADTON", 1, { aimedPublicDeparture: NOW }),
			makeCall("PP", "JUNCTION", 2, { aimedWorkingPass: NOW + 300_000 }),
			makeCall("IP", "RDNGSTN", 3, { aimedPublicArrival: NOW + 600_000, aimedPublicDeparture: NOW + 660_000 }),
			makeCall("DT", "SWINDON", 4, { aimedPublicArrival: NOW + 1_200_000 }),
		]);
		context.references.mergeCoordinates(new Map([["DEPOT", { latitude: 51.52, longitude: -0.11 }]]));

		const result = buildJourney(context, train, NOW);
		expect(result).toBeDefined();
		const { journey } = result as NonNullable<typeof result>;

		expect(
			(journey.calls ?? []).every((call) =>
				["PADTON", "RDNGSTN", "SWINDON"].includes(call.stopRef.split(":").at(-1) ?? ""),
			),
		).toBe(true);
	});

	it("invariant : la distance de la position et celle du point où le train est ancré coïncident, toutes deux issues de pathRef", () => {
		const context = makePassengerContext();
		const train = makePassengerTrain();
		const nowMs = NOW + 600_000; // à quai à Reading (order 1) : cf. test précédent.

		const result = buildJourney(context, train, nowMs);
		expect(result).toBeDefined();
		const { journey } = result as NonNullable<typeof result>;

		expect(journey.pathRef).toBeDefined();
		expect(journey.position.distanceTraveled).toBeDefined();
		const anchoredCall = (journey.calls ?? []).find((call) => call.stopRef.endsWith("RDNGSTN"));
		expect(anchoredCall?.distanceTraveled).toBe(journey.position.distanceTraveled);
	});
});

describe("buildJourney — les trois tracés de segment sont tous construits", () => {
	it("rend une carte des trois segments, même non actifs ; seul l'actif est référencé par pathRef", () => {
		const context = createContext(makeConfiguration(), noopPublisher());
		context.references.mergeCoordinates(
			new Map([
				["DEPOT", { latitude: 51.52, longitude: -0.12 }],
				["PADTON", { latitude: 51.5, longitude: -0.1 }],
				["RDNGSTN", { latitude: 51.458, longitude: -0.971 }],
				["SIDING", { latitude: 51.45, longitude: -0.98 }],
			]),
		);

		const train = makeTrain([
			makeCall("PP", "DEPOT", 0, { aimedWorkingPass: NOW - 500_000 }),
			makeCall("OR", "PADTON", 1, { aimedPublicDeparture: NOW }),
			makeCall("DT", "RDNGSTN", 2, { aimedPublicArrival: NOW + 600_000 }),
			makeCall("PP", "SIDING", 3, { aimedWorkingPass: NOW + 700_000 }),
		]);

		// Juste avant le départ effectif du premier call voyageur : régime ECS, actif sur le trail-in.
		const nowMs = NOW - 1_000;

		const result = buildJourney(context, train, nowMs);
		expect(result).toBeDefined();
		const { journey, shapes } = result as NonNullable<typeof result>;

		expect(new Set(shapes.keys())).toEqual(new Set(["TRAIL_IN", "PASSENGER", "TRAIL_OUT"]));
		expect(journey.pathRef).toBe(shapes.get("TRAIL_IN")?.redisKey);
		expect(journey.line).toBeUndefined();
	});

	it("la version de graphe du contexte se retrouve dans pathRef, et non une valeur figée", () => {
		// Ce segment de clé est ce qui invalide automatiquement les anciennes clés Redis quand la
		// topologie change. Le figer à `local` priverait le système de cette invalidation : après un
		// changement de graphe, les trains continueraient de référencer des géométries calculées sur
		// l'ancienne topologie.
		const context = createContext(makeConfiguration(), noopPublisher());
		context.references.mergeCoordinates(
			new Map([
				["PADTON", { latitude: 51.5, longitude: -0.1 }],
				["RDNGSTN", { latitude: 51.458, longitude: -0.971 }],
			]),
		);
		// `jobs/load-resources.ts` adopte la version du graphe une fois celui-ci chargé.
		context.graphVersion = "20260903";

		const train = makeTrain([
			makeCall("OR", "PADTON", 0, { aimedPublicDeparture: NOW }),
			makeCall("DT", "RDNGSTN", 1, { aimedPublicArrival: NOW + 600_000 }),
		]);

		const result = buildJourney(context, train, NOW);
		expect(result?.journey.pathRef).toContain(":20260903:");
		expect(result?.journey.pathRef).not.toContain(":local:");
	});

	it("sans graphe chargé, la version reste `local`", () => {
		const context = createContext(makeConfiguration(), noopPublisher());
		context.references.mergeCoordinates(
			new Map([
				["PADTON", { latitude: 51.5, longitude: -0.1 }],
				["RDNGSTN", { latitude: 51.458, longitude: -0.971 }],
			]),
		);

		const train = makeTrain([
			makeCall("OR", "PADTON", 0, { aimedPublicDeparture: NOW }),
			makeCall("DT", "RDNGSTN", 1, { aimedPublicArrival: NOW + 600_000 }),
		]);

		expect(buildJourney(context, train, NOW)?.journey.pathRef).toContain(":local:");
	});
});
