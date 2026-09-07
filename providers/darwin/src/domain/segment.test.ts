import { describe, expect, it } from "vitest";

import type { Call, CallTag } from "./call.js";
import { canonicalShapeKey, selectShapeCalls, splitIntoSegments } from "./segment.js";

function makeCall(tag: CallTag, tiploc: string, order: number, overrides: Partial<Call> = {}): Call {
	return {
		tag,
		tiploc,
		activity: "",
		order,
		platformSuppressed: false,
		locationSuppressed: false,
		platformConfirmed: false,
		cancelled: false,
		...overrides,
	};
}

const alwaysLocatable = () => true;

describe("splitIntoSegments", () => {
	it("train ECS (aucun call voyageur) : un unique segment WHOLE couvrant tout le parcours", () => {
		const calls = [makeCall("OPOR", "DEPOT1", 0), makeCall("PP", "YARD1", 1), makeCall("OPDT", "DEPOT2", 2)];
		const segments = splitIntoSegments(calls);
		expect(segments).toEqual([{ kind: "WHOLE", calls }]);
	});

	it("aucun trail-in quand le premier call est déjà voyageur (p === 0)", () => {
		const or = makeCall("OR", "A", 0);
		const ip = makeCall("IP", "B", 1);
		const dt = makeCall("DT", "C", 2);
		const opdt = makeCall("OPDT", "DEPOT", 3);
		const segments = splitIntoSegments([or, ip, dt, opdt]);
		expect(segments.map((segment) => segment.kind)).toEqual(["PASSENGER", "TRAIL_OUT"]);
		expect(segments[0]?.calls).toEqual([or, ip, dt]);
		// Recouvrement : le trail-out commence bien au dernier arrêt voyageur (DT), partagé avec la
		// section voyageurs.
		expect(segments[1]?.calls[0]).toBe(dt);
	});

	it("aucun trail-out quand le dernier call est déjà voyageur (q === dernier indice)", () => {
		const opor = makeCall("OPOR", "DEPOT", 0);
		const or = makeCall("OR", "A", 1);
		const ip = makeCall("IP", "B", 2);
		const dt = makeCall("DT", "C", 3);
		const segments = splitIntoSegments([opor, or, ip, dt]);
		expect(segments.map((segment) => segment.kind)).toEqual(["TRAIL_IN", "PASSENGER"]);
		// Recouvrement : le trail-in se termine bien au premier arrêt voyageur (OR), partagé avec la
		// section voyageurs.
		expect(segments[0]?.calls.at(-1)).toBe(or);
		expect(segments[1]?.calls[0]).toBe(or);
	});

	it("train complet à trois segments, avec recouvrement explicite aux deux jonctions", () => {
		const opor = makeCall("OPOR", "DEPOT1", 0);
		const or = makeCall("OR", "A", 1);
		const ip = makeCall("IP", "B", 2);
		const dt = makeCall("DT", "C", 3);
		const opdt = makeCall("OPDT", "DEPOT2", 4);
		const segments = splitIntoSegments([opor, or, ip, dt, opdt]);

		expect(segments.map((segment) => segment.kind)).toEqual(["TRAIL_IN", "PASSENGER", "TRAIL_OUT"]);
		expect(segments[0]?.calls).toEqual([opor, or]);
		expect(segments[1]?.calls).toEqual([or, ip, dt]);
		expect(segments[2]?.calls).toEqual([dt, opdt]);

		// Le recouvrement porte précisément sur les points de jonction, pas sur des copies distinctes.
		expect(segments[0]?.calls.at(-1)).toBe(segments[1]?.calls[0]);
		expect(segments[1]?.calls.at(-1)).toBe(segments[2]?.calls[0]);
	});
});

describe("selectShapeCalls", () => {
	it("retire les points sans coordonnée et les compte dans dropped", () => {
		const or = makeCall("OR", "A", 0);
		const ip = makeCall("IP", "NOCOORD", 1);
		const dt = makeCall("DT", "B", 2);
		const hasCoordinates = (tiploc: string) => tiploc !== "NOCOORD";
		const result = selectShapeCalls({ kind: "PASSENGER", calls: [or, ip, dt] }, hasCoordinates);
		expect(result).toEqual({ calls: [or, dt], dropped: 1 });
	});

	it("rend une liste vide quand il reste moins de deux points après retrait des coordonnées manquantes", () => {
		const or = makeCall("OR", "A", 0);
		const ip = makeCall("IP", "NOCOORD", 1);
		const hasCoordinates = (tiploc: string) => tiploc !== "NOCOORD";
		const result = selectShapeCalls({ kind: "PASSENGER", calls: [or, ip] }, hasCoordinates);
		expect(result).toEqual({ calls: [], dropped: 1 });
	});
});

describe("canonicalShapeKey", () => {
	it("trie par rang croissant et joint par >", () => {
		const c1 = makeCall("DT", "B", 1);
		const c2 = makeCall("OR", "A", 0);
		expect(canonicalShapeKey([c1, c2])).toBe("A>B");
	});

	it("tri stable à rang égal : conserve l'ordre d'apparition", () => {
		const c1 = makeCall("IP", "X", 5);
		const c2 = makeCall("IP", "Y", 5);
		expect(canonicalShapeKey([c1, c2])).toBe("X>Y");
	});

	it("ignore tag, activité, annulation et opérateur : deux trains différents, même clé", () => {
		const fromTimetable = [
			makeCall("OR", "PADTON", 0, { activity: "TB", cancelled: false }),
			makeCall("IP", "RDNGSTN", 1, { activity: "T ", cancelled: true }),
			makeCall("DT", "SWINDON", 2, { activity: "TF" }),
		];
		// Même parcours, construit dans des conditions différentes : autre tag sur le point
		// intermédiaire (OPIP au lieu de IP, comme le rendrait un message temps réel sur un point où
		// aucune desserte voyageur n'est finalement possible), autre activité, autre statut d'annulation.
		const fromRealtime = [
			makeCall("OR", "PADTON", 0),
			makeCall("OPIP", "RDNGSTN", 1, { activity: "-" }),
			makeCall("DT", "SWINDON", 2, { cancelled: true }),
		];
		expect(canonicalShapeKey(fromTimetable)).toBe("PADTON>RDNGSTN>SWINDON");
		expect(canonicalShapeKey(fromTimetable)).toBe(canonicalShapeKey(fromRealtime));
	});
});
