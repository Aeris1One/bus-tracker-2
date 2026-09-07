import { describe, expect, it } from "vitest";

import type { Train } from "../domain/train.js";
import { createTrainStore } from "./train-store.js";

function makeTrain(overrides: Partial<Train> = {}): Train {
	return {
		rid: "202509050001",
		uid: "A00001",
		ssd: "2025-09-05",
		trainId: "1A01",
		toc: "GW",
		calls: [],
		origin: "PADTON",
		destination: "BRSTL",
		cancelled: false,
		...overrides,
	};
}

describe("createTrainStore", () => {
	it("indexe par (ssd, rid) : deux trains de même RID mais de SSD différentes coexistent", () => {
		const store = createTrainStore();
		const day1 = makeTrain({ ssd: "2025-09-05" });
		const day2 = makeTrain({ ssd: "2025-09-06" });

		store.set(day1);
		store.set(day2);

		expect(store.get("2025-09-05", day1.rid)).toBe(day1);
		expect(store.get("2025-09-06", day2.rid)).toBe(day2);
		expect(store.size).toBe(2);
	});

	it("set écrase l'entrée existante pour un même (ssd, rid)", () => {
		const store = createTrainStore();
		const train = makeTrain();
		store.set(train);
		const updated = makeTrain({ cancelled: true });
		store.set(updated);

		expect(store.get(train.ssd, train.rid)).toBe(updated);
		expect(store.size).toBe(1);
	});

	it("delete retire uniquement l'entrée visée", () => {
		const store = createTrainStore();
		const train = makeTrain();
		store.set(train);
		store.delete(train.ssd, train.rid);

		expect(store.get(train.ssd, train.rid)).toBeUndefined();
		expect(store.size).toBe(0);
	});

	it("clear vide entièrement le store", () => {
		const store = createTrainStore();
		store.set(makeTrain({ rid: "R1" }));
		store.set(makeTrain({ rid: "R2" }));
		store.clear();

		expect(store.size).toBe(0);
		expect([...store.values()]).toEqual([]);
	});

	it("values() itère toutes les entrées", () => {
		const store = createTrainStore();
		const t1 = makeTrain({ rid: "R1" });
		const t2 = makeTrain({ rid: "R2" });
		store.set(t1);
		store.set(t2);

		expect([...store.values()].sort((a, b) => a.rid.localeCompare(b.rid))).toEqual([t1, t2]);
	});

	it("get d'une clé inconnue rend undefined", () => {
		const store = createTrainStore();
		expect(store.get("2025-09-05", "UNKNOWN")).toBeUndefined();
	});
});
