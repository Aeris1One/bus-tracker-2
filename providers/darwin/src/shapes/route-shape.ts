// Construction d'un tracé suivant les rails, par programmation dynamique de type Viterbi sur des
// couches de candidats : voir {@link buildRoutedShape} pour le détail de cette forme.

import {
	CANDIDATE_CLUSTER_METERS,
	CANDIDATE_MAX,
	CANDIDATE_RADIUS_METERS,
	SHAPE_COORDINATE_DIGITS,
	SHAPE_DISTANCE_DIGITS,
	TURN_ANGLE_DEGREES,
	TURN_PENALTY_METERS,
} from "../constants.js";
import type { ShapeVertex } from "../domain/shape.js";
import type { Counters } from "../state/counters.js";
import { bearingBetween, bearingDifference, distanceBetween } from "../utils/geo.js";
import type { ChGraph } from "./ch-graph.js";
import type { NodeGrid } from "./node-grid.js";
import type { RailGraph } from "./rail-graph.js";

/** Point. Déjà filtré par {@link selectShapeCalls} pour exclure les lieux sans coordonnées. */
export type ShapePoint = {
	readonly tiploc: string;
	readonly latitude: number;
	readonly longitude: number;
	readonly callOrder: number;
	/** Alimente `shape:snap:station:*` et `shape:snap:pp:*`. */
	readonly isPassenger: boolean;
};

/** Un candidat retenu pour un point */
export type Candidate = {
	readonly latitude: number;
	readonly longitude: number;
	/** Clé de nœud du graphe pré-contracté ; absente pour un pseudo-candidat. */
	readonly key?: string;
	/** Distance d'accrochage au rail, en mètres ; 0 pour un pseudo-candidat. */
	readonly snapDistance: number;
};

/** Le tronçon entre deux candidats. */
type RouteLeg = {
	path: [number, number][];
	length: number;
	bearing: number;
	bridge: boolean;
};

export type RailRouter = {
	// Faux en l'absence de graphe pré-contracté (`.pbf`)
	readonly canRoute: boolean;
	findCandidates(latitude: number, longitude: number): Candidate[];
	leg(from: Candidate, to: Candidate): RouteLeg;
};

function snapBucket(distanceMeters: number): "<25" | "25-100" | "100-200" | ">=200" {
	const [low, mid, high] = [25, 100, 200];
	if (distanceMeters < low) return "<25";
	if (distanceMeters < mid) return "25-100";
	if (distanceMeters < high) return "100-200";
	return ">=200";
}

function ratioBucket(ratio: number): "<1" | "1-1.6" | "1.6-2" | ">2" {
	const [low, mid, high] = [1, 1.6, 2];
	if (ratio < low) return "<1";
	if (ratio < mid) return "1-1.6";
	if (ratio < high) return "1.6-2";
	return ">2";
}

export function roundTo(value: number, digits: number): number {
	const factor = 10 ** digits;
	return Math.round(value * factor) / factor;
}

function recordSnap(counters: Counters, point: ShapePoint, candidate: Candidate): void {
	const bucket = snapBucket(candidate.snapDistance);
	counters.increment(`shape:snap:${bucket}`);
	counters.increment(`shape:snap:${point.isPassenger ? "station" : "pp"}:${bucket}`);
}

function pairKey(a: number, b: number): string {
	return `${a}:${b}`;
}

/**
 * Relie le graphe ferroviaire (`.bin`), sa grille d'accélération et le graphe pré-contracté (`.pbf`)
 */
export function createRailRouter(graph: RailGraph, grid: NodeGrid, ch: ChGraph | undefined): RailRouter {
	function findCandidates(latitude: number, longitude: number): Candidate[] {
		const nearbyIndices = grid.within(latitude, longitude, CANDIDATE_RADIUS_METERS);

		const withDistance = nearbyIndices
			.map((index) => {
				const nodeLatitude = graph.latitudes[index];
				const nodeLongitude = graph.longitudes[index];
				if (nodeLatitude === undefined || nodeLongitude === undefined) {
					return undefined;
				}
				return {
					index,
					latitude: nodeLatitude,
					longitude: nodeLongitude,
					distance: distanceBetween(latitude, longitude, nodeLatitude, nodeLongitude),
				};
			})
			.filter((candidate) => candidate !== undefined)
			.sort((a, b) => a.distance - b.distance);

		const closest = withDistance[0];
		if (!closest) {
			// Aucun nœud dans le rayon : pseudo-candidat sur la coordonnée du lieu. Normalement n'arrive jamais.
			return [{ latitude, longitude, snapDistance: 0 }];
		}

		// Renvois tous les candidats à moins de 200m de la position
		return withDistance
			.filter((candidate) => candidate.distance < closest.distance + CANDIDATE_CLUSTER_METERS)
			.slice(0, CANDIDATE_MAX)
			.map((candidate) => ({
				latitude: candidate.latitude,
				longitude: candidate.longitude,
				key: ch?.keyForNode(candidate.index),
				snapDistance: candidate.distance,
			}));
	}

	function leg(from: Candidate, to: Candidate): RouteLeg {
		const chordBearing = bearingBetween(from.latitude, from.longitude, to.latitude, to.longitude);
		const chordDistance = distanceBetween(from.latitude, from.longitude, to.latitude, to.longitude);
		const chordFallback: RouteLeg = {
			path: [
				[from.latitude, from.longitude],
				[to.latitude, to.longitude],
			],
			length: chordDistance,
			bearing: chordBearing,
			bridge: true,
		};

		// Pseudo-candidat (sans clé) ou absence de graphe pré-contracté : ligne droite.
		if (from.key === undefined || to.key === undefined || ch === undefined) {
			return chordFallback;
		}

		const path = ch.shortestPath(from.key, to.key);
		if (!path || path.length < 2) {
			return chordFallback;
		}

		let length = 0;
		for (let index = 1; index < path.length; index += 1) {
			const previous = path[index - 1];
			const current = path[index];
			if (!previous || !current) {
				continue;
			}
			length += distanceBetween(previous[0], previous[1], current[0], current[1]);
		}
		const first = path[0];
		const second = path[1];
		if (!first || !second) {
			return chordFallback;
		}
		// Le cap d'entrée d'un tronçon est celui de son premier micro-segment.
		return { path, length, bearing: bearingBetween(first[0], first[1], second[0], second[1]), bridge: false };
	}

	return { canRoute: ch !== undefined, findCandidates, leg };
}

/**
 * Construit la polyligne routée d'un tracé. Erreur en cas d'impossibilité, ({@link ensureShapes}) retombe sur le
 * rectiligne.
 *
 * L'état gardé à chaque étape est le couple (candidat précédent, candidat courant) et pas juste le
 * courant, parce que la pénalité de demi-tour a besoin des deux derniers tronçons pour être calculée.
 */
export function buildRoutedShape(points: ShapePoint[], router: RailRouter, counters: Counters): ShapeVertex[] {
	if (points.length < 2) {
		throw new Error("buildRoutedShape : au moins deux points sont nécessaires.");
	}

	const layers = points.map((point) => router.findCandidates(point.latitude, point.longitude));
	const transitionCount = layers.length - 1;

	const legsByTransition: Map<string, RouteLeg>[] = [];
	const costByTransition: Map<string, number>[] = [];
	const backByTransition: (Map<string, number> | undefined)[] = [];

	for (let t = 0; t < transitionCount; t += 1) {
		const fromLayer = layers[t];
		const toLayer = layers[t + 1];
		if (!fromLayer || !toLayer) {
			throw new Error("buildRoutedShape : couche de candidats manquante (inatteignable).");
		}

		const legs = new Map<string, RouteLeg>();
		for (let a = 0; a < fromLayer.length; a += 1) {
			const from = fromLayer[a];
			if (!from) continue;
			for (let b = 0; b < toLayer.length; b += 1) {
				const to = toLayer[b];
				if (!to) continue;
				legs.set(pairKey(a, b), router.leg(from, to));
			}
		}
		legsByTransition.push(legs);

		const costs = new Map<string, number>();
		const backs = t === 0 ? undefined : new Map<string, number>();

		if (t === 0) {
			// Premier point : pas de tronçon précédent, donc pas de pénalité de demi-tour possible ici.
			for (let a = 0; a < fromLayer.length; a += 1) {
				const from = fromLayer[a];
				if (!from) continue;
				for (let b = 0; b < toLayer.length; b += 1) {
					const to = toLayer[b];
					const leg = to ? legs.get(pairKey(a, b)) : undefined;
					if (!to || !leg) continue;
					costs.set(pairKey(a, b), from.snapDistance + leg.length + to.snapDistance);
				}
			}
		} else {
			const previousCosts = costByTransition[t - 1];
			const previousLegs = legsByTransition[t - 1];
			const previousLayer = layers[t - 1];
			if (!previousCosts || !previousLegs || !previousLayer) {
				throw new Error("buildRoutedShape : transition précédente manquante (inatteignable).");
			}

			for (let a = 0; a < fromLayer.length; a += 1) {
				for (let b = 0; b < toLayer.length; b += 1) {
					const to = toLayer[b];
					const currentLeg = legs.get(pairKey(a, b));
					if (!to || !currentLeg) continue;

					let bestCost = Number.POSITIVE_INFINITY;
					let bestPrevious = 0;
					for (let x = 0; x < previousLayer.length; x += 1) {
						const enteringCost = previousCosts.get(pairKey(x, a));
						const previousLeg = previousLegs.get(pairKey(x, a));
						if (enteringCost === undefined || !previousLeg) continue;
						const penalty =
							bearingDifference(previousLeg.bearing, currentLeg.bearing) > TURN_ANGLE_DEGREES ? TURN_PENALTY_METERS : 0;
						const total = enteringCost + penalty;
						if (total < bestCost) {
							bestCost = total;
							bestPrevious = x;
						}
					}
					if (bestCost === Number.POSITIVE_INFINITY) continue;
					costs.set(pairKey(a, b), bestCost + currentLeg.length + to.snapDistance);
					backs?.set(pairKey(a, b), bestPrevious);
				}
			}
		}

		costByTransition.push(costs);
		backByTransition.push(backs);
	}

	// On repart de la dernière transition et on remonte.
	const lastT = transitionCount - 1;
	const lastCosts = costByTransition[lastT];
	if (!lastCosts) {
		throw new Error("buildRoutedShape : aucune transition calculée (inatteignable).");
	}
	let bestKey: string | undefined;
	let bestCost = Number.POSITIVE_INFINITY;
	for (const [key, cost] of lastCosts) {
		if (cost < bestCost) {
			bestCost = cost;
			bestKey = key;
		}
	}
	if (bestKey === undefined) {
		// Inatteignable : `leg` retourne toujours quelque chose (routé ou corde).
		throw new Error("buildRoutedShape : aucun chemin trouvé, même en repli sur corde.");
	}
	const [bestFromRaw, bestToRaw] = bestKey.split(":");
	const chosen: number[] = new Array(layers.length);
	chosen[layers.length - 1] = Number(bestToRaw);
	chosen[layers.length - 2] = Number(bestFromRaw);

	for (let t = lastT; t >= 1; t -= 1) {
		const a = chosen[t];
		const b = chosen[t + 1];
		const backs = backByTransition[t];
		const x = a !== undefined && b !== undefined ? backs?.get(pairKey(a, b)) : undefined;
		if (x === undefined) {
			throw new Error("buildRoutedShape : antécédent introuvable lors de la reconstruction (inatteignable).");
		}
		chosen[t - 1] = x;
	}

	const selected = layers.map((layer, index) => {
		const candidateIndex = chosen[index];
		const candidate = candidateIndex === undefined ? undefined : layer[candidateIndex];
		if (!candidate) {
			throw new Error("buildRoutedShape : candidat introuvable après reconstruction (inatteignable).");
		}
		return candidate;
	});

	const vertices: ShapeVertex[] = [];
	const firstPoint = points[0];
	const firstCandidate = selected[0];
	if (!firstPoint || !firstCandidate) {
		throw new Error("buildRoutedShape : premier point ou candidat manquant (inatteignable).");
	}
	recordSnap(counters, firstPoint, firstCandidate);
	vertices.push({
		latitude: roundTo(firstCandidate.latitude, SHAPE_COORDINATE_DIGITS),
		longitude: roundTo(firstCandidate.longitude, SHAPE_COORDINATE_DIGITS),
		distance: 0,
		callOrder: firstPoint.callOrder,
	});

	let cumulativeDistance = 0;
	let previousRaw: [number, number] = [firstCandidate.latitude, firstCandidate.longitude];
	let turnCount = 0;

	for (let t = 0; t < transitionCount; t += 1) {
		const arrivalPoint = points[t + 1];
		const arrivalCandidate = selected[t + 1];
		const a = chosen[t];
		const b = chosen[t + 1];
		const legHere = a !== undefined && b !== undefined ? legsByTransition[t]?.get(pairKey(a, b)) : undefined;
		if (!arrivalPoint || !arrivalCandidate || !legHere) {
			throw new Error("buildRoutedShape : tronçon retenu introuvable à l'émission (inatteignable).");
		}

		if (t >= 1) {
			const previousA = chosen[t - 1];
			const previousB = chosen[t];
			const previousLeg =
				previousA !== undefined && previousB !== undefined
					? legsByTransition[t - 1]?.get(pairKey(previousA, previousB))
					: undefined;
			if (previousLeg && bearingDifference(previousLeg.bearing, legHere.bearing) > TURN_ANGLE_DEGREES) {
				turnCount += 1;
			}
		}

		if (legHere.bridge) {
			counters.increment("shape:bridge");
			counters.increment("shape:bridge:len", legHere.length);
		}

		// On saute le premier nœud du tronçon, déjà émis comme dernier sommet du tronçon d'avant.
		for (let index = 1; index < legHere.path.length; index += 1) {
			const point = legHere.path[index];
			if (!point) continue;
			cumulativeDistance += distanceBetween(previousRaw[0], previousRaw[1], point[0], point[1]);
			previousRaw = point;
			vertices.push({
				latitude: roundTo(point[0], SHAPE_COORDINATE_DIGITS),
				longitude: roundTo(point[1], SHAPE_COORDINATE_DIGITS),
				distance: roundTo(cumulativeDistance, SHAPE_DISTANCE_DIGITS),
				// Rang du point d'arrivée du tronçon, pas celui de départ.
				callOrder: arrivalPoint.callOrder,
			});
		}

		recordSnap(counters, arrivalPoint, arrivalCandidate);
	}

	let chordSum = 0;
	for (let index = 1; index < points.length; index += 1) {
		const previous = points[index - 1];
		const current = points[index];
		if (!previous || !current) continue;
		chordSum += distanceBetween(previous.latitude, previous.longitude, current.latitude, current.longitude);
	}

	counters.increment("shape:total");
	if (chordSum > 0) {
		counters.increment(`shape:ratio:${ratioBucket(cumulativeDistance / chordSum)}`);
	}
	counters.increment("shape:turns", turnCount);
	if (turnCount > 0) {
		counters.increment("shape:turns:nonzero");
	}

	return vertices;
}
