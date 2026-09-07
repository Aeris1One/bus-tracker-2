// Construction des shapes

import { createHash } from "node:crypto";
import { SHAPE_KEY_PREFIX } from "../constants.js";
import { type Call, isPassengerTag } from "../domain/call.js";
import { canonicalShapeKey, type Segment, type SegmentKind, selectShapeCalls } from "../domain/segment.js";
import { createShape, type Shape, type ShapeVertex } from "../domain/shape.js";
import type { Counters } from "../state/counters.js";
import { logger } from "../utils/logger.js";
import { buildRoutedShape, type RailRouter, type ShapePoint } from "./route-shape.js";
import type { ShapeStore } from "./shape-store.js";
import { buildStraightShape } from "./straight-shape.js";

/** Nombre de caractères pour le SHA-1 de la clé canonique. */
const FINGERPRINT_LENGTH = 16;

export type ShapeBuilderDeps = {
	sourceId: string;
	shapePaths: boolean;
	graphVersion: string;
	shapes: ShapeStore;
	counters: Counters;
	router?: RailRouter;
	coordinatesOf: (tiploc: string) => { latitude: number; longitude: number } | undefined;
};

/**
 * Clé Redis d'un tracé. `<versionGraphe>` invalide automatiquement les anciennes clés quand
 * la topologie change.
 */
export function shapeRedisKey(sourceId: string, graphVersion: string, canonicalKey: string): string {
	const fingerprint = createHash("sha1").update(canonicalKey).digest("hex").slice(0, FINGERPRINT_LENGTH);
	return `${SHAPE_KEY_PREFIX}:${sourceId}:${graphVersion}:${fingerprint}`;
}

/** Convertit les calls en points géolocalisés */
function toShapePoints(calls: readonly Call[], coordinatesOf: ShapeBuilderDeps["coordinatesOf"]): ShapePoint[] {
	return calls.map((call) => {
		const coordinates = coordinatesOf(call.tiploc);
		if (!coordinates) {
			// Inatteignable : `selectShapeCalls` a déjà retiré tout point sans coordonnée, avec le même
			// prédicat `coordinatesOf(tiploc) !== undefined` que celui utilisé ici.
			throw new Error(`toShapePoints : coordonnée manquante pour ${call.tiploc} après filtrage (inatteignable).`);
		}
		return {
			tiploc: call.tiploc,
			latitude: coordinates.latitude,
			longitude: coordinates.longitude,
			callOrder: call.order,
			isPassenger: isPassengerTag(call.tag),
		};
	});
}

/**
 * Construit les tracés des segments d'un train, avec cache. 
 * Pour chaque segment :
 * - filtrage
 * - calcul de la clé canonique 
 * - la shape est cachée ? oui : retourner la shape
 * - non ?
 *   - si le graphe est disponible et `shapePaths` actif, routage
 *   - sinon, rectiligne 
 *   - mise en cache.
 */
export function ensureShapes(segments: Segment[], deps: ShapeBuilderDeps): Map<SegmentKind, Shape> {
	const result = new Map<SegmentKind, Shape>();
	const graphVersion = deps.graphVersion;

	for (const segment of segments) {
		const selection = selectShapeCalls(segment, (tiploc) => deps.coordinatesOf(tiploc) !== undefined);
		deps.counters.increment("shape:dropped", selection.dropped);
		if (selection.calls.length < 2) {
			continue;
		}

		const canonicalKey = canonicalShapeKey(selection.calls);
		const cached = deps.shapes.get(canonicalKey);
		if (cached) {
			deps.counters.increment("shape:cache:hit");
			result.set(segment.kind, cached);
			continue;
		}
		deps.counters.increment("shape:cache:miss");

		const redisKey = shapeRedisKey(deps.sourceId, graphVersion, canonicalKey);
		const points = toShapePoints(selection.calls, deps.coordinatesOf);

		let vertices: ShapeVertex[];
		if (deps.shapePaths && deps.router?.canRoute) {
			try {
				vertices = buildRoutedShape(points, deps.router, deps.counters);
			} catch (error) {
				logger.warning("échec du tracé routé pour %s, repli rectiligne : %s", canonicalKey, String(error));
				vertices = buildStraightShape(points);
			}
		} else {
			vertices = buildStraightShape(points);
		}

		const shape = createShape(canonicalKey, redisKey, vertices);
		deps.shapes.set(shape);
		result.set(segment.kind, shape);
	}

	return result;
}
