// Assemblage de l'entrée publiée d'un train. Seul fichier du provider qui construise un
// `VehicleJourney` : aucun type local ne redécrit une entité du contrat.

import type { VehicleJourney } from "@bus-tracker/contracts";

import type { ProviderContext } from "../context.js";
import { buildDestination } from "../domain/destination.js";
import { evaluateTrain } from "../domain/eligibility.js";
import { buildLine } from "../domain/line.js";
import { computePosition } from "../domain/position.js";
import { computePassengerWindow, selectActiveSegment } from "../domain/regime.js";
import { type Segment, type SegmentKind, splitIntoSegments } from "../domain/segment.js";
import type { Shape } from "../domain/shape.js";
import type { Train } from "../domain/train.js";
import { ensureShapes } from "../shapes/shape-builder.js";
import { buildCalls } from "./build-calls.js";

/**
 * `evaluateTrain` → `splitIntoSegments` → `ensureShapes` → `selectActiveSegment` 
 * → `computePosition` → `buildCalls` → `buildLine` → `buildDestination`.
 *
 * Renvoie `undefined` quand le train est écarté par `evaluateTrain`. 
 * Sinon, renvoie la journey, les shapes et le nombre d'arrêts dont les horaires n'ont pas pu être déterminées.
 */
export function buildJourney(
	context: ProviderContext,
	train: Train,
	nowMs: number,
): { journey: VehicleJourney; shapes: Map<SegmentKind, Shape>; omitted: number } | undefined {
	// Vérifier l'éligibilité du train
	const eligibility = evaluateTrain(
		train,
		nowMs,
		{
			showDeparturesWithinMs: context.configuration.showDeparturesWithinMs,
			keepAfterArrivalMs: context.configuration.keepAfterArrivalMs,
		},
		context.references.hasCoordinates,
	);
	if ("rejectedBecause" in eligibility) {
		return undefined;
	}
	const truncatedCalls = eligibility.calls;

	// /!\ Pour le calcul des shapes on veut tous les arrêts même ceux qui ne seront pas envoyés sur BT,
	// par ex. les points de passage sans arrêt, donc on utilise bien train.calls (non filtré) et pas 
	// eligibility.calls (filtré)
	const segments: Segment[] = splitIntoSegments(train.calls);
	const shapes = ensureShapes(segments, {
		sourceId: context.configuration.id,
		shapePaths: context.configuration.shapePaths ?? false,
		graphVersion: context.graphVersion,
		shapes: context.shapes,
		counters: context.counters,
		router: context.router,
		coordinatesOf: context.references.coordinatesOf,
	});

	const window = computePassengerWindow(train);
	const { segment: activeSegment, regime } = selectActiveSegment(segments, window, nowMs);
	const activeShape = shapes.get(activeSegment.kind);

	// Interpolation
	const position = computePosition(train.calls, context.references.coordinatesOf, activeShape, nowMs);
	// S'il n'y a aucun tracé actif, ou distance non calculable dessus alors aucune distance nulle part pour ce
	// train, ni sur la position, ni sur ses points (le client BT aime pas du tout).
	const suppressDistances = position.distanceTraveled === undefined;

	const { calls, omitted } = buildCalls(truncatedCalls, regime, {
		placeName: context.references.placeName,
		coordinatesOf: context.references.coordinatesOf,
		activeShape,
		suppressDistances,
	});

	const networkRef = context.configuration.getNetworkRef(train);
	const line = buildLine(train, regime, {
		networkRef,
		placeName: context.references.placeName,
		operatorName: context.references.operatorName,
		mapHeadcodeToLineName: context.configuration.mapHeadcodeToLineName,
		tocColors: context.configuration.tocColors,
	});
	const destination = buildDestination(
		train,
		regime,
		context.references.placeName,
		context.associations.forRid(train.rid),
		context.references.via,
	);

	// Ancrage temporel commun à `updatedAt` et `position.recordedAt` : la dernière observation temps
	// réel du train, à défaut l'instant courant du cycle.
	const observedAtMs = train.lastObservedAt ?? nowMs;
	const observedAtIso = new Date(observedAtMs).toISOString();

	const journey: VehicleJourney = {
		id: `${networkRef}:ServiceJourney:${train.rid}`,
		journeyRef: `${networkRef}:ServiceJourney:${train.rid}`,
		networkRef,
		operatorRef: context.configuration.mapOperatorRef?.(train.toc) ?? train.toc,
		serviceDate: train.ssd,
		updatedAt: observedAtIso,
		// Toujours faux : aucune position GPS réelle n'est disponible. `path`, `direction`,
		// `occupancy` et `vehicleRef` ne sont donc jamais renseignés par ce provider.
		hasRealVehicle: false,
		position: {
			latitude: position.latitude,
			longitude: position.longitude,
			type: "COMPUTED",
			atStop: position.atStop,
			recordedAt: observedAtIso,
			...(position.bearing !== undefined ? { bearing: position.bearing } : {}),
			...(position.distanceTraveled !== undefined ? { distanceTraveled: position.distanceTraveled } : {}),
		},
		calls,
		...(line !== undefined ? { line } : {}),
		...(destination !== undefined ? { destination } : {}),
		...(activeShape !== undefined ? { pathRef: activeShape.redisKey } : {}),
	};

	return { journey, shapes, omitted };
}
