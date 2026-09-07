import { describe, expect, it } from "vitest";
import type { Configuration } from "../../configuration/configuration.js";
import { createContext } from "../../context.js";
import { type Call, isPlatformHidden } from "../../domain/call.js";
import type { Train } from "../../domain/train.js";
import type { Publisher } from "../../publish/publisher.js";
import type { Envelope } from "../envelope.js";
import { applyTrainStatus, handleTrainStatus } from "./handle-train-status.js";

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

function makeCall(overrides: Partial<Call> = {}): Call {
	return {
		tag: "IP",
		tiploc: "TIPLOC1",
		activity: "T",
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
		rid: "RID1",
		uid: "U1",
		ssd: "2026-09-06",
		trainId: "1A23",
		toc: "VT",
		calls: [
			makeCall({ tiploc: "A", order: 0 }),
			makeCall({ tiploc: "B", order: 1 }),
			makeCall({ tiploc: "C", order: 2 }),
		],
		origin: "A",
		destination: "C",
		cancelled: false,
		...overrides,
	};
}

function makeEnvelope(overrides: Partial<Envelope> = {}): Envelope {
	return { payload: {}, isSnapshot: false, ...overrides };
}

/** `Publisher` (L11) est concret : ces tests portent sur les handlers, jamais sur la
 * publication elle-même ; un double neutre suffit à satisfaire le type. */
const noopPublisher: Publisher = {
	publishJourneys: async () => 0,
	publishShapes: async () => {},
	resetKeyRegistry: () => {},
};

describe("handleTrainStatus", () => {
	it("un message sans rid ou sans ssd est ignoré", () => {
		const context = createContext(makeConfiguration(), noopPublisher);
		handleTrainStatus(context, { ssd: "2026-09-06" }, makeEnvelope());
		handleTrainStatus(context, { rid: "RID1" }, makeEnvelope());
		expect(context.pendingStatuses.size).toBe(0);
	});

	it("un train inconnu met le message en attente (orphelin), puis il peut être rejoué", () => {
		const context = createContext(makeConfiguration(), noopPublisher);
		const message = { rid: "RID1", ssd: "2026-09-06", Location: { tpl: "A", dep: { at: "10:05:00" } } };

		handleTrainStatus(context, message, makeEnvelope());
		expect(context.pendingStatuses.size).toBe(1);

		const train = makeTrain();
		context.trains.set(train);
		const pending = context.pendingStatuses.take("2026-09-06", "RID1");
		expect(pending).toEqual(message);

		applyTrainStatus(train, message as Record<string, unknown>, 0);
		expect(train.calls[0]?.actualDeparture).toBeDefined();
	});

	it("curseur monotone avant : un TIPLOC visité deux fois reçoit ses mises à jour dans le bon ordre", () => {
		const train = makeTrain({
			calls: [
				makeCall({ tiploc: "LOOP", order: 0 }),
				makeCall({ tiploc: "MID", order: 1 }),
				makeCall({ tiploc: "LOOP", order: 2 }),
			],
		});
		const context = createContext(makeConfiguration(), noopPublisher);
		context.trains.set(train);

		const message = {
			rid: train.rid,
			ssd: train.ssd,
			Location: [
				{ tpl: "LOOP", dep: { at: "10:00:00" } },
				{ tpl: "MID", dep: { at: "10:10:00" } },
				{ tpl: "LOOP", arr: { at: "10:20:00" } },
			],
		};

		handleTrainStatus(context, message, makeEnvelope());

		expect(train.calls[0]?.actualDeparture).toBeDefined();
		expect(train.calls[2]?.actualArrival).toBeDefined();
		// Le premier passage par LOOP n'a pas reçu l'heure d'arrivée destinée au second passage.
		expect(train.calls[0]?.actualArrival).toBeUndefined();
	});

	it("une location dont le TIPLOC ne se retrouve plus à partir du curseur est ignorée", () => {
		const train = makeTrain();
		const context = createContext(makeConfiguration(), noopPublisher);
		context.trains.set(train);

		// "C" est avant "B" dans l'horaire du train : à partir du curseur avancé après le premier
		// call trouvé pour "B" ... en réalité ici on simule un TIPLOC totalement inconnu.
		handleTrainStatus(
			context,
			{ rid: train.rid, ssd: train.ssd, Location: [{ tpl: "UNKNOWN", dep: { at: "10:00:00" } }] },
			makeEnvelope(),
		);

		expect(train.calls.every((call) => call.actualDeparture === undefined)).toBe(true);
	});

	it("une location sans tpl est ignorée", () => {
		const train = makeTrain();
		const context = createContext(makeConfiguration(), noopPublisher);
		context.trains.set(train);

		handleTrainStatus(
			context,
			{ rid: train.rid, ssd: train.ssd, Location: [{ dep: { at: "10:00:00" } }] },
			makeEnvelope(),
		);

		expect(train.calls.every((call) => call.actualDeparture === undefined)).toBe(true);
	});

	it("atRemoved rétracte l'heure réelle correspondante, qui est ignorée", () => {
		const train = makeTrain();
		train.calls[0] = makeCall({ tiploc: "A", order: 0, actualArrival: 12345 });
		const context = createContext(makeConfiguration(), noopPublisher);
		context.trains.set(train);

		handleTrainStatus(
			context,
			{ rid: train.rid, ssd: train.ssd, Location: [{ tpl: "A", arr: { at: "10:00:00", atRemoved: true } }] },
			makeEnvelope(),
		);

		// La valeur précédente n'est pas remise à zéro : elle est simplement laissée telle quelle,
		// la nouvelle heure (rétractée) n'étant jamais appliquée.
		expect(train.calls[0]?.actualArrival).toBe(12345);
	});

	it("les trois formes du quai sont acceptées : chaîne simple, objet avec la clé vide, value, ou plat", () => {
		const context = createContext(makeConfiguration(), noopPublisher);

		const asString = makeTrain();
		context.trains.set(asString);
		handleTrainStatus(
			context,
			{ rid: asString.rid, ssd: asString.ssd, Location: [{ tpl: "A", plat: "4" }] },
			makeEnvelope(),
		);
		expect(asString.calls[0]?.platform).toBe("4");

		const asEmptyKey = makeTrain({ rid: "RID2" });
		context.trains.set(asEmptyKey);
		handleTrainStatus(
			context,
			{ rid: asEmptyKey.rid, ssd: asEmptyKey.ssd, Location: [{ tpl: "A", plat: { "": "5" } }] },
			makeEnvelope(),
		);
		expect(asEmptyKey.calls[0]?.platform).toBe("5");

		const asValueKey = makeTrain({ rid: "RID3" });
		context.trains.set(asValueKey);
		handleTrainStatus(
			context,
			{ rid: asValueKey.rid, ssd: asValueKey.ssd, Location: [{ tpl: "A", plat: { value: "6" } }] },
			makeEnvelope(),
		);
		expect(asValueKey.calls[0]?.platform).toBe("6");

		const asPlatKey = makeTrain({ rid: "RID4" });
		context.trains.set(asPlatKey);
		handleTrainStatus(
			context,
			{ rid: asPlatKey.rid, ssd: asPlatKey.ssd, Location: [{ tpl: "A", plat: { plat: "7" } }] },
			makeEnvelope(),
		);
		expect(asPlatKey.calls[0]?.platform).toBe("7");
	});

	it("suppr masque l'affichage du quai SANS annuler la desserte", () => {
		const train = makeTrain();
		const context = createContext(makeConfiguration(), noopPublisher);
		context.trains.set(train);

		handleTrainStatus(
			context,
			{ rid: train.rid, ssd: train.ssd, Location: [{ tpl: "A", plat: "4", suppr: true }] },
			makeEnvelope(),
		);

		expect(isPlatformHidden(train.calls[0] as Call)).toBe(true);
		expect(train.calls[0]?.platform).toBe("4");
		expect(train.calls[0]?.cancelled).toBe(false);
	});

	it("plat.platsup masque aussi le quai, et plat.conf le marque confirmé sans le publier", () => {
		const train = makeTrain();
		const context = createContext(makeConfiguration(), noopPublisher);
		context.trains.set(train);

		handleTrainStatus(
			context,
			{ rid: train.rid, ssd: train.ssd, Location: [{ tpl: "A", plat: { "": "4", platsup: true, conf: true } }] },
			makeEnvelope(),
		);

		expect(isPlatformHidden(train.calls[0] as Call)).toBe(true);
		expect(train.calls[0]?.platformConfirmed).toBe(true);
	});

	it("un message ne portant QUE `plat` ne lève pas un masquage posé par `suppr`", () => {
		// Les deux sources de masquage (plat.platsup, suppr) sont indépendantes. Les recombiner à
		// partir du seul message courant traiterait la source absente comme fausse : un quai supprimé
		// par l'exploitant réapparaîtrait au voyageur dès le message suivant.
		const train = makeTrain();
		const context = createContext(makeConfiguration(), noopPublisher);
		context.trains.set(train);

		handleTrainStatus(
			context,
			{ rid: train.rid, ssd: train.ssd, Location: [{ tpl: "A", plat: "5", suppr: true }] },
			makeEnvelope(),
		);
		expect(isPlatformHidden(train.calls[0] as Call)).toBe(true);

		// Message suivant : il parle du quai, mais ne dit rien de `suppr`.
		handleTrainStatus(context, { rid: train.rid, ssd: train.ssd, Location: [{ tpl: "A", plat: "5" }] }, makeEnvelope());
		expect(isPlatformHidden(train.calls[0] as Call)).toBe(true);
	});

	it("symétriquement, un message ne portant QUE `suppr` ne lève pas un masquage posé par plat.platsup", () => {
		const train = makeTrain();
		const context = createContext(makeConfiguration(), noopPublisher);
		context.trains.set(train);

		handleTrainStatus(
			context,
			{ rid: train.rid, ssd: train.ssd, Location: [{ tpl: "A", plat: { "": "5", platsup: true } }] },
			makeEnvelope(),
		);
		expect(isPlatformHidden(train.calls[0] as Call)).toBe(true);

		handleTrainStatus(
			context,
			{ rid: train.rid, ssd: train.ssd, Location: [{ tpl: "A", suppr: false }] },
			makeEnvelope(),
		);
		expect(isPlatformHidden(train.calls[0] as Call)).toBe(true);
	});

	it("chaque source reste levable par un message qui la mentionne explicitement", () => {
		const train = makeTrain();
		const context = createContext(makeConfiguration(), noopPublisher);
		context.trains.set(train);

		handleTrainStatus(
			context,
			{ rid: train.rid, ssd: train.ssd, Location: [{ tpl: "A", plat: "5", suppr: true }] },
			makeEnvelope(),
		);
		expect(isPlatformHidden(train.calls[0] as Call)).toBe(true);

		handleTrainStatus(
			context,
			{ rid: train.rid, ssd: train.ssd, Location: [{ tpl: "A", suppr: false }] },
			makeEnvelope(),
		);
		expect(isPlatformHidden(train.calls[0] as Call)).toBe(false);
	});

	it("un champ absent ne remet jamais un champ existant à zéro", () => {
		const train = makeTrain();
		train.calls[0] = makeCall({
			tiploc: "A",
			order: 0,
			platform: "9",
			platformSuppressed: true,
			locationSuppressed: false,
			actualArrival: 555,
		});
		const context = createContext(makeConfiguration(), noopPublisher);
		context.trains.set(train);

		// Message ne portant AUCUNE information de quai ni d'arrivée pour cette location.
		handleTrainStatus(
			context,
			{ rid: train.rid, ssd: train.ssd, Location: [{ tpl: "A", dep: { at: "10:00:00" } }] },
			makeEnvelope(),
		);

		expect(train.calls[0]?.platform).toBe("9");
		expect(isPlatformHidden(train.calls[0] as Call)).toBe(true);
		expect(train.calls[0]?.actualArrival).toBe(555);
		expect(train.calls[0]?.actualDeparture).toBeDefined();
	});

	it("lateReason et cancelReason sont attachés à la dernière location du message uniquement", () => {
		const train = makeTrain();
		const context = createContext(makeConfiguration(), noopPublisher);
		context.trains.set(train);

		handleTrainStatus(
			context,
			{
				rid: train.rid,
				ssd: train.ssd,
				lateReason: "42",
				Location: [
					{ tpl: "A", dep: { at: "10:00:00" } },
					{ tpl: "B", dep: { at: "10:10:00" } },
				],
			},
			makeEnvelope(),
		);

		expect(train.calls[0]?.lateReason).toBeUndefined();
		expect(train.calls[1]?.lateReason).toBe(42);
	});

	it("train.lastObservedAt reprend le ts de l'enveloppe, ou l'heure courante si absent, et mémorise le message", () => {
		const train = makeTrain();
		const context = createContext(makeConfiguration(), noopPublisher);
		context.trains.set(train);
		const message = { rid: train.rid, ssd: train.ssd, Location: [{ tpl: "A", dep: { at: "10:00:00" } }] };

		handleTrainStatus(context, message, makeEnvelope({ observedAtMs: 999 }));

		expect(train.lastObservedAt).toBe(999);
		expect(train.lastStatusMessage).toEqual(message);
	});
});
