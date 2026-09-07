// Message TS : retards, heures réelles et quais.

import type { ProviderContext } from "../../context.js";
import { toBoolean } from "../../domain/boolean.js";
import type { Call } from "../../domain/call.js";
import type { TimeReference } from "../../domain/time.js";
import { parseDarwinTime } from "../../domain/time.js";
import type { Train } from "../../domain/train.js";
import type { Envelope } from "../envelope.js";
import { isRecord, toArray } from "../envelope.js";

function readString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

/** Nombre depuis une chaîne ou un nombre déjà natif ; undefined sur toute autre forme. */
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
 * Lecture du quai, sous ses trois formes : chaîne simple, ou objet dont la valeur est cherchée dans
 * la clé vide "", puis `value`, puis `plat`.
 */
function readPlatformValue(plat: unknown): string | undefined {
	if (typeof plat === "string") {
		return plat;
	}
	if (isRecord(plat)) {
		const candidate = plat[""] ?? plat.value ?? plat.plat;
		return typeof candidate === "string" ? candidate : undefined;
	}
	return undefined;
}

type ResolvedLocationTimes = {
	expectedArrival?: number;
	actualArrival?: number;
	expectedDeparture?: number;
	actualDeparture?: number;
	expectedWorking?: number;
	nextReference: TimeReference;
};

/**
 * Résolution temporelle d'une location.
 * La priorité de chaînage diffère de celle utilisée pour l'horaire théorique :
 * ici c'est départ réel, départ prévu, arrivée réelle, arrivée prévue, heure
 * technique prévue, référence précédente.
 */
function resolveLocationTimes(
	location: Record<string, unknown>,
	serviceDate: string,
	reference: TimeReference,
): ResolvedLocationTimes {
	const arr = isRecord(location.arr) ? location.arr : undefined;
	const dep = isRecord(location.dep) ? location.dep : undefined;
	const pass = isRecord(location.pass) ? location.pass : undefined;

	// `atRemoved` rétracte l'heure réelle correspondante : elle est ignorée, comme si elle était
	// absente du message — elle ne remet donc rien à zéro, cf. `applyDefined`.
	const arrRemoved = arr !== undefined && toBoolean(arr.atRemoved);
	const depRemoved = dep !== undefined && toBoolean(dep.atRemoved);

	const expectedArrival = parseDarwinTime(readString(arr?.et), serviceDate, reference);
	const actualArrival = arrRemoved ? undefined : parseDarwinTime(readString(arr?.at), serviceDate, reference);
	const expectedDeparture = parseDarwinTime(readString(dep?.et), serviceDate, reference);
	const actualDeparture = depRemoved ? undefined : parseDarwinTime(readString(dep?.at), serviceDate, reference);
	// Heure technique prévue = dep.wet si présent, sinon pass.wet.
	const expectedWorking =
		parseDarwinTime(readString(dep?.wet), serviceDate, reference) ??
		parseDarwinTime(readString(pass?.wet), serviceDate, reference);

	const nextReference =
		actualDeparture ?? expectedDeparture ?? actualArrival ?? expectedArrival ?? expectedWorking ?? reference;

	return { expectedArrival, actualArrival, expectedDeparture, actualDeparture, expectedWorking, nextReference };
}

/** Chaque champ n'écrase la valeur existante que s'il est défini : une absence dans le message ne remet jamais un champ à zéro. */
function applyDefined<K extends keyof Call>(call: Call, key: K, value: Call[K] | undefined): void {
	if (value !== undefined) {
		call[key] = value;
	}
}

/**
 * Applique le quai et sa visibilité. `suppr` masque l'affichage du quai
 */
function applyPlatform(call: Call, location: Record<string, unknown>): void {
	const platRaw = location.plat;
	const supprRaw = location.suppr;
	const platPresent = platRaw !== undefined;
	const supprPresent = supprRaw !== undefined;

	if (platPresent) {
		const value = readPlatformValue(platRaw);
		if (value !== undefined) {
			call.platform = value;
		}
		if (isRecord(platRaw)) {
			call.platformConfirmed = toBoolean(platRaw.conf);
		}
	}

	if (platPresent) {
		call.platformSuppressed = isRecord(platRaw) ? toBoolean(platRaw.platsup) : false;
	}
	if (supprPresent) {
		call.locationSuppressed = toBoolean(supprRaw);
	}
}

/** Cherche, à partir de `cursor`, le premier call dont le TIPLOC correspond (curseur monotone avant). */
function findFromCursor(calls: Call[], cursor: number, tiploc: string): { call: Call; nextCursor: number } | undefined {
	for (let i = cursor; i < calls.length; i++) {
		const call = calls[i];
		if (call !== undefined && call.tiploc === tiploc) {
			return { call, nextCursor: i + 1 };
		}
	}
	return undefined;
}

/**
 * Applique un message TS (sur un train précis) sur son horaire courant.
 */
export function applyTrainStatus(train: Train, message: Record<string, unknown>, nowMs: number): void {
	const locations = toArray(message.Location).filter(isRecord);

	let cursor = 0;
	let reference: TimeReference;
	const lastIndex = locations.length - 1;

	locations.forEach((location, index) => {
		const tpl = readString(location.tpl);
		if (tpl === undefined) {
			// tpl absent ⇒ location entièrement ignorée : ni chaînage, ni curseur.
			return;
		}

		const resolved = resolveLocationTimes(location, train.ssd, reference);
		reference = resolved.nextReference;

		const found = findFromCursor(train.calls, cursor, tpl);
		if (found === undefined) {
			return;
		}
		cursor = found.nextCursor;

		applyDefined(found.call, "expectedArrival", resolved.expectedArrival);
		applyDefined(found.call, "actualArrival", resolved.actualArrival);
		applyDefined(found.call, "expectedDeparture", resolved.expectedDeparture);
		applyDefined(found.call, "actualDeparture", resolved.actualDeparture);
		applyDefined(found.call, "expectedWorking", resolved.expectedWorking);
		applyPlatform(found.call, location);

		if (index === lastIndex) {
			// Motifs : attachés à la DERNIÈRE location du message uniquement.
			const lateReason = toNumber(message.LateReason ?? message.lateReason);
			const cancelReason = toNumber(message.cancelReason);
			applyDefined(found.call, "lateReason", lateReason);
			applyDefined(found.call, "cancelReason", cancelReason);
		}
	});

	train.lastObservedAt = nowMs;
	// Mémorisé tel quel pour pouvoir être rejoué après un remplacement d'horaire.
	train.lastStatusMessage = message;
}

export function handleTrainStatus(
	context: ProviderContext,
	message: Record<string, unknown>,
	envelope: Envelope,
): void {
	const rid = readString(message.rid);
	const ssd = readString(message.ssd);
	if (rid === undefined || ssd === undefined) {
		return;
	}

	const train = context.trains.get(ssd, rid);
	const nowMs = envelope.observedAtMs ?? Date.now();

	if (train === undefined) {
		// Aucun train connu pour ce couple : mis en attente, rejoué plus tard.
		context.pendingStatuses.put(ssd, rid, message, nowMs);
		return;
	}

	applyTrainStatus(train, message, nowMs);
}
