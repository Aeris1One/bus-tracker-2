import { describe, expect, it } from "vitest";
import { createNodeGrid } from "./node-grid.js";
import type { RailGraph } from "./rail-graph.js";

// Trois nœuds partageant la même cellule de grille (0,02°) : idx0 et idx1 sont proches l'un de
// l'autre, idx2 est loin (~1,7 km) mais reste dans la même cellule — c'est exactement le cas que
// `within` doit exclure par le filtre à l'orthodromie exacte, et que la seule appartenance à la
// cellule ne suffirait pas à écarter.
function buildGraph(): RailGraph {
	return {
		version: "1",
		latitudes: Float32Array.from([51.5, 51.5015, 51.515]),
		longitudes: Float32Array.from([-0.1, -0.1, -0.1]),
	};
}

describe("createNodeGrid", () => {
	describe("within", () => {
		it("returns the nodes inside the radius and excludes one in the same cell but out of range", () => {
			const grid = createNodeGrid(buildGraph());

			const indices = grid.within(51.5, -0.1, 200).toSorted((a, b) => a - b);

			expect(indices).toEqual([0, 1]);
		});

		it("returns an empty array when nothing is within radius", () => {
			const grid = createNodeGrid(buildGraph());

			expect(grid.within(0, 0, 200)).toEqual([]);
		});
	});

	describe("nearest", () => {
		it("returns the closest node within tolerance", () => {
			const grid = createNodeGrid(buildGraph());

			// Point situé entre idx0 (~111 m) et idx1 (~56 m) : idx1 doit l'emporter.
			expect(grid.nearest(51.501, -0.1, 100)).toBe(1);
		});

		it("returns undefined beyond the tolerance", () => {
			const grid = createNodeGrid(buildGraph());

			expect(grid.nearest(51.501, -0.1, 50)).toBeUndefined();
		});
	});
});
