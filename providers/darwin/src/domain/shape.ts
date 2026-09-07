// Type d'un tracé et les deux accès qu'on en fait : la distance d'un rang de desserte, et la
// position interpolée à une distance donnée sur le tracé.

import { bearingBetween, interpolate } from "../utils/geo.js";

export type ShapeVertex = {
	/** Arrondie à 6 décimales. */
	latitude: number;
	/** Arrondie à 6 décimales. */
	longitude: number;
	/** Distance orthodromique cumulée depuis le premier sommet, arrondie au décimètre. */
	distance: number;
	/** Rang du point de desserte dont dépend ce sommet — pour un sommet intermédiaire, celui du point
	 * d'arrivée du tronçon. */
	callOrder: number;
};

/**
 * Les sommets sont rangés en plusieurs tableaux typés plutôt qu'en un tableau de ShapeVertex, parce que la RAM c'est cher !
 * (144 octets par sommet en objet vs 28 en tableaux typés, soit ~1,44Go vs ~0.28Go pour 10k trains)
 */
export type Shape = {
	readonly canonicalKey: string;
	readonly redisKey: string;
	readonly latitudes: Float64Array;
	readonly longitudes: Float64Array;
	readonly distances: Float64Array;
	readonly callOrders: Int32Array;
	readonly length: number;
	readonly distanceByCallOrder: ReadonlyMap<number, number>;
	readonly projectedByCallOrder: Map<number, number>;
	toPayload(): string;
};

/**
 * Construit un tracé et la table des distances par rang de desserte.
 */
export function createShape(canonicalKey: string, redisKey: string, vertices: ShapeVertex[]): Shape {
	const length = vertices.length;
	const latitudes = new Float64Array(length);
	const longitudes = new Float64Array(length);
	const distances = new Float64Array(length);
	const callOrders = new Int32Array(length);
	const distanceByCallOrder = new Map<number, number>();

	for (let index = 0; index < length; index++) {
		const vertex = vertices[index];
		if (vertex === undefined) {
			continue;
		}
		latitudes[index] = vertex.latitude;
		longitudes[index] = vertex.longitude;
		distances[index] = vertex.distance;
		callOrders[index] = vertex.callOrder;
		distanceByCallOrder.set(vertex.callOrder, vertex.distance);
	}

	return {
		canonicalKey,
		redisKey,
		projectedByCallOrder: new Map<number, number>(),
		latitudes,
		longitudes,
		distances,
		callOrders,
		length,
		distanceByCallOrder,
		toPayload() {
			const points: [number, number, number][] = new Array(length);
			for (let index = 0; index < length; index++) {
				points[index] = [latitudes[index] as number, longitudes[index] as number, distances[index] as number];
			}
			return JSON.stringify({ p: points });
		},
	};
}

/**
 * Coordonnée et cap à une distance donnée sur le tracé :
 * - distance <= la première ⇒ premier sommet, cap vers le second ;
 * - distance >= la dernière ⇒ dernier sommet, cap depuis l'avant-dernier ;
 * - sinon, sommet encadrant et interpolation linéaire.
 */
export function locateOnShape(
	shape: Shape,
	distance: number,
): { latitude: number; longitude: number; bearing: number } {
	const { latitudes, longitudes, distances, length } = shape;
	if (length === 0) {
		throw new Error("locateOnShape: tracé sans sommet");
	}

	const bearingAt = (from: number, to: number) =>
		bearingBetween(
			latitudes[from] as number,
			longitudes[from] as number,
			latitudes[to] as number,
			longitudes[to] as number,
		);

	if (length === 1 || distance <= (distances[0] as number)) {
		return {
			latitude: latitudes[0] as number,
			longitude: longitudes[0] as number,
			bearing: bearingAt(0, length > 1 ? 1 : 0),
		};
	}

	const lastIndex = length - 1;
	if (distance >= (distances[lastIndex] as number)) {
		return {
			latitude: latitudes[lastIndex] as number,
			longitude: longitudes[lastIndex] as number,
			bearing: bearingAt(lastIndex - 1, lastIndex),
		};
	}

	// Sommet encadrant : le premier sommet dont la distance dépasse la cible, précédé de celui d'avant.
	for (let index = 1; index < length; index++) {
		const to = distances[index] as number;
		if (distance <= to) {
			const from = distances[index - 1] as number;
			const span = to - from;
			const ratio = span > 0 ? (distance - from) / span : 0;
			const point = interpolate(
				latitudes[index - 1] as number,
				longitudes[index - 1] as number,
				latitudes[index] as number,
				longitudes[index] as number,
				ratio,
			);
			return { ...point, bearing: bearingAt(index - 1, index) };
		}
	}

	// Inatteignable mais Webstorm râle.
	return {
		latitude: latitudes[lastIndex] as number,
		longitude: longitudes[lastIndex] as number,
		bearing: bearingAt(0, lastIndex),
	};
}

/**
 * Distance cumulée du point de la polyligne le plus proche de la coordonnée donnée.
 *
 * La projection se fait en repère équirectangulaire, ça sert à rien de faire une 
 * grosse trigonométrie à notre échelle et c'est déjà assez complexe comme ça.
 */
export function projectOnShape(shape: Shape, latitude: number, longitude: number): number | undefined {
	const { latitudes, longitudes, distances, length } = shape;
	if (length === 0) {
		return undefined;
	}
	if (length === 1) {
		return distances[0] as number;
	}

	const RADIUS = 6371008.8;
	const rad = Math.PI / 180;
	let bestDistance = distances[0] as number;
	let bestGap = Number.POSITIVE_INFINITY;

	for (let index = 1; index < length; index++) {
		const alat = latitudes[index - 1] as number;
		const alon = longitudes[index - 1] as number;
		const blat = latitudes[index] as number;
		const blon = longitudes[index] as number;
		const scale = Math.cos(((alat + blat) / 2) * rad);

		const px = (longitude - alon) * scale * RADIUS * rad;
		const py = (latitude - alat) * RADIUS * rad;
		const bx = (blon - alon) * scale * RADIUS * rad;
		const by = (blat - alat) * RADIUS * rad;

		const lengthSquared = bx * bx + by * by;
		const ratio = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / lengthSquared));
		const dx = px - ratio * bx;
		const dy = py - ratio * by;
		const gap = dx * dx + dy * dy;

		if (gap < bestGap) {
			bestGap = gap;
			const from = distances[index - 1] as number;
			const to = distances[index] as number;
			bestDistance = from + (to - from) * ratio;
		}
	}

	return bestDistance;
}
