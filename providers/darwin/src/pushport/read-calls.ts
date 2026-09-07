// Lecture des attributs de desserte, partagée entre le fichier d'horaires statique
// (`bucket/load-timetable.ts`) et le message temps réel `schedule`.

import { toBoolean } from "../domain/boolean.js";
import type { Call, CallTag } from "../domain/call.js";
import { isCallTag } from "../domain/call.js";
import type { RawTimes, TimeReference } from "../domain/time.js";
import { representativeTime, resolveAimedTimes } from "../domain/time.js";
import { isRecord, toArray } from "./envelope.js";

export type RawCall = { tag: CallTag; tpl: string; act: string; can: boolean } & RawTimes;

function readString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

/** Lit un élément de desserte. Rend undefined si `tpl` est absent. */
export function readRawCall(tag: CallTag, node: Record<string, unknown>): RawCall | undefined {
	const tpl = readString(node.tpl);
	if (tpl === undefined) {
		return undefined;
	}
	return {
		tag,
		tpl,
		act: readString(node.act) ?? "",
		can: toBoolean(node.can),
		pta: readString(node.pta),
		ptd: readString(node.ptd),
		wta: readString(node.wta),
		wtd: readString(node.wtd),
		wtp: readString(node.wtp),
	};
}

// Un train dont le mode vaut B (bus), F (ferry) ou S (bateau) n'est pas un train.
const DELETED_STATUSES = new Set(["B", "F", "S"]);

/** Un train de mode B, F ou S, ou marqué supprimé, n'existe jamais. */
export function isDeletedTrain(status: unknown, deleted: unknown): boolean {
	if (toBoolean(deleted)) {
		return true;
	}
	return typeof status === "string" && DELETED_STATUSES.has(status);
}

/** Résout les heures en chaînant la référence et numérote les points de 0 à n−1. */
export function buildCalls(raws: RawCall[], serviceDate: string): Call[] {
	let reference: TimeReference;
	return raws.map((raw, index) => {
		const { times, reference: nextReference } = resolveAimedTimes(raw, serviceDate, reference);
		reference = nextReference;
		return {
			tag: raw.tag,
			tiploc: raw.tpl,
			activity: raw.act,
			order: index,
			...times,
			platformSuppressed: false,
			locationSuppressed: false,
			platformConfirmed: false,
			cancelled: raw.can,
		};
	});
}

/**
 * Heure du point d'origine, contre laquelle toutes les autres sont bornées avant le tri. L'origine
 * est identifiée par son tag — technique (`OPOR`) avant commerciale (`OR`).
 * À défaut de l'un et de l'autre, on retombe sur l'heure la plus ancienne.
 */
function findOriginReference(collected: RawCall[], serviceDate: string): number | undefined {
	const origin = collected.find((raw) => raw.tag === "OPOR") ?? collected.find((raw) => raw.tag === "OR");
	if (origin !== undefined) {
		return representativeTime(resolveAimedTimes(origin, serviceDate, undefined).times);
	}

	let earliest: number | undefined;
	for (const raw of collected) {
		const time = representativeTime(resolveAimedTimes(raw, serviceDate, undefined).times);
		if (time !== undefined && (earliest === undefined || time < earliest)) {
			earliest = time;
		}
	}
	return earliest;
}

/**
 * Ordre reconstruit par le temps, en DEUX passes, pour un message `schedule`. Nécessaire parce que
 * le bornage de minuit dépend de l'ordre, qui dépend lui-même des heures.
 *
 * Piège : les tags ne sont pas dans l'ordre, itérer tag par tag rendra les arrêts dans le désordre.
 */
export function buildCallsFromTaggedGroups(groups: Partial<Record<CallTag, unknown>>, serviceDate: string): Call[] {
	// 1. Collecte de tous les points de toutes les clés de tag ; chaque valeur peut être un objet ou
	// un tableau d'objets, les deux formes sont acceptées.
	const collected: RawCall[] = [];
	for (const [tag, value] of Object.entries(groups)) {
		if (value === undefined || !isCallTag(tag)) {
			continue;
		}
		for (const node of toArray(value)) {
			if (!isRecord(node)) {
				continue;
			}
			const raw = readRawCall(tag, node);
			if (raw !== undefined) {
				collected.push(raw);
			}
		}
	}

	// 2. Ancrage sur l'origine, puis tri.
	// On fixe donc d'abord l'heure du point d'origine, puis on borne toutes les autres contre elle
	// (fenêtre [réf − 6 h, réf + 18 h]) avant de trier. Permet de ne pas faire n'importe quoi avec les
	// passages de minuit
	const originReference = findOriginReference(collected, serviceDate);

	const withSortKey = collected.map((raw) => ({
		raw,
		sortKey: representativeTime(resolveAimedTimes(raw, serviceDate, originReference).times) ?? Number.POSITIVE_INFINITY,
	}));
	withSortKey.sort((a, b) => a.sortKey - b.sortKey);

	// 3. Ré-analyse dans l'ordre trié, cette fois avec chaînage de la référence, et numérotation
	// finale de 0 à n−1.
	return buildCalls(
		withSortKey.map((entry) => entry.raw),
		serviceDate,
	);
}
