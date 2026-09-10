import { emptyPositionTypeCounts } from "@bus-tracker/monitoring";
import { describe, expect, it } from "vitest";

import type { Configuration } from "../configuration/configuration.js";
import { TRAIN_RETENTION_MS } from "../constants.js";
import { createContext, type ProviderContext } from "../context.js";
import type { Call } from "../domain/call.js";
import type { Association } from "../domain/destination.js";
import type { Train } from "../domain/train.js";
import type { Publisher } from "../publish/publisher.js";
import { sweep } from "./sweep.js";

const NOW = new Date(2026, 0, 1, 12, 0, 0).getTime();

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

function makeTrain(rid: string, calls: Call[], overrides: Partial<Train> = {}): Train {
	return {
		rid,
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

function noopPublisher(): Publisher {
	return {
		publishJourneys: async () => emptyPositionTypeCounts(),
		publishShapes: async () => {},
		resetKeyRegistry: () => {},
	};
}

function makeContext(): ProviderContext {
	return createContext(makeConfiguration(), noopPublisher());
}

function makeAssociation(mainRid: string, assocRid: string, overrides: Partial<Association> = {}): Association {
	return { mainRid, assocRid, tiploc: "EUS", ...overrides };
}

describe("sweep", () => {
	it("supprime un train arrivé à son dernier point il y a plus de 30 minutes", () => {
		const context = makeContext();
		context.trains.set(makeTrain("RID1", [makeCall({ order: 0, actualArrival: NOW - TRAIN_RETENTION_MS - 1_000 })]));

		sweep(context, NOW);

		expect(context.trains.get("2026-01-01", "RID1")).toBeUndefined();
	});

	it("conserve un train arrivé à son dernier point il y a seulement 10 minutes", () => {
		const context = makeContext();
		context.trains.set(makeTrain("RID2", [makeCall({ order: 0, actualArrival: NOW - 600_000 })]));

		sweep(context, NOW);

		expect(context.trains.get("2026-01-01", "RID2")).toBeDefined();
	});

	it("un train À QUAI (départ effectif +∞) mais arrivé depuis longtemps est bien supprimé", () => {
		const context = makeContext();
		// Arrivée réelle connue, aucun départ réel : effectiveDeparture vaut +∞. Un balayage fondé sur
		// le départ ne supprimerait jamais ce train.
		context.trains.set(makeTrain("RID3", [makeCall({ order: 0, actualArrival: NOW - TRAIN_RETENTION_MS - 1_000 })]));

		sweep(context, NOW);

		expect(context.trains.get("2026-01-01", "RID3")).toBeUndefined();
	});

	it("conserve un train dont l'arrivée au dernier point n'est pas encore connue", () => {
		const context = makeContext();
		context.trains.set(makeTrain("RID4", [makeCall({ order: 0, aimedPublicArrival: NOW + 600_000 })]));

		sweep(context, NOW);

		expect(context.trains.get("2026-01-01", "RID4")).toBeDefined();
	});

	it("élague les associations dont le RID principal a été supprimé par le balayage", () => {
		const context = makeContext();
		// RID1 est supprimé (arrivé depuis longtemps), RID9 n'a jamais existé dans le train-store.
		context.trains.set(makeTrain("RID1", [makeCall({ order: 0, actualArrival: NOW - TRAIN_RETENTION_MS - 1_000 })]));
		context.associations.add(makeAssociation("RID1", "RID9"));

		sweep(context, NOW);

		expect(context.associations.forRid("RID1")).toHaveLength(0);
		expect(context.associations.forRid("RID9")).toHaveLength(0);
	});

	it("conserve les associations dont les deux RID subsistent après le balayage", () => {
		const context = makeContext();
		context.trains.set(makeTrain("RID1", [makeCall({ order: 0, actualArrival: NOW - 600_000 })]));
		context.trains.set(makeTrain("RID2", [makeCall({ order: 0, actualArrival: NOW - 600_000 })]));
		context.associations.add(makeAssociation("RID1", "RID2"));

		sweep(context, NOW);

		expect(context.associations.forRid("RID1")).toHaveLength(1);
	});

	it("purge les messages temps réel orphelins périmés", () => {
		const context = makeContext();
		context.pendingStatuses.put("2026-01-01", "RIDX", { any: "message" }, NOW - 700_000);

		sweep(context, NOW);

		expect(context.pendingStatuses.size).toBe(0);
	});
});
