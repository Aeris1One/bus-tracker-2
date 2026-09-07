import { describe, expect, it } from "vitest";

import type { Call } from "./call.js";
import { type Association, buildDestination, type ViaLookup } from "./destination.js";
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
		rid: "rid1",
		uid: "uid",
		ssd: "2026-03-01",
		trainId: "1A00",
		toc: "GW",
		calls: [makeCall({ tag: "OR", tiploc: "ORIG", order: 0 }), makeCall({ tag: "DT", tiploc: "DEST", order: 1 })],
		origin: "ORIG",
		destination: "DEST",
		cancelled: false,
		...overrides,
	};
}

const placeName = (tiploc: string): string => (tiploc === "DEST" ? "Destination Station" : tiploc);

const neverFound: ViaLookup = () => undefined;

describe("buildDestination", () => {
	it('régime ECS ⇒ exactement "Not taking passengers"', () => {
		const train = makeTrain();
		expect(buildDestination(train, "ECS", placeName, [], neverFound)).toBe("Not taking passengers");
	});

	it("régime voyageur ⇒ nom du dernier point non annulé", () => {
		const train = makeTrain();
		expect(buildDestination(train, "PASSENGER", placeName, [], neverFound)).toBe("Destination Station");
	});

	it("dernier point annulé ⇒ le précédent non annulé est retenu", () => {
		const train = makeTrain({
			calls: [
				makeCall({ tag: "OR", tiploc: "ORIG", order: 0 }),
				makeCall({ tag: "IP", tiploc: "PENULT", order: 1 }),
				makeCall({ tag: "DT", tiploc: "DEST", order: 2, cancelled: true }),
			],
		});
		expect(buildDestination(train, "PASSENGER", placeName, [], neverFound)).toBe("PENULT");
	});

	it("aucun point non annulé ⇒ destination omise", () => {
		const train = makeTrain({
			calls: [
				makeCall({ tag: "OR", tiploc: "ORIG", order: 0, cancelled: true }),
				makeCall({ tag: "DT", tiploc: "DEST", order: 1, cancelled: true }),
			],
		});
		expect(buildDestination(train, "PASSENGER", placeName, [], neverFound)).toBeUndefined();
	});

	it("aucun libellé via si aucune association ne porte le TIPLOC exact du dernier point", () => {
		const train = makeTrain();
		const associations: Association[] = [{ mainRid: "rid1", assocRid: "assoc1", tiploc: "AUTRE" }];
		expect(buildDestination(train, "PASSENGER", placeName, associations, neverFound)).toBe("Destination Station");
	});

	it("clé 1 : at | dest | RID associé | (vide) — prioritaire quand elle est trouvée", () => {
		const train = makeTrain();
		const associations: Association[] = [{ mainRid: "rid1", assocRid: "assoc1", tiploc: "DEST" }];
		const via: ViaLookup = (at, dest, assocRid, origin) =>
			at === "DEST" && dest === "DEST" && assocRid === "assoc1" && origin === "" ? "via Reading" : undefined;
		expect(buildDestination(train, "PASSENGER", placeName, associations, via)).toBe("Destination Station via Reading");
	});

	it("clé 2 : at | dest | (vide) | (vide) — utilisée quand la clé 1 échoue", () => {
		const train = makeTrain();
		const associations: Association[] = [{ mainRid: "rid1", assocRid: "assoc1", tiploc: "DEST" }];
		const via: ViaLookup = (at, dest, assocRid, origin) =>
			assocRid === "" && at === "DEST" && dest === "DEST" && origin === "" ? "via Oxford" : undefined;
		expect(buildDestination(train, "PASSENGER", placeName, associations, via)).toBe("Destination Station via Oxford");
	});

	it("clé 3 : at | dest | TIPLOC origine du train | (vide) — dernier recours", () => {
		const train = makeTrain();
		const associations: Association[] = [{ mainRid: "rid1", assocRid: "assoc1", tiploc: "DEST" }];
		const via: ViaLookup = (at, dest, assocRid, origin) =>
			assocRid === "ORIG" && at === "DEST" && dest === "DEST" && origin === "" ? "via Didcot" : undefined;
		expect(buildDestination(train, "PASSENGER", placeName, associations, via)).toBe("Destination Station via Didcot");
	});
});
