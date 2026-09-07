import { describe, expect, it } from "vitest";

import { PENDING_STATUS_MAX, PENDING_STATUS_TTL_MS } from "../constants.js";
import { createPendingStatusStore } from "./pending-status-store.js";

describe("createPendingStatusStore", () => {
	it("un nouveau message remplace le précédent pour un même train", () => {
		const store = createPendingStatusStore();
		store.put("2025-09-05", "RID1", { seq: 1 }, 1_000);
		store.put("2025-09-05", "RID1", { seq: 2 }, 2_000);

		expect(store.size).toBe(1);
		expect(store.take("2025-09-05", "RID1")).toEqual({ seq: 2 });
	});

	it("take retire bien l'entrée", () => {
		const store = createPendingStatusStore();
		store.put("2025-09-05", "RID1", { seq: 1 }, 1_000);

		expect(store.take("2025-09-05", "RID1")).toEqual({ seq: 1 });
		expect(store.take("2025-09-05", "RID1")).toBeUndefined();
		expect(store.size).toBe(0);
	});

	it("purge retire les entrées reçues depuis plus de 10 minutes", () => {
		const store = createPendingStatusStore();
		const receivedAt = 100_000;
		store.put("2025-09-05", "OLD", {}, receivedAt);
		store.put("2025-09-05", "FRESH", {}, receivedAt + 5_000);

		// Juste avant le seuil : rien n'est purgé.
		store.purge(receivedAt + PENDING_STATUS_TTL_MS);
		expect(store.size).toBe(2);

		// Juste après le seuil pour OLD, encore dans la fenêtre pour FRESH.
		store.purge(receivedAt + PENDING_STATUS_TTL_MS + 1);
		expect(store.take("2025-09-05", "OLD")).toBeUndefined();
		expect(store.take("2025-09-05", "FRESH")).toEqual({});
	});

	it("purge ramène le stock à 5000 en supprimant les plus anciennes au-delà du plafond", () => {
		const store = createPendingStatusStore();
		for (let i = 0; i < PENDING_STATUS_MAX + 10; i++) {
			store.put("2025-09-05", `RID${i}`, { i }, i);
		}
		expect(store.size).toBe(PENDING_STATUS_MAX + 10);

		// nowMs choisi pour ne déclencher aucune purge par âge : seul le plafond doit jouer.
		store.purge(5);

		expect(store.size).toBe(PENDING_STATUS_MAX);
		// Les 10 plus anciennes (RID0..RID9) ont disparu.
		expect(store.take("2025-09-05", "RID0")).toBeUndefined();
		expect(store.take("2025-09-05", "RID9")).toBeUndefined();
		// La plus récente survit.
		expect(store.take("2025-09-05", `RID${PENDING_STATUS_MAX + 9}`)).toEqual({ i: PENDING_STATUS_MAX + 9 });
	});

	it("takeAll rend toutes les entrées et vide le store", () => {
		const store = createPendingStatusStore();
		store.put("2025-09-05", "RID1", { a: 1 }, 0);
		store.put("2025-09-05", "RID2", { a: 2 }, 0);

		const all = store.takeAll();
		expect(all).toHaveLength(2);
		expect(store.size).toBe(0);
	});
});
