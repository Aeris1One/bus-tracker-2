import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { loadTimetable, peekTimetableId } from "./load-timetable.js";
import type { ObjectStore } from "./object-store.js";

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

function timetableStore(xml: string, name = "PPTimetable/20260825064431_v8.xml.gz"): ObjectStore {
	return createInMemoryStore({ [name]: gzipSync(xml) });
}

describe("loadTimetable", () => {
	it("préserve l'ordre du document, y compris entre points de tags différents", async () => {
		// OR, IP, PP, IP, DT imbriqués : un analyseur qui regrouperait par tag romprait cet ordre
		// chronologique.
		const xml = `<PportTimetable timetableID="20260825064431">
			<Journey rid="R1" ssd="2026-08-25">
				<OR tpl="AAA" wtd="10:00:00"/>
				<IP tpl="BBB" wta="10:10:00" wtd="10:11:00"/>
				<PP tpl="CCC" wtp="10:15:00"/>
				<IP tpl="DDD" wta="10:20:00" wtd="10:21:00"/>
				<DT tpl="EEE" wta="10:30:00"/>
			</Journey>
		</PportTimetable>`;

		const { trains } = await loadTimetable(timetableStore(xml));

		expect(trains).toHaveLength(1);
		expect(trains[0]?.calls.map((call) => call.tiploc)).toEqual(["AAA", "BBB", "CCC", "DDD", "EEE"]);
		expect(trains[0]?.calls.map((call) => call.order)).toEqual([0, 1, 2, 3, 4]);
	});

	it("extrait le timetableId depuis la suite de chiffres en tête du nom de fichier", async () => {
		const xml = `<PportTimetable><Journey rid="R1" ssd="2026-08-25"><OR tpl="AAA"/><DT tpl="BBB"/></Journey></PportTimetable>`;
		const { timetableId } = await loadTimetable(timetableStore(xml, "PPTimetable/20260825064431_v8.xml.gz"));
		expect(timetableId).toBe("20260825064431");
	});

	it('applique les valeurs par défaut (uid, trainId, toc = "", ssd dérivée du RID)', async () => {
		const xml = `<PportTimetable><Journey rid="20260825123456AB"><OR tpl="AAA"/><DT tpl="BBB"/></Journey></PportTimetable>`;
		const { trains } = await loadTimetable(timetableStore(xml));
		const [train] = trains;
		expect(train?.uid).toBe("");
		expect(train?.trainId).toBe("");
		expect(train?.toc).toBe("");
		// SSD absente : dérivée des 8 premiers caractères du RID.
		expect(train?.ssd).toBe("2026-08-25");
	});

	it("ignore un train dont le rid est absent", async () => {
		const xml = `<PportTimetable>
			<Journey ssd="2026-08-25"><OR tpl="AAA"/><DT tpl="BBB"/></Journey>
			<Journey rid="R2" ssd="2026-08-25"><OR tpl="CCC"/><DT tpl="DDD"/></Journey>
		</PportTimetable>`;
		const { trains } = await loadTimetable(timetableStore(xml));
		expect(trains.map((train) => train.rid)).toEqual(["R2"]);
	});

	it("ignore un point de desserte dont le tpl est absent", async () => {
		const xml = `<PportTimetable>
			<Journey rid="R1" ssd="2026-08-25">
				<OR tpl="AAA"/>
				<IP act="TB"/>
				<DT tpl="BBB"/>
			</Journey>
		</PportTimetable>`;
		const { trains } = await loadTimetable(timetableStore(xml));
		expect(trains[0]?.calls.map((call) => call.tiploc)).toEqual(["AAA", "BBB"]);
	});

	it("ignore un élément dont le nom de balise n'est pas un tag connu", async () => {
		const xml = `<PportTimetable>
			<Journey rid="R1" ssd="2026-08-25">
				<OR tpl="AAA"/>
				<Unknown tpl="ZZZ"/>
				<DT tpl="BBB"/>
			</Journey>
		</PportTimetable>`;
		const { trains } = await loadTimetable(timetableStore(xml));
		expect(trains[0]?.calls.map((call) => call.tiploc)).toEqual(["AAA", "BBB"]);
	});

	describe("suppression d'un train", () => {
		it.each(["B", "F", "S"])("un train de mode %s (majuscule) n'existe jamais", async (status) => {
			const xml = `<PportTimetable><Journey rid="R1" ssd="2026-08-25" status="${status}"><OR tpl="AAA"/><DT tpl="BBB"/></Journey></PportTimetable>`;
			const { trains } = await loadTimetable(timetableStore(xml));
			expect(trains).toHaveLength(0);
		});

		it("un mode en minuscule n'est pas une suppression (comparaison exacte)", async () => {
			const xml = `<PportTimetable><Journey rid="R1" ssd="2026-08-25" status="b"><OR tpl="AAA"/><DT tpl="BBB"/></Journey></PportTimetable>`;
			const { trains } = await loadTimetable(timetableStore(xml));
			expect(trains).toHaveLength(1);
		});

		it("un train marqué supprimé (deleted) n'existe jamais", async () => {
			const xml = `<PportTimetable><Journey rid="R1" ssd="2026-08-25" deleted="true"><OR tpl="AAA"/><DT tpl="BBB"/></Journey></PportTimetable>`;
			const { trains } = await loadTimetable(timetableStore(xml));
			expect(trains).toHaveLength(0);
		});

		it("un train annulé (can) est bien créé : ce n'est pas une suppression", async () => {
			const xml = `<PportTimetable><Journey rid="R1" ssd="2026-08-25" can="true"><OR tpl="AAA"/><DT tpl="BBB"/></Journey></PportTimetable>`;
			const { trains } = await loadTimetable(timetableStore(xml));
			expect(trains).toHaveLength(1);
			expect(trains[0]?.cancelled).toBe(true);
		});
	});

	it("ne confond jamais le fichier d'horaires avec le référentiel (_ref_)", async () => {
		const store = createInMemoryStore({
			"PPTimetable/20260101000000_ref_v9.xml.gz": gzipSync("<PportTimetableRef/>"),
			"PPTimetable/20260825064431_v8.xml.gz": gzipSync(
				`<PportTimetable><Journey rid="R1" ssd="2026-08-25"><OR tpl="AAA"/><DT tpl="BBB"/></Journey></PportTimetable>`,
			),
		});
		const { timetableId, trains } = await loadTimetable(store);
		expect(timetableId).toBe("20260825064431");
		expect(trains).toHaveLength(1);
	});

	it("échoue quand aucun fichier d'horaires n'est trouvé", async () => {
		const store = createInMemoryStore({});
		await expect(loadTimetable(store)).rejects.toThrow();
	});
});

describe("peekTimetableId", () => {
	it("lit l'identifiant sans télécharger le fichier", async () => {
		const store: ObjectStore = {
			async list() {
				return ["PPTimetable/20260825064431_v8.xml.gz"];
			},
			async download() {
				throw new Error("peekTimetableId ne doit jamais télécharger le fichier");
			},
		};
		await expect(peekTimetableId(store)).resolves.toBe("20260825064431");
	});

	it("rend undefined si aucun fichier d'horaires n'est présent", async () => {
		const store = createInMemoryStore({});
		await expect(peekTimetableId(store)).resolves.toBeUndefined();
	});
});
