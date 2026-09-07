import { afterEach, describe, expect, it, vi } from "vitest";

import { SEQUENCE_MAX, SEQUENCE_WARN_INTERVAL_MS } from "../constants.js";
import { createSequenceTracker } from "./sequence-tracker.js";

describe("createSequenceTracker", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("aucun contrôle sur le tout premier numéro observé, quelle que soit sa valeur", () => {
		const tracker = createSequenceTracker();
		expect(tracker.observe(42, 0)).toBe(false);
		expect(tracker.hasGap).toBe(false);
	});

	it("0 est un état initial légitime, distinct de « aucun numéro observé » : 0 puis 1 ne fait pas de trou", () => {
		const tracker = createSequenceTracker();
		expect(tracker.observe(0, 0)).toBe(false);
		expect(tracker.observe(1, 1)).toBe(false);
		expect(tracker.hasGap).toBe(false);
	});

	it("le rebouclage légitime 9 999 999 → 0 n'est pas une discontinuité", () => {
		const tracker = createSequenceTracker();
		tracker.observe(SEQUENCE_MAX, 0);
		expect(tracker.observe(0, 1)).toBe(false);
		expect(tracker.hasGap).toBe(false);
	});

	it("un trou est signalé, le drapeau reste levé jusqu'à clearGap", () => {
		const tracker = createSequenceTracker();
		tracker.observe(1, 0);
		expect(tracker.observe(5, 1)).toBe(true);
		expect(tracker.hasGap).toBe(true);

		tracker.clearGap();
		expect(tracker.hasGap).toBe(false);
	});

	it("le dernier numéro est mémorisé même sur une discontinuité", () => {
		const tracker = createSequenceTracker();
		tracker.observe(1, 0);
		tracker.observe(5, 1);
		// Si le dernier numéro mémorisé était resté 1, 6 serait vu comme consécutif (5+1) : ce n'est
		// pas le cas, la discontinuité est de nouveau détectée.
		expect(tracker.observe(6, 2)).toBe(false);
	});

	it("un numéro précédent légitimement 0 déclenche bien le contrôle au message suivant", () => {
		const tracker = createSequenceTracker();
		tracker.observe(0, 0);
		expect(tracker.observe(5, 1)).toBe(true);
	});

	it("les avertissements sont étranglés à une fois toutes les 30 secondes", () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
		const tracker = createSequenceTracker();
		tracker.observe(1, 0);

		// Deux trous rapprochés : un seul avertissement journalisé.
		expect(tracker.observe(5, 1_000)).toBe(true);
		expect(tracker.observe(9, SEQUENCE_WARN_INTERVAL_MS - 1_000)).toBe(true);
		expect(logSpy).toHaveBeenCalledTimes(1);

		// Passé l'intervalle, un nouvel avertissement est journalisé.
		expect(tracker.observe(20, SEQUENCE_WARN_INTERVAL_MS + 1_000)).toBe(true);
		expect(logSpy).toHaveBeenCalledTimes(2);
	});
});
