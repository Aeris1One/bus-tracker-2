import { describe, expect, it } from "vitest";

import type { Configuration } from "../../configuration/configuration.js";
import { createContext } from "../../context.js";
import type { Call } from "../../domain/call.js";
import { canonicalShapeKey } from "../../domain/segment.js";
import { createShape } from "../../domain/shape.js";
import type { Train } from "../../domain/train.js";
import type { Publisher } from "../../publish/publisher.js";
import { handleSchedule } from "./handle-schedule.js";

function makeConfiguration(overrides: Partial<Configuration> = {}): Configuration {
	return {
		id: "test",
		computeDelayMs: 30_000,
		gcsBucket: "bucket",
		kafkaBrokers: [],
		kafkaTopic: "topic",
		kafkaGroupId: "imposed-group",
		kafkaSasl: { username: "", password: "" },
		showDeparturesWithinMs: 600_000,
		keepAfterArrivalMs: 300_000,
		getNetworkRef: () => "NR:UNKNOWN",
		...overrides,
	};
}

function makeShape(canonicalKey: string) {
	return createShape(canonicalKey, `redis:${canonicalKey}`, []);
}

/** `Publisher` (L11) est concret : ces tests portent sur les handlers, jamais sur la
 * publication elle-même ; un double neutre suffit à satisfaire le type. */
const noopPublisher: Publisher = {
	publishJourneys: async () => 0,
	publishShapes: async () => {},
	resetKeyRegistry: () => {},
};

describe("handleSchedule", () => {
	it("un message sans rid est ignoré", () => {
		const context = createContext(makeConfiguration(), noopPublisher);
		handleSchedule(context, { ssd: "2026-09-06" });
		expect(context.trains.size).toBe(0);
	});

	it("un train supprimé (mode B/F/S ou marqueur de suppression) est entièrement ignoré", () => {
		const context = createContext(makeConfiguration(), noopPublisher);
		handleSchedule(context, {
			rid: "2026090601234",
			status: "B",
			OR: { tpl: "A", wtd: "10:00:00" },
			DT: { tpl: "B", wta: "10:30:00" },
		});
		handleSchedule(context, {
			rid: "2026090601235",
			deleted: "true",
			OR: { tpl: "A", wtd: "10:00:00" },
			DT: { tpl: "B", wta: "10:30:00" },
		});
		expect(context.trains.size).toBe(0);
	});

	it("crée un nouveau train, origine/destination et rangs reconstruits à partir du schedule", () => {
		const context = createContext(makeConfiguration(), noopPublisher);
		context.references.mergeCoordinates(
			new Map([
				["A", { latitude: 51, longitude: 0 }],
				["B", { latitude: 52, longitude: 0 }],
			]),
		);

		handleSchedule(context, {
			rid: "2026090601234",
			ssd: "2026-09-06",
			uid: "U1",
			trainId: "1A23",
			toc: "VT",
			OR: { tpl: "A", act: "TB", wtd: "10:00:00" },
			DT: { tpl: "B", act: "TF", wta: "10:30:00" },
		});

		const train = context.trains.get("2026-09-06", "2026090601234");
		expect(train).toBeDefined();
		expect(train?.origin).toBe("A");
		expect(train?.destination).toBe("B");
		expect(train?.calls.map((call: Call) => call.order)).toEqual([0, 1]);
		expect(train?.toc).toBe("VT");
	});

	it("ssd est dérivée du rid si absente", () => {
		const context = createContext(makeConfiguration(), noopPublisher);
		handleSchedule(context, {
			rid: "2026090712345",
			OR: { tpl: "A", wtd: "10:00:00" },
			DT: { tpl: "B", wta: "10:30:00" },
		});
		expect(context.trains.get("2026-09-07", "2026090712345")).toBeDefined();
	});

	it("un train annulé (can ou cancelReason) marque tous ses points annulés", () => {
		const context = createContext(makeConfiguration(), noopPublisher);
		handleSchedule(context, {
			rid: "2026090601234",
			can: "true",
			OR: { tpl: "A", wtd: "10:00:00" },
			DT: { tpl: "B", wta: "10:30:00" },
		});
		const train = context.trains.get("2026-09-06", "2026090601234");
		expect(train?.cancelled).toBe(true);
		expect(train?.calls.every((call) => call.cancelled)).toBe(true);
	});

	it("remplacement d'un horaire existant : origine/destination recalculées, et le dernier TS reçu est rejoué", () => {
		const context = createContext(makeConfiguration(), noopPublisher);
		const existing: Train = {
			rid: "RID1",
			uid: "U1",
			ssd: "2026-09-06",
			trainId: "1A23",
			toc: "VT",
			calls: [
				{
					tag: "OR",
					tiploc: "A",
					activity: "TB",
					order: 0,
					platformSuppressed: false,
					locationSuppressed: false,
					platformConfirmed: false,
					cancelled: false,
				},
				{
					tag: "DT",
					tiploc: "B",
					activity: "TF",
					order: 1,
					platformSuppressed: false,
					locationSuppressed: false,
					platformConfirmed: false,
					cancelled: false,
				},
			],
			origin: "A",
			destination: "B",
			cancelled: false,
			lastStatusMessage: { rid: "RID1", ssd: "2026-09-06", Location: [{ tpl: "C", dep: { at: "10:05:00" } }] },
		};
		context.trains.set(existing);

		handleSchedule(context, {
			rid: "RID1",
			ssd: "2026-09-06",
			OR: { tpl: "A", wtd: "10:00:00" },
			IP: { tpl: "C", wta: "10:15:00", wtd: "10:16:00" },
			DT: { tpl: "D", wta: "10:30:00" },
		});

		const replaced = context.trains.get("2026-09-06", "RID1");
		expect(replaced?.origin).toBe("A");
		expect(replaced?.destination).toBe("D");
		expect(replaced?.calls.map((call) => call.tiploc)).toEqual(["A", "C", "D"]);
		// Le dernier TS reçu (portant sur C) a bien été rejoué sur le nouvel horaire.
		const cCall = replaced?.calls.find((call) => call.tiploc === "C");
		expect(cCall?.actualDeparture).toBeDefined();
	});

	it("l'invalidation de tracés ne porte que sur les clés canoniques de l'ANCIEN parcours du train concerné", () => {
		const context = createContext(makeConfiguration(), noopPublisher);
		context.references.mergeCoordinates(
			new Map([
				["A", { latitude: 51, longitude: 0 }],
				["B", { latitude: 52, longitude: 0 }],
				["C", { latitude: 53, longitude: 0 }],
			]),
		);

		const oldKey = canonicalShapeKey([
			{
				tag: "OR",
				tiploc: "A",
				activity: "TB",
				order: 0,
				platformSuppressed: false,
				locationSuppressed: false,
				platformConfirmed: false,
				cancelled: false,
			},
			{
				tag: "DT",
				tiploc: "B",
				activity: "TF",
				order: 1,
				platformSuppressed: false,
				locationSuppressed: false,
				platformConfirmed: false,
				cancelled: false,
			},
		]);
		const unrelatedKey = "UNRELATED>KEY";
		context.shapes.set(makeShape(oldKey));
		context.shapes.set(makeShape(unrelatedKey));

		context.trains.set({
			rid: "RID1",
			uid: "",
			ssd: "2026-09-06",
			trainId: "",
			toc: "",
			calls: [
				{
					tag: "OR",
					tiploc: "A",
					activity: "TB",
					order: 0,
					platformSuppressed: false,
					locationSuppressed: false,
					platformConfirmed: false,
					cancelled: false,
				},
				{
					tag: "DT",
					tiploc: "B",
					activity: "TF",
					order: 1,
					platformSuppressed: false,
					locationSuppressed: false,
					platformConfirmed: false,
					cancelled: false,
				},
			],
			origin: "A",
			destination: "B",
			cancelled: false,
		});

		handleSchedule(context, {
			rid: "RID1",
			ssd: "2026-09-06",
			OR: { tpl: "A", wtd: "10:00:00" },
			DT: { tpl: "C", wta: "10:30:00" },
		});

		expect(context.shapes.get(oldKey)).toBeUndefined();
		expect(context.shapes.get(unrelatedKey)).toBeDefined();
	});

	it("rejoue un message TS orphelin en attente pour ce train, dès l'arrivée de son horaire", () => {
		const context = createContext(makeConfiguration(), noopPublisher);
		context.pendingStatuses.put(
			"2026-09-06",
			"RID1",
			{ rid: "RID1", ssd: "2026-09-06", Location: [{ tpl: "A", dep: { at: "10:05:00" } }] },
			0,
		);

		handleSchedule(context, {
			rid: "RID1",
			ssd: "2026-09-06",
			OR: { tpl: "A", wtd: "10:00:00" },
			DT: { tpl: "B", wta: "10:30:00" },
		});

		const train = context.trains.get("2026-09-06", "RID1");
		expect(train?.calls[0]?.actualDeparture).toBeDefined();
		expect(context.pendingStatuses.size).toBe(0);
	});

	describe("les filtres de configuration s'appliquent aussi au temps réel", () => {
		it("un TOC exclu par filterTocs fait ignorer le message", () => {
			const context = createContext(makeConfiguration({ filterTocs: ["VT"] }), noopPublisher);
			handleSchedule(context, {
				rid: "RID1",
				ssd: "2026-09-06",
				toc: "VT",
				OR: { tpl: "A", wtd: "10:00:00" },
				DT: { tpl: "B", wta: "10:30:00" },
			});
			expect(context.trains.size).toBe(0);
		});

		it("les TIPLOC exclus par filterTiplocs sont retirés de l'horaire, rangs renumérotés", () => {
			const context = createContext(makeConfiguration({ filterTiplocs: ["EXCLUDED"] }), noopPublisher);
			handleSchedule(context, {
				rid: "RID1",
				ssd: "2026-09-06",
				OR: { tpl: "A", wtd: "10:00:00" },
				IP: { tpl: "EXCLUDED", wta: "10:10:00" },
				DT: { tpl: "B", wta: "10:30:00" },
			});
			const train = context.trains.get("2026-09-06", "RID1");
			expect(train?.calls.map((call) => call.tiploc)).toEqual(["A", "B"]);
			expect(train?.calls.map((call) => call.order)).toEqual([0, 1]);
		});

		it("moins de deux points restants après filtrage : le train n'est pas installé", () => {
			const context = createContext(makeConfiguration({ filterTiplocs: ["B"] }), noopPublisher);
			handleSchedule(context, {
				rid: "RID1",
				ssd: "2026-09-06",
				OR: { tpl: "A", wtd: "10:00:00" },
				DT: { tpl: "B", wta: "10:30:00" },
			});
			expect(context.trains.size).toBe(0);
		});
	});
});
