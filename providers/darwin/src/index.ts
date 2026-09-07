// Amorçage du provider, boucle de publication et arrêt. Ce fichier est délibérément le moins
// abstrait du projet : il se lit de haut en bas comme la séquence complète, sans indirection.

import "dotenv/config";

import { setTimeout } from "node:timers/promises";
import { captureException, initMonitoring, shutdownMonitoring } from "@bus-tracker/monitoring";
import { createClient } from "redis";

import { createObjectStore } from "./bucket/object-store.js";
import { loadConfiguration } from "./configuration/load-configuration.js";
import { CYCLE_MAX_WAIT_MS, CYCLE_MIN_WAIT_MS, PUBLISH_WATCHDOG_MS, SWEEP_INTERVAL_MS } from "./constants.js";
import { createContext } from "./context.js";
import { loadResources } from "./jobs/load-resources.js";
import { runPublishCycle } from "./jobs/publish-cycle.js";
import { refreshTimetableIfNeeded } from "./jobs/refresh-timetable.js";
import { sweep } from "./jobs/sweep.js";
import { configurationPath } from "./options.js";
import { createPublisher } from "./publish/publisher.js";
import { createConsumer } from "./pushport/consumer.js";
import { checkShapeQuality } from "./shapes/shape-quality.js";
import { createCounters } from "./state/counters.js";
import { logger } from "./utils/logger.js";

console.log("Bus Tracker — Darwin (National Rail) processor\n");

// 1. Chargement de la conf
const configuration = await loadConfiguration(configurationPath);

// 2. Télémétrie
initMonitoring(`processor-darwin:${configuration.id}`);

// 3. Connexion Redis
logger.step("connexion à Redis.");
const redis = createClient({
	socket: process.env.REDIS_SOCK ? { path: process.env.REDIS_SOCK, tls: process.env.REDIS_TLS === "true" } : undefined,
	url: process.env.REDIS_SOCK ? undefined : (process.env.REDIS_URL ?? "redis://127.0.0.1:6379"),
});
redis.on("error", (error) => {
	logger.failure("erreur Redis : %s", String(error));
	captureException(error);
});
await redis.connect();
const channel = process.env.REDIS_CHANNEL ?? "journeys";
logger.success("connecté à Redis ; publication sur le canal '%s'.", channel);

const publisher = createPublisher(redis, channel, createCounters());
const context = createContext(configuration, publisher);

const dataDir = process.env.DATA_DIR ?? "/data";
const store = createObjectStore(configuration.gcsBucket, configuration.gcsKeyFile);

// 4. Chargement des ressources statiques
// En cas d'erreur, on continue quand-même, le temps-réel devrait fonctionner et le
// rafraichissement chaque nuit réessayera
try {
	await loadResources(context, store, dataDir);
} catch (error) {
	logger.failure("échec du chargement initial des ressources : %s", String(error));
	captureException(error);
}

// 5. Connexion PushPort
const consumer = createConsumer(context);
consumer.start().catch((error: unknown) => {
	logger.failure("échec du démarrage de la consommation Push Port : %s", String(error));
	captureException(error);
});

// 6. Boucle et arrêt.
let stopping = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
	if (stopping) {
		return;
	}
	stopping = true;

	logger.step("arrêt demandé (%s).", signal);
	try {
		await consumer.stop();
	} catch (error) {
		logger.failure("échec de l'arrêt de la consommation Push Port : %s", String(error));
	}
	await shutdownMonitoring();
	await redis.quit();
	process.exit(0);
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

let lastSweepAtMs = Date.now();

while (!stopping) {
	logger.step("entrée dans un nouveau cycle.");

	// Rafraichir les données statiques si besoin
	try {
		await refreshTimetableIfNeeded(context, store, dataDir, Date.now());
	} catch (error) {
		logger.failure("échec inattendu du rafraîchissement des horaires : %s", String(error));
		captureException(error);
	}

	// Purge
	if (Date.now() - lastSweepAtMs > SWEEP_INTERVAL_MS) {
		sweep(context, Date.now());
		lastSweepAtMs = Date.now();
	}

	// Publication, watchdog de 30 s
	const cycleStartedAtMs = Date.now();
	try {
		let timedOut = false;
		await Promise.race([
			runPublishCycle(context),
			setTimeout(PUBLISH_WATCHDOG_MS).then(() => {
				timedOut = true;
			}),
		]);

		if (timedOut) {
			const timeoutError = new Error(`Limite de temps de publication dépassé (${PUBLISH_WATCHDOG_MS} ms).`);
			logger.failure("%s", timeoutError.message);
			captureException(timeoutError);
			await shutdownMonitoring();
			process.exit(1);
		}
	} catch (error) {
		logger.failure("échec du cycle de publication : %s", String(error));
		captureException(error);
	}
	const cycleDurationMs = Date.now() - cycleStartedAtMs;

	// Contrôle qualité des tracés
	checkShapeQuality(context.counters);

	const waitMs = Math.min(
		CYCLE_MAX_WAIT_MS,
		Math.max(CYCLE_MIN_WAIT_MS, configuration.computeDelayMs - cycleDurationMs),
	);
	logger.step("cycle terminé en %d ms, attente de %d ms.", cycleDurationMs, waitMs);
	try {
		await setTimeout(waitMs);
	} catch {
	}
}
