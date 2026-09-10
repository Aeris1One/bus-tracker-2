import { emptyPositionTypeCounts } from "@bus-tracker/monitoring";
import { describe, expect, it } from "vitest";

import type { Configuration } from "../configuration/configuration.js";
import { createContext } from "../context.js";
import type { Publisher } from "../publish/publisher.js";
import { dispatch } from "./dispatch.js";
import type { Envelope } from "./envelope.js";

function makeConfiguration(): Configuration {
	return {
		id: "test",
		computeDelayMs: 30_000,
		gcsBucket: "bucket",
		kafkaBrokers: [],
		kafkaTopic: "topic",
		kafkaGroupId: "imposed-group",
		kafkaSasl: { username: "", password: "" },
		showDeparturesWithinMs: 600_000,
		keepAfterArrivalMs: 300_000,
		getNetworkRef: () => "NR:UNKNOWN",
	};
}

function makeEnvelope(payload: Record<string, unknown>): Envelope {
	return { payload, isSnapshot: false };
}

/** `Publisher` (L11) est concret : ces tests portent sur les handlers, jamais sur la
 * publication elle-même ; un double neutre suffit à satisfaire le type. */
const noopPublisher: Publisher = {
	publishJourneys: async () => emptyPositionTypeCounts(),
	publishShapes: async () => {},
	resetKeyRegistry: () => {},
};

describe("dispatch", () => {
	it("achemine `deactivated` vers son gestionnaire", () => {
		const context = createContext(makeConfiguration(), noopPublisher);
		context.trains.set({
			rid: "202609060001",
			uid: "",
			ssd: "2026-09-06",
			trainId: "",
			toc: "GW",
			calls: [],
			origin: "A",
			destination: "B",
			cancelled: false,
		});

		dispatch(context, makeEnvelope({ deactivated: { rid: "202609060001", ssd: "2026-09-06" } }));

		expect(context.trains.get("2026-09-06", "202609060001")?.cancelled).toBe(true);
	});

	it("achemine `TimeTableId`, dont l'argument peut être scalaire", () => {
		const context = createContext(makeConfiguration(), noopPublisher);

		dispatch(context, makeEnvelope({ TimeTableId: { ttfile: "20260906064431" } }));

		expect(context.timetable.announced).toBe("20260906064431");
	});

	it("accepte indifféremment un objet unique ou un tableau d'objets", () => {
		const context = createContext(makeConfiguration(), noopPublisher);

		dispatch(
			context,
			makeEnvelope({
				association: [
					{ category: "NP", tiploc: "R", main: { rid: "A" }, assoc: { rid: "B" } },
					{ category: "NP", tiploc: "S", main: { rid: "A" }, assoc: { rid: "C" } },
				],
			}),
		);

		expect(context.associations.forRid("A")).toHaveLength(2);
	});

	it("un type hors périmètre est acquitté, compté, et journalisé une seule fois", () => {
		const context = createContext(makeConfiguration(), noopPublisher);

		dispatch(context, makeEnvelope({ stationMessage: {}, trainOrder: {} }));
		dispatch(context, makeEnvelope({ stationMessage: {} }));

		expect(context.counters.get("stationMessage")).toBe(2);
		expect(context.counters.get("trainOrder")).toBe(1);
		// `seenFirstTime` a déjà été consommé par le dispatch : il ne rend plus vrai.
		expect(context.counters.seenFirstTime("stationMessage")).toBe(false);
	});

	it("les clés commençant par `@_` sont ignorées, sans être comptées", () => {
		const context = createContext(makeConfiguration(), noopPublisher);

		dispatch(context, makeEnvelope({ "@_version": "2.0" }));

		expect(context.counters.get("@_version")).toBe(0);
	});

	it("un type connu dont la valeur n'est pas un objet est ignoré sans lever", () => {
		const context = createContext(makeConfiguration(), noopPublisher);

		expect(() => dispatch(context, makeEnvelope({ deactivated: "pas un objet" }))).not.toThrow();
		expect(context.trains.size).toBe(0);
	});
});
