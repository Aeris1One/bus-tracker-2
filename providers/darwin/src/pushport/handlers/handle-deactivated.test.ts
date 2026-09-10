import { emptyPositionTypeCounts } from "@bus-tracker/monitoring";
import { describe, expect, it } from "vitest";

import type { Configuration } from "../../configuration/configuration.js";
import { createContext } from "../../context.js";
import type { Call } from "../../domain/call.js";
import type { Train } from "../../domain/train.js";
import type { Publisher } from "../../publish/publisher.js";
import { handleDeactivated } from "./handle-deactivated.js";

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

function makeCall(tiploc: string, order: number): Call {
	return {
		tag: "IP",
		tiploc,
		activity: "T",
		order,
		platformSuppressed: false,
		locationSuppressed: false,
		platformConfirmed: false,
		cancelled: false,
	};
}

function makeTrain(overrides: Partial<Train> = {}): Train {
	return {
		rid: "202609060001",
		uid: "A00001",
		ssd: "2026-09-06",
		trainId: "1A23",
		toc: "GW",
		calls: [makeCall("PADTON", 0), makeCall("RDNGSTN", 1)],
		origin: "PADTON",
		destination: "RDNGSTN",
		cancelled: false,
		...overrides,
	};
}

/** `Publisher` (L11) est concret : ces tests portent sur les handlers, jamais sur la
 * publication elle-même ; un double neutre suffit à satisfaire le type. */
const noopPublisher: Publisher = {
	publishJourneys: async () => emptyPositionTypeCounts(),
	publishShapes: async () => {},
	resetKeyRegistry: () => {},
};

describe("handleDeactivated", () => {
	it("marque le train et TOUS ses points annulés, ce qui le retire de la publication", () => {
		const context = createContext(makeConfiguration(), noopPublisher);
		context.trains.set(makeTrain());

		handleDeactivated(context, { rid: "202609060001", ssd: "2026-09-06" });

		const train = context.trains.get("2026-09-06", "202609060001");
		expect(train?.cancelled).toBe(true);
		expect(train?.calls.every((call) => call.cancelled)).toBe(true);
	});

	it("dérive la date de service du RID quand `ssd` manque", () => {
		const context = createContext(makeConfiguration(), noopPublisher);
		context.trains.set(makeTrain());

		handleDeactivated(context, { rid: "202609060001" });

		expect(context.trains.get("2026-09-06", "202609060001")?.cancelled).toBe(true);
	});

	it("un message sans rid est ignoré", () => {
		const context = createContext(makeConfiguration(), noopPublisher);
		context.trains.set(makeTrain());

		handleDeactivated(context, { ssd: "2026-09-06" });

		expect(context.trains.get("2026-09-06", "202609060001")?.cancelled).toBe(false);
	});

	it("un train inconnu ne provoque rien — ni création, ni erreur", () => {
		const context = createContext(makeConfiguration(), noopPublisher);

		expect(() => handleDeactivated(context, { rid: "202609069999", ssd: "2026-09-06" })).not.toThrow();
		expect(context.trains.size).toBe(0);
	});

	it("ne touche pas aux autres trains", () => {
		const context = createContext(makeConfiguration(), noopPublisher);
		context.trains.set(makeTrain());
		context.trains.set(makeTrain({ rid: "202609060002" }));

		handleDeactivated(context, { rid: "202609060001", ssd: "2026-09-06" });

		expect(context.trains.get("2026-09-06", "202609060002")?.cancelled).toBe(false);
	});
});
