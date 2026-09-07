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

/**
 * Les cinq heures théoriques d'un point, dans l'ordre de priorité applicable à sa nature (voyageur
 * ou non) et à sa position dans la liste (`isLast`) : horaire publique avant technique pour un point
 * voyageur, l'inverse pour un point technique ; arrivée avant départ pour le dernier point,
 * l'inverse pour tous les autres.
 */
function priorityTimes(call: Call, passengerCall: boolean, isLast: boolean): (number | undefined)[] {
	if (passengerCall) {
		return isLast
			? [
					call.aimedPublicArrival,
					call.aimedPublicDeparture,
					call.aimedWorkingArrival,
					call.aimedWorkingDeparture,
					call.aimedWorkingPass,
				]
			: [
					call.aimedPublicDeparture,
					call.aimedPublicArrival,
					call.aimedWorkingDeparture,
					call.aimedWorkingArrival,
					call.aimedWorkingPass,
				];
	}
	return isLast
		? [
				call.aimedWorkingArrival,
				call.aimedWorkingDeparture,
				call.aimedWorkingPass,
				call.aimedPublicArrival,
				call.aimedPublicDeparture,
			]
		: [
				call.aimedWorkingDeparture,
				call.aimedWorkingArrival,
				call.aimedWorkingPass,
				call.aimedPublicDeparture,
				call.aimedPublicArrival,
			];
}

/**
 * Heure théorique retenue, ou `undefined` si aucune des cinq n'est résoluble.
 */
function resolveAimedTime(call: Call, isLast: boolean): number | undefined {
	for (const candidate of priorityTimes(call, isPassengerTag(call.tag), isLast)) {
		if (candidate !== undefined) {
			return candidate;
		}
	}
	return undefined;
}

/**
 * Heure prévue, facultative : arrivée si `isLast`, départ sinon ; à défaut, heure technique
 * prévue (pour les PP).
 */
function resolveExpectedTime(call: Call, isLast: boolean): number | undefined {
	const primary = isLast
		? (call.expectedArrival ?? call.actualArrival)
		: (call.expectedDeparture ?? call.actualDeparture);
	return primary ?? call.expectedWorking;
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
	aimedTimeMs: number,
	context: CallBuildContext,
): VehicleJourneyCall {
	const coordinates = context.coordinatesOf(call.tiploc);
	const flags = resolveFlags(call, regime);
	const expectedTimeMs = resolveExpectedTime(call, isLast);
	const distance =
		context.activeShape !== undefined && !context.suppressDistances
			? context.activeShape.distanceByCallOrder.get(call.order)
			: undefined;

	return {
		stopRef: `${STOP_REF_PREFIX}:${call.tiploc}`,
		stopName: context.placeName(call.tiploc),
		stopOrder: call.order,
		aimedTime: new Date(aimedTimeMs).toISOString(),
		callStatus: call.cancelled ? "SKIPPED" : "SCHEDULED",
		// Pas de clé `undefined`.
		...(expectedTimeMs !== undefined ? { expectedTime: new Date(expectedTimeMs).toISOString() } : {}),
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
		const aimedTimeMs = resolveAimedTime(call, isLast);
		if (aimedTimeMs === undefined) {
			omitted++;
			continue;
		}
		calls.push(buildOneCall(call, regime, isLast, aimedTimeMs, context));
	}
	return { calls, omitted };
}
