import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ObjectStore } from "../bucket/object-store.js";
import type { Configuration } from "../configuration/configuration.js";
import { SHAPE_KEY_LOCAL_VERSION } from "../constants.js";
import { createContext, type ProviderContext } from "../context.js";
import type { Call } from "../domain/call.js";
import { createShape } from "../domain/shape.js";
import type { Train } from "../domain/train.js";
import type { Publisher } from "../publish/publisher.js";
import { loadResources } from "./load-resources.js";

const REFERENCE_XML = `<?xml version="1.0"?>
<PportTimetableRef>
	<LocationRef tpl="AAA" locname="Start"/>
	<LocationRef tpl="BBB" locname="End"/>
</PportTimetableRef>`;

const TIMETABLE_XML = `<PportTimetable>
	<Journey rid="NEW1" ssd="2026-01-01" toc="GW">
		<OR tpl="AAA" wtd="10:00:00"/>
		<DT tpl="BBB" wta="10:30:00"/>
	</Journey>
</PportTimetable>`;

const TIPLOCS_JSON = JSON.stringify({ tiplocs: { AAA: { lat: 51.5, lon: -0.1 }, BBB: { lat: 51.6, lon: -0.2 } } });

const REFERENCE_NAME = "PPTimetable/20260101000000_ref_v1.xml.gz";
const TIMETABLE_NAME = "PPTimetable/20260101000000_v1.xml.gz";
const TIPLOCS_NAME = "RAILEASY/tiplocs-20260101.json";

/** Double en mémoire d'`ObjectStore` — un chargement complet et fonctionnel, aucun graphe présent
 * (absence traitée en simple avertissement). */
function makeWorkingStore(): ObjectStore {
	const files: Record<string, Buffer> = {
		[REFERENCE_NAME]: gzipSync(REFERENCE_XML),
		[TIMETABLE_NAME]: gzipSync(TIMETABLE_XML),
		[TIPLOCS_NAME]: Buffer.from(TIPLOCS_JSON, "utf8"),
	};
	return {
		async list(prefix) {
			return Object.keys(files).filter((name) => name.startsWith(prefix));
		},
		async download(name) {
			const buffer = files[name];
			if (buffer === undefined) {
				throw new Error(`objet inconnu : ${name}`);
			}
			return buffer;
		},
	};
}

/** Le référentiel se télécharge normalement, mais le fichier d'horaires échoue. */
function makeBrokenTimetableStore(): ObjectStore {
	return {
		async list(prefix) {
			return prefix === "PPTimetable/" ? [REFERENCE_NAME, TIMETABLE_NAME] : [];
		},
		async download(name) {
			if (name === REFERENCE_NAME) {
				return gzipSync(REFERENCE_XML);
			}
			throw new Error("panne réseau simulée sur le fichier d'horaires");
		},
	};
}

function makeConfiguration(overrides: Partial<Configuration> = {}): Configuration {
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
		...overrides,
	};
}

type SpyingPublisher = Publisher & { resetCount: number };

function makePublisher(): SpyingPublisher {
	return {
		resetCount: 0,
		publishJourneys: async () => 0,
		publishShapes: async () => {},
		resetKeyRegistry() {
			this.resetCount += 1;
		},
	};
}

function makeContext(configuration: Configuration = makeConfiguration()): {
	context: ProviderContext;
	publisher: SpyingPublisher;
} {
	const publisher = makePublisher();
	return { context: createContext(configuration, publisher), publisher };
}

function makeCall(overrides: Partial<Call> = {}): Call {
	return {
		tag: "IP",
		tiploc: "OLDTPL",
		activity: "",
		order: 0,
		platformSuppressed: false,
		locationSuppressed: false,
		platformConfirmed: false,
		cancelled: false,
		...overrides,
	};
}

function makeOldTrain(): Train {
	return {
		rid: "OLD1",
		uid: "A00000",
		ssd: "2025-12-31",
		trainId: "9Z99",
		toc: "XX",
		calls: [makeCall({ order: 0 }), makeCall({ order: 1, tiploc: "OLDTPL2" })],
		origin: "OLDTPL",
		destination: "OLDTPL2",
		cancelled: false,
	};
}

let dataDir: string;
const RAILWAY_ENV_KEYS = ["RAILWAY_GRAPH_PATH", "RAILWAY_CH_PATH", "RAILEASY_TIPLOCS_PATH"] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(async () => {
	dataDir = await mkdtemp(join(tmpdir(), "load-resources-test-"));
	for (const key of RAILWAY_ENV_KEYS) {
		savedEnv[key] = process.env[key];
		delete process.env[key];
	}
});

afterEach(async () => {
	await rm(dataDir, { recursive: true, force: true });
	for (const key of RAILWAY_ENV_KEYS) {
		if (savedEnv[key] === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = savedEnv[key];
		}
	}
});

describe("loadResources", () => {
	it("un échec de téléchargement laisse les trains en place, sans purge", async () => {
		const { context, publisher } = makeContext();
		context.trains.set(makeOldTrain());
		context.timetable.loaded = "PREVIOUS_VERSION";

		await expect(loadResources(context, makeBrokenTimetableStore(), dataDir)).rejects.toThrow();

		// Rien n'a été touché : ni le train déjà en place, ni la version chargée, ni le registre.
		expect(context.trains.get("2025-12-31", "OLD1")).toBeDefined();
		expect(context.timetable.loaded).toBe("PREVIOUS_VERSION");
		expect(publisher.resetCount).toBe(0);
	});

	it("un chargement réussi remplace les trains et le cache de tracés, mais conserve les associations", async () => {
		const { context, publisher } = makeContext();
		context.trains.set(makeOldTrain());
		context.associations.add({ mainRid: "SOME_RID", assocRid: "OTHER_RID", tiploc: "EUS" });

		await loadResources(context, makeWorkingStore(), dataDir);

		// Le vieux train n'appartient pas à la nouvelle version d'horaires : disparu.
		expect(context.trains.get("2025-12-31", "OLD1")).toBeUndefined();
		// Le nouveau train, lui, est installé.
		expect(context.trains.get("2026-01-01", "NEW1")).toBeDefined();
		// Le registre des clés de tracés publiées a été purgé.
		expect(publisher.resetCount).toBe(1);
		// Les associations, elles, SURVIVENT à la remise à zéro : indexées par RID, elles restent
		// valables d'une version d'horaires à l'autre.
		expect(context.associations.forRid("SOME_RID")).toHaveLength(1);
		expect(context.timetable.loaded).toBe("20260101000000");
	});

	it("un chargement réussi vide le cache de tracés existant", async () => {
		const { context } = makeContext();
		// Un tracé résiduel d'une version précédente, à purger inconditionnellement.
		context.shapes.set(createShape("STALE", "NR:RoutePath:test:local:stale", []));

		await loadResources(context, makeWorkingStore(), dataDir);

		expect(context.shapes.get("STALE")).toBeUndefined();
	});

	it("absence de graphe : graphVersion et router restent tous deux inchangés", async () => {
		const { context } = makeContext();
		expect(context.graphVersion).toBe(SHAPE_KEY_LOCAL_VERSION);
		expect(context.router).toBeUndefined();

		// Le double de bucket ne porte aucun `.bin` ni `.pbf` sous RAILEASY/ : simple avertissement.
		await loadResources(context, makeWorkingStore(), dataDir);

		expect(context.graphVersion).toBe(SHAPE_KEY_LOCAL_VERSION);
		expect(context.router).toBeUndefined();
	});

	it("succès du graphe : graphVersion et router sont affectés ENSEMBLE", async () => {
		const { context } = makeContext();

		// Fabrique un `.bin` synthétique minimal, forcé via la variable d'environnement de dérogation
		// locale — aucun `.pbf` associé : le routeur doit exister mais `canRoute` doit rester faux.
		const graphDate = 20250315;
		const latitudes = [51.5, 51.6];
		const longitudes = [-0.1, -0.2];
		const nodeCount = latitudes.length;
		const arcCount = 0;
		const headerSize = 20;
		const coordsSize = 4 * nodeCount * 2;
		// Table d'arcs héritée : jamais lue (skip), mais son emprise doit exister dans le tampon.
		const legacyArcTablesSize = 4 * nodeCount + 4 * (nodeCount + 1) + 4 * arcCount * 6 + 4 * arcCount;
		const buffer = Buffer.alloc(headerSize + coordsSize + legacyArcTablesSize);
		let offset = 0;
		buffer.write("RGR1", offset, "latin1");
		offset += 4;
		buffer.writeUInt32LE(graphDate, offset);
		offset += 4;
		buffer.writeUInt32LE(latitudes.length, offset);
		offset += 4;
		buffer.writeUInt32LE(0, offset); // arcCount
		offset += 4;
		buffer.writeUInt32LE(0, offset); // drapeau ignoré
		offset += 4;
		for (const latitude of latitudes) {
			buffer.writeFloatLE(latitude, offset);
			offset += 4;
		}
		for (const longitude of longitudes) {
			buffer.writeFloatLE(longitude, offset);
			offset += 4;
		}

		const graphPath = join(dataDir, "graph.bin");
		await writeFile(graphPath, buffer);
		process.env.RAILWAY_GRAPH_PATH = graphPath;

		await loadResources(context, makeWorkingStore(), dataDir);

		expect(context.graphVersion).toBe("20250315");
		expect(context.router).toBeDefined();
		// Aucun `.pbf` chargé : le routeur existe mais ne peut pas router.
		expect(context.router?.canRoute).toBe(false);
	});

	it("rejoue les messages temps réel orphelins dont le train existe désormais", async () => {
		const { context } = makeContext();
		// Message TS orphelin en attente pour NEW1, avant même que ce train n'existe.
		context.pendingStatuses.put("2026-01-01", "NEW1", { rid: "NEW1", ssd: "2026-01-01", Location: [] }, Date.now());

		await loadResources(context, makeWorkingStore(), dataDir);

		const train = context.trains.get("2026-01-01", "NEW1");
		expect(train).toBeDefined();
		expect(train?.lastStatusMessage).toBeDefined();
		expect(context.pendingStatuses.size).toBe(0);
	});
});
