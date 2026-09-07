import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Graph } from "contraction-hierarchy-js";
import { afterEach, describe, expect, it } from "vitest";
import { createCounters } from "../state/counters.js";
import { loadChGraph } from "./ch-graph.js";
import { createNodeGrid } from "./node-grid.js";
import type { RailGraph } from "./rail-graph.js";
import { buildRoutedShape, type Candidate, createRailRouter, roundTo, type ShapePoint } from "./route-shape.js";

function buildRailGraph(coordinates: [number, number][]): RailGraph {
	return {
		version: "1",
		latitudes: Float32Array.from(coordinates.map(([lat]) => lat)),
		longitudes: Float32Array.from(coordinates.map(([, lon]) => lon)),
	};
}

function point(
	tiploc: string,
	[latitude, longitude]: [number, number],
	callOrder: number,
	isPassenger = true,
): ShapePoint {
	return { tiploc, latitude, longitude, callOrder, isPassenger };
}

const filesToClean: string[] = [];

afterEach(async () => {
	await Promise.all(filesToClean.splice(0).map((path) => rm(path, { force: true })));
});

/**
 * Construit un `.pbf` synthétique respectant la convention positionnelle : les identifiants de
 * nœuds sont les indices décimaux du `.bin`, dans le même ordre. `edges` liste des arêtes
 * bidirectionnelles (indice, indice, coût).
 */
async function buildPbfFixture(edges: [number, number, number][]): Promise<Buffer> {
	const chGraph = new Graph();
	for (const [from, to, cost] of edges) {
		chGraph.addEdge(String(from), String(to), { _cost: cost });
		chGraph.addEdge(String(to), String(from), { _cost: cost });
	}
	chGraph.contractGraph();

	const path = join(tmpdir(), `route-shape-test-${randomUUID()}.pbf`);
	filesToClean.push(path);
	await chGraph.savePbfCH(path);
	return readFile(path);
}

describe("createRailRouter — recherche de candidats", () => {
	it("restreint à la grappe locale : un nœud à 150 m est écarté quand le plus proche est à 20 m", () => {
		// P à ~20 m au nord du lieu recherché, Q à ~150 m : les deux sont dans le rayon de 200 m, mais
		// l'écart entre eux (130 m) dépasse les 80 m de la grappe locale — Q doit être écarté.
		const graph = buildRailGraph([
			[51.50018, -0.1], // P, index 0, ~20 m
			[51.501347, -0.1], // Q, index 1, ~150 m
		]);
		const router = createRailRouter(graph, createNodeGrid(graph), undefined);

		const candidates = router.findCandidates(51.5, -0.1);

		expect(candidates).toHaveLength(1);
		expect(candidates[0]?.latitude).toBeCloseTo(51.50018, 5);
		expect(candidates[0]?.snapDistance).toBeCloseTo(20, 0);
	});

	it("fabrique un pseudo-candidat sur le lieu lui-même quand aucun nœud n'est dans le rayon", () => {
		// Le seul nœud du graphe est à ~300 m, hors du rayon de recherche de 200 m.
		const graph = buildRailGraph([[51.502695, -0.1]]);
		const router = createRailRouter(graph, createNodeGrid(graph), undefined);

		const candidates = router.findCandidates(51.5, -0.1);

		expect(candidates).toEqual([{ latitude: 51.5, longitude: -0.1, snapDistance: 0 }]);
		expect(candidates[0]?.key).toBeUndefined();
	});

	it("retient l'ambiguïté légitime d'un aiguillage : plusieurs candidats proches sont tous conservés", () => {
		// Deux voies à quelques mètres l'une de l'autre : aucune ne doit être écartée arbitrairement.
		const graph = buildRailGraph([
			[51.5, -0.1],
			[51.500009, -0.1], // ~1 m
		]);
		const router = createRailRouter(graph, createNodeGrid(graph), undefined);

		const candidates = router.findCandidates(51.5, -0.1);

		expect(candidates.length).toBeGreaterThanOrEqual(2);
	});
});

describe("buildRoutedShape — sur un graphe synthétique en Y", () => {
	// Réseau en Y : A---J---S (impasse, 5 m au-delà de J) et J---M---C (voie continue). Un lieu situé
	// physiquement tout près de S (impasse) a aussi un candidat plus loin, M, situé sur la voie
	// continue. Rejoindre S impose de rebrousser chemin par J pour continuer vers C ; rejoindre M non.
	const A: [number, number] = [51.5, -0.1];
	const J: [number, number] = [51.504492, -0.1];
	const S: [number, number] = [51.504536, -0.1]; // ~5 m au-delà de J (impasse)
	const M: [number, number] = [51.504492, -0.099278]; // ~50 m à l'est de J (voie continue)
	const C: [number, number] = [51.508085, -0.093507]; // plus loin sur la voie continue
	// Lieu physique du point intermédiaire : à michemin entre S (~5 m) et M (~45 m).
	const STATION: [number, number] = [51.504518, -0.099928];

	async function buildYGraph() {
		const graph = buildRailGraph([A, J, S, M, C]);
		const buffer = await buildPbfFixture([
			[0, 1, 500], // A-J
			[1, 2, 5], // J-S (impasse)
			[1, 3, 50], // J-M (voie continue)
			[3, 4, 566], // M-C
		]);
		const ch = loadChGraph(buffer, graph);
		if (!ch) throw new Error("le graphe pré-contracté aurait dû être chargé");
		return createRailRouter(graph, createNodeGrid(graph), ch);
	}

	it("la pénalité de demi-tour fait préférer le candidat plus éloigné (M) à celui plus proche mais en impasse (S)", async () => {
		const router = await buildYGraph();
		const counters = createCounters();
		const points = [point("A", A, 0), point("STATION", STATION, 1), point("C", C, 2)];

		const vertices = buildRoutedShape(points, router, counters);

		// S (l'impasse) est le candidat le PLUS PROCHE du lieu physique — sans la pénalité de
		// demi-tour, il serait retenu. Il ne doit pourtant jamais apparaître dans le tracé émis : la
		// polyligne ne passe jamais par l'impasse, et le choix retenu ne comporte donc aucun demi-tour.
		const viaDeadEnd = vertices.some(
			(vertex) => vertex.latitude === roundTo(S[0], 6) && vertex.longitude === roundTo(S[1], 6),
		);
		expect(viaDeadEnd).toBe(false);
		expect(counters.get("shape:turns")).toBe(0);
	});

	it("distances cumulées strictement croissantes, arrondies au décimètre, et callOrder du point d'arrivée sur les sommets intermédiaires", async () => {
		const router = await buildYGraph();
		const counters = createCounters();
		const points = [point("A", A, 0), point("STATION", STATION, 1), point("C", C, 2)];

		const vertices = buildRoutedShape(points, router, counters);

		expect(vertices.length).toBeGreaterThanOrEqual(3);
		expect(vertices[0]?.distance).toBe(0);
		for (let index = 1; index < vertices.length; index += 1) {
			const previous = vertices[index - 1];
			const current = vertices[index];
			expect(previous).toBeDefined();
			expect(current).toBeDefined();
			if (previous && current) {
				expect(current.distance).toBeGreaterThan(previous.distance);
				// Arrondi au décimètre : la distance est un multiple de 0,1 (aux erreurs de virgule flottante près).
				expect(Math.round(current.distance * 10)).toBeCloseTo(current.distance * 10, 6);
			}
		}
		// Tous les sommets sauf le tout premier appartiennent au tronçon A→STATION ou STATION→C ; le
		// dernier sommet émis porte donc toujours le callOrder du point final (arrivée du dernier
		// tronçon), et au moins un sommet intermédiaire porte celui de STATION (rang 1).
		expect(vertices.at(-1)?.callOrder).toBe(2);
		expect(vertices.some((vertex) => vertex.callOrder === 1)).toBe(true);
	});

	it("arrondit les coordonnées émises à 6 décimales", async () => {
		const router = await buildYGraph();
		const counters = createCounters();
		const points = [point("A", A, 0), point("C2", [51.5080851234, -0.0935071234], 1)];

		const vertices = buildRoutedShape(points, router, counters);

		for (const vertex of vertices) {
			expect(vertex.latitude).toBe(roundTo(vertex.latitude, 6));
			expect(vertex.longitude).toBe(roundTo(vertex.longitude, 6));
		}
	});

	it("alimente shape:turns et shape:turns:nonzero quand un demi-tour est effectivement retenu, faute d'alternative", async () => {
		// Ligne simple F--A--J--S (impasse) : un train visitant F, puis S (l'impasse), puis A, doit
		// nécessairement rebrousser chemin entre les deux derniers tronçons — aucune alternative de
		// candidat n'existe ici pour l'éviter.
		const F: [number, number] = [51.495508, -0.1];
		const graph = buildRailGraph([F, A, J, S]);
		const buffer = await buildPbfFixture([
			[0, 1, 500], // F-A
			[1, 2, 500], // A-J
			[2, 3, 5], // J-S
		]);
		const ch = loadChGraph(buffer, graph);
		if (!ch) throw new Error("le graphe pré-contracté aurait dû être chargé");
		const router = createRailRouter(graph, createNodeGrid(graph), ch);
		const counters = createCounters();
		const points = [point("F", F, 0), point("S", S, 1), point("A", A, 2)];

		buildRoutedShape(points, router, counters);

		expect(counters.get("shape:turns")).toBeGreaterThanOrEqual(1);
		expect(counters.get("shape:turns:nonzero")).toBe(1);
	});

	it("émet un pont explicitement comptabilisé quand aucun chemin n'existe entre les candidats", async () => {
		// Deux composantes disjointes du graphe : {0,1} connectée, {2,3} connectée, mais aucun chemin
		// de l'une à l'autre.
		const start: [number, number] = [51.5, -0.1];
		const startNeighbour: [number, number] = [51.5009, -0.1];
		const target: [number, number] = [51.52, -0.1];
		const targetNeighbour: [number, number] = [51.524492, -0.1];
		const graph = buildRailGraph([start, startNeighbour, target, targetNeighbour]);
		const buffer = await buildPbfFixture([
			[0, 1, 100],
			[2, 3, 500],
		]);
		const ch = loadChGraph(buffer, graph);
		if (!ch) throw new Error("le graphe pré-contracté aurait dû être chargé");
		const router = createRailRouter(graph, createNodeGrid(graph), ch);
		const counters = createCounters();
		const points = [point("START", start, 0), point("TARGET", target, 1)];

		const vertices = buildRoutedShape(points, router, counters);

		expect(counters.get("shape:bridge")).toBe(1);
		expect(counters.get("shape:bridge:len")).toBeGreaterThan(0);
		// Le pont reste bel et bien publié : le tracé compte deux sommets, le second au point cible.
		expect(vertices).toHaveLength(2);
		expect(vertices[1]?.latitude).toBe(roundTo(target[0], 6));
		expect(vertices[1]?.longitude).toBe(roundTo(target[1], 6));
	});

	it("alimente shape:total et un compteur shape:ratio après chaque construction", async () => {
		const router = await buildYGraph();
		const counters = createCounters();
		const points = [point("A", A, 0), point("C", C, 2)];

		buildRoutedShape(points, router, counters);

		expect(counters.get("shape:total")).toBe(1);
		const ratioCounters = ["<1", "1-1.6", "1.6-2", ">2"].map((bucket) => counters.get(`shape:ratio:${bucket}`));
		expect(ratioCounters.reduce((a, b) => a + b, 0)).toBe(1);
	});

	it("alimente les histogrammes séparés shape:snap:station et shape:snap:pp selon isPassenger", async () => {
		const router = await buildYGraph();
		const counters = createCounters();
		const points = [point("A", A, 0, true), point("C", C, 1, false)];

		buildRoutedShape(points, router, counters);

		const stationTotal = ["<25", "25-100", "100-200", ">=200"]
			.map((bucket) => counters.get(`shape:snap:station:${bucket}`))
			.reduce((a, b) => a + b, 0);
		const ppTotal = ["<25", "25-100", "100-200", ">=200"]
			.map((bucket) => counters.get(`shape:snap:pp:${bucket}`))
			.reduce((a, b) => a + b, 0);
		expect(stationTotal).toBe(1);
		expect(ppTotal).toBe(1);
	});

	it("lève quand moins de deux points sont fournis", async () => {
		const router = await buildYGraph();
		const counters = createCounters();
		expect(() => buildRoutedShape([point("A", A, 0)], router, counters)).toThrow();
	});
});

describe("createRailRouter — leg", () => {
	it("retombe sur la corde quand l'un des deux candidats est un pseudo-candidat", () => {
		const graph = buildRailGraph([[51.5, -0.1]]);
		const router = createRailRouter(graph, createNodeGrid(graph), undefined);
		const real: Candidate = { latitude: 51.5, longitude: -0.1, key: "0", snapDistance: 0 };
		const pseudo: Candidate = { latitude: 51.51, longitude: -0.11, snapDistance: 0 };

		const leg = router.leg(real, pseudo);

		expect(leg.bridge).toBe(true);
		expect(leg.path).toEqual([
			[real.latitude, real.longitude],
			[pseudo.latitude, pseudo.longitude],
		]);
	});
});
