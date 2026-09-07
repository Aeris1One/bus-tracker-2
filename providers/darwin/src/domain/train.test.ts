import { describe, expect, it } from "vitest";

import type { Call } from "./call.js";
import {
	firstPassengerCall,
	isPassengerService,
	lastArrivalTime,
	lastPassengerCall,
	type Train,
	trainKey,
} from "./train.js";

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
		rid: "202601010123456",
		uid: "A12345",
		ssd: "2026-01-01",
		trainId: "1A23",
		toc: "GW",
		calls,
		origin: "PADTON",
		destination: "RDNGSTN",
		cancelled: false,
	};
}

describe("trainKey", () => {
	it("assemble la SSD et le RID", () => {
		expect(trainKey("2026-01-01", "rid1")).toBe("2026-01-01|rid1");
	});
});

describe("isPassengerService / firstPassengerCall / lastPassengerCall", () => {
	it("un train ECS (aucun call voyageur) n'est pas un service voyageur", () => {
		const train = makeTrain([
			makeCall({ tag: "OPOR", tiploc: "DEPOT1", order: 0 }),
			makeCall({ tag: "OPDT", tiploc: "DEPOT2", order: 1 }),
		]);
		expect(isPassengerService(train)).toBe(false);
		expect(firstPassengerCall(train)).toBeUndefined();
		expect(lastPassengerCall(train)).toBeUndefined();
	});

	it("identifie le premier et le dernier call voyageur parmi des points techniques", () => {
		const or = makeCall({ tag: "OR", tiploc: "A", order: 0 });
		const ip1 = makeCall({ tag: "IP", tiploc: "B", order: 1 });
		const pp = makeCall({ tag: "PP", tiploc: "C", order: 2 });
		const dt = makeCall({ tag: "DT", tiploc: "D", order: 3 });
		const train = makeTrain([or, ip1, pp, dt]);
		expect(isPassengerService(train)).toBe(true);
		expect(firstPassengerCall(train)).toBe(or);
		expect(lastPassengerCall(train)).toBe(dt);
	});
});

describe("lastArrivalTime", () => {
	it("est indéfini pour un train sans call", () => {
		expect(lastArrivalTime(makeTrain([]))).toBeUndefined();
	});

	it("se fonde sur l'arrivée effective du dernier point", () => {
		const train = makeTrain([
			makeCall({ order: 0 }),
			makeCall({ order: 1, actualArrival: 1_000, aimedPublicArrival: 2_000 }),
		]);
		expect(lastArrivalTime(train)).toBe(1_000);
	});

	it("retombe sur l'arrivée théorique quand aucune autre heure d'arrivée n'est connue", () => {
		const train = makeTrain([makeCall({ order: 0, aimedPublicArrival: 3_000 })]);
		expect(lastArrivalTime(train)).toBe(3_000);
	});

	it("un train arrivé à son terminus a une arrivée définie même si son départ effectif vaut +∞", () => {
		// Un train à quai (arrivée réelle, pas de départ réel) a un départ effectif de +∞ : un balayage
		// fondé sur le départ ne franchirait jamais aucun seuil. `lastArrivalTime` doit rester
		// exploitable dans ce cas précis.
		const train = makeTrain([makeCall({ order: 0, actualArrival: 5_000 })]);
		expect(lastArrivalTime(train)).toBe(5_000);
		expect(lastArrivalTime(train)).not.toBe(Number.POSITIVE_INFINITY);
	});
});
