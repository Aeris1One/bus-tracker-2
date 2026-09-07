import { describe, expect, it } from "vitest";

import type { Configuration } from "../../configuration/configuration.js";
import { createContext } from "../../context.js";
import type { Publisher } from "../../publish/publisher.js";
import { handleTimetableId } from "./handle-timetable-id.js";

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

/** `Publisher` (L11) est concret : ces tests portent sur les handlers, jamais sur la
 * publication elle-même ; un double neutre suffit à satisfaire le type. */
const noopPublisher: Publisher = {
	publishJourneys: async () => 0,
	publishShapes: async () => {},
	resetKeyRegistry: () => {},
};

describe("handleTimetableId", () => {
	it("mémorise la version annoncée et arme la demande de rechargement", () => {
		const context = createContext(makeConfiguration(), noopPublisher);

		handleTimetableId(context, { ttfile: "20260906064431" });

		expect(context.timetable.announced).toBe("20260906064431");
		expect(context.timetable.reloadRequested).toBe(true);
	});

	it("lit `ttfile` aussi bien comme attribut préfixé `@_`", () => {
		const context = createContext(makeConfiguration(), noopPublisher);

		handleTimetableId(context, { "@_ttfile": "20260906064431" });

		expect(context.timetable.announced).toBe("20260906064431");
	});

	it("PIÈGE — un `ttfile` valant une seule espace n'a AUCUN effet", () => {
		// Une mise à jour ne concernant que le fichier de référentiel porte `ttfile` valant une seule
		// espace. La prendre pour une nouvelle version d'horaires déclencherait un rechargement
		// complet inutile — plusieurs dizaines de mégaoctets et une purge de tous les trains.
		const context = createContext(makeConfiguration(), noopPublisher);

		handleTimetableId(context, { ttfile: " " });

		expect(context.timetable.announced).toBeUndefined();
		expect(context.timetable.reloadRequested).toBe(false);
	});

	it("un `ttfile` absent n'a aucun effet", () => {
		const context = createContext(makeConfiguration(), noopPublisher);

		handleTimetableId(context, { autre: "20260906064431" });

		expect(context.timetable.reloadRequested).toBe(false);
	});

	it("une valeur scalaire nue est ignorée, faute de pouvoir être filtrée", () => {
		const context = createContext(makeConfiguration(), noopPublisher);

		handleTimetableId(context, "20260906064431");
		handleTimetableId(context, 20260906064431);

		expect(context.timetable.announced).toBeUndefined();
		expect(context.timetable.reloadRequested).toBe(false);
	});

	it("la version mémorisée est débarrassée de ses espaces", () => {
		const context = createContext(makeConfiguration(), noopPublisher);

		handleTimetableId(context, { ttfile: "  20260906064431  " });

		expect(context.timetable.announced).toBe("20260906064431");
	});
});
