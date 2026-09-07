import { Graph } from "contraction-hierarchy-js";
import { ROUTE_MEMO_EVICT_RATIO, ROUTE_MEMO_MAX } from "../constants.js";
import { logger } from "../utils/logger.js";
import type { RailGraph } from "./rail-graph.js";

/** Adaptateur de `contraction-hierarchy-js`. */
export type ChGraph = {
	/** Clé de nœud du graphe pré-contracté pour un indice de nœud du .bin, si elle existe. */
	keyForNode(index: number): string | undefined;
	/** Séquence [latitude, longitude] du plus court chemin, ou undefined si aucun. */
	shortestPath(fromKey: string, toKey: string): [number, number][] | undefined;
};

/**
 * `loadPbfCH` loggue `done loading pbf` sauf que ta gueule
 */
function loadPbfSilently(chGraph: Graph, buffer: Buffer): void {
	const originalLog = console.log;
	console.log = () => {};
	try {
		chGraph.loadPbfCH(buffer);
	} finally {
		console.log = originalLog;
	}
}

function memoKey(fromKey: string, toKey: string): string {
	return `${fromKey} ${toKey}`;
}

/**
 * L'identifiant de nœud du `.pbf` doit être l'indice décimal du nœud dans le `.bin`.
 */
function isPositionalMatch(lookup: Record<string, number>, nodeCount: number): boolean {
	const keys = Object.keys(lookup);
	if (keys.length !== nodeCount) {
		return false;
	}
	for (const key of keys) {
		if (!/^\d+$/.test(key)) {
			return false;
		}
		if (lookup[key] !== Number(key)) {
			return false;
		}
	}
	return true;
}

/** Renvoie les coordonnées d'un noeud depuis le `.bin`, ou undefined. */
function coordinateAt(graph: RailGraph, index: number): [number, number] | undefined {
	const latitude = graph.latitudes[index];
	const longitude = graph.longitudes[index];
	if (latitude === undefined || longitude === undefined) {
		return undefined;
	}
	return [latitude, longitude];
}

/**
 * Charge un graphe pré-contracté `.pbf` et vérifie la correspondance positionnelle avec le `.bin`.
 * Renvoie `undefined` si elle n'est pas vérifiée.
 */
export function loadChGraph(buffer: Buffer, graph: RailGraph): ChGraph | undefined {
	const chGraph = new Graph();
	loadPbfSilently(chGraph, buffer);

	// N'activer que l'option `nodes` : `ids`, `path` et `properties` prennent de la mémoire pour rien
	const finder = chGraph.createPathfinder({ nodes: true });

	if (!isPositionalMatch(chGraph._nodeToIndexLookup, graph.latitudes.length)) {
		logger.warning(
			"correspondance positionnelle non vérifiée entre le .bin (%d nœuds) et le .pbf (%d clés) : " +
				"bascule en tracés rectilignes.",
			graph.latitudes.length,
			Object.keys(chGraph._nodeToIndexLookup).length,
		);
		return undefined;
	}

	const memo = new Map<string, [number, number][] | undefined>();

	function evictOldestIfNeeded(): void {
		if (memo.size < ROUTE_MEMO_MAX) {
			return;
		}
		const evictCount = Math.ceil(ROUTE_MEMO_MAX * ROUTE_MEMO_EVICT_RATIO);
		let evicted = 0;
		for (const key of memo.keys()) {
			if (evicted >= evictCount) {
				break;
			}
			memo.delete(key);
			evicted += 1;
		}
	}

	return {
		keyForNode(index) {
			return coordinateAt(graph, index) ? String(index) : undefined;
		},
		shortestPath(fromKey, toKey) {
			const cacheKey = memoKey(fromKey, toKey);
			if (memo.has(cacheKey)) {
				return memo.get(cacheKey);
			}

			const result = finder.queryContractionHierarchy(fromKey, toKey);
			// Un couple sans chemin rend { total_cost: 0, nodes: [] }, pas une erreur.
			let path: [number, number][] | undefined;
			if (result.nodes && result.nodes.length >= 2) {
				const coordinates: [number, number][] = [];
				let allValid = true;
				for (const nodeKey of result.nodes) {
					const coordinate = coordinateAt(graph, Number(nodeKey));
					if (!coordinate) {
						allValid = false;
						break;
					}
					coordinates.push(coordinate);
				}
				path = allValid ? coordinates : undefined;
			} else {
				path = undefined;
			}

			evictOldestIfNeeded();
			memo.set(cacheKey, path);
			return path;
		},
	};
}
