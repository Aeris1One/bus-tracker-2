import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadTiplocs } from "./load-tiplocs.js";
import type { ObjectStore } from "./object-store.js";

function createInMemoryStore(files: Record<string, Buffer>): ObjectStore {
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

const ENV_KEY = "RAILEASY_TIPLOCS_PATH";

describe("loadTiplocs", () => {
	afterEach(() => {
		delete process.env[ENV_KEY];
	});

	it("retient le fichier de date la plus récente", async () => {
		const store = createInMemoryStore({
			"RAILEASY/tiplocs-20260101.json": Buffer.from(JSON.stringify({ tiplocs: { BHM: { lat: 1, lon: 1 } } })),
			"RAILEASY/tiplocs-20260825.json": Buffer.from(JSON.stringify({ tiplocs: { BHM: { lat: 52.478, lon: -1.898 } } })),
		});

		const coordinates = await loadTiplocs(store);

		expect(coordinates.get("BHM")).toEqual({ latitude: 52.478, longitude: -1.898 });
	});

	it("ne retient que lat et lon, ignore les entrées incomplètes", async () => {
		const store = createInMemoryStore({
			"RAILEASY/tiplocs-20260825.json": Buffer.from(
				JSON.stringify({
					tiplocs: {
						BHM: { lat: 52.478, lon: -1.898, name: "Birmingham New Street", crs: "BHM" },
						NOCOORD: { name: "Sans coordonnées" },
					},
				}),
			),
		});

		const coordinates = await loadTiplocs(store);

		expect(coordinates.get("BHM")).toEqual({ latitude: 52.478, longitude: -1.898 });
		expect(coordinates.has("NOCOORD")).toBe(false);
	});

	it("échoue quand aucun fichier de coordonnées n'est trouvé", async () => {
		const store = createInMemoryStore({});
		await expect(loadTiplocs(store)).rejects.toThrow();
	});

	it("se surcharge par RAILEASY_TIPLOCS_PATH sans jamais consulter le bucket", async () => {
		const directory = mkdtempSync(join(tmpdir(), "darwin-tiplocs-"));
		const path = join(directory, "tiplocs.json");
		writeFileSync(path, JSON.stringify({ tiplocs: { EUS: { lat: 51.528, lon: -0.133 } } }));
		process.env[ENV_KEY] = path;

		const store: ObjectStore = {
			async list() {
				throw new Error("le bucket ne doit jamais être consulté quand RAILEASY_TIPLOCS_PATH est défini");
			},
			async download() {
				throw new Error("le bucket ne doit jamais être consulté quand RAILEASY_TIPLOCS_PATH est défini");
			},
		};

		const coordinates = await loadTiplocs(store);

		expect(coordinates.get("EUS")).toEqual({ latitude: 51.528, longitude: -0.133 });
	});
});
