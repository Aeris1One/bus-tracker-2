// Fichier de référentiel : noms de lieux, opérateurs, libellés « via », libellés de motifs de
// retard et d'annulation.

import { XMLParser } from "fast-xml-parser";
import type { Place } from "../state/reference-store.js";
import { gunzip } from "../utils/gunzip.js";
import type { ObjectStore } from "./object-store.js";
import { pickLatest } from "./pick-latest.js";

export type ReferenceData = {
	places: Map<string, Place>;
	operators: Map<string, string>;
	vias: Map<string, string>;
	lateReasons: Map<number, string>;
	cancellationReasons: Map<number, string>;
};

// `_ref_v<chiffres>.xml.gz` : à ne pas confondre avec le fichier d'horaires, qui correspond à
// `_v<chiffres>.xml.gz` sans `_ref_`.
const REFERENCE_NAME_PATTERN = /^PPTimetable\/(\d+)_ref_v(\d+)\.xml\.gz$/;

const REPEATED_ELEMENTS = new Set(["LocationRef", "TocRef", "Via", "Reason"]);

const parser = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: "@_",
	// Force un tableau même pour une occurrence unique (les deux formes existent dans le flux).
	isArray: (tagName) => REPEATED_ELEMENTS.has(tagName),
});

/** Valeur d'attribut, ou undefined si absente. */
function attr(attrs: Record<string, unknown>, name: string): string | undefined {
	const value = attrs[`@_${name}`];
	return typeof value === "string" ? value : undefined;
}

/** Comme `attr`, mais avec "" pour les champs des Map, qui n'admettent pas `undefined`. */
function attrOr(attrs: Record<string, unknown>, name: string): string {
	return attr(attrs, name) ?? "";
}

function viaKey(at: string, dest: string, loc1: string, loc2: string): string {
	return `${at}|${dest}|${loc1}|${loc2}`;
}

function emptyReferenceData(): ReferenceData {
	return {
		places: new Map(),
		operators: new Map(),
		vias: new Map(),
		lateReasons: new Map(),
		cancellationReasons: new Map(),
	};
}

function parseReferenceXml(xml: string): ReferenceData {
	const data = emptyReferenceData();
	const root = parser.parse(xml) as Record<string, unknown>;
	const timetableRef = root.PportTimetableRef;
	if (typeof timetableRef !== "object" || timetableRef === null) {
		return data;
	}
	const sections = timetableRef as Record<string, unknown>;

	const locations = sections.LocationRef;
	if (Array.isArray(locations)) {
		for (const location of locations as Record<string, unknown>[]) {
			const tpl = attr(location, "tpl");
			if (tpl === undefined) {
				continue;
			}
			// `name`/`crs` restent absents plutôt que vides
			const place: Place = { tiploc: tpl, name: attr(location, "locname"), crs: attr(location, "crs") };
			data.places.set(tpl, place);
		}
	}

	const tocs = sections.TocRef;
	if (Array.isArray(tocs)) {
		for (const toc of tocs as Record<string, unknown>[]) {
			const code = attr(toc, "toc");
			if (code === undefined) {
				continue;
			}
			data.operators.set(code, attrOr(toc, "tocname"));
		}
	}

	const vias = sections.Via;
	if (Array.isArray(vias)) {
		for (const via of vias as Record<string, unknown>[]) {
			const key = viaKey(attrOr(via, "at"), attrOr(via, "dest"), attrOr(via, "loc1"), attrOr(via, "loc2"));
			data.vias.set(key, attrOr(via, "viatext"));
		}
	}

	readReasons(sections.LateRunningReasons, data.lateReasons);
	readReasons(sections.CancellationReasons, data.cancellationReasons);

	return data;
}

function readReasons(section: unknown, target: Map<number, string>): void {
	if (typeof section !== "object" || section === null) {
		return;
	}
	const reasons = (section as Record<string, unknown>).Reason;
	if (!Array.isArray(reasons)) {
		return;
	}
	for (const reason of reasons as Record<string, unknown>[]) {
		const code = Number(attrOr(reason, "code"));
		if (Number.isNaN(code)) {
			continue;
		}
		target.set(code, attrOr(reason, "reasontext"));
	}
}

function pickReferenceObject(names: string[]) {
	return pickLatest(
		names,
		(name) => {
			const match = REFERENCE_NAME_PATTERN.exec(name);
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

export async function loadReference(store: ObjectStore): Promise<ReferenceData> {
	const names = await store.list("PPTimetable/");
	const picked = pickReferenceObject(names);
	if (picked === undefined) {
		throw new Error("Aucun fichier de référentiel PPTimetable/*_ref_v<N>.xml.gz trouvé dans le bucket.");
	}

	const compressed = await store.download(picked.name);
	const xml = (await gunzip(compressed)).toString("utf8");
	return parseReferenceXml(xml);
}
