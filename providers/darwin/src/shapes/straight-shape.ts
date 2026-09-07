// Shapes rectilignes en secours

import { SHAPE_COORDINATE_DIGITS, SHAPE_DISTANCE_DIGITS } from "../constants.js";
import type { ShapeVertex } from "../domain/shape.js";
import { distanceBetween } from "../utils/geo.js";
import { roundTo, type ShapePoint } from "./route-shape.js";

/**
 * Employé dans tous les cas de secours : tracés désactivés en configuration, aucun graphe ferroviaire
 * chargé, aucun graphe pré-contracté chargé, ou erreur du calcul routé.
 */
export function buildStraightShape(points: ShapePoint[]): ShapeVertex[] {
	if (points.length < 2) {
		throw new Error("buildStraightShape : au moins deux points sont nécessaires.");
	}

	const first = points[0];
	if (!first) {
		throw new Error("buildStraightShape : premier point manquant (inatteignable).");
	}

	const vertices: ShapeVertex[] = [
		{
			latitude: roundTo(first.latitude, SHAPE_COORDINATE_DIGITS),
			longitude: roundTo(first.longitude, SHAPE_COORDINATE_DIGITS),
			distance: 0,
			callOrder: first.callOrder,
		},
	];

	let cumulativeDistance = 0;
	for (let index = 1; index < points.length; index += 1) {
		const previous = points[index - 1];
		const current = points[index];
		if (!previous || !current) {
			continue;
		}
		cumulativeDistance += distanceBetween(previous.latitude, previous.longitude, current.latitude, current.longitude);
		vertices.push({
			latitude: roundTo(current.latitude, SHAPE_COORDINATE_DIGITS),
			longitude: roundTo(current.longitude, SHAPE_COORDINATE_DIGITS),
			distance: roundTo(cumulativeDistance, SHAPE_DISTANCE_DIGITS),
			callOrder: current.callOrder,
		});
	}

	return vertices;
}
