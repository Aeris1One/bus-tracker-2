import { describe, expect, it } from "vitest";
import { type DatedObject, pickLatest } from "./pick-latest.js";

/** Analyseur synthétique : `obj_<date>_v<version>.dat`, date et version en chiffres. */
function parseFixture(name: string): DatedObject<number> | undefined {
	const match = /^obj_(\d+)_v(\d+)\.dat$/.exec(name);
	if (match === null) {
		return undefined;
	}
	const date = match[1] ?? "";
	const version = match[2] ?? "";
	return { name, date, extra: Number(version) };
}

describe("pickLatest", () => {
	it("retient la date la plus récente même si les suffixes n'ont pas la même longueur", () => {
		// Le second nom est nettement plus long (version à trois chiffres) mais porte une date plus
		// ancienne : une comparaison naïve sur la longueur ou l'ordre lexical du nom entier pourrait
		// s'y tromper, la comparaison doit porter uniquement sur la date extraite.
		const names = ["obj_20260825064431_v8.dat", "obj_20260101000000_v123.dat"];
		const result = pickLatest(names, parseFixture, (a, b) => a - b);
		expect(result?.name).toBe("obj_20260825064431_v8.dat");
	});

	it("départage par numéro de version numérique à date égale (_v10 > _v9)", () => {
		const names = ["obj_20260825064431_v9.dat", "obj_20260825064431_v10.dat"];
		const result = pickLatest(names, parseFixture, (a, b) => a - b);
		// Une comparaison lexicale de "v9" et "v10" donnerait "v9" > "v10" (le caractère '9' > '1') :
		// c'est exactement l'erreur que le départage numérique doit éviter.
		expect(result?.name).toBe("obj_20260825064431_v10.dat");
		expect(result?.extra).toBe(10);
	});

	it("ignore un nom non conforme", () => {
		const names = ["obj_20260825064431_v8.dat", "not-a-timetable-object.txt", "obj_ref_v1.dat"];
		const result = pickLatest(names, parseFixture, (a, b) => a - b);
		expect(result?.name).toBe("obj_20260825064431_v8.dat");
	});

	it("rend undefined quand aucun nom ne correspond", () => {
		const result = pickLatest(["nope.txt", "also-nope"], parseFixture);
		expect(result).toBeUndefined();
	});

	it("compare les dates comme des dates, jamais comme des chaînes", () => {
		// "10" doit l'emporter sur "9" : une comparaison de chaînes classerait "10" avant "9" (le
		// caractère '1' < '9'), à l'inverse de l'ordre chronologique réel.
		function parseShortDate(name: string): DatedObject<undefined> | undefined {
			const match = /^short_(\d+)\.dat$/.exec(name);
			if (match === null) {
				return undefined;
			}
			return { name, date: match[1] ?? "", extra: undefined };
		}

		const names = ["short_9.dat", "short_10.dat"];
		const result = pickLatest(names, parseShortDate);
		expect(result?.name).toBe("short_10.dat");
	});
});
