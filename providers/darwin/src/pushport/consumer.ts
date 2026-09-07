// Connexion Kafka au Push Port

import { Kafka } from "kafkajs";

import type { ProviderContext } from "../context.js";
import { logger } from "../utils/logger.js";
import { dispatch } from "./dispatch.js";
import { readEnvelope } from "./envelope.js";
import { createSequenceTracker } from "./sequence-tracker.js";

export type Consumer = { start(): Promise<void>; stop(): Promise<void> };

export function createConsumer(context: ProviderContext): Consumer {
	const { kafkaBrokers, kafkaTopic, kafkaGroupId, kafkaSasl } = context.configuration;

	const kafka = new Kafka({
		clientId: process.env.DARWIN_KAFKA_CLIENT_ID ?? "bus-tracker-darwin",
		brokers: kafkaBrokers,
		ssl: true,
		sasl: { mechanism: "plain", username: kafkaSasl.username, password: kafkaSasl.password },
	});

	// `groupId` est imposé par les ACL du fournisseur
	const consumer = kafka.consumer({ groupId: kafkaGroupId });
	const sequenceTracker = createSequenceTracker();
	const startedAtMs = Date.now();

	return {
		async start() {
			await consumer.connect();

			consumer.on(consumer.events.GROUP_JOIN, () => {
				logger.info("Groupe Kafka rejoint après %d ms", Date.now() - startedAtMs);
			});

			// fromBeginning: false, et aucun repositionnement explicite des offsets : le groupe est
			// imposé par ACL et peut être partagé.
			await consumer.subscribe({ topic: kafkaTopic, fromBeginning: false });

			await consumer.run({
				eachMessage: async ({ message }) => {
					try {
						const envelope = readEnvelope(message.value);
						if (envelope === undefined) {
							return;
						}

						if (envelope.sequence !== undefined) {
							sequenceTracker.observe(envelope.sequence, Date.now());
						}

						dispatch(context, envelope);

						if (envelope.isSnapshot) {
							sequenceTracker.clearGap();
						}
					} catch (error) {
						logger.failure("Erreur de traitement d'un message Push Port : %s", error);
						context.counters.increment("pushPortProcessingErrors");
					}
				},
			});
		},
		async stop() {
			await consumer.disconnect();
		},
	};
}
