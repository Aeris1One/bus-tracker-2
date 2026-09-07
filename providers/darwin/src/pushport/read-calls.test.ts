import { describe, expect, it } from "vitest";

import { canonicalShapeKey } from "../domain/segment.js";
import { buildCalls, buildCallsFromTaggedGroups, isDeletedTrain, type RawCall, readRawCall } from "./read-calls.js";

const SERVICE_DATE = "2026-09-06";

describe("readRawCall", () => {
	it("rend undefined si tpl est absent", () => {
		expect(readRawCall("IP", { act: "T" })).toBeUndefined();
	});

	it("applique les valeurs par défaut de act et can", () => {
		const raw = readRawCall("IP", { tpl: "BHM" });
		expect(raw).toEqual({
			tag: "IP",
			tpl: "BHM",
			act: "",
			can: false,
			pta: undefined,
			ptd: undefined,
			wta: undefined,
			wtd: undefined,
			wtp: undefined,
		});
	});

	it('lit can via toBoolean : seul true/"true" compte', () => {
		expect(readRawCall("IP", { tpl: "BHM", can: "true" })?.can).toBe(true);
		expect(readRawCall("IP", { tpl: "BHM", can: "1" })?.can).toBe(false);
	});
});

describe("isDeletedTrain", () => {
	it("un mode B, F ou S supprime le train", () => {
		expect(isDeletedTrain("B", undefined)).toBe(true);
		expect(isDeletedTrain("F", undefined)).toBe(true);
		expect(isDeletedTrain("S", undefined)).toBe(true);
	});

	it("un marqueur de suppression vrai supprime le train", () => {
		expect(isDeletedTrain(undefined, "true")).toBe(true);
		expect(isDeletedTrain(undefined, true)).toBe(true);
	});

	it("un mode de train normal n'est pas supprimé", () => {
		expect(isDeletedTrain("P", "false")).toBe(false);
		expect(isDeletedTrain(undefined, undefined)).toBe(false);
	});
});

describe("buildCalls", () => {
	it("numérote les points de 0 à n−1 dans l'ordre du document, et chaîne la référence", () => {
		const raws: RawCall[] = [
			{ tag: "OR", tpl: "A", act: "TB", can: false, wtd: "10:00:00" },
			{ tag: "IP", tpl: "B", act: "", can: false, wta: "10:30:00", wtd: "10:31:00" },
			{ tag: "DT", tpl: "C", act: "TF", can: false, wta: "23:50:00" },
		];

		const calls = buildCalls(raws, SERVICE_DATE);

		expect(calls.map((call) => call.order)).toEqual([0, 1, 2]);
		expect(calls.map((call) => call.tiploc)).toEqual(["A", "B", "C"]);
		expect(calls[0]?.aimedWorkingDeparture).toBeDefined();
		expect(calls[1]?.aimedWorkingArrival).toBeGreaterThan(calls[0]?.aimedWorkingDeparture ?? 0);
		expect(calls[2]?.aimedWorkingArrival).toBeGreaterThan(calls[1]?.aimedWorkingDeparture ?? 0);
	});
});

describe("buildCallsFromTaggedGroups", () => {
	it("accepte un objet unique aussi bien qu'un tableau, pour la même clé de tag", () => {
		const fromObject = buildCallsFromTaggedGroups({ OR: { tpl: "A", wtd: "10:00:00" } }, SERVICE_DATE);
		const fromArray = buildCallsFromTaggedGroups({ OR: [{ tpl: "A", wtd: "10:00:00" }] }, SERVICE_DATE);

		expect(fromObject).toEqual(fromArray);
	});

	it("reconstruit l'ordre chronologique bien que les points soient regroupés par tag", () => {
		// L'ordre du document serait OR(A) IP(B) IP(C) DT(D). Ici les points sont fournis groupés par
		// tag (OR puis IP puis DT), volontairement dans un ordre qui ne respecterait pas la
		// chronologie si on les prenait tag par tag.
		const groups = {
			DT: { tpl: "D", wta: "12:00:00" },
			OR: { tpl: "A", wtd: "10:00:00" },
			IP: [
				{ tpl: "C", wta: "11:30:00", wtd: "11:31:00" },
				{ tpl: "B", wta: "10:30:00", wtd: "10:31:00" },
			],
		};

		const calls = buildCallsFromTaggedGroups(groups, SERVICE_DATE);

		expect(calls.map((call) => call.tiploc)).toEqual(["A", "B", "C", "D"]);
		expect(calls.map((call) => call.order)).toEqual([0, 1, 2, 3]);
	});

	it("le tri est stable : un point sans aucune heure conserve sa position relative face aux autres points sans heure", () => {
		const groups = {
			OR: { tpl: "A", wtd: "10:00:00" },
			PP: [{ tpl: "X1" }, { tpl: "X2" }],
			DT: { tpl: "B", wta: "11:00:00" },
		};

		const calls = buildCallsFromTaggedGroups(groups, SERVICE_DATE);
		const withoutTime = calls.filter((call) => call.tiploc.startsWith("X"));

		expect(withoutTime.map((call) => call.tiploc)).toEqual(["X1", "X2"]);
	});
});

describe("même clé canonique depuis les deux sources", () => {
	// Train de NUIT : départ 23:40, terminus 00:30 le lendemain. C'est le cas qui met en défaut un
	// tri sur des heures analysées sans référence — 00:30 ancré sur la date de service se placerait
	// avant 23:40 et remonterait le terminus en tête. L'ancrage sur l'origine (`findOriginReference`)
	// l'évite.
	const OVERNIGHT = [
		{ tag: "OPOR" as const, node: { tpl: "OLDOAKC", wtd: "23:25:00" } },
		{ tag: "OR" as const, node: { tpl: "PADTON", act: "TB", wtd: "23:40:00", ptd: "23:40" } },
		// Un point de passage réel porte une heure de passage technique : c'est elle qui permet de le
		// replacer dans un ordre reconstruit. Un point littéralement dépourvu de toute heure ne peut,
		// lui, être ordonné que par la stabilité du tri.
		{ tag: "PP" as const, node: { tpl: "SLOUGH", wtp: "23:47:00" } },
		{
			tag: "IP" as const,
			node: { tpl: "READING", act: "T", wta: "23:55:00", wtd: "23:57:00", pta: "23:55", ptd: "23:57" },
		},
		{ tag: "DT" as const, node: { tpl: "OXFORD", act: "TF", wta: "00:30:00", pta: "00:30" } },
	];

	it("un même train de nuit, décrit par le fichier d'horaires ou par un message schedule, produit les mêmes rangs, les mêmes heures et la même clé canonique", () => {
		const fromTimetable = buildCalls(
			OVERNIGHT.map(({ tag, node }) => readRawCall(tag, node)).filter((raw): raw is RawCall => raw !== undefined),
			SERVICE_DATE,
		);

		// Message `schedule` équivalent : mêmes points, regroupés par tag, ordre du document perdu —
		// et volontairement énoncés dans un ordre défavorable, terminus en premier.
		const fromSchedule = buildCallsFromTaggedGroups(
			{
				DT: OVERNIGHT[4]?.node,
				IP: OVERNIGHT[3]?.node,
				PP: OVERNIGHT[2]?.node,
				OR: OVERNIGHT[1]?.node,
				OPOR: OVERNIGHT[0]?.node,
			},
			SERVICE_DATE,
		);

		expect(fromSchedule.map((call) => call.tiploc)).toEqual(fromTimetable.map((call) => call.tiploc));
		expect(fromSchedule.map((call) => call.order)).toEqual(fromTimetable.map((call) => call.order));
		expect(fromSchedule.map((call) => call.aimedWorkingArrival)).toEqual(
			fromTimetable.map((call) => call.aimedWorkingArrival),
		);
		expect(fromSchedule.map((call) => call.aimedWorkingDeparture)).toEqual(
			fromTimetable.map((call) => call.aimedWorkingDeparture),
		);
		expect(canonicalShapeKey(fromSchedule)).toBe(canonicalShapeKey(fromTimetable));
	});

	it("le terminus d'après minuit est daté du lendemain, pas du jour de service", () => {
		const calls = buildCallsFromTaggedGroups({ OR: OVERNIGHT[1]?.node, DT: OVERNIGHT[4]?.node }, SERVICE_DATE);

		const terminus = calls.at(-1);
		expect(terminus?.tiploc).toBe("OXFORD");
		// Le départ est le 15 à 23:40 locale ; l'arrivée doit être le 16 à 00:30, donc postérieure.
		expect(terminus?.aimedWorkingArrival).toBeGreaterThan(calls[0]?.aimedWorkingDeparture ?? 0);
	});
});
