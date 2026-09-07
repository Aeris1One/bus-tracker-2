import { describe, expect, it } from "vitest";

import type { Call } from "./call.js";
import { deriveColor } from "./color.js";
import { buildLine, type LineContext } from "./line.js";
import type { Train } from "./train.js";

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

function makeTrain(overrides: Partial<Train> = {}): Train {
	return {
		rid: "rid",
		uid: "uid",
		ssd: "2026-03-01",
		trainId: "1A00",
		toc: "GW",
		calls: [
			makeCall({ tag: "OR", tiploc: "PADTON", order: 0 }),
			makeCall({ tag: "IP", tiploc: "READING", order: 1 }),
			makeCall({ tag: "DT", tiploc: "SWNDON", order: 2 }),
		],
		origin: "PADTON",
		destination: "SWNDON",
		cancelled: false,
		...overrides,
	};
}

const placeNames: Record<string, string> = {
	PADTON: "London Paddington",
	READING: "Reading",
	SWNDON: "Swindon",
};

const operatorNames: Record<string, string> = { GW: "Great Western Railway" };

function makeContext(overrides: Partial<LineContext> = {}): LineContext {
	return {
		networkRef: "NR:GW",
		placeName: (tiploc) => placeNames[tiploc] ?? tiploc,
		operatorName: (toc) => operatorNames[toc],
		...overrides,
	};
}

describe("buildLine", () => {
	it("rend undefined en régime ECS", () => {
		const train = makeTrain();
		expect(buildLine(train, "ECS", makeContext())).toBeUndefined();
	});

	it("bâtit ref, number et type à partir du premier et du dernier arrêt voyageur du train entier", () => {
		const train = makeTrain();
		const line = buildLine(train, "PASSENGER", makeContext());
		expect(line).toMatchObject({
			ref: "NR:GW:Line:GW:PADTON>SWNDON",
			number: "London Paddington → Swindon",
			type: "RAIL",
		});
	});

	it("deux trains de TOC identique, mêmes arrêts voyageurs mais dépôts différents, partagent le même ref", () => {
		const trainFromDepotA = makeTrain({
			rid: "ridA",
			calls: [
				makeCall({ tag: "PP", tiploc: "DEPOTA", order: 0 }),
				makeCall({ tag: "OR", tiploc: "PADTON", order: 1 }),
				makeCall({ tag: "IP", tiploc: "READING", order: 2 }),
				makeCall({ tag: "DT", tiploc: "SWNDON", order: 3 }),
			],
			origin: "DEPOTA",
		});
		const trainFromDepotB = makeTrain({
			rid: "ridB",
			calls: [
				makeCall({ tag: "OR", tiploc: "PADTON", order: 0 }),
				makeCall({ tag: "IP", tiploc: "READING", order: 1 }),
				makeCall({ tag: "DT", tiploc: "SWNDON", order: 2 }),
				makeCall({ tag: "PP", tiploc: "DEPOTB", order: 3 }),
			],
			destination: "DEPOTB",
		});

		const lineA = buildLine(trainFromDepotA, "PASSENGER", makeContext());
		const lineB = buildLine(trainFromDepotB, "PASSENGER", makeContext());
		expect(lineA?.ref).toBe(lineB?.ref);
		expect(lineA?.ref).toBe("NR:GW:Line:GW:PADTON>SWNDON");
	});

	it("utilise mapHeadcodeToLineName quand il est configuré", () => {
		const train = makeTrain({ trainId: "1A05" });
		const line = buildLine(
			train,
			"PASSENGER",
			makeContext({ mapHeadcodeToLineName: (headcode) => `Ligne ${headcode}` }),
		);
		expect(line?.number).toBe("Ligne 1A05");
	});

	it("replie sur le code TIPLOC quand le nom du lieu est inconnu", () => {
		const train = makeTrain({
			calls: [
				makeCall({ tag: "OR", tiploc: "UNKNOWNORIG", order: 0 }),
				makeCall({ tag: "DT", tiploc: "SWNDON", order: 1 }),
			],
		});
		const line = buildLine(train, "PASSENGER", makeContext());
		expect(line?.number).toBe("UNKNOWNORIG → Swindon");
	});

	it("utilise la couleur configurée pour le TOC quand elle existe", () => {
		const train = makeTrain();
		const line = buildLine(
			train,
			"PASSENGER",
			makeContext({ tocColors: { GW: { color: "0079c1", textColor: "ffffff" } } }),
		);
		expect(line).toMatchObject({ color: "0079c1", textColor: "ffffff" });
	});

	it("retombe sur une couleur dérivée du NOM de l'opérateur si aucune n'est configurée", () => {
		const train = makeTrain();
		const line = buildLine(train, "PASSENGER", makeContext());
		// La couleur dérive du nom lisible, pas du code — les deux donnent des teintes différentes,
		// c'est donc bien discriminant.
		expect(line).toMatchObject(deriveColor("Great Western Railway"));
		expect(deriveColor("Great Western Railway").color).not.toBe(deriveColor("GW").color);
	});

	it("retombe sur le code opérateur quand son nom est inconnu du référentiel", () => {
		const train = makeTrain();
		const line = buildLine(train, "PASSENGER", makeContext({ operatorName: () => undefined }));
		expect(line).toMatchObject(deriveColor("GW"));
	});
});
