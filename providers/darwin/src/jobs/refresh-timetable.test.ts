import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./load-resources.js", () => ({ loadResources: vi.fn(async () => {}) }));

import type { ObjectStore } from "../bucket/object-store.js";
import type { Configuration } from "../configuration/configuration.js";
import { TIMETABLE_CHECK_INTERVAL_MS } from "../constants.js";
import { createContext, type ProviderContext } from "../context.js";
import type { Publisher } from "../publish/publisher.js";
import { loadResources } from "./load-resources.js";
import { refreshTimetableIfNeeded } from "./refresh-timetable.js";

const NOW = new Date(2026, 0, 1, 12, 0, 0).getTime();
const DATA_DIR = "/data";

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
		publishJourneys: async () => 0,
		publishShapes: async () => {},
		resetKeyRegistry: () => {},
	};
}

function makeContext(): ProviderContext {
	return createContext(makeConfiguration(), noopPublisher());
}

/** Double en mémoire d'`ObjectStore` : aucun accès réseau. `list` est un espion. */
function makeStore(names: string[]): { store: ObjectStore; list: ReturnType<typeof vi.fn> } {
	const list = vi.fn(async () => names);
	return {
		store: {
			list,
			download: async () => {
				throw new Error("peekTimetableId ne doit jamais télécharger.");
			},
		},
		list,
	};
}

const SAME_VERSION_BUCKET = ["PPTimetable/20260101000000_v3.xml.gz"];
const NEWER_VERSION_BUCKET = ["PPTimetable/20260102000000_v1.xml.gz"];
const LOADED_TIMETABLE_ID = "20260101000000";

beforeEach(() => {
	vi.mocked(loadResources).mockClear();
});

describe("refreshTimetableIfNeeded", () => {
	it("déclenche un rechargement quand la version annoncée diffère de la version chargée", async () => {
		const context = makeContext();
		context.timetable.loaded = LOADED_TIMETABLE_ID;
		context.timetable.announced = "20260201000000";
		context.timetable.reloadRequested = true;
		context.timetable.lastCheckedAtMs = NOW;
		const { store } = makeStore(SAME_VERSION_BUCKET);

		await refreshTimetableIfNeeded(context, store, DATA_DIR, NOW);

		expect(loadResources).toHaveBeenCalledTimes(1);
		expect(loadResources).toHaveBeenCalledWith(context, store, DATA_DIR);
	});

	it("déclenche un rechargement quand la version du bucket diffère de la version chargée", async () => {
		const context = makeContext();
		context.timetable.loaded = LOADED_TIMETABLE_ID;
		// Aucune annonce reçue : seule la vérification périodique du bucket doit jouer.
		context.timetable.announced = undefined;
		context.timetable.reloadRequested = false;
		context.timetable.lastCheckedAtMs = NOW - TIMETABLE_CHECK_INTERVAL_MS - 1;
		const { store } = makeStore(NEWER_VERSION_BUCKET);

		await refreshTimetableIfNeeded(context, store, DATA_DIR, NOW);

		expect(loadResources).toHaveBeenCalledTimes(1);
	});

	it("désarme la demande de rechargement même quand aucun rechargement n'a lieu", async () => {
		const context = makeContext();
		context.timetable.loaded = LOADED_TIMETABLE_ID;
		context.timetable.announced = LOADED_TIMETABLE_ID;
		context.timetable.reloadRequested = true;
		context.timetable.lastCheckedAtMs = NOW;
		// Le bucket ne porte rien de plus récent : aucune des deux conditions n'est vraie.
		const { store } = makeStore(SAME_VERSION_BUCKET);

		await refreshTimetableIfNeeded(context, store, DATA_DIR, NOW);

		expect(loadResources).not.toHaveBeenCalled();
		expect(context.timetable.reloadRequested).toBe(false);
	});

	it("ne fait aucune vérification périodique avant l'échéance", async () => {
		const context = makeContext();
		context.timetable.loaded = LOADED_TIMETABLE_ID;
		context.timetable.reloadRequested = false;
		// La dernière vérification remonte à moins de TIMETABLE_CHECK_INTERVAL_MS.
		context.timetable.lastCheckedAtMs = NOW - 1_000;
		const { store, list } = makeStore(NEWER_VERSION_BUCKET);

		await refreshTimetableIfNeeded(context, store, DATA_DIR, NOW);

		expect(list).not.toHaveBeenCalled();
		expect(loadResources).not.toHaveBeenCalled();
	});
});
