// Publication sur Redis

import type { VehicleJourney } from "@bus-tracker/contracts";
import { vehicleJourneySchema } from "@bus-tracker/contracts";
import { type } from "arktype";

import { PUBLISH_CHUNK_SIZE, SHAPE_KEY_REGISTRY_TTL_MS } from "../constants.js";
import type { Shape } from "../domain/shape.js";
import type { Counters } from "../state/counters.js";
import { createPublishedKeyStore } from "../state/published-key-store.js";
import { logger } from "../utils/logger.js";

export type RedisMulti = {
	set(key: string, value: string, options: { EX: number }): RedisMulti;
	exec(): Promise<unknown>;
};

export type RedisClient = {
	publish(channel: string, message: string): Promise<number>;
	multi(): RedisMulti;
};

export type Publisher = {
	publishJourneys(journeys: VehicleJourney[]): Promise<number>;
	publishShapes(shapes: Iterable<Shape>, nowMs: number): Promise<void>;
	resetKeyRegistry(): void;
};

export function createPublisher(redis: RedisClient, channel: string, counters: Counters): Publisher {
	const publishedKeys = createPublishedKeyStore();

	return {
		async publishJourneys(journeys) {
			const valid: VehicleJourney[] = [];
			let firstErrorLogged = false;

			// Valider contre le schéma de @bus-tracker/contracts
			for (const journey of journeys) {
				const result = vehicleJourneySchema(journey);
				if (result instanceof type.errors) {
					counters.increment("publish:invalid");
					// On logue uniquement la première erreur pour ne pas spam
					if (!firstErrorLogged) {
						logger.failure("entrée rejetée par vehicleJourneySchema pour %s : %s", journey.id, String(result));
						firstErrorLogged = true;
					}
					continue;
				}
				valid.push(journey);
			}

			// Diviser en chunks
			for (let index = 0; index < valid.length; index += PUBLISH_CHUNK_SIZE) {
				const chunk = valid.slice(index, index + PUBLISH_CHUNK_SIZE);
				await redis.publish(channel, JSON.stringify(chunk));
			}

			return valid.length;
		},

		async publishShapes(shapes, nowMs) {
			// Une clé est réécrite si elle n'a jamais été écrite, ou si sa
			// dernière écriture remonte à plus de `SHAPE_KEY_REWRITE_MS`
			const toWrite: Shape[] = [];
			for (const shape of shapes) {
				if (publishedKeys.shouldWrite(shape.redisKey, nowMs)) {
					toWrite.push(shape);
				} 
			}

			if (toWrite.length > 0) {
				// Une seule transaction
				const multi = redis.multi();
				for (const shape of toWrite) {
					// `EX` attend des secondes ; la constante partagée est en millisecondes.
					multi.set(shape.redisKey, shape.toPayload(), { EX: SHAPE_KEY_REGISTRY_TTL_MS / 1000 });
				}
				await multi.exec();
				for (const shape of toWrite) {
					publishedKeys.markWritten(shape.redisKey, nowMs);
				}
			}

			publishedKeys.evict(nowMs);
		},

		resetKeyRegistry() {
			publishedKeys.clear();
		},
	};
}
