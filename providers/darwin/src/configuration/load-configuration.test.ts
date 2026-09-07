import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { loadConfiguration } from "./load-configuration.js";

/**
 * Écrit une configuration de test dans un répertoire temporaire.
 */
function writeConfigFile(body: string): string {
	const dir = mkdtempSync(join(tmpdir(), "darwin-config-"));
	const path = join(dir, "config.mjs");
	writeFileSync(path, body);
	return path;
}

const BASE_CONFIGURATION = `
export default {
	id: "test",
	gcsBucket: "bucket",
	kafkaTopic: "topic",
	kafkaGroupId: "imposed-group",
	computeDelayMs: 30_000,
	showDeparturesWithinMs: 600_000,
	keepAfterArrivalMs: 300_000,
	getNetworkRef: () => "NR:UNKNOWN",
};
`;

describe("loadConfiguration", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("charge une configuration complète et valide sans variable d'environnement", async () => {
		vi.stubEnv("DARWIN_KAFKA_BROKERS", undefined);
		const path = writeConfigFile(BASE_CONFIGURATION);

		const configuration = await loadConfiguration(path);

		expect(configuration.id).toBe("test");
		expect(configuration.kafkaGroupId).toBe("imposed-group");
	});

	it("superpose les variables d'environnement Kafka", async () => {
		vi.stubEnv("DARWIN_KAFKA_BROKERS", "broker-a:9092,broker-b:9092");
		vi.stubEnv("DARWIN_KAFKA_GROUP_ID", "from-darwin-env");
		vi.stubEnv("DARWIN_KAFKA_SASL_USERNAME", "darwin-user");
		vi.stubEnv("DARWIN_KAFKA_SASL_PASSWORD", "darwin-pass");
		const path = writeConfigFile(BASE_CONFIGURATION);

		const configuration = await loadConfiguration(path);

		expect(configuration.kafkaBrokers).toEqual(["broker-a:9092", "broker-b:9092"]);
		expect(configuration.kafkaGroupId).toBe("from-darwin-env");
		expect(configuration.kafkaSasl).toEqual({ username: "darwin-user", password: "darwin-pass" });
	});

	it("lit les brokers comme une liste séparée par des virgules, en retirant les espaces", async () => {
		vi.stubEnv("DARWIN_KAFKA_BROKERS", " broker-a:9092 , broker-b:9092 ,broker-c:9092");
		const path = writeConfigFile(BASE_CONFIGURATION);

		const configuration = await loadConfiguration(path);

		expect(configuration.kafkaBrokers).toEqual(["broker-a:9092", "broker-b:9092", "broker-c:9092"]);
	});

	it("gcsKeyFile retombe sur GOOGLE_APPLICATION_CREDENTIALS", async () => {
		vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS", "/secrets/service-account.json");
		const path = writeConfigFile(BASE_CONFIGURATION);

		const configuration = await loadConfiguration(path);

		expect(configuration.gcsKeyFile).toBe("/secrets/service-account.json");
	});

	it("gcsKeyFile explicite dans le fichier l'emporte sur l'absence de variable d'environnement", async () => {
		vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS", undefined);
		const path = writeConfigFile(`
			export default {
				id: "test",
				gcsBucket: "bucket",
				gcsKeyFile: "/local/service-account.json",
				kafkaTopic: "topic",
				kafkaGroupId: "imposed-group",
				computeDelayMs: 30_000,
				showDeparturesWithinMs: 600_000,
				keepAfterArrivalMs: 300_000,
				getNetworkRef: () => "NR:UNKNOWN",
			};
		`);

		const configuration = await loadConfiguration(path);

		expect(configuration.gcsKeyFile).toBe("/local/service-account.json");
	});

	it("refuse une configuration à laquelle il manque un champ obligatoire", async () => {
		const path = writeConfigFile(`
			export default {
				id: "test",
				gcsBucket: "bucket",
				kafkaTopic: "topic",
				// kafkaGroupId manquant
				computeDelayMs: 30_000,
				showDeparturesWithinMs: 600_000,
				keepAfterArrivalMs: 300_000,
				getNetworkRef: () => "NR:UNKNOWN",
			};
		`);

		await expect(loadConfiguration(path)).rejects.toThrow(`Unable to load configuration at '${path}'.`);
	});

	it("le cause de l'erreur porte le détail du champ manquant", async () => {
		const path = writeConfigFile(`
			export default {
				id: "test",
				gcsBucket: "bucket",
				kafkaTopic: "topic",
				computeDelayMs: 30_000,
				showDeparturesWithinMs: 600_000,
				keepAfterArrivalMs: 300_000,
				getNetworkRef: () => "NR:UNKNOWN",
			};
		`);

		try {
			await loadConfiguration(path);
			expect.unreachable("loadConfiguration aurait dû lever");
		} catch (error) {
			expect(error).toBeInstanceOf(Error);
			expect((error as Error).cause).toBeInstanceOf(Error);
			expect(((error as Error).cause as Error).message).toContain("kafkaGroupId");
		}
	});

	it("refuse un chemin de configuration inexistant", async () => {
		const path = join(tmpdir(), "does-not-exist-darwin-config.mjs");

		await expect(loadConfiguration(path)).rejects.toThrow(`Unable to load configuration at '${path}'.`);
	});
});
