import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { loadReference } from "./load-reference.js";
import type { ObjectStore } from "./object-store.js";

const REFERENCE_XML = `<?xml version="1.0"?>
<PportTimetableRef>
	<LocationRef tpl="BHM" locname="Birmingham New Street" crs="BHM" toc="LM"/>
	<LocationRef tpl="EUS" locname="London Euston"/>
	<TocRef toc="VT" tocname="Avanti West Coast" url="https://example.invalid"/>
	<Via at="MKC" dest="EUS" loc1="BHM" loc2="WFJ" viatext="via Milton Keynes"/>
	<LateRunningReasons>
		<Reason code="42" reasontext="Signalling problems"/>
	</LateRunningReasons>
	<CancellationReasons>
		<Reason code="7" reasontext="Fatality"/>
	</CancellationReasons>
</PportTimetableRef>`;

/** Double en mémoire d'`ObjectStore` : aucun accès réseau dans les tests. */
function createInMemoryStore(files: Record<string, Buffer>): ObjectStore {
	return {
		async list(prefix) {
			return Object.keys(files).filter((name) => name.startsWith(prefix));
		},
		async download(name) {
			const buffer = files[name];
			if (buffer === undefined) {
				throw new Error(`objet inconnu : ${name}`);
			}
			return buffer;
		},
	};
}

describe("loadReference", () => {
	it("extrait les cinq familles d'éléments", async () => {
		const store = createInMemoryStore({
			"PPTimetable/20260825064431_ref_v8.xml.gz": gzipSync(REFERENCE_XML),
		});

		const reference = await loadReference(store);

		expect(reference.places.get("BHM")).toEqual({ tiploc: "BHM", name: "Birmingham New Street", crs: "BHM" });
		expect(reference.places.get("EUS")).toEqual({ tiploc: "EUS", name: "London Euston", crs: undefined });
		expect(reference.operators.get("VT")).toBe("Avanti West Coast");
		expect(reference.vias.get("MKC|EUS|BHM|WFJ")).toBe("via Milton Keynes");
		expect(reference.lateReasons.get(42)).toBe("Signalling problems");
		expect(reference.cancellationReasons.get(7)).toBe("Fatality");
	});

	it("retient le référentiel de date la plus récente, puis de version la plus élevée", async () => {
		const store = createInMemoryStore({
			"PPTimetable/20260101000000_ref_v9.xml.gz": gzipSync(REFERENCE_XML.replace("Birmingham New Street", "OLD")),
			"PPTimetable/20260825064431_ref_v8.xml.gz": gzipSync(REFERENCE_XML),
			// Fichier d'horaires (pas de référentiel) : ne doit jamais être sélectionné ici.
			"PPTimetable/20260825064431_v8.xml.gz": gzipSync("<PportTimetable/>"),
		});

		const reference = await loadReference(store);

		expect(reference.places.get("BHM")?.name).toBe("Birmingham New Street");
	});

	it("échoue quand aucun référentiel n'est trouvé", async () => {
		const store = createInMemoryStore({});
		await expect(loadReference(store)).rejects.toThrow();
	});
});
