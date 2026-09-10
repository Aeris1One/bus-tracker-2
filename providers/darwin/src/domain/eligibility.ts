// Filtres d'éligibilité d'un train à la publication.

import { type Call, effectiveArrival, effectiveDeparture } from "./call.js";
import { isRelevantServiceDate, isWellFormedServiceDate } from "./service-date.js";
import type { Train } from "./train.js";

export type Rejection =
	| "CANCELLED"
	| "BAD_SERVICE_DATE"
	| "IRRELEVANT_SERVICE_DATE"
	| "TOO_EARLY"
	| "TOO_LATE"
	| "NO_CALLS_LEFT"
	| "NOT_LOCATABLE";

export type EligibilityOptions = { showDeparturesWithinMs: number; keepAfterArrivalMs: number };

/**
 * Indice du dernier point franchi : le plus élevé dont l'heure d'arrivée effective, à défaut son
 * départ effectif, à défaut l'infini, est inférieure ou égale à `nowMs`. Rend `0` si aucun point ne
 * satisfait ce critère.
 */
export function findLastPassedIndex(calls: Call[], nowMs: number): number {
	for (let index = calls.length - 1; index >= 0; index--) {
		const call = calls[index];
		if (call === undefined) {
			continue;
		}
		const passedAt = effectiveArrival(call) ?? effectiveDeparture(call) ?? Number.POSITIVE_INFINITY;
		if (passedAt <= nowMs) {
			return index;
		}
	}
	return 0;
}

/**
 * Détermine si le train doit être affiché ou non
 */
export function evaluateTrain(
	train: Train,
	nowMs: number,
	options: EligibilityOptions,
	hasCoordinates: (tiploc: string) => boolean,
): { calls: Call[] } | { rejectedBecause: Rejection } {
	// Annulation : marqué annulé, ou tous ses points annulés.
	if (train.cancelled || (train.calls.length > 0 && train.calls.every((call) => call.cancelled))) {
		return { rejectedBecause: "CANCELLED" };
	}

	// Date de service
	if (!isWellFormedServiceDate(train.ssd)) {
		return { rejectedBecause: "BAD_SERVICE_DATE" };
	}
	if (!isRelevantServiceDate(train.ssd, nowMs)) {
		return { rejectedBecause: "IRRELEVANT_SERVICE_DATE" };
	}

	// Pré-départ. Heure effective (théorique publique, à défaut théorique de travail) : un train ECS
	// n'a jamais d'heure publique, seulement de travail — s'en tenir au seul public le laisserait
	// toujours passer, quelle que soit son heure de départ réelle.
	const firstCall = train.calls[0];
	if (firstCall !== undefined) {
		const firstTime = effectiveDeparture(firstCall) ?? effectiveArrival(firstCall);
		if (firstTime !== undefined && firstTime > nowMs + options.showDeparturesWithinMs) {
			return { rejectedBecause: "TOO_EARLY" };
		}
	}

	// Post-arrivée
	const lastCall = train.calls.at(-1);
	if (lastCall !== undefined) {
		const lastTime = effectiveArrival(lastCall) ?? effectiveDeparture(lastCall);
		if (lastTime !== undefined && nowMs - lastTime > options.keepAfterArrivalMs) {
			return { rejectedBecause: "TOO_LATE" };
		}
	}

	// Supprimer les arrêts déjà passés
	const truncated = train.calls.slice(findLastPassedIndex(train.calls, nowMs));

	// Plus d'arrêts
	if (truncated.length === 0) {
		return { rejectedBecause: "NO_CALLS_LEFT" };
	}

	// Impossible à localiser (aucun point n'a de coords)
	if (!train.calls.some((call) => hasCoordinates(call.tiploc))) {
		return { rejectedBecause: "NOT_LOCATABLE" };
	}

	return { calls: truncated };
}
