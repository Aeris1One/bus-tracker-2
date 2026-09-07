import { describe, expect, it } from "vitest";

import { createTimetableVersionState } from "./timetable-version.js";

describe("createTimetableVersionState", () => {
	it("démarre sans version connue, sans demande de rechargement armée", () => {
		const state = createTimetableVersionState();

		expect(state.loaded).toBeUndefined();
		expect(state.announced).toBeUndefined();
		expect(state.reloadRequested).toBe(false);
		expect(state.lastCheckedAtMs).toBe(0);
	});

	it("est un état mutable indépendant à chaque appel (P3 : pas de singleton de module)", () => {
		const a = createTimetableVersionState();
		const b = createTimetableVersionState();

		a.loaded = "20260903";
		a.reloadRequested = true;

		expect(b.loaded).toBeUndefined();
		expect(b.reloadRequested).toBe(false);
	});
});
