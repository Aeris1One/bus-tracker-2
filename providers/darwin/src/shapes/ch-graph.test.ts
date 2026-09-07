import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Graph } from "contraction-hierarchy-js";
import { afterEach, describe, expect, it } from "vitest";
import { loadChGraph } from "./ch-graph.js";
import type { RailGraph } from "./rail-graph.js";

// Cinq nœuds du .bin, formant deux composantes : 0 → 1 → 2 est connectée, 3 → 4 est séparée.
const BIN_COORDINATES: [number, number][] = [
	[51.5, -0.1], // index 0
	[51.501, -0.099], // index 1
	[51.502, -0.098], // index 2
	[51.6, -0.2], // index 3
	[51.601, -0.199], // index 4
];

function buildRailGraph(): RailGraph {
	return {
		version: "1",
		latitudes: Float32Array.from(BIN_COORDINATES.map(([lat]) => lat)),
		longitudes: Float32Array.from(BIN_COORDINATES.map(([, lon]) => lon)),
	};
}

/**
 * Reproduit le `.pbf` de production (mesuré) : les identifiants de nœuds sont les indices décimaux
 * du `.bin`, construits par appels directs à `addEdge` — jamais depuis un GeoJSON, qui produirait
 * des clés `"<lon>,<lat>"`. Les nœuds "0".."4" sont introduits dans cet ordre pour que
 * `_nodeToIndexLookup` leur attribue exactement ces mêmes indices (mapping identité).
 */
async function buildPositionalPbfFixture(): Promise<{ path: string; buffer: Buffer }> {
	const chGraph = new Graph();
	chGraph.addEdge("0", "1", { _cost: 100 });
	chGraph.addEdge("1", "0", { _cost: 100 });
	chGraph.addEdge("1", "2", { _cost: 100 });
	chGraph.addEdge("2", "1", { _cost: 100 });
	chGraph.addEdge("3", "4", { _cost: 50 });
	chGraph.addEdge("4", "3", { _cost: 50 });
	chGraph.contractGraph();

	const path = join(tmpdir(), `ch-graph-test-positional-${randomUUID()}.pbf`);
	await chGraph.savePbfCH(path);
	const buffer = await readFile(path);
	return { path, buffer };
}

/**
 * Un graphe bâti depuis un GeoJSON, dont les clés sont des chaînes `"<lon>,<lat>"` plutôt que des
 * indices décimaux. `loadChGraph` doit le rejeter, quel que soit le `.bin` fourni.
 */
async function buildGeoJsonPbfFixture(): Promise<{ path: string; buffer: Buffer }> {
	const geojson = {
		type: "FeatureCollection",
		features: [
			{
				type: "Feature",
				properties: { _id: "a", _cost: 100 },
				geometry: {
					type: "LineString",
					coordinates: [
						[-0.1, 51.5],
						[-0.099, 51.501],
					],
				},
			},
		],
	};
	const chGraph = new Graph(geojson);
	chGraph.contractGraph();

	const path = join(tmpdir(), `ch-graph-test-geojson-${randomUUID()}.pbf`);
	await chGraph.savePbfCH(path);
	const buffer = await readFile(path);
	return { path, buffer };
}

const filesToClean: string[] = [];

afterEach(async () => {
	await Promise.all(filesToClean.splice(0).map((path) => rm(path, { force: true })));
});

describe("loadChGraph", () => {
	it("accepts a .pbf whose node identifiers are the .bin's decimal indices", async () => {
		const { path, buffer } = await buildPositionalPbfFixture();
		filesToClean.push(path);

		const ch = loadChGraph(buffer, buildRailGraph());

		expect(ch).toBeDefined();
	});

	it('rejects a .pbf built from GeoJSON, whose keys are "<lon>,<lat>" strings', async () => {
		const { path, buffer } = await buildGeoJsonPbfFixture();
		filesToClean.push(path);

		const ch = loadChGraph(buffer, buildRailGraph());

		expect(ch).toBeUndefined();
	});

	it("rejects a .pbf whose node count does not match the .bin's", async () => {
		const { path, buffer } = await buildPositionalPbfFixture();
		filesToClean.push(path);

		const shortGraph: RailGraph = {
			version: "1",
			latitudes: Float32Array.from(BIN_COORDINATES.slice(0, 3).map(([lat]) => lat)),
			longitudes: Float32Array.from(BIN_COORDINATES.slice(0, 3).map(([, lon]) => lon)),
		};

		expect(loadChGraph(buffer, shortGraph)).toBeUndefined();
	});

	it("keyForNode renders the string index for a node within bounds, undefined out of bounds", async () => {
		const { path, buffer } = await buildPositionalPbfFixture();
		filesToClean.push(path);
		const ch = loadChGraph(buffer, buildRailGraph());
		if (!ch) throw new Error("le graphe pré-contracté aurait dû être chargé");

		expect(ch.keyForNode(0)).toBe("0");
		expect(ch.keyForNode(4)).toBe("4");
		expect(ch.keyForNode(99)).toBeUndefined();
	});

	it("resolves an existing path as [latitude, longitude] coordinates taken from the .bin, in order", async () => {
		const { path, buffer } = await buildPositionalPbfFixture();
		filesToClean.push(path);
		const graph = buildRailGraph();
		const ch = loadChGraph(buffer, graph);
		if (!ch) throw new Error("le graphe pré-contracté aurait dû être chargé");

		const result = ch.shortestPath("0", "2");

		expect(result).toBeDefined();
		if (!result) throw new Error("unreachable");
		expect(result.length).toBeGreaterThanOrEqual(2);
		// Chaque sommet doit correspondre à une coordonnée du .bin (ordre latitude, longitude) — les
		// nœuds rendus par la bibliothèque sont des indices décimaux, pas des chaînes "<lon>,<lat>".
		for (const [latitude, longitude] of result) {
			const matchesKnownNode = BIN_COORDINATES.some(
				([lat, lon]) => Math.abs(lat - latitude) < 1e-3 && Math.abs(lon - longitude) < 1e-3,
			);
			expect(matchesKnownNode).toBe(true);
		}
		const [firstLatitude, firstLongitude] = result[0] ?? [];
		expect(firstLatitude).toBeCloseTo(BIN_COORDINATES[0]?.[0] ?? Number.NaN, 3);
		expect(firstLongitude).toBeCloseTo(BIN_COORDINATES[0]?.[1] ?? Number.NaN, 3);
		const [lastLatitude, lastLongitude] = result[result.length - 1] ?? [];
		expect(lastLatitude).toBeCloseTo(BIN_COORDINATES[2]?.[0] ?? Number.NaN, 3);
		expect(lastLongitude).toBeCloseTo(BIN_COORDINATES[2]?.[1] ?? Number.NaN, 3);
	});

	it("returns undefined for a pair with no path (disconnected components)", async () => {
		const { path, buffer } = await buildPositionalPbfFixture();
		filesToClean.push(path);
		const ch = loadChGraph(buffer, buildRailGraph());
		if (!ch) throw new Error("le graphe pré-contracté aurait dû être chargé");

		expect(ch.shortestPath("0", "3")).toBeUndefined();
	});

	it("memoisation is a pure optimisation: repeated calls return the same result", async () => {
		const { path, buffer } = await buildPositionalPbfFixture();
		filesToClean.push(path);
		const ch = loadChGraph(buffer, buildRailGraph());
		if (!ch) throw new Error("le graphe pré-contracté aurait dû être chargé");

		const first = ch.shortestPath("0", "2");
		const second = ch.shortestPath("0", "2");

		expect(second).toEqual(first);
	});
});
