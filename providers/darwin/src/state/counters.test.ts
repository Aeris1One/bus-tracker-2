import { describe, expect, it } from "vitest";

import { createCounters } from "./counters.js";

describe("createCounters", () => {
	it("increment sans quantité vaut 1, get d'une clé inconnue vaut 0", () => {
		const counters = createCounters();
		expect(counters.get("a")).toBe(0);
		counters.increment("a");
		expect(counters.get("a")).toBe(1);
	});

	it("increment avec une quantité explicite s'accumule", () => {
		const counters = createCounters();
		counters.increment("a", 5);
		counters.increment("a", 3);
		expect(counters.get("a")).toBe(8);
	});

	it("snapshot rend toutes les clés entretenues", () => {
		const counters = createCounters();
		counters.increment("a");
		counters.increment("b", 2);
		expect(counters.snapshot()).toEqual({ a: 1, b: 2 });
	});

	it("seenFirstTime ne rend vrai qu'une seule fois par clé", () => {
		const counters = createCounters();
		expect(counters.seenFirstTime("schedule")).toBe(true);
		expect(counters.seenFirstTime("schedule")).toBe(false);
		expect(counters.seenFirstTime("schedule")).toBe(false);
		expect(counters.seenFirstTime("association")).toBe(true);
	});

	it("deux fabriques distinctes n'ont aucun état partagé", () => {
		const a = createCounters();
		const b = createCounters();
		a.increment("x");
		expect(b.get("x")).toBe(0);
	});
});
