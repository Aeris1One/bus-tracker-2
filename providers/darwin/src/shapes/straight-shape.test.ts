import { describe, expect, it } from "vitest";
import { roundTo, type ShapePoint } from "./route-shape.js";
import { buildStraightShape } from "./straight-shape.js";

function point(tiploc: string, latitude: number, longitude: number, callOrder: number): ShapePoint {
	return { tiploc, latitude, longitude, callOrder, isPassenger: true };
}

describe("buildStraightShape", () => {
	it("émet un sommet par point, en cordes droites, premier sommet à distance 0", () => {
		const points = [point("A", 51.5, -0.1, 0), point("B", 51.501, -0.1, 1), point("C", 51.502, -0.1, 2)];

		const vertices = buildStraightShape(points);

		expect(vertices).toHaveLength(3);
		expect(vertices[0]).toEqual({ latitude: 51.5, longitude: -0.1, distance: 0, callOrder: 0 });
	});

	it("distances cumulées strictement croissantes, arrondies au décimètre — mêmes arrondis que le mode routé", () => {
		const points = [point("A", 51.5, -0.1, 0), point("B", 51.501, -0.1, 1), point("C", 51.5025, -0.1005, 2)];

		const vertices = buildStraightShape(points);

		for (let index = 1; index < vertices.length; index += 1) {
			const previous = vertices[index - 1];
			const current = vertices[index];
			expect(previous).toBeDefined();
			expect(current).toBeDefined();
			if (previous && current) {
				expect(current.distance).toBeGreaterThan(previous.distance);
				expect(current.distance).toBe(roundTo(current.distance, 1));
			}
		}
	});

	it("arrondit les coordonnées émises à 6 décimales", () => {
		const points = [point("A", 51.500000123456, -0.100000654321, 0), point("B", 51.501, -0.1, 1)];

		const vertices = buildStraightShape(points);

		for (const vertex of vertices) {
			expect(vertex.latitude).toBe(roundTo(vertex.latitude, 6));
			expect(vertex.longitude).toBe(roundTo(vertex.longitude, 6));
		}
	});

	it("chaque sommet porte le callOrder de son propre point (pas de sommet intermédiaire en mode rectiligne)", () => {
		const points = [point("A", 51.5, -0.1, 5), point("B", 51.501, -0.1, 7), point("C", 51.502, -0.1, 9)];

		const vertices = buildStraightShape(points);

		expect(vertices.map((vertex) => vertex.callOrder)).toEqual([5, 7, 9]);
	});

	it("lève quand moins de deux points sont fournis", () => {
		expect(() => buildStraightShape([point("A", 51.5, -0.1, 0)])).toThrow();
		expect(() => buildStraightShape([])).toThrow();
	});
});
