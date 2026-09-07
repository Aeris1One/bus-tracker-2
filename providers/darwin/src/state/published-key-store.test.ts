import { describe, expect, it } from "vitest";

import { SHAPE_KEY_REGISTRY_TTL_MS, SHAPE_KEY_REWRITE_MS } from "../constants.js";
import { createPublishedKeyStore } from "./published-key-store.js";

describe("createPublishedKeyStore", () => {
	it("une clé jamais écrite doit être écrite", () => {
		const store = createPublishedKeyStore();
		expect(store.shouldWrite("k1", 1_000)).toBe(true);
	});

	it("une clé écrite il y a 300 s (< 600 s) ne doit pas être réécrite", () => {
		const store = createPublishedKeyStore();
		store.markWritten("k1", 0);
		expect(store.shouldWrite("k1", 300_000)).toBe(false);
	});

	it("une clé écrite il y a 700 s (> 600 s) doit être réécrite", () => {
		const store = createPublishedKeyStore();
		store.markWritten("k1", 0);
		expect(store.shouldWrite("k1", 700_000)).toBe(true);
	});

	it("borne exacte à 600 s : pas encore réécrite (> strict)", () => {
		const store = createPublishedKeyStore();
		store.markWritten("k1", 0);
		expect(store.shouldWrite("k1", SHAPE_KEY_REWRITE_MS)).toBe(false);
		expect(store.shouldWrite("k1", SHAPE_KEY_REWRITE_MS + 1)).toBe(true);
	});

	it("evict retire les entrées écrites il y a plus de 900 s", () => {
		// `shouldWrite` seul ne distingue pas une clé évincée d'une clé simplement âgée de plus de
		// 600 s (les deux rendent `true`) : on observe l'éviction via `size`.
		const store = createPublishedKeyStore();
		store.markWritten("old", 0);
		store.markWritten("recent", 0);
		expect(store.size).toBe(2);

		// À la borne exacte, rien n'est encore évincé.
		store.evict(SHAPE_KEY_REGISTRY_TTL_MS);
		expect(store.size).toBe(2);

		store.evict(SHAPE_KEY_REGISTRY_TTL_MS + 1);
		expect(store.size).toBe(0);
	});

	it("evict conserve les entrées récentes tout en retirant les entrées expirées", () => {
		const store = createPublishedKeyStore();
		store.markWritten("old", 0);
		store.markWritten("recent", SHAPE_KEY_REGISTRY_TTL_MS);

		store.evict(SHAPE_KEY_REGISTRY_TTL_MS + 1);

		expect(store.size).toBe(1);
		expect(store.shouldWrite("recent", SHAPE_KEY_REGISTRY_TTL_MS + 1)).toBe(false);
	});

	it("clear purge intégralement le registre", () => {
		const store = createPublishedKeyStore();
		store.markWritten("k1", 0);
		store.markWritten("k2", 0);
		store.clear();

		expect(store.size).toBe(0);
		expect(store.shouldWrite("k1", 0)).toBe(true);
		expect(store.shouldWrite("k2", 0)).toBe(true);
	});
});
