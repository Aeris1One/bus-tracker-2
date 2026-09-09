// Mise en forme des points de desserte publiés d'un train

import type { VehicleJourneyCall, VehicleJourneyCallFlags } from "@bus-tracker/contracts";

import { STOP_REF_PREFIX } from "../constants.js";
import { type Call, computeCallFlags, isPassengerTag, isPlatformHidden } from "../domain/call.js";
import type { Regime } from "../domain/regime.js";
import type { Shape } from "../domain/shape.js";

export type CallBuildContext = {
	placeName: (tiploc: string) => string;
	coordinatesOf: (tiploc: string) => { latitude: number; longitude: number } | undefined;
	/** Tracé du segment actif ; absent si aucun n'a pu être construit. */
	activeShape: Shape | undefined;
	/** Vrai si aucune distance ne doit être publiée pour ce train. */
	suppressDistances: boolean;
};

type AimedPair = { departure: number | undefined; arrival?: number | undefined };

/**
 * Couples {départ, arrivée théorique} d'un point, dans l'ordre de priorité applicable à sa nature
 * (voyageur ou non) et à sa position dans la liste (`isLast`) : horaire public avant technique pour un
 * point voyageur, l'inverse pour un point technique ; on part de l'arrivée pour le dernier point du
 * train, du départ pour tous les autres.
 */
function priorityPairs(call: Call, passengerCall: boolean, isLast: boolean): AimedPair[] {
	if (passengerCall) {
		return isLast
			? [
					{ departure: call.aimedPublicArrival },
					{ departure: call.aimedPublicDeparture },
					{ departure: call.aimedWorkingArrival },
					{ departure: call.aimedWorkingDeparture },
					{ departure: call.aimedWorkingPass },
				]
			: [
					{ departure: call.aimedPublicDeparture, arrival: call.aimedPublicArrival },
					{ departure: call.aimedPublicArrival },
					{ departure: call.aimedWorkingDeparture, arrival: call.aimedWorkingArrival },
					{ departure: call.aimedWorkingArrival },
					{ departure: call.aimedWorkingPass },
				];
	}
	return isLast
		? [
				{ departure: call.aimedWorkingArrival },
				{ departure: call.aimedWorkingDeparture },
				{ departure: call.aimedWorkingPass },
				{ departure: call.aimedPublicArrival },
				{ departure: call.aimedPublicDeparture },
			]
		: [
				{ departure: call.aimedWorkingDeparture, arrival: call.aimedWorkingArrival },
				{ departure: call.aimedWorkingArrival },
				{ departure: call.aimedWorkingPass },
				{ departure: call.aimedPublicDeparture, arrival: call.aimedPublicArrival },
				{ departure: call.aimedPublicArrival },
			];
}

/**
 * Couple théorique retenu, ou `undefined` si aucun des cinq départs n'est résoluble. `arrival` n'est
 * présente que si le couple choisi en porte une (voir `priorityPairs`).
 */
function resolveAimedPair(call: Call, isLast: boolean): { departure: number; arrival: number | undefined } | undefined {
	for (const pair of priorityPairs(call, isPassengerTag(call.tag), isLast)) {
		if (pair.departure !== undefined) {
			return { departure: pair.departure, arrival: pair.arrival };
		}
	}
	return undefined;
}

/**
 * Heure temps-réel, facultative : arrivée si `isLast`, départ sinon ; à défaut, heure technique
 * prévue (pour les PP).
 */
function resolveExpectedTime(call: Call, isLast: boolean): number | undefined {
	const primary = isLast
		? (call.actualArrival ?? call.expectedArrival)
		: (call.actualDeparture ?? call.expectedDeparture);
	return primary ?? call.expectedWorking;
}

/**
 * Arrivée temps réel
 */
function resolveExpectedArrival(call: Call): number | undefined {
	return call.actualArrival ?? call.expectedArrival;
}

/** En ECS on ajoute systématiquement les flags */
function resolveFlags(call: Call, regime: Regime): VehicleJourneyCallFlags[] {
	const computed = computeCallFlags(call.tag, call.activity);
	if (regime !== "ECS") {
		return computed;
	}
	return [...new Set<VehicleJourneyCallFlags>([...computed, "NO_PICKUP", "NO_DROP_OFF"])];
}

function buildOneCall(
	call: Call,
	regime: Regime,
	isLast: boolean,
	aimedPair: { departure: number; arrival: number | undefined },
	context: CallBuildContext,
): VehicleJourneyCall {
	const departureMs = aimedPair.departure;
	const arrivalMs = aimedPair.arrival;
	const coordinates = context.coordinatesOf(call.tiploc);
	const flags = resolveFlags(call, regime);
	const expectedTimeMs = resolveExpectedTime(call, isLast);
	const expectedArrivalMs = resolveExpectedArrival(call);
	const distance =
		context.activeShape !== undefined && !context.suppressDistances
			? context.activeShape.distanceByCallOrder.get(call.order)
			: undefined;

	const aimedOk = !isLast && arrivalMs !== undefined && arrivalMs <= departureMs;
	const expectedOk =
		aimedOk && expectedArrivalMs !== undefined && expectedTimeMs !== undefined && expectedArrivalMs <= expectedTimeMs;
	const dwelling = aimedOk && (arrivalMs !== departureMs || (expectedOk && expectedArrivalMs !== expectedTimeMs));

	return {
		stopRef: `${STOP_REF_PREFIX}:${call.tiploc}`,
		stopName: context.placeName(call.tiploc),
		stopOrder: call.order,
		aimedTime: new Date(departureMs).toISOString(),
		callStatus: call.cancelled ? "SKIPPED" : "SCHEDULED",
		// Pas de clé `undefined`.
		...(expectedTimeMs !== undefined ? { expectedTime: new Date(expectedTimeMs).toISOString() } : {}),
		...(dwelling && arrivalMs !== undefined ? { aimedArrivalTime: new Date(arrivalMs).toISOString() } : {}),
		...(dwelling && expectedOk && expectedArrivalMs !== undefined
			? { expectedArrivalTime: new Date(expectedArrivalMs).toISOString() }
			: {}),
		...(call.platform !== undefined && !isPlatformHidden(call) ? { platformName: call.platform } : {}),
		...(coordinates !== undefined ? { latitude: coordinates.latitude, longitude: coordinates.longitude } : {}),
		...(flags.length > 0 ? { flags } : {}),
		...(distance !== undefined ? { distanceTraveled: distance } : {}),
	};
}

/**
 * Sélection puis mise en forme des points publiés d'un train.
 * `omitted` compte les points sans heure théorique résoluble.
 */
export function buildCalls(
	truncatedCalls: Call[],
	regime: Regime,
	context: CallBuildContext,
): { calls: VehicleJourneyCall[]; omitted: number } {
	// Si le train est un ECS, on montre tout sauf les PP
	// Si le train est un voyageur, on affiche que les arrêts de desserte
	const selected =
		regime === "ECS"
			? truncatedCalls.filter((call) => call.tag !== "PP")
			: truncatedCalls.filter((call) => isPassengerTag(call.tag));
	const lastSelected = selected.at(-1);

	const calls: VehicleJourneyCall[] = [];
	let omitted = 0;
	for (const call of selected) {
		const isLast = call === lastSelected;
		const aimedPair = resolveAimedPair(call, isLast);
		if (aimedPair === undefined) {
			omitted++;
			continue;
		}
		calls.push(buildOneCall(call, regime, isLast, aimedPair, context));
	}
	return { calls, omitted };
}
