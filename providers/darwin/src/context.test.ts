import { describe, expect, it } from "vitest";

import type { Configuration } from "./configuration/configuration.js";
import { createContext } from "./context.js";
import type { Publisher } from "./publish/publisher.js";
import type { RailRouter } from "./shapes/route-shape.js";

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

function makePublisher(): Publisher {
	return {
		publishJourneys: async () => 0,
		publishShapes: async () => {},
		resetKeyRegistry: () => {},
	};
}

describe("createContext", () => {
	it("assemble des magasins vides et transporte la configuration, les tracés et le publisher tels quels", () => {
		const configuration = makeConfiguration();
		const publisher = makePublisher();

		const context = createContext(configuration, publisher);

		expect(context.configuration).toBe(configuration);
		expect(context.publisher).toBe(publisher);
		expect(context.shapes.size).toBe(0);
		expect(context.trains.size).toBe(0);
		expect(context.timetable.reloadRequested).toBe(false);
		expect(context.router).toBeUndefined();
	});

	it("router est le seul champ mutable : il peut être affecté après coup sans toucher au reste", () => {
		const context = createContext(makeConfiguration(), makePublisher());
		const router: RailRouter = {
			canRoute: false,
			findCandidates: () => [],
			leg: () => ({ path: [], length: 0, bearing: 0, bridge: true }),
		};

		// `jobs/load-resources.ts` l'affecte une fois le graphe chargé.
		context.router = router;

		expect(context.router).toBe(router);
	});
});
