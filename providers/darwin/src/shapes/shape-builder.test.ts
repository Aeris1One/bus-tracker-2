import { describe, expect, it } from "vitest";
import type { Call, CallTag } from "../domain/call.js";
import type { Segment } from "../domain/segment.js";
import { createCounters } from "../state/counters.js";
import type { RailRouter } from "./route-shape.js";
import { ensureShapes, type ShapeBuilderDeps, shapeRedisKey } from "./shape-builder.js";
import { createShapeStore } from "./shape-store.js";

function makeCall(tag: CallTag, tiploc: string, order: number, overrides: Partial<Call> = {}): Call {
	return {
		tag,
		tiploc,
		activity: "",
		order,
		platformSuppressed: false,
		locationSuppressed: false,
		platformConfirmed: false,
		cancelled: false,
		...overrides,
	};
}

const COORDINATES: Record<string, { latitude: number; longitude: number }> = {
	PADTON: { latitude: 51.5, longitude: -0.1 },
	RDNGSTN: { latitude: 51.458, longitude: -0.971 },
	SWINDON: { latitude: 51.568, longitude: -1.782 },
};

function coordinatesOf(tiploc: string) {
	return COORDINATES[tiploc];
}

function baseDeps(overrides: Partial<ShapeBuilderDeps> = {}): ShapeBuilderDeps {
	return {
		sourceId: "national-rail",
		shapePaths: false,
		graphVersion: "local",
		shapes: createShapeStore(),
		counters: createCounters(),
		coordinatesOf,
		...overrides,
	};
}

function passengerSegment(calls: Call[]): Segment {
	return { kind: "PASSENGER", calls };
}

describe("shapeRedisKey", () => {
	it("l'empreinte fait exactement 16 caractères hexadécimaux", () => {
		const key = shapeRedisKey("national-rail", "1", "PADTON>RDNGSTN>SWINDON");
		const fingerprint = key.split(":").at(-1);
		expect(fingerprint).toMatch(/^[0-9a-f]{16}$/);
	});

	it("est stable pour une même clé canonique", () => {
		const first = shapeRedisKey("national-rail", "1", "PADTON>RDNGSTN>SWINDON");
		const second = shapeRedisKey("national-rail", "1", "PADTON>RDNGSTN>SWINDON");
		expect(first).toBe(second);
	});

	it("est dépourvue de préfixe opérateur : sourceId et versionGraphe seuls varient le préfixe", () => {
		const key = shapeRedisKey("national-rail", "20260903", "PADTON>RDNGSTN>SWINDON");
		expect(key).toMatch(/^NR:RoutePath:national-rail:20260903:[0-9a-f]{16}$/);
	});

	it("deux clés canoniques différentes produisent des empreintes différentes", () => {
		const a = shapeRedisKey("national-rail", "1", "PADTON>RDNGSTN");
		const b = shapeRedisKey("national-rail", "1", "RDNGSTN>PADTON");
		expect(a).not.toBe(b);
	});
});

describe("ensureShapes", () => {
	it("deux trains de TOC différents empruntant la même succession de gares obtiennent la même clé de tracé", () => {
		const first = ensureShapes(
			[
				passengerSegment([
					makeCall("OR", "PADTON", 0, { activity: "TB" }),
					makeCall("IP", "RDNGSTN", 1),
					makeCall("DT", "SWINDON", 2),
				]),
			],
			baseDeps({ sourceId: "national-rail" }),
		);
		const second = ensureShapes(
			[
				passengerSegment([
					makeCall("OR", "PADTON", 0, { activity: "TF" }),
					makeCall("IP", "RDNGSTN", 1, { cancelled: true }),
					makeCall("DT", "SWINDON", 2),
				]),
			],
			baseDeps({ sourceId: "national-rail" }),
		);

		const firstShape = first.get("PASSENGER");
		const secondShape = second.get("PASSENGER");
		expect(firstShape).toBeDefined();
		expect(secondShape).toBeDefined();
		expect(firstShape?.redisKey).toBe(secondShape?.redisKey);
		expect(firstShape?.canonicalKey).toBe(secondShape?.canonicalKey);
	});

	it("repli rectiligne quand le routage est disponible mais lève une erreur", () => {
		const throwingRouter: RailRouter = {
			canRoute: true,
			findCandidates() {
				throw new Error("échec synthétique du routage");
			},
			leg() {
				throw new Error("ne devrait jamais être appelé");
			},
		};
		const segments = [
			passengerSegment([makeCall("OR", "PADTON", 0), makeCall("IP", "RDNGSTN", 1), makeCall("DT", "SWINDON", 2)]),
		];

		const result = ensureShapes(segments, baseDeps({ shapePaths: true, router: throwingRouter }));

		const shape = result.get("PASSENGER");
		expect(shape).toBeDefined();
		// Repli rectiligne : un sommet par point retenu, aux coordonnées mêmes des lieux.
		expect(shape?.length).toBe(3);
		expect(shape?.latitudes[0]).toBe(COORDINATES.PADTON?.latitude);
	});

	it("tracés désactivés en configuration ⇒ toujours rectiligne, même avec un routeur disponible", () => {
		const router: RailRouter = {
			canRoute: true,
			findCandidates() {
				throw new Error("ne devrait jamais être appelé : shapePaths est désactivé");
			},
			leg() {
				throw new Error("ne devrait jamais être appelé");
			},
		};
		const segments = [passengerSegment([makeCall("OR", "PADTON", 0), makeCall("DT", "RDNGSTN", 1)])];

		const result = ensureShapes(segments, baseDeps({ shapePaths: false, router }));

		expect(result.get("PASSENGER")).toBeDefined();
	});

	it("shape:cache:miss au premier calcul, shape:cache:hit à la réutilisation d'un même tracé", () => {
		const counters = createCounters();
		const shapes = createShapeStore();
		const segments = [passengerSegment([makeCall("OR", "PADTON", 0), makeCall("DT", "RDNGSTN", 1)])];
		const deps = baseDeps({ counters, shapes });

		ensureShapes(segments, deps);
		expect(counters.get("shape:cache:miss")).toBe(1);
		expect(counters.get("shape:cache:hit")).toBe(0);

		ensureShapes(segments, deps);
		expect(counters.get("shape:cache:miss")).toBe(1);
		expect(counters.get("shape:cache:hit")).toBe(1);
	});

	it("shape:dropped compte les points sans coordonnée retirés, même quand le tracé reste constructible", () => {
		const counters = createCounters();
		const segments = [
			passengerSegment([makeCall("OR", "PADTON", 0), makeCall("IP", "NOCOORD", 1), makeCall("DT", "RDNGSTN", 2)]),
		];

		const result = ensureShapes(segments, baseDeps({ counters }));

		expect(counters.get("shape:dropped")).toBe(1);
		expect(result.get("PASSENGER")).toBeDefined();
	});

	it("un segment réduit à moins de deux points après filtrage ne produit aucun tracé", () => {
		const segments = [passengerSegment([makeCall("OR", "PADTON", 0), makeCall("DT", "NOCOORD", 1)])];

		const result = ensureShapes(segments, baseDeps());

		expect(result.has("PASSENGER")).toBe(false);
	});

	it("<versionGraphe> vaut SHAPE_KEY_LOCAL_VERSION quand aucun routeur n'est disponible", () => {
		const segments = [passengerSegment([makeCall("OR", "PADTON", 0), makeCall("DT", "RDNGSTN", 1)])];

		const result = ensureShapes(segments, baseDeps({ router: undefined, graphVersion: "local" }));

		expect(result.get("PASSENGER")?.redisKey).toContain(":local:");
	});

	it("un routeur sans graphe pré-contracté produit un tracé RECTILIGNE, pas un routé de cordes", () => {
		// Le piège : un routeur dont `canRoute` est faux sait encore accrocher les lieux au rail. S'il
		// était employé, ses sommets se placeraient sur les nœuds accrochés — jusqu'à 200 m du lieu —
		// et chaque tronçon compterait un pont. Le repli rectiligne est donc exigé ici, dont les
		// sommets sont exactement les coordonnées des lieux.
		const segments = [passengerSegment([makeCall("OR", "PADTON", 0), makeCall("DT", "RDNGSTN", 1)])];
		const nonRoutingRouter: RailRouter = {
			canRoute: false,
			findCandidates: () => {
				throw new Error("ne doit jamais être appelé lorsque canRoute est faux");
			},
			leg: () => {
				throw new Error("ne doit jamais être appelé lorsque canRoute est faux");
			},
		};

		const counters = createCounters();
		const result = ensureShapes(
			segments,
			baseDeps({ shapePaths: true, router: nonRoutingRouter, graphVersion: "20260903", counters }),
		);

		const shape = result.get("PASSENGER");
		expect(Array.from(shape?.latitudes ?? [], (lat, i) => [lat, shape?.longitudes[i]])).toEqual([
			[coordinatesOf("PADTON")?.latitude, coordinatesOf("PADTON")?.longitude],
			[coordinatesOf("RDNGSTN")?.latitude, coordinatesOf("RDNGSTN")?.longitude],
		]);
		// Aucun tracé routé n'a été construit : les compteurs de routage restent vierges.
		expect(counters.get("shape:total")).toBe(0);
		expect(counters.get("shape:bridge")).toBe(0);
		// La version du graphe reste celle du .bin, qui est bien chargé.
		expect(shape?.redisKey).toContain(":20260903:");
	});
});
