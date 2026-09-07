// Chargement de la configuration d'exécution

import { resolve } from "node:path";
import { cwd } from "node:process";

import type { Configuration } from "./configuration.js";

type ConfigurationFile = Partial<Configuration>;

/** Champs sans lesquels le provider ne peut pas fonctionner. */
const REQUIRED_FIELDS = [
	"id",
	"gcsBucket",
	"kafkaTopic",
	"kafkaBrokers",
	"kafkaSasl",
	"kafkaGroupId",
	"getNetworkRef",
	"computeDelayMs",
	"showDeparturesWithinMs",
	"keepAfterArrivalMs",
] as const satisfies readonly (keyof Configuration)[];

/** Les brokers se lisent comme une liste séparée par des virgules. */
function splitBrokers(value: string): string[] {
	return value
		.split(",")
		.map((broker) => broker.trim())
		.filter((broker) => broker.length > 0);
}

/** Superpose les variables d'environnement au fichier : l'environnement l'emporte toujours. */
function applyEnvironment(file: ConfigurationFile, env: NodeJS.ProcessEnv): ConfigurationFile {
	const brokers = env.DARWIN_KAFKA_BROKERS;
	const groupId = env.DARWIN_KAFKA_GROUP_ID;
	const username = env.DARWIN_KAFKA_SASL_USERNAME;
	const password = env.DARWIN_KAFKA_SASL_PASSWORD;
	const gcsKeyFile = env.GOOGLE_APPLICATION_CREDENTIALS;

	return {
		...file,
		kafkaBrokers: brokers !== undefined ? splitBrokers(brokers) : file.kafkaBrokers,
		kafkaGroupId: groupId ?? file.kafkaGroupId,
		kafkaSasl: {
			username: username ?? file.kafkaSasl?.username ?? "",
			password: password ?? file.kafkaSasl?.password ?? "",
		},
		gcsKeyFile: gcsKeyFile ?? file.gcsKeyFile,
	};
}

function assertComplete(configuration: ConfigurationFile): asserts configuration is Configuration {
	const missing = REQUIRED_FIELDS.filter((field) => configuration[field] === undefined);
	if (missing.length > 0) {
		throw new Error(`Missing required configuration field(s): ${missing.join(", ")}.`);
	}
}

export async function loadConfiguration(path: string): Promise<Configuration> {
	const resolvedPath = resolve(cwd(), path);
	try {
		const module = (await import(resolvedPath)) as { default?: ConfigurationFile };
		const configuration = applyEnvironment(module.default ?? {}, process.env);
		assertComplete(configuration);
		return configuration;
	} catch (cause) {
		throw new Error(`Unable to load configuration at '${resolvedPath}'.`, { cause });
	}
}
