import { describe, expect, it } from "vitest";

import { createShape, locateOnShape, type ShapeVertex } from "./shape.js";

function vertex(overrides: Partial<ShapeVertex> = {}): ShapeVertex {
	return { latitude: 0, longitude: 0, distance: 0, callOrder: 0, ...overrides };
}

describe("createShape", () => {
	it("distanceByCallOrder retient le DERNIER sommet portant un rang répété", () => {
		// Le rang 1 est porté par deux sommets consécutifs (un tronçon routé qui émet un sommet
		// intermédiaire avant d'atteindre le point de desserte) : le premier vaut une distance
		// proche de zéro, le second la distance réelle du point. Prendre le premier écraserait la
		// distance parcourue.
		const vertices = [
			vertex({ callOrder: 0, distance: 0 }),
			vertex({ callOrder: 1, distance: 50 }),
			vertex({ callOrder: 1, distance: 1000 }),
			vertex({ callOrder: 2, distance: 2000 }),
		];
		const shape = createShape("A>B>C", "NR:RoutePath:test", vertices);
		expect(shape.distanceByCallOrder.get(1)).toBe(1000);
		expect(shape.distanceByCallOrder.get(0)).toBe(0);
		expect(shape.distanceByCallOrder.get(2)).toBe(2000);
	});

	it("le payload correspond exactement aux sommets, au format [lat, lon, distance]", () => {
		const vertices = [
			vertex({ latitude: 51.5, longitude: -0.1, distance: 0, callOrder: 0 }),
			vertex({ latitude: 51.6, longitude: -0.2, distance: 1234.5, callOrder: 1 }),
		];
		const shape = createShape("A>B", "NR:RoutePath:test", vertices);
		expect(JSON.parse(shape.toPayload())).toEqual({
			p: [
				[51.5, -0.1, 0],
				[51.6, -0.2, 1234.5],
			],
		});
	});

	it("conserve la clé canonique et le nom de clé Redis fournis", () => {
		const shape = createShape("A>B", "NR:RoutePath:national-rail:local:abc", [vertex(), vertex({ distance: 10 })]);
		expect(shape.canonicalKey).toBe("A>B");
		expect(shape.redisKey).toBe("NR:RoutePath:national-rail:local:abc");
	});
});

describe("locateOnShape", () => {
	// Un tracé simple à trois sommets alignés sur l'équateur (variation de longitude uniquement),
	// pour raisonner facilement sur les distances et les caps.
	const shape = createShape("A>B>C", "NR:RoutePath:test", [
		vertex({ latitude: 0, longitude: 0, distance: 0, callOrder: 0 }),
		vertex({ latitude: 0, longitude: 1, distance: 1000, callOrder: 1 }),
		vertex({ latitude: 0, longitude: 2, distance: 2000, callOrder: 2 }),
	]);

	it("distance <= la première ⇒ premier sommet, cap vers le second", () => {
		const result = locateOnShape(shape, -50);
		expect(result.latitude).toBe(0);
		expect(result.longitude).toBe(0);
		expect(result.bearing).toBeCloseTo(90, 0); // vers l'est, longitude croissante
	});

	it("distance >= la dernière ⇒ dernier sommet, cap depuis l'avant-dernier", () => {
		const result = locateOnShape(shape, 5000);
		expect(result.latitude).toBe(0);
		expect(result.longitude).toBe(2);
		expect(result.bearing).toBeCloseTo(90, 0);
	});

	it("sinon, sommet encadrant et interpolation linéaire", () => {
		const result = locateOnShape(shape, 500);
		expect(result.latitude).toBeCloseTo(0, 6);
		expect(result.longitude).toBeCloseTo(0.5, 6);
		expect(result.bearing).toBeCloseTo(90, 0);
	});

	it("interpolation exacte au sommet encadrant supérieur", () => {
		const result = locateOnShape(shape, 1000);
		expect(result.latitude).toBeCloseTo(0, 6);
		expect(result.longitude).toBeCloseTo(1, 6);
	});
});
