// Calcul de la position d'un train

import { bearingBetween, interpolate } from "../utils/geo.js";
import { type Call, effectiveArrival, effectiveDeparture } from "./call.js";
import { findLastPassedIndex } from "./eligibility.js";
import { locateOnShape, projectOnShape, type Shape } from "./shape.js";

export type ComputedPosition = {
	latitude: number;
	longitude: number;
	bearing?: number;
	atStop: boolean;
	distanceTraveled?: number;
};

type Coordinates = { latitude: number; longitude: number };
type CoordinatesOf = (tiploc: string) => Coordinates | undefined;

/**
 * Position d'un train à `nowMs`. 
 * 
 * `calls` est la liste COMPLÈTE du train (tous tags, y compris annulés) : le calcul ne retient 
 * que les points non annulés, mais le report d'ancrage ({@link nearestCoordinate}) et le réancrage 
 * sur tracé doivent pouvoir viser n'importe quel point de l'horaire complet.
 */
export function computePosition(
	calls: Call[],
	coordinatesOf: CoordinatesOf,
	activeShape: Shape | undefined,
	nowMs: number,
): ComputedPosition {
	const nonCancelled = calls.filter((call) => !call.cancelled);

	// Cas 1 — aucun point non annulé : devrait jamais arriver mais on sais jamais
	if (nonCancelled.length === 0) {
		throw new Error("computePosition : train sans aucun point");
	}

	const first = nonCancelled[0];
	const last = nonCancelled.at(-1);
	if (first === undefined || last === undefined) {
		// Pareil, normalement ça devrait jamais arriver, mais au cas où
		throw new Error("computePosition : liste vide");
	}

	// Cas 2 — avant (ou au) départ effectif du premier point.
	const firstThreshold = effectiveDeparture(first) ?? effectiveArrival(first) ?? 0;
	if (nowMs <= firstThreshold) {
		return anchorOn(calls, first, activeShape, coordinatesOf);
	}

	// Cas 3 — après (ou à) l'arrivée effective du dernier point.
	const lastThreshold = effectiveArrival(last) ?? effectiveDeparture(last) ?? 0;
	if (nowMs >= lastThreshold) {
		return anchorOn(calls, last, activeShape, coordinatesOf);
	}

	// Cas 4 — entre les deux : `c` est le dernier point franchi (hors annulés)
	const cIndex = findLastPassedIndex(nonCancelled, nowMs);
	const c = nonCancelled[cIndex];
	if (c === undefined) {
		// Inatteignable : cIndex est un indice valide de nonCancelled, non vide.
		throw new Error("computePosition : indice de troncature invalide");
	}

	// Sous-cas « à quai » : l'instant courant n'a pas encore atteint le départ effectif de `c`.
	const departureOfC = effectiveDeparture(c);
	if (departureOfC === undefined) {
		// Aucun départ effectif connu pour `c` : aucun ratio n'est calculable, on reste ancré dessus.
		return anchorOn(calls, c, activeShape, coordinatesOf);
	}
	if (nowMs <= departureOfC) {
		return anchorOn(calls, c, activeShape, coordinatesOf);
	}

	// Sous-cas « pas de point suivant ».
	const s = nonCancelled[cIndex + 1];
	if (s === undefined) {
		return anchorOn(calls, c, activeShape, coordinatesOf);
	}

	// Sous-cas « le point suivant n'a pas d'heure d'arrivée ». On ne sais pas quel pourcentage du trajet est
	// effectué, on reste ancré sur `c`.
	const arrivalAtS = effectiveArrival(s);
	if (arrivalAtS === undefined) {
		return anchorOn(calls, c, activeShape, coordinatesOf);
	}
	const span = arrivalAtS - departureOfC;
	if (span <= 0) {
		return anchorOn(calls, c, activeShape, coordinatesOf);
	}

	// Interpolation, ratio temporel borné à [0, 1].
	const ratio = Math.min(1, Math.max(0, (nowMs - departureOfC) / span));
	return interpolateBetween(calls, c, s, ratio, activeShape, coordinatesOf);
}

/**
 * Distance d'un point de desserte sur le tracé actif. 
 */
function distanceOf(shape: Shape, call: Call, coordinatesOf: CoordinatesOf): number | undefined {
	// Cas 1 : `call` est un sommet étiqueté du tracé, sa distance a déjà été précalculée à la 
	// construction de la shape.
	const labelled = shape.distanceByCallOrder.get(call.order);
	if (labelled !== undefined) {
		return labelled;
	}

	// Cas 2 : `call` n'est pas un sommet étiqueté : sa distance n'existe pas dans la table, mais 
	// a peut-être déjà été projetée lors d'un cycle précédent et dans le cache
	const memoised = shape.projectedByCallOrder.get(call.order);
	if (memoised !== undefined) {
		return memoised;
	}

	// Cas 3 : On projete et on inscris dans le cache pour les cycles suivants
	const coordinates = coordinatesOf(call.tiploc);
	if (coordinates === undefined) {
		return undefined;
	}
	const projected = projectOnShape(shape, coordinates.latitude, coordinates.longitude);
	if (projected !== undefined) {
		shape.projectedByCallOrder.set(call.order, projected);
	}
	return projected;
}

/**
 * Ancrer le pointeur sur `call`.
 */
function anchorOn(
	calls: Call[],
	call: Call,
	activeShape: Shape | undefined,
	coordinatesOf: CoordinatesOf,
): ComputedPosition {
	const base = coordinatesOf(call.tiploc) ?? nearestCoordinate(calls, call.order, coordinatesOf);

	// Forcer la coordonnée sur la shape (si possible)
	const distance = activeShape === undefined ? undefined : distanceOf(activeShape, call, coordinatesOf);
	if (activeShape !== undefined && distance !== undefined) {
		const located = locateOnShape(activeShape, distance);
		return {
			latitude: located.latitude,
			longitude: located.longitude,
			bearing: located.bearing,
			atStop: true,
			distanceTraveled: distance,
		};
	}

	return { latitude: base.latitude, longitude: base.longitude, atStop: true };
}

/**
 * Interpolation entre `c` (dernier point franchi) et `s` (le suivant), au ratio temporel donné.
 * `atStop` vaut faux dans tous les sous-cas de cette fonction.
 */
function interpolateBetween(
	calls: Call[],
	c: Call,
	s: Call,
	ratio: number,
	activeShape: Shape | undefined,
	coordinatesOf: CoordinatesOf,
): ComputedPosition {
	// Priorité au tracé du segment actif : seul cas où une distance est publiable, et seule géométrie
	// garantissant que la distance et la coordonnée publiées correspondent au même tracé.
	if (activeShape !== undefined) {
		const distanceC = distanceOf(activeShape, c, coordinatesOf);
		const distanceS = distanceOf(activeShape, s, coordinatesOf);
		if (distanceC !== undefined && distanceS !== undefined) {
			const targetDistance = distanceC + (distanceS - distanceC) * ratio;
			const located = locateOnShape(activeShape, targetDistance);
			return {
				latitude: located.latitude,
				longitude: located.longitude,
				bearing: located.bearing,
				atStop: false,
				distanceTraveled: targetDistance,
			};
		}
	}

	// Repli : corde droite entre les coordonnées directes des deux lieux — jamais de report
	// d'ancrage tiers ici, seulement les coordonnées propres de `c` et `s`.
	const coordC = coordinatesOf(c.tiploc);
	const coordS = coordinatesOf(s.tiploc);
	if (coordC !== undefined && coordS !== undefined) {
		const point = interpolate(coordC.latitude, coordC.longitude, coordS.latitude, coordS.longitude, ratio);
		return {
			latitude: point.latitude,
			longitude: point.longitude,
			bearing: bearingBetween(coordC.latitude, coordC.longitude, coordS.latitude, coordS.longitude),
			atStop: false,
		};
	}

	// L'une des deux coordonnées manque : repli sur l'ancrage du point courant (`c`), en conservant
	// `atStop` faux — le train est toujours considéré en mouvement, seule la coordonnée se dégrade.
	const fallback = coordC ?? nearestCoordinate(calls, c.order, coordinatesOf);
	return { latitude: fallback.latitude, longitude: fallback.longitude, atStop: false };
}

/**
 * Trouver le point avec coordonnées disponibles le plus proche (utilisé lorsqu'on a un point sans 
 * coordonnées)
 */
function nearestCoordinate(calls: Call[], order: number, coordinatesOf: CoordinatesOf): Coordinates {
	for (let index = order - 1; index >= 0; index--) {
		const candidate = calls[index];
		if (candidate === undefined) {
			continue;
		}
		const coordinates = coordinatesOf(candidate.tiploc);
		if (coordinates !== undefined) {
			return coordinates;
		}
	}
	for (let index = order + 1; index < calls.length; index++) {
		const candidate = calls[index];
		if (candidate === undefined) {
			continue;
		}
		const coordinates = coordinatesOf(candidate.tiploc);
		if (coordinates !== undefined) {
			return coordinates;
		}
	}
	throw new Error("computePosition : aucun point coordonné dans l'horaire");
}
