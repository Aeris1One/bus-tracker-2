import { describe, expect, it } from "vitest";

import type { Configuration } from "../../configuration/configuration.js";
import { createContext } from "../../context.js";
import type { Publisher } from "../../publish/publisher.js";
import { handleAssociation } from "./handle-association.js";

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

const NP = {
	category: "NP",
	tiploc: "RDNGSTN",
	main: { rid: "202609060001", wta: "10:00", wtd: "10:02", pta: "10:00", ptd: "10:02" },
	assoc: { rid: "202609060002" },
};

/** `Publisher` (L11) est concret : ces tests portent sur les handlers, jamais sur la
 * publication elle-même ; un double neutre suffit à satisfaire le type. */
const noopPublisher: Publisher = {
	publishJourneys: async () => 0,
	publishShapes: async () => {},
	resetKeyRegistry: () => {},
};

describe("handleAssociation", () => {
	it("enregistre l'association sous LES DEUX rid", () => {
		const context = createContext(makeConfiguration(), noopPublisher);

		handleAssociation(context, { ...NP });

		expect(context.associations.forRid("202609060001")).toHaveLength(1);
		expect(context.associations.forRid("202609060002")).toHaveLength(1);
	});

	it.each(["JJ", "VV"])("ignore la catégorie %s : elle n'a aucun effet observable en sortie", (category) => {
		const context = createContext(makeConfiguration(), noopPublisher);

		handleAssociation(context, { ...NP, category });

		expect(context.associations.forRid("202609060001")).toHaveLength(0);
	});

	it("lit chaque champ aussi bien comme attribut préfixé `@_`", () => {
		const context = createContext(makeConfiguration(), noopPublisher);

		handleAssociation(context, {
			"@_category": "NP",
			"@_tiploc": "RDNGSTN",
			main: { "@_rid": "202609060001", "@_wtd": "10:02" },
			assoc: { "@_rid": "202609060002" },
		});

		const [association] = context.associations.forRid("202609060001");
		expect(association?.assocRid).toBe("202609060002");
		expect(association?.tiploc).toBe("RDNGSTN");
		expect(association?.wtd).toBe("10:02");
	});

	it("`wtd` et `ptd` retombent sur ceux de `assoc` quand ils manquent dans `main`", () => {
		const context = createContext(makeConfiguration(), noopPublisher);

		handleAssociation(context, {
			category: "NP",
			tiploc: "RDNGSTN",
			main: { rid: "202609060001" },
			assoc: { rid: "202609060002", wtd: "10:05", ptd: "10:05" },
		});

		const [association] = context.associations.forRid("202609060001");
		expect(association?.wtd).toBe("10:05");
		expect(association?.ptd).toBe("10:05");
	});

	it.each([
		["main.rid", { category: "NP", tiploc: "R", main: {}, assoc: { rid: "202609060002" } }],
		["assoc.rid", { category: "NP", tiploc: "R", main: { rid: "202609060001" }, assoc: {} }],
	])("ignore le message quand %s manque", (_, message) => {
		const context = createContext(makeConfiguration(), noopPublisher);

		handleAssociation(context, message);

		expect(context.associations.forRid("202609060001")).toHaveLength(0);
		expect(context.associations.forRid("202609060002")).toHaveLength(0);
	});

	it("évite le doublon sur le triplet (mainRid, assocRid, tiploc)", () => {
		const context = createContext(makeConfiguration(), noopPublisher);

		handleAssociation(context, { ...NP });
		handleAssociation(context, { ...NP });

		expect(context.associations.forRid("202609060001")).toHaveLength(1);
	});

	it("un même couple à un TIPLOC différent est bien une seconde association", () => {
		const context = createContext(makeConfiguration(), noopPublisher);

		handleAssociation(context, { ...NP });
		handleAssociation(context, { ...NP, tiploc: "SWNDON" });

		expect(context.associations.forRid("202609060001")).toHaveLength(2);
	});
});
