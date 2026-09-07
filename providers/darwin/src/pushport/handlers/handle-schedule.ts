// Message `schedule` : horaire complet d'un train, en remplacement de celui connu. Les filtres de
// configuration (`filterTocs`, `filterTiplocs`) s'appliquent aussi ici, à l'identique de
// `jobs/load-resources.ts` pour le chargement initial.

import type { ProviderContext } from "../../context.js";
import { toBoolean } from "../../domain/boolean.js";
import type { Call, CallTag } from "../../domain/call.js";
import { CALL_TAGS } from "../../domain/call.js";
import { canonicalShapeKey, selectShapeCalls, splitIntoSegments } from "../../domain/segment.js";
import { serviceDateFromRid } from "../../domain/service-date.js";
import type { Train } from "../../domain/train.js";
import { isRecord } from "../envelope.js";
import { buildCallsFromTaggedGroups, isDeletedTrain } from "../read-calls.js";
import { applyTrainStatus } from "./handle-train-status.js";

function readString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function toNumber(value: unknown): number | undefined {
	if (typeof value === "number") {
		return Number.isFinite(value) ? value : undefined;
	}
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (trimmed === "") {
			return undefined;
		}
		const parsed = Number(trimmed);
		return Number.isFinite(parsed) ? parsed : undefined;
	}
	return undefined;
}

/**
 * Clés canoniques des segments d'un train, calculées sur son parcours ACTUEL. Appelée sur l'ancien
 * train, avant tout remplacement, pour cibler l'invalidation du cache de tracés (voir l'appelant).
 */
function canonicalKeysOf(train: Train, hasCoordinates: (tiploc: string) => boolean): string[] {
	return splitIntoSegments(train.calls)
		.map((segment) => selectShapeCalls(segment, hasCoordinates).calls)
		.filter((calls) => calls.length >= 2)
		.map((calls) => canonicalShapeKey(calls));
}

export function handleSchedule(context: ProviderContext, message: Record<string, unknown>): void {
	const rid = readString(message.rid);
	if (rid === undefined) {
		return;
	}
	const ssd = readString(message.ssd) ?? serviceDateFromRid(rid);

	// Un train de mode B/F/S, ou marqué supprimé, n'existe jamais : message entièrement ignoré.
	if (isDeletedTrain(message.status, message.deleted)) {
		return;
	}

	const toc = readString(message.toc) ?? "";
	const { filterTocs, filterTiplocs } = context.configuration;
	if (filterTocs?.includes(toc)) {
		// TOC exclu : message ignoré.
		return;
	}

	const groups: Partial<Record<CallTag, unknown>> = {};
	for (const tag of CALL_TAGS) {
		if (message[tag] !== undefined) {
			groups[tag] = message[tag];
		}
	}

	let calls: Call[] = buildCallsFromTaggedGroups(groups, ssd);

	if (filterTiplocs !== undefined && filterTiplocs.length > 0) {
		// TIPLOC exclus retirés, puis rangs renumérotés pour rester contigus de 0 à n−1.
		calls = calls
			.filter((call) => !filterTiplocs.includes(call.tiploc))
			.map((call, index) => ({ ...call, order: index }));
	}

	if (calls.length < 2) {
		// Moins de deux points restants : le train n'est pas installé.
		return;
	}

	const firstCall = calls[0];
	const lastCall = calls[calls.length - 1];
	if (firstCall === undefined || lastCall === undefined) {
		return;
	}

	const cancelled = toBoolean(message.can) || message.cancelReason !== undefined;
	if (cancelled) {
		calls = calls.map((call) => ({ ...call, cancelled: true }));
	}

	const existing = context.trains.get(ssd, rid);
	if (existing !== undefined) {
		context.shapes.invalidate(canonicalKeysOf(existing, context.references.hasCoordinates));
	}

	const newTrain: Train = {
		rid,
		uid: readString(message.uid) ?? "",
		ssd,
		trainId: readString(message.trainId) ?? "",
		toc,
		calls,
		origin: firstCall.tiploc,
		destination: lastCall.tiploc,
		cancelled,
		cancelReason: toNumber(message.cancelReason),
		lastObservedAt: existing?.lastObservedAt,
		lastStatusMessage: existing?.lastStatusMessage,
	};

	context.trains.set(newTrain);

	// Le dernier message TS reçu est rejoué sur le nouvel horaire, afin que le temps réel survive
	// au remplacement.
	if (isRecord(newTrain.lastStatusMessage)) {
		applyTrainStatus(newTrain, newTrain.lastStatusMessage, newTrain.lastObservedAt ?? Date.now());
	}

	// Un éventuel message TS en attente pour ce train est rejoué immédiatement.
	const pending = context.pendingStatuses.take(ssd, rid);
	if (isRecord(pending)) {
		applyTrainStatus(newTrain, pending, Date.now());
	}
}
