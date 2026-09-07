import { describe, expect, it } from "vitest";

import type { Association } from "../domain/destination.js";
import { createAssociationStore } from "./association-store.js";

function makeAssociation(overrides: Partial<Association> = {}): Association {
	return {
		mainRid: "MAIN1",
		assocRid: "ASSOC1",
		tiploc: "JUNCT",
		...overrides,
	};
}

describe("createAssociationStore", () => {
	it("enregistre l'association sous les deux RID", () => {
		const store = createAssociationStore();
		const association = makeAssociation();
		store.add(association);

		expect(store.forRid("MAIN1")).toEqual([association]);
		expect(store.forRid("ASSOC1")).toEqual([association]);
	});

	it("refuse le doublon sur le triplet (mainRid, assocRid, tiploc)", () => {
		const store = createAssociationStore();
		store.add(makeAssociation());
		store.add(makeAssociation());

		expect(store.forRid("MAIN1")).toHaveLength(1);
		expect(store.forRid("ASSOC1")).toHaveLength(1);
	});

	it("deux associations différant par le TIPLOC restent distinctes", () => {
		const store = createAssociationStore();
		store.add(makeAssociation({ tiploc: "A" }));
		store.add(makeAssociation({ tiploc: "B" }));

		expect(store.forRid("MAIN1")).toHaveLength(2);
	});

	it("forRid d'un RID inconnu rend un tableau vide", () => {
		const store = createAssociationStore();
		expect(store.forRid("UNKNOWN")).toEqual([]);
	});

	it("prune élague les associations référençant un RID supprimé", () => {
		const store = createAssociationStore();
		store.add(makeAssociation({ mainRid: "KEEP1", assocRid: "KEEP2" }));
		store.add(makeAssociation({ mainRid: "GONE", assocRid: "KEEP2", tiploc: "OTHER" }));

		store.prune((rid) => rid !== "GONE");

		expect(store.forRid("KEEP1")).toHaveLength(1);
		// La liste sous KEEP2 ne conserve que l'association dont les deux RID sont connus.
		expect(store.forRid("KEEP2")).toEqual([{ mainRid: "KEEP1", assocRid: "KEEP2", tiploc: "JUNCT" }]);
		expect(store.forRid("GONE")).toEqual([]);
	});

	it("prune supprime les listes devenues vides", () => {
		const store = createAssociationStore();
		store.add(makeAssociation({ mainRid: "M", assocRid: "A" }));

		store.prune(() => false);

		expect(store.forRid("M")).toEqual([]);
		expect(store.forRid("A")).toEqual([]);
	});
});
