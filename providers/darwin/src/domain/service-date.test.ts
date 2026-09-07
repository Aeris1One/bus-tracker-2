import { describe, expect, it } from "vitest";

import { isRelevantServiceDate, isWellFormedServiceDate, serviceDateFromRid } from "./service-date.js";

/** Formate une date locale en YYYY-MM-DD, indépendamment du fuseau de la machine qui exécute le test. */
function ymd(date: Date): string {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

describe("serviceDateFromRid(rid)", () => {
	it("reconstruit la SSD depuis les 8 premiers caractères du RID", () => {
		expect(serviceDateFromRid("20260315123456")).toBe("2026-03-15");
	});

	it("ne valide rien : un RID malformé produit une date malformée sans lever", () => {
		expect(() => serviceDateFromRid("abc")).not.toThrow();
		expect(serviceDateFromRid("abc")).toBe("abc--");
		expect(() => serviceDateFromRid("")).not.toThrow();
		expect(serviceDateFromRid("")).toBe("--");
	});
});

describe("isWellFormedServiceDate(ssd)", () => {
	it.each([
		["2026-03-15", true],
		["2026-3-15", false],
		["ab-c-", false],
		["", false],
		["2026-03-15T00:00:00", false],
	])("isWellFormedServiceDate(%o) === %o", (ssd, expected) => {
		expect(isWellFormedServiceDate(ssd)).toBe(expected);
	});
});

describe("isRelevantServiceDate(ssd, nowMs)", () => {
	it("accepte hier, aujourd'hui et demain, et refuse une quatrième date", () => {
		const now = new Date();
		const nowMs = now.getTime();

		const yesterday = new Date(now);
		yesterday.setDate(now.getDate() - 1);
		const tomorrow = new Date(now);
		tomorrow.setDate(now.getDate() + 1);
		const twoDaysAway = new Date(now);
		twoDaysAway.setDate(now.getDate() + 2);

		expect(isRelevantServiceDate(ymd(yesterday), nowMs)).toBe(true);
		expect(isRelevantServiceDate(ymd(now), nowMs)).toBe(true);
		expect(isRelevantServiceDate(ymd(tomorrow), nowMs)).toBe(true);
		expect(isRelevantServiceDate(ymd(twoDaysAway), nowMs)).toBe(false);
	});

	it("un service de demain daté à minuit apparaît dès 23:45 heure locale ce soir", () => {
		const tonight = new Date(2026, 2, 15, 23, 45, 0);
		const tomorrow = new Date(2026, 2, 16, 0, 10, 0);
		expect(isRelevantServiceDate(ymd(tomorrow), tonight.getTime())).toBe(true);
	});

	it("un service tardif daté d'hier reste visible après minuit heure locale", () => {
		const justAfterMidnight = new Date(2026, 2, 16, 0, 10, 0);
		const yesterday = new Date(2026, 2, 15);
		expect(isRelevantServiceDate(ymd(yesterday), justAfterMidnight.getTime())).toBe(true);
	});
});
