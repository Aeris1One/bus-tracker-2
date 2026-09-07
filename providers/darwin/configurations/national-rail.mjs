/** @type {import('../src/configuration/configuration.ts').Configuration} */
export default {
	id: "national-rail",
	computeDelayMs: 30_000,
	gcsBucket: "raildata-uk",
	// Variante JSON du flux Push Port ; -AVRO et -XML portent le même flux sous d'autres encodages.
	kafkaTopic: "prod-1010-Darwin-Train-Information-Push-Port-IIII2_0-JSON",
	// Identifiants fournis par l'environnement mais peuvent aussi être écrits ici.
	kafkaBrokers: [], // DARWIN_KAFKA_BROKERS
	kafkaGroupId: "", // DARWIN_KAFKA_GROUP_ID
	kafkaSasl: { username: "", password: "" }, // DARWIN_KAFKA_SASL_USERNAME et DARWIN_KAFKA_SASL_PASSWORD
	showDeparturesWithinMs: 600_000,
	keepAfterArrivalMs: 300_000,
	shapePaths: true,
	getNetworkRef: (train) => `NR:${train?.toc.trim() || "UNKNOWN"}`,
};
