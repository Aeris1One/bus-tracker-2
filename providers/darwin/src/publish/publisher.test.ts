import type { VehicleJourney } from "@bus-tracker/contracts";
import { totalPositionTypeCounts } from "@bus-tracker/monitoring";
import { describe, expect, it } from "vitest";

import { PUBLISH_CHUNK_SIZE } from "../constants.js";
import { createShape } from "../domain/shape.js";
import { createCounters } from "../state/counters.js";
import { createPublisher, type RedisClient, type RedisMulti } from "./publisher.js";

/**
 * Stub de Redis
 */
function makeRedisDouble() {
	const published: { channel: string; message: string }[] = [];
	const multiCalls: { sets: { key: string; value: string; options: { EX: number } }[]; executed: boolean }[] = [];

	const redis: RedisClient = {
		async publish(channel, message) {
			published.push({ channel, message });
			return 1;
		},
		multi() {
			const sets: { key: string; value: string; options: { EX: number } }[] = [];
			const record = { sets, executed: false };
			multiCalls.push(record);
			const multi: RedisMulti = {
				set(key, value, options) {
					sets.push({ key, value, options });
					return multi;
				},
				async exec() {
					record.executed = true;
					return sets.map(() => "OK");
				},
			};
			return multi;
		},
	};

	return { redis, published, multiCalls };
}

function makeJourney(overrides: Partial<VehicleJourney> = {}): VehicleJourney {
	return {
		id: "NR:UNKNOWN:ServiceJourney:R1",
		networkRef: "NR:UNKNOWN",
		updatedAt: new Date(0).toISOString(),
		position: {
			latitude: 51.5,
			longitude: -0.1,
			type: "COMPUTED",
			atStop: true,
			recordedAt: new Date(0).toISOString(),
		},
		...overrides,
	};
}

function makeShape(canonicalKey: string, redisKey: string) {
	return createShape(canonicalKey, redisKey, [
		{ latitude: 51.5, longitude: -0.1, distance: 0, callOrder: 0 },
		{ latitude: 51.6, longitude: -0.2, distance: 1_000, callOrder: 1 },
	]);
}

describe("createPublisher — publishJourneys", () => {
	it("un cycle sans train visible ne publie rien", async () => {
		const { redis, published } = makeRedisDouble();
		const publisher = createPublisher(redis, "journeys", createCounters());

		const counts = await publisher.publishJourneys([]);

		expect(totalPositionTypeCounts(counts)).toBe(0);
		expect(published).toHaveLength(0);
	});

	it("découpe les entrées valides en paquets d'au plus PUBLISH_CHUNK_SIZE", async () => {
		const { redis, published } = makeRedisDouble();
		const publisher = createPublisher(redis, "journeys", createCounters());
		const journeys = Array.from({ length: PUBLISH_CHUNK_SIZE + 1 }, (_, index) =>
			makeJourney({ id: `NR:UNKNOWN:ServiceJourney:R${index}` }),
		);

		const counts = await publisher.publishJourneys(journeys);

		expect(totalPositionTypeCounts(counts)).toBe(PUBLISH_CHUNK_SIZE + 1);
		expect(published).toHaveLength(2);
		expect(JSON.parse(published[0]?.message ?? "[]")).toHaveLength(PUBLISH_CHUNK_SIZE);
		expect(JSON.parse(published[1]?.message ?? "[]")).toHaveLength(1);
		expect(published.every((entry) => entry.channel === "journeys")).toBe(true);
	});

	it("une entrée invalide est écartée et comptée, sans interrompre la publication des autres", async () => {
		const { redis, published } = makeRedisDouble();
		const counters = createCounters();
		const publisher = createPublisher(redis, "journeys", counters);
		// `id` manquant : rejetée par `vehicleJourneySchema`.
		const invalid = { ...makeJourney(), id: undefined } as unknown as VehicleJourney;
		const valid = makeJourney({ id: "NR:UNKNOWN:ServiceJourney:VALID" });

		const counts = await publisher.publishJourneys([invalid, valid]);

		expect(totalPositionTypeCounts(counts)).toBe(1);
		expect(counters.get("publish:invalid")).toBe(1);
		expect(published).toHaveLength(1);
		expect(JSON.parse(published[0]?.message ?? "[]")).toHaveLength(1);
	});

	it("aucun train valide après écartement des invalides ⇒ aucune publication", async () => {
		const { redis, published } = makeRedisDouble();
		const publisher = createPublisher(redis, "journeys", createCounters());
		const invalid = { ...makeJourney(), id: undefined } as unknown as VehicleJourney;

		const counts = await publisher.publishJourneys([invalid]);

		expect(totalPositionTypeCounts(counts)).toBe(0);
		expect(published).toHaveLength(0);
	});
});

describe("createPublisher — publishShapes", () => {
	it("regroupe toutes les écritures d'un cycle en une seule transaction", async () => {
		const { redis, multiCalls } = makeRedisDouble();
		const publisher = createPublisher(redis, "journeys", createCounters());
		const shapes = [
			makeShape("A>B", "NR:RoutePath:national-rail:local:aaaa"),
			makeShape("C>D", "NR:RoutePath:national-rail:local:bbbb"),
		];

		await publisher.publishShapes(shapes, 1_000);

		expect(multiCalls).toHaveLength(1);
		expect(multiCalls[0]?.sets).toHaveLength(2);
		expect(multiCalls[0]?.executed).toBe(true);
	});

	it("une clé écrite il y a 300 s n'est pas réécrite (< 600 s)", async () => {
		const { redis, multiCalls } = makeRedisDouble();
		const publisher = createPublisher(redis, "journeys", createCounters());
		const shape = makeShape("A>B", "NR:RoutePath:national-rail:local:aaaa");

		await publisher.publishShapes([shape], 0);
		expect(multiCalls).toHaveLength(1);

		await publisher.publishShapes([shape], 300_000);

		// Aucune nouvelle transaction n'est ouverte : rien à écrire.
		expect(multiCalls).toHaveLength(1);
	});

	it("une clé écrite il y a 700 s est réécrite (> 600 s)", async () => {
		const { redis, multiCalls } = makeRedisDouble();
		const publisher = createPublisher(redis, "journeys", createCounters());
		const shape = makeShape("A>B", "NR:RoutePath:national-rail:local:aaaa");

		await publisher.publishShapes([shape], 0);
		expect(multiCalls).toHaveLength(1);

		await publisher.publishShapes([shape], 700_000);

		expect(multiCalls).toHaveLength(2);
		expect(multiCalls[1]?.sets).toHaveLength(1);
	});

	it("EX est fixé à la durée de vie contractuelle des clés de tracés", async () => {
		const { redis, multiCalls } = makeRedisDouble();
		const publisher = createPublisher(redis, "journeys", createCounters());
		const shape = makeShape("A>B", "NR:RoutePath:national-rail:local:aaaa");

		await publisher.publishShapes([shape], 0);

		expect(multiCalls[0]?.sets[0]?.options.EX).toBeGreaterThan(0);
		expect(multiCalls[0]?.sets[0]?.value).toBe(shape.toPayload());
		expect(multiCalls[0]?.sets[0]?.key).toBe(shape.redisKey);
	});
});

describe("createPublisher — resetKeyRegistry", () => {
	it("purge le registre : une clé pourtant récente redevient réécrite", async () => {
		const { redis, multiCalls } = makeRedisDouble();
		const publisher = createPublisher(redis, "journeys", createCounters());
		const shape = makeShape("A>B", "NR:RoutePath:national-rail:local:aaaa");

		await publisher.publishShapes([shape], 0);
		expect(multiCalls).toHaveLength(1);

		publisher.resetKeyRegistry();
		await publisher.publishShapes([shape], 100);

		expect(multiCalls).toHaveLength(2);
	});
});
