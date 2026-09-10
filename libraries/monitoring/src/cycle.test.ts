import { describe, expect, it } from "vitest";

import {
	addPositionTypeCounts,
	countPositionTypes,
	createZeroOutputTracker,
	emptyPositionTypeCounts,
	getPositionType,
	type PositionTypeInput,
	totalPositionTypeCounts,
} from "./cycle.js";

const gps: PositionTypeInput = { position: { type: "GPS" } };
const estimated: PositionTypeInput = {
	position: { type: "COMPUTED" },
	calls: [{ expectedTime: "2026-09-10T12:00:00" }],
};
const scheduled: PositionTypeInput = { position: { type: "COMPUTED" }, calls: [{}] };

describe("getPositionType", () => {
	it("qualifie une position remontée par le véhicule", () => {
		expect(getPositionType(gps)).toBe("GPS");
	});

	it("qualifie ESTIMATED dès qu'un arrêt porte un horaire temps réel", () => {
		expect(getPositionType(estimated)).toBe("ESTIMATED");
	});

	it("qualifie SCHEDULED sans horaire temps réel", () => {
		expect(getPositionType(scheduled)).toBe("SCHEDULED");
		expect(getPositionType({ position: { type: "COMPUTED" } })).toBe("SCHEDULED");
	});

	it("privilégie le GPS même lorsque des horaires temps réel existent", () => {
		expect(getPositionType({ position: { type: "GPS" }, calls: [{ expectedTime: "2026-09-10T12:00:00" }] })).toBe(
			"GPS",
		);
	});
});

describe("countPositionTypes", () => {
	it("ventile les courses par type de position", () => {
		expect(countPositionTypes([gps, gps, estimated, scheduled])).toEqual({ GPS: 2, ESTIMATED: 1, SCHEDULED: 1 });
	});

	it("renvoie un décompte vide pour une liste vide", () => {
		expect(countPositionTypes([])).toEqual(emptyPositionTypeCounts());
	});

	it("s'additionne sans muter les opérandes", () => {
		const a = { GPS: 1, ESTIMATED: 2, SCHEDULED: 3 };
		const b = { GPS: 10, ESTIMATED: 20, SCHEDULED: 30 };

		expect(addPositionTypeCounts(a, b)).toEqual({ GPS: 11, ESTIMATED: 22, SCHEDULED: 33 });
		expect(a).toEqual({ GPS: 1, ESTIMATED: 2, SCHEDULED: 3 });
	});

	it("se totalise", () => {
		expect(totalPositionTypeCounts({ GPS: 1, ESTIMATED: 2, SCHEDULED: 3 })).toBe(6);
	});
});

describe("createZeroOutputTracker", () => {
	const observeAll = (published: number[]) => {
		const tracker = createZeroOutputTracker();
		return published.map((count) => tracker.observe(count));
	};

	it("n'alerte pas tant que le processeur publie", () => {
		const states = observeAll([5, 5, 5, 5, 5]);
		expect(states.every(({ shouldAlert }) => !shouldAlert)).toBe(true);
		expect(states.at(-1)?.streak).toBe(0);
	});

	it("alerte après trois cycles vides consécutifs", () => {
		const states = observeAll([5, 0, 0, 0]);
		expect(states.map(({ shouldAlert }) => shouldAlert)).toEqual([false, false, false, true]);
		expect(states.at(-1)?.streak).toBe(3);
	});

	it("alerte aussi lorsque le processeur n'a jamais rien publié — le cas le plus grave", () => {
		const states = observeAll([0, 0, 0, 0, 0]);
		expect(states.map(({ shouldAlert }) => shouldAlert)).toEqual([false, false, true, false, false]);
	});

	it("relance périodiquement pour distinguer un à-coup d'une panne longue", () => {
		const tracker = createZeroOutputTracker();
		tracker.observe(5);
		const alerts: number[] = [];
		for (let cycle = 0; cycle < 50; cycle += 1) {
			const { streak, shouldAlert } = tracker.observe(0);
			if (shouldAlert) alerts.push(streak);
		}
		expect(alerts).toEqual([3, 23, 43]);
	});

	it("remet le compteur à zéro dès la reprise des publications", () => {
		const states = observeAll([5, 0, 0, 0, 7, 0]);
		expect(states.at(4)?.streak).toBe(0);
		expect(states.at(5)).toEqual({ streak: 1, shouldAlert: false });
	});
});
