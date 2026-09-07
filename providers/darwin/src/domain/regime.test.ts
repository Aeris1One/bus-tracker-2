import { describe, expect, it } from "vitest";

import type { Call } from "./call.js";
import { computePassengerWindow, selectActiveSegment } from "./regime.js";
import type { Segment } from "./segment.js";
import type { Train } from "./train.js";

function makeCall(overrides: Partial<Call> = {}): Call {
	return {
		tag: "IP",
		tiploc: "TIPLOC1",
		activity: "",
		order: 0,
		platformSuppressed: false,
		locationSuppressed: false,
		platformConfirmed: false,
		cancelled: false,
		...overrides,
	};
}

function makeTrain(calls: Call[]): Train {
	return {
		rid: "rid",
		uid: "uid",
		ssd: "2026-03-01",
		trainId: "1A00",
		toc: "GW",
		calls,
		origin: "ORIG",
		destination: "DEST",
		cancelled: false,
	};
}

describe("computePassengerWindow", () => {
	it("début et fin dérivés des heures effectives des calls voyageurs", () => {
		const train = makeTrain([
			makeCall({ tag: "OR", order: 0, actualDeparture: 1000 }),
			makeCall({ tag: "IP", order: 1, actualArrival: 1500, actualDeparture: 1600 }),
			makeCall({ tag: "DT", order: 2, actualArrival: 2000 }),
		]);
		expect(computePassengerWindow(train)).toEqual({ start: 1000, end: 2000 });
	});

	it("se rabat sur l'autre heure effective quand celle prioritaire manque", () => {
		// Premier point : aucun départ effectif résoluble (une arrivée réelle sans départ vaudrait
		// +∞, ce n'est donc volontairement pas le cas ici), seulement une heure théorique d'arrivée.
		const train = makeTrain([
			makeCall({ tag: "OR", order: 0, aimedPublicArrival: 900 }),
			makeCall({ tag: "DT", order: 1, actualDeparture: 1800 }),
		]);
		expect(computePassengerWindow(train)).toEqual({ start: 900, end: 1800 });
	});

	it("aucune heure effective sur les calls voyageurs ⇒ pas de fenêtre : ECS pour toute sa vie", () => {
		const train = makeTrain([
			makeCall({ tag: "OR", order: 0 }),
			makeCall({ tag: "IP", order: 1 }),
			makeCall({ tag: "DT", order: 2 }),
		]);
		expect(computePassengerWindow(train)).toBeUndefined();
	});

	it("ignore les calls non voyageurs, même dotés d'heures effectives", () => {
		const train = makeTrain([
			makeCall({ tag: "PP", order: 0, actualDeparture: 500 }),
			makeCall({ tag: "OR", order: 1, actualDeparture: 1000 }),
			makeCall({ tag: "DT", order: 2, actualArrival: 2000 }),
		]);
		expect(computePassengerWindow(train)).toEqual({ start: 1000, end: 2000 });
	});
});

describe("selectActiveSegment — les six situations", () => {
	const whole: Segment = { kind: "WHOLE", calls: [makeCall({ tag: "PP" })] };
	const trailIn: Segment = { kind: "TRAIL_IN", calls: [makeCall({ tag: "PP" })] };
	const passenger: Segment = { kind: "PASSENGER", calls: [makeCall({ tag: "OR" })] };
	const trailOut: Segment = { kind: "TRAIL_OUT", calls: [makeCall({ tag: "PP" })] };
	const window = { start: 1000, end: 2000 };

	it("pas de fenêtre ⇒ segment unique, régime ECS", () => {
		expect(selectActiveSegment([whole], undefined, 500)).toEqual({ segment: whole, regime: "ECS" });
	});

	it("avant le début, trail-in présent ⇒ trail-in, ECS", () => {
		expect(selectActiveSegment([trailIn, passenger, trailOut], window, 500)).toEqual({
			segment: trailIn,
			regime: "ECS",
		});
	});

	it("avant le début, sans trail-in ⇒ section voyageurs, voyageur", () => {
		expect(selectActiveSegment([passenger, trailOut], window, 500)).toEqual({
			segment: passenger,
			regime: "PASSENGER",
		});
	});

	it("après la fin, trail-out présent ⇒ trail-out, ECS", () => {
		expect(selectActiveSegment([trailIn, passenger, trailOut], window, 2500)).toEqual({
			segment: trailOut,
			regime: "ECS",
		});
	});

	it("après la fin, sans trail-out ⇒ section voyageurs, voyageur", () => {
		expect(selectActiveSegment([trailIn, passenger], window, 2500)).toEqual({
			segment: passenger,
			regime: "PASSENGER",
		});
	});

	it("entre début et fin, bornes incluses ⇒ section voyageurs, voyageur", () => {
		expect(selectActiveSegment([trailIn, passenger, trailOut], window, 1000)).toEqual({
			segment: passenger,
			regime: "PASSENGER",
		});
		expect(selectActiveSegment([trailIn, passenger, trailOut], window, 2000)).toEqual({
			segment: passenger,
			regime: "PASSENGER",
		});
		expect(selectActiveSegment([trailIn, passenger, trailOut], window, 1500)).toEqual({
			segment: passenger,
			regime: "PASSENGER",
		});
	});
});
