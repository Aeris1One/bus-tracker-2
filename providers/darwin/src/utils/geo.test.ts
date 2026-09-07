import { describe, expect, it } from "vitest";
import { bearingBetween, bearingDifference, distanceBetween, interpolate } from "./geo.js";

describe("distanceBetween", () => {
	it("calculates the distance between two known points", () => {
		// Paris → Lyon (~391 km).
		const distance = distanceBetween(48.8566, 2.3522, 45.764, 4.8357);
		expect(Math.round(distance / 1000)).toBe(391);
	});

	it("returns 0 for the same point", () => {
		const distance = distanceBetween(48.8566, 2.3522, 48.8566, 2.3522);
		expect(distance).toBe(0);
	});
});

describe("bearingBetween", () => {
	it("returns 0 (north) when travelling due north", () => {
		const bearing = bearingBetween(48.0, 2.0, 49.0, 2.0);
		expect(bearing).toBeCloseTo(0, 1);
	});

	it("returns 90 (east) when travelling due east on the equator", () => {
		const bearing = bearingBetween(0, 0, 0, 1);
		expect(bearing).toBeCloseTo(90, 1);
	});

	it("returns 180 (south) when travelling due south", () => {
		const bearing = bearingBetween(49.0, 2.0, 48.0, 2.0);
		expect(bearing).toBeCloseTo(180, 1);
	});

	it("returns 270 (west) when travelling due west on the equator", () => {
		const bearing = bearingBetween(0, 1, 0, 0);
		expect(bearing).toBeCloseTo(270, 1);
	});
});

describe("bearingDifference", () => {
	it("returns 0 for identical bearings", () => {
		expect(bearingDifference(90, 90)).toBe(0);
	});

	it("returns the absolute difference for close bearings", () => {
		expect(bearingDifference(10, 30)).toBe(20);
	});

	it("wraps around the 0/360 crossing", () => {
		expect(bearingDifference(350, 10)).toBe(20);
	});

	it("caps at 180 for opposite bearings", () => {
		expect(bearingDifference(0, 180)).toBe(180);
	});

	it("is symmetric", () => {
		expect(bearingDifference(300, 20)).toBe(bearingDifference(20, 300));
	});
});

describe("interpolate", () => {
	it("returns the first point at ratio 0", () => {
		expect(interpolate(48, 2, 49, 3, 0)).toEqual({ latitude: 48, longitude: 2 });
	});

	it("returns the second point at ratio 1", () => {
		expect(interpolate(48, 2, 49, 3, 1)).toEqual({ latitude: 49, longitude: 3 });
	});

	it("returns the midpoint at ratio 0.5", () => {
		expect(interpolate(48, 2, 50, 4, 0.5)).toEqual({ latitude: 49, longitude: 3 });
	});
});
