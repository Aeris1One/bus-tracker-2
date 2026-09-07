import { describe, expect, it } from "vitest";

import {
	type Call,
	computeCallFlags,
	effectiveArrival,
	effectiveDeparture,
	isCallTag,
	isPassengerTag,
} from "./call.js";

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

describe("isCallTag / isPassengerTag", () => {
	it("reconnaît les sept tags, et seuls OR/IP/DT sont voyageurs", () => {
		expect(isCallTag("OR")).toBe(true);
		expect(isCallTag("PP")).toBe(true);
		expect(isCallTag("XX")).toBe(false);
		expect(isPassengerTag("OR")).toBe(true);
		expect(isPassengerTag("IP")).toBe(true);
		expect(isPassengerTag("DT")).toBe(true);
		expect(isPassengerTag("OPOR")).toBe(false);
		expect(isPassengerTag("PP")).toBe(false);
	});
});

describe("computeCallFlags(tag, activity)", () => {
	it("un point technique (OPOR/OPIP/OPDT) est toujours fermé, quel que soit le code d'activité", () => {
		expect(computeCallFlags("OPOR", "TB")).toEqual(["NO_PICKUP", "NO_DROP_OFF"]);
		expect(computeCallFlags("OPIP", "D")).toEqual(["NO_PICKUP", "NO_DROP_OFF"]);
		expect(computeCallFlags("OPDT", "")).toEqual(["NO_PICKUP", "NO_DROP_OFF"]);
	});

	it('une activité vide ou "-" (une fois les espaces retirés) ferme le point', () => {
		expect(computeCallFlags("IP", "")).toEqual(["NO_PICKUP", "NO_DROP_OFF"]);
		expect(computeCallFlags("IP", " -")).toEqual(["NO_PICKUP", "NO_DROP_OFF"]);
		expect(computeCallFlags("IP", "-")).toEqual(["NO_PICKUP", "NO_DROP_OFF"]);
	});

	it('"D" exact interdit la montée seule', () => {
		expect(computeCallFlags("IP", "D")).toEqual(["NO_PICKUP"]);
	});

	it('"U" exact interdit la descente seule', () => {
		expect(computeCallFlags("IP", "U")).toEqual(["NO_DROP_OFF"]);
	});

	it("aucun indicateur sinon", () => {
		expect(computeCallFlags("IP", "T ")).toEqual([]);
	});

	it('les codes de manœuvre "-D" et "-U" ne sont pas des égalités D/U : aucune restriction déduite', () => {
		expect(computeCallFlags("IP", "-D")).toEqual([]);
		expect(computeCallFlags("IP", "-U")).toEqual([]);
	});
});

describe("effectiveArrival(call)", () => {
	it("suit l'ordre : réelle, prévue, technique théorique, technique prévue, passage technique, publique théorique", () => {
		const full = makeCall({
			actualArrival: 1,
			expectedArrival: 2,
			aimedWorkingArrival: 3,
			expectedWorking: 4,
			aimedWorkingPass: 5,
			aimedPublicArrival: 6,
		});
		expect(effectiveArrival(full)).toBe(1);
		expect(effectiveArrival({ ...full, actualArrival: undefined })).toBe(2);
		expect(effectiveArrival({ ...full, actualArrival: undefined, expectedArrival: undefined })).toBe(3);
		expect(
			effectiveArrival({
				...full,
				actualArrival: undefined,
				expectedArrival: undefined,
				aimedWorkingArrival: undefined,
			}),
		).toBe(4);
		expect(
			effectiveArrival({
				...full,
				actualArrival: undefined,
				expectedArrival: undefined,
				aimedWorkingArrival: undefined,
				expectedWorking: undefined,
			}),
		).toBe(5);
		expect(
			effectiveArrival({
				...full,
				actualArrival: undefined,
				expectedArrival: undefined,
				aimedWorkingArrival: undefined,
				expectedWorking: undefined,
				aimedWorkingPass: undefined,
			}),
		).toBe(6);
		expect(effectiveArrival(makeCall())).toBeUndefined();
	});
});

describe("effectiveDeparture(call)", () => {
	it("vaut +∞ quand une arrivée réelle est connue sans départ réel : le train est à quai", () => {
		const atPlatform = makeCall({ actualArrival: 1000, aimedWorkingDeparture: 2000 });
		expect(effectiveDeparture(atPlatform)).toBe(Number.POSITIVE_INFINITY);
	});

	it("la règle +∞ est levée dès qu'un départ réel arrive", () => {
		const departed = makeCall({ actualArrival: 1000, actualDeparture: 1500 });
		expect(effectiveDeparture(departed)).toBe(1500);
	});

	it("suit l'ordre : réel, prévu, technique théorique, technique prévu, passage technique, public théorique", () => {
		const full = makeCall({
			actualDeparture: 1,
			expectedDeparture: 2,
			aimedWorkingDeparture: 3,
			expectedWorking: 4,
			aimedWorkingPass: 5,
			aimedPublicDeparture: 6,
		});
		expect(effectiveDeparture(full)).toBe(1);
		expect(effectiveDeparture({ ...full, actualDeparture: undefined })).toBe(2);
		expect(effectiveDeparture({ ...full, actualDeparture: undefined, expectedDeparture: undefined })).toBe(3);
		expect(
			effectiveDeparture({
				...full,
				actualDeparture: undefined,
				expectedDeparture: undefined,
				aimedWorkingDeparture: undefined,
			}),
		).toBe(4);
		expect(
			effectiveDeparture({
				...full,
				actualDeparture: undefined,
				expectedDeparture: undefined,
				aimedWorkingDeparture: undefined,
				expectedWorking: undefined,
			}),
		).toBe(5);
		expect(
			effectiveDeparture({
				...full,
				actualDeparture: undefined,
				expectedDeparture: undefined,
				aimedWorkingDeparture: undefined,
				expectedWorking: undefined,
				aimedWorkingPass: undefined,
			}),
		).toBe(6);
		expect(effectiveDeparture(makeCall())).toBeUndefined();
	});
});
