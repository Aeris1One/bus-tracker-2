import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyPositionTypeCounts } from "@bus-tracker/monitoring";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Configuration } from "../configuration/configuration.js";
import { createContext, type ProviderContext } from "../context.js";
import type { Call } from "../domain/call.js";
import type { Train } from "../domain/train.js";
import type { Publisher } from "../publish/publisher.js";
import { readShapeFile } from "../shapes/shape-file.js";
import { precomputeShapes } from "./precompute-shapes.js";

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
		shapePaths: true,
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

function makeCall(tiploc: string, order: number): Call {
	return {
		tag: "IP",
		tiploc,
		activity: "",
		order,
		platformSuppressed: false,
		locationSuppressed: false,
		platformConfirmed: false,
		cancelled: false,
	};
}

function makeTrain(rid: string, from: string, to: string): Train {
	return {
		rid,
		uid: "A12345",
		ssd: "2026-01-01",
		trainId: "1A23",
		toc: "GW",
		calls: [makeCall(from, 0), makeCall(to, 1)],
		origin: from,
		destination: to,
		cancelled: false,
	};
}

let dataDir: string;

beforeEach(async () => {
	dataDir = await mkdtemp(join(tmpdir(), "precompute-shapes-test-"));
});

afterEach(async () => {
	await rm(dataDir, { recursive: true, force: true });
});

describe("precomputeShapes", () => {
	it("construit les tracés manquants pour tous les trains connus, puis écrit l'index sur disque", async () => {
		const context = makeContext();
		context.references.mergeCoordinates(
			new Map([
				["AAA", { latitude: 51.5, longitude: -0.1 }],
				["BBB", { latitude: 51.6, longitude: -0.2 }],
			]),
		);
		context.trains.set(makeTrain("RID1", "AAA", "BBB"));

		await precomputeShapes(context, dataDir, "20260101000000");

		expect(context.shapes.size).toBeGreaterThan(0);
		const cachedShapes = await readShapeFile(dataDir, "20260101000000", context.graphVersion);
		expect(cachedShapes.length).toBe(context.shapes.size);
	});

	it("une erreur sur un train n'interrompt pas le parcours des autres", async () => {
		const context = makeContext();
		context.references.mergeCoordinates(
			new Map([
				["AAA", { latitude: 51.5, longitude: -0.1 }],
				["BBB", { latitude: 51.6, longitude: -0.2 }],
			]),
		);

		const badTrain = makeTrain("BAD", "AAA", "BBB");
		// Force une exception au premier accès à `.calls`, sans quoi il n'existe aucun moyen simple de
		// faire échouer `splitIntoSegments`/`ensureShapes` sur des données par ailleurs valides.
		Object.defineProperty(badTrain, "calls", {
			get() {
				throw new Error("échec délibéré du train BAD");
			},
		});

		context.trains.set(badTrain);
		context.trains.set(makeTrain("GOOD", "AAA", "BBB"));

		await expect(precomputeShapes(context, dataDir, "20260101000000")).resolves.toBeUndefined();

		// Le train GOOD a malgré tout été traité : son tracé est en cache.
		expect(context.shapes.size).toBeGreaterThan(0);
	});

	it("cède la main après chaque lot de PRECOMPUTE_BATCH_SIZE trains", async () => {
		const context = makeContext();
		context.references.mergeCoordinates(
			new Map([
				["AAA", { latitude: 51.5, longitude: -0.1 }],
				["BBB", { latitude: 51.6, longitude: -0.2 }],
			]),
		);
		// 30 trains partageant tous la même paire de TIPLOC : un seul tracé canonique, mais 30
		// itérations pour vérifier que la boucle ne bloque pas au-delà d'un lot de 25 (PRECOMPUTE_BATCH_SIZE).
		for (let i = 0; i < 30; i += 1) {
			context.trains.set(makeTrain(`RID${i}`, "AAA", "BBB"));
		}

		await precomputeShapes(context, dataDir, "20260101000000");

		// Un seul tracé canonique pour les 30 trains identiques (mutualisation par clé).
		expect(context.shapes.size).toBe(1);
	});
});
