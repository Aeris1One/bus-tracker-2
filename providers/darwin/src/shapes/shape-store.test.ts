import { describe, expect, it } from "vitest";
import { createShape, type Shape } from "../domain/shape.js";
import { createShapeStore } from "./shape-store.js";

function makeShape(canonicalKey: string): Shape {
	return createShape(canonicalKey, `NR:RoutePath:national-rail:1:${canonicalKey}`, [
		{ latitude: 51.5, longitude: -0.1, distance: 0, callOrder: 0 },
		{ latitude: 51.501, longitude: -0.1, distance: 111.2, callOrder: 1 },
	]);
}

describe("createShapeStore", () => {
	it("get rend undefined pour une clé jamais posée", () => {
		const store = createShapeStore();
		expect(store.get("A>B")).toBeUndefined();
	});

	it("set puis get rend le même tracé, indexé par sa clé canonique", () => {
		const store = createShapeStore();
		const shape = makeShape("A>B");
		store.set(shape);
		expect(store.get("A>B")).toBe(shape);
		expect(store.size).toBe(1);
	});

	it("un tracé déjà calculé n'est jamais recalculé : un second set écrase, ne duplique pas", () => {
		const store = createShapeStore();
		store.set(makeShape("A>B"));
		store.set(makeShape("A>B"));
		expect(store.size).toBe(1);
	});

	it("invalidate retire précisément les clés d'un train dont l'horaire a été remplacé", () => {
		const store = createShapeStore();
		store.set(makeShape("A>B"));
		store.set(makeShape("C>D"));

		store.invalidate(["A>B"]);

		expect(store.get("A>B")).toBeUndefined();
		expect(store.get("C>D")).toBeDefined();
	});

	it("clear vide intégralement le cache", () => {
		const store = createShapeStore();
		store.set(makeShape("A>B"));
		store.set(makeShape("C>D"));

		store.clear();

		expect(store.size).toBe(0);
		expect([...store.values()]).toEqual([]);
	});

	it("values() itère tous les tracés en cache", () => {
		const store = createShapeStore();
		const a = makeShape("A>B");
		const c = makeShape("C>D");
		store.set(a);
		store.set(c);

		expect(new Set(store.values())).toEqual(new Set([a, c]));
	});
});
