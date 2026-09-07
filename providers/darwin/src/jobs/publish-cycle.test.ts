import type { VehicleJourney } from "@bus-tracker/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../publish/build-journey.js", () => ({ buildJourney: vi.fn() }));

import type { Configuration } from "../configuration/configuration.js";
import { createContext, type ProviderContext } from "../context.js";
import type { Call } from "../domain/call.js";
import { createShape, type Shape } from "../domain/shape.js";
import type { Train } from "../domain/train.js";
import { buildJourney } from "../publish/build-journey.js";
import type { Publisher } from "../publish/publisher.js";
import { runPublishCycle } from "./publish-cycle.js";

function makeConfiguration(): Configuration {
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
	};
}

function makeCall(order: number): Call {
	return {
		tag: "IP",
		tiploc: `TPL${order}`,
		activity: "",
		order,
		platformSuppressed: false,
		locationSuppressed: false,
		platformConfirmed: false,
		cancelled: false,
	};
}

function makeTrain(rid: string): Train {
	return {
		rid,
		uid: "A12345",
		ssd: "2026-01-01",
		trainId: "1A23",
		toc: "GW",
		calls: [makeCall(0), makeCall(1)],
		origin: "TPL0",
		destination: "TPL1",
		cancelled: false,
	};
}

function makeJourney(rid: string): VehicleJourney {
	return {
		id: `NR:UNKNOWN:ServiceJourney:${rid}`,
		networkRef: "NR:UNKNOWN",
		updatedAt: new Date().toISOString(),
		position: { latitude: 51.5, longitude: -0.1, atStop: true, type: "COMPUTED", recordedAt: new Date().toISOString() },
	};
}

function makeShape(redisKey: string): Shape {
	return createShape(`canonical-${redisKey}`, redisKey, [
		{ latitude: 51.5, longitude: -0.1, distance: 0, callOrder: 0 },
		{ latitude: 51.6, longitude: -0.2, distance: 1000, callOrder: 1 },
	]);
}

type CapturingPublisher = Publisher & { journeysCalls: VehicleJourney[][]; shapesCalls: Shape[][] };

function makePublisher(publishedCount?: (journeys: VehicleJourney[]) => number): CapturingPublisher {
	const journeysCalls: VehicleJourney[][] = [];
	const shapesCalls: Shape[][] = [];
	return {
		journeysCalls,
		shapesCalls,
		async publishJourneys(journeys) {
			journeysCalls.push(journeys);
			return publishedCount ? publishedCount(journeys) : journeys.length;
		},
		async publishShapes(shapes) {
			shapesCalls.push([...shapes]);
		},
		resetKeyRegistry() {},
	};
}

function makeContext(publisher: Publisher): ProviderContext {
	return createContext(makeConfiguration(), publisher);
}

beforeEach(() => {
	vi.mocked(buildJourney).mockReset();
});

describe("runPublishCycle", () => {
	it("une erreur sur un train n'empêche pas les autres d'être publiés", async () => {
		const publisher = makePublisher();
		const context = makeContext(publisher);
		context.trains.set(makeTrain("BAD"));
		context.trains.set(makeTrain("GOOD"));

		vi.mocked(buildJourney).mockImplementation((_ctx, train) => {
			if (train.rid === "BAD") {
				throw new Error("échec délibéré du train BAD");
			}
			return { journey: makeJourney(train.rid), shapes: new Map(), omitted: 0 };
		});

		await runPublishCycle(context);

		expect(publisher.journeysCalls).toHaveLength(1);
		const published = publisher.journeysCalls[0] ?? [];
		expect(published).toHaveLength(1);
		expect(published[0]?.id).toContain("GOOD");
	});

	it("les trois tracés de chaque train sont collectés pour téléversement, même les non actifs", async () => {
		const publisher = makePublisher();
		const context = makeContext(publisher);
		context.trains.set(makeTrain("RID1"));

		const shapes = new Map([
			["TRAIL_IN", makeShape("shape:trail-in")],
			["PASSENGER", makeShape("shape:passenger")],
			["TRAIL_OUT", makeShape("shape:trail-out")],
		] as const);

		vi.mocked(buildJourney).mockReturnValue({ journey: makeJourney("RID1"), shapes, omitted: 0 });

		await runPublishCycle(context);

		expect(publisher.shapesCalls).toHaveLength(1);
		const published = publisher.shapesCalls[0] ?? [];
		expect(published.map((shape) => shape.redisKey).sort()).toEqual(
			["shape:passenger", "shape:trail-in", "shape:trail-out"].sort(),
		);
	});

	it("un cycle sans train visible ne publie rien", async () => {
		const publisher = makePublisher();
		const context = makeContext(publisher);

		await runPublishCycle(context);

		expect(buildJourney).not.toHaveBeenCalled();
		expect(publisher.journeysCalls).toEqual([[]]);
		expect(publisher.shapesCalls).toEqual([[]]);
	});

	it("agrège le compte des points omis à travers tous les trains du cycle", async () => {
		const publisher = makePublisher();
		const context = makeContext(publisher);
		context.trains.set(makeTrain("RID1"));
		context.trains.set(makeTrain("RID2"));

		vi.mocked(buildJourney).mockImplementation((_ctx, train) => ({
			journey: makeJourney(train.rid),
			shapes: new Map(),
			omitted: train.rid === "RID1" ? 2 : 3,
		}));

		await runPublishCycle(context);

		// Rien à observer directement sur `omitted` (agrégé seulement pour la journalisation), mais
		// les deux trains doivent malgré tout avoir été publiés.
		expect(publisher.journeysCalls[0]).toHaveLength(2);
	});

	it("un train écarté par les filtres d'éligibilité (buildJourney rend undefined) n'est ni erreur ni publication", async () => {
		const publisher = makePublisher();
		const context = makeContext(publisher);
		context.trains.set(makeTrain("RID1"));

		vi.mocked(buildJourney).mockReturnValue(undefined);

		await runPublishCycle(context);

		expect(publisher.journeysCalls[0]).toEqual([]);
	});
});
