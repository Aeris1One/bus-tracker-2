// Fichier d'horaires

import { XMLParser } from "fast-xml-parser";
import { toBoolean } from "../domain/boolean.js";
import { isCallTag } from "../domain/call.js";
import { serviceDateFromRid } from "../domain/service-date.js";
import type { Train } from "../domain/train.js";
import { buildCalls, isDeletedTrain, readRawCall } from "../pushport/read-calls.js";
import { gunzip } from "../utils/gunzip.js";
import type { ObjectStore } from "./object-store.js";
import { pickLatest } from "./pick-latest.js";

export type TimetableData = { timetableId: string; trains: Train[] };

// `_v<chiffres>.xml.gz`, sans le segment `_ref_` qui distingue le référentiel.
const TIMETABLE_NAME_PATTERN = /^PPTimetable\/(\d+)_v(\d+)\.xml\.gz$/;

/**
 * `preserveOrder: true` : sans lui, `fast-xml-parser` regroupe tous les `IP` ensemble, tous les `PP` ensemble, etc.,
 * et l'ordre chronologique des points de desserte serait perdu.
 */
const parser = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: "@_",
	preserveOrder: true,
	parseTagValue: false,
});

/** Un nœud en mode `preserveOrder` : `{ <tag>: enfants[], ":@"?: attributs }`. */
type OrderedNode = Record<string, unknown>;

function nodeTagName(node: OrderedNode): string | undefined {
	return Object.keys(node).find((key) => key !== ":@");
}

function nodeChildren(node: OrderedNode): OrderedNode[] {
	const tag = nodeTagName(node);
	if (tag === undefined) {
		return [];
	}
	const children = node[tag];
	return Array.isArray(children) ? (children as OrderedNode[]) : [];
}

function nodeAttributes(node: OrderedNode): Record<string, unknown> {
	const attrs = node[":@"];
	return typeof attrs === "object" && attrs !== null ? (attrs as Record<string, unknown>) : {};
}

/** Reconstitue un objet d'attributs à noms simples (`tpl`, `act`, …) depuis le préfixe `@_` de fast-xml-parser. */
function plainAttributes(node: OrderedNode): Record<string, unknown> {
	const attrs = nodeAttributes(node);
	const plain: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(attrs)) {
		if (key.startsWith("@_")) {
			plain[key.slice(2)] = value;
		}
	}
	return plain;
}

function attrString(node: OrderedNode, name: string): string | undefined {
	const value = plainAttributes(node)[name];
	return typeof value === "string" ? value : undefined;
}

/** Texte du premier enfant `#text` d'un nœud (utilisé pour `cancelReason`). */
function nodeText(node: OrderedNode): string | undefined {
	for (const child of nodeChildren(node)) {
		const text = child["#text"];
		if (typeof text === "string") {
			return text;
		}
	}
	return undefined;
}

function parseCancelReason(journeyNode: OrderedNode): number | undefined {
	for (const child of nodeChildren(journeyNode)) {
		if (nodeTagName(child) !== "cancelReason") {
			continue;
		}
		const text = nodeText(child);
		if (text === undefined) {
			return undefined;
		}
		const value = Number(text);
		return Number.isNaN(value) ? undefined : value;
	}
	return undefined;
}

function firstCallTiploc(train: Train): string {
	return train.calls[0]?.tiploc ?? "";
}

function lastCallTiploc(train: Train): string {
	return train.calls.at(-1)?.tiploc ?? "";
}

/** Construit un train depuis un nœud `Journey`, ou undefined s'il n'existe pas. */
function readJourney(journeyNode: OrderedNode): Train | undefined {
	const rid = attrString(journeyNode, "rid");
	if (rid === undefined) {
		return undefined;
	}

	const status = attrString(journeyNode, "status");
	const deleted = attrString(journeyNode, "deleted");
	if (isDeletedTrain(status, deleted)) {
		return undefined;
	}

	const ssd = attrString(journeyNode, "ssd") ?? serviceDateFromRid(rid);

	// Le nom de balise EST le tag : tout élément dont le nom n'est pas l'un des sept tags de desserte
	// est ignoré (`cancelReason` inclus, déjà traité séparément ci-dessus).
	const rawCalls = [];
	for (const child of nodeChildren(journeyNode)) {
		const tag = nodeTagName(child);
		if (tag === undefined || !isCallTag(tag)) {
			continue;
		}
		const raw = readRawCall(tag, plainAttributes(child));
		if (raw !== undefined) {
			rawCalls.push(raw);
		}
	}

	const calls = buildCalls(rawCalls, ssd);

	const train: Train = {
		rid,
		uid: attrString(journeyNode, "uid") ?? "",
		ssd,
		trainId: attrString(journeyNode, "trainId") ?? "",
		toc: attrString(journeyNode, "toc") ?? "",
		calls,
		origin: "",
		destination: "",
		cancelled: toBoolean(attrString(journeyNode, "can")),
		cancelReason: parseCancelReason(journeyNode),
	};
	train.origin = firstCallTiploc(train);
	train.destination = lastCallTiploc(train);
	return train;
}

function pickTimetableObject(names: string[]) {
	return pickLatest(
		names,
		(name) => {
			// Ne jamais confondre avec le référentiel, qui porte le même préfixe de date.
			if (name.includes("_ref_")) {
				return undefined;
			}
			const match = TIMETABLE_NAME_PATTERN.exec(name);
			if (match === null) {
				return undefined;
			}
			const date = match[1] ?? "";
			const version = Number(match[2] ?? "");
			return { name, date, extra: version };
		},
		(a, b) => a - b,
	);
}

/** La version de l'horaire est la suite de chiffres au début du nom de fichier. */
function timetableIdOf(name: string): string {
	const basename = name.slice(name.lastIndexOf("/") + 1);
	const separatorIndex = basename.indexOf("_");
	return separatorIndex === -1 ? basename : basename.slice(0, separatorIndex);
}

export async function loadTimetable(store: ObjectStore): Promise<TimetableData> {
	const names = await store.list("PPTimetable/");
	const picked = pickTimetableObject(names);
	if (picked === undefined) {
		throw new Error("Aucun fichier d'horaires PPTimetable/*_v<N>.xml.gz trouvé dans le bucket.");
	}

	const compressed = await store.download(picked.name);
	const xml = (await gunzip(compressed)).toString("utf8");
	const document = parser.parse(xml) as OrderedNode[];

	const root = document.find((node) => nodeTagName(node) === "PportTimetable");
	const journeyNodes = root === undefined ? [] : nodeChildren(root).filter((node) => nodeTagName(node) === "Journey");

	const trains: Train[] = [];
	for (const journeyNode of journeyNodes) {
		const train = readJourney(journeyNode);
		if (train !== undefined) {
			trains.push(train);
		}
	}

	return { timetableId: timetableIdOf(picked.name), trains };
}

/** Lit la version du dernier fichier SANS le télécharger : seule la liste est consultée. */
export async function peekTimetableId(store: ObjectStore): Promise<string | undefined> {
	const names = await store.list("PPTimetable/");
	const picked = pickTimetableObject(names);
	return picked === undefined ? undefined : timetableIdOf(picked.name);
}
