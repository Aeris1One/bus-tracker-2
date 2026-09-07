import { NODE_GRID_CELL_DEGREES } from "../constants.js";
import { distanceBetween } from "../utils/geo.js";
import type { RailGraph } from "./rail-graph.js";

export type NodeGrid = {
	within(latitude: number, longitude: number, radiusMeters: number): number[];
	nearest(latitude: number, longitude: number, maxMeters: number): number | undefined;
};

const METERS_PER_DEGREE_LATITUDE = 111_320;
// En dessous de cette latitude, on ne fais plus la correction de longitude, évite une division par zéro.
const MIN_LONGITUDE_CORRECTION_FACTOR = 0.01;

function cellKey(cellX: number, cellY: number): string {
	return `${cellX}:${cellY}`;
}

/**
 * Construit une grille de cellules de `NODE_GRID_CELL_DEGREES` degrés de côté, indexant les nœuds
 * du graphe ferroviaire par cellule. Une cellule est un carré en degrés.
 */
export function createNodeGrid(graph: RailGraph): NodeGrid {
	const { latitudes, longitudes } = graph;
	const cells = new Map<string, number[]>();

	for (let index = 0; index < latitudes.length; index += 1) {
		const latitude = latitudes[index];
		const longitude = longitudes[index];
		if (latitude === undefined || longitude === undefined) {
			continue;
		}
		const key = cellKey(Math.floor(longitude / NODE_GRID_CELL_DEGREES), Math.floor(latitude / NODE_GRID_CELL_DEGREES));
		const bucket = cells.get(key);
		if (bucket) {
			bucket.push(index);
		} else {
			cells.set(key, [index]);
		}
	}

	function candidateIndices(latitude: number, longitude: number, radiusMeters: number): number[] {
		const latitudeSpanDegrees = radiusMeters / METERS_PER_DEGREE_LATITUDE;
		// Un degré de longitude ne vaut pas un degré de latitude en distance : il se contracte avec le
		// cosinus de la latitude.
		const longitudeCorrection = Math.max(Math.cos((latitude * Math.PI) / 180), MIN_LONGITUDE_CORRECTION_FACTOR);
		const longitudeSpanDegrees = radiusMeters / (METERS_PER_DEGREE_LATITUDE * longitudeCorrection);

		const minCellX = Math.floor((longitude - longitudeSpanDegrees) / NODE_GRID_CELL_DEGREES);
		const maxCellX = Math.floor((longitude + longitudeSpanDegrees) / NODE_GRID_CELL_DEGREES);
		const minCellY = Math.floor((latitude - latitudeSpanDegrees) / NODE_GRID_CELL_DEGREES);
		const maxCellY = Math.floor((latitude + latitudeSpanDegrees) / NODE_GRID_CELL_DEGREES);

		const indices: number[] = [];
		for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
			for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
				const bucket = cells.get(cellKey(cellX, cellY));
				if (bucket) {
					indices.push(...bucket);
				}
			}
		}
		return indices;
	}

	return {
		within(latitude, longitude, radiusMeters) {
			const result: number[] = [];
			for (const index of candidateIndices(latitude, longitude, radiusMeters)) {
				const nodeLatitude = latitudes[index];
				const nodeLongitude = longitudes[index];
				if (nodeLatitude === undefined || nodeLongitude === undefined) {
					continue;
				}
				if (distanceBetween(latitude, longitude, nodeLatitude, nodeLongitude) <= radiusMeters) {
					result.push(index);
				}
			}
			return result;
		},
		nearest(latitude, longitude, maxMeters) {
			let bestIndex: number | undefined;
			let bestDistance = Number.POSITIVE_INFINITY;
			for (const index of candidateIndices(latitude, longitude, maxMeters)) {
				const nodeLatitude = latitudes[index];
				const nodeLongitude = longitudes[index];
				if (nodeLatitude === undefined || nodeLongitude === undefined) {
					continue;
				}
				const distance = distanceBetween(latitude, longitude, nodeLatitude, nodeLongitude);
				if (distance <= maxMeters && distance < bestDistance) {
					bestDistance = distance;
					bestIndex = index;
				}
			}
			return bestIndex;
		},
	};
}
