import { describe, expect, it } from "vitest";

import { createReferenceStore, type Place } from "./reference-store.js";

describe("createReferenceStore", () => {
	it("place/placeName retombent sur le TIPLOC lui-même quand le nom est inconnu", () => {
		const store = createReferenceStore();
		const places = new Map<string, Place>([["KNOWN", { tiploc: "KNOWN", name: "Known Station" }]]);
		store.setPlaces(places);

		expect(store.placeName("KNOWN")).toBe("Known Station");
		expect(store.placeName("UNKNOWN")).toBe("UNKNOWN");
		expect(store.place("UNKNOWN")).toBeUndefined();
	});

	it("mergeCoordinates n'écrase jamais une coordonnée déjà connue", () => {
		const store = createReferenceStore();
		store.setPlaces(new Map<string, Place>([["A", { tiploc: "A", name: "A Station", latitude: 51, longitude: -1 }]]));

		store.mergeCoordinates(new Map([["A", { latitude: 99, longitude: 99 }]]));

		expect(store.coordinatesOf("A")).toEqual({ latitude: 51, longitude: -1 });
	});

	it("mergeCoordinates complète un lieu qui n'en avait pas", () => {
		const store = createReferenceStore();
		store.setPlaces(new Map<string, Place>([["B", { tiploc: "B", name: "B Station" }]]));

		expect(store.hasCoordinates("B")).toBe(false);
		store.mergeCoordinates(new Map([["B", { latitude: 52, longitude: -2 }]]));

		expect(store.hasCoordinates("B")).toBe(true);
		expect(store.coordinatesOf("B")).toEqual({ latitude: 52, longitude: -2 });
	});

	it("coordinatesOf rend undefined sans coordonnée, jamais de valeur sentinelle", () => {
		const store = createReferenceStore();
		store.setPlaces(new Map<string, Place>([["C", { tiploc: "C" }]]));
		expect(store.coordinatesOf("C")).toBeUndefined();
		expect(store.coordinatesOf("NOWHERE")).toBeUndefined();
	});

	it("la clé « via » a exactement quatre composantes, dans l'ordre at|dest|loc1|loc2", () => {
		const store = createReferenceStore();
		store.setVias(
			new Map([
				["AT1|DEST1|LOC1|LOC2", "via Somewhere"],
				["AT1|DEST1||", "via Nothing"],
			]),
		);

		expect(store.via("AT1", "DEST1", "LOC1", "LOC2")).toBe("via Somewhere");
		expect(store.via("AT1", "DEST1", "", "")).toBe("via Nothing");
		expect(store.via("AT1", "DEST1", "OTHER", "")).toBeUndefined();
	});

	it("operatorName et les motifs sont lus depuis les cartes fournies", () => {
		const store = createReferenceStore();
		store.setOperators(new Map([["GW", "Great Western Railway"]]));
		store.setReasons(new Map([[42, "Signal failure"]]), new Map([[7, "Staff shortage"]]));

		expect(store.operatorName("GW")).toBe("Great Western Railway");
		expect(store.operatorName("XX")).toBeUndefined();
		expect(store.lateReason(42)).toBe("Signal failure");
		expect(store.cancellationReason(7)).toBe("Staff shortage");
		expect(store.lateReason(0)).toBeUndefined();
	});

	it("deux fabriques distinctes n'ont aucun état partagé", () => {
		const a = createReferenceStore();
		const b = createReferenceStore();
		a.setPlaces(new Map<string, Place>([["A", { tiploc: "A", name: "A" }]]));
		expect(b.placeName("A")).toBe("A");
		expect(b.place("A")).toBeUndefined();
	});
});
