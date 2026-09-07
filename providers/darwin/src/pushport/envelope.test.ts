import { describe, expect, it } from "vitest";

import { isRecord, readEnvelope, toArray } from "./envelope.js";

function encode(value: unknown): Buffer {
	return Buffer.from(JSON.stringify(value), "utf8");
}

describe("readEnvelope", () => {
	it("rend undefined sur une valeur nulle : rien à faire", () => {
		expect(readEnvelope(null)).toBeUndefined();
	});

	it("re-parse `bytes` quand c'est une chaîne : c'est la charge utile réelle", () => {
		const inner = { ts: "2026-09-06T10:00:00Z", uR: { TS: { rid: "R1" } } };
		const outer = { bytes: JSON.stringify(inner), properties: {} };

		const envelope = readEnvelope(encode(outer));

		expect(envelope?.payload).toEqual({ TS: { rid: "R1" } });
		expect(envelope?.isSnapshot).toBe(false);
	});

	it("si `bytes` n'est pas une chaîne, l'objet externe EST la charge utile", () => {
		const outer = { ts: "2026-09-06T10:00:00Z", uR: { TS: { rid: "R1" } } };

		const envelope = readEnvelope(encode(outer));

		expect(envelope?.payload).toEqual({ TS: { rid: "R1" } });
	});

	it("rend undefined si ni uR ni sR ne sont un objet", () => {
		expect(readEnvelope(encode({ ts: "2026-09-06T10:00:00Z" }))).toBeUndefined();
		expect(readEnvelope(encode({ uR: "pas un objet" }))).toBeUndefined();
	});

	it("uR et sR sont traités de façon identique, à l'exception du drapeau isSnapshot", () => {
		const withUR = readEnvelope(encode({ uR: { TS: {} } }));
		const withSR = readEnvelope(encode({ sR: { TS: {} } }));

		expect(withUR?.payload).toEqual({ TS: {} });
		expect(withUR?.isSnapshot).toBe(false);
		expect(withSR?.payload).toEqual({ TS: {} });
		expect(withSR?.isSnapshot).toBe(true);
	});

	it("extrait le numéro de séquence depuis properties.PushPortSequence.string", () => {
		const outer = { uR: { TS: {} }, properties: { PushPortSequence: { string: "1234567" } } };

		expect(readEnvelope(encode(outer))?.sequence).toBe(1234567);
	});

	it("un numéro de séquence non numérique ou absent ne produit aucun numéro", () => {
		expect(
			readEnvelope(encode({ uR: { TS: {} }, properties: { PushPortSequence: { string: "abc" } } }))?.sequence,
		).toBeUndefined();
		expect(readEnvelope(encode({ uR: { TS: {} } }))?.sequence).toBeUndefined();
	});

	it("`ts` à la racine de la charge utile devient observedAtMs quand c'est une chaîne parsable", () => {
		const envelope = readEnvelope(encode({ ts: "2026-09-06T10:00:00.000Z", uR: { TS: {} } }));
		expect(envelope?.observedAtMs).toBe(Date.parse("2026-09-06T10:00:00.000Z"));
	});

	it("un `ts` non parsable ou absent ne produit aucun horodatage d'observation", () => {
		expect(readEnvelope(encode({ ts: "n'importe quoi", uR: { TS: {} } }))?.observedAtMs).toBeUndefined();
		expect(readEnvelope(encode({ uR: { TS: {} } }))?.observedAtMs).toBeUndefined();
	});
});

describe("toArray", () => {
	it("enveloppe un objet isolé dans un tableau à un élément", () => {
		expect(toArray({ a: 1 })).toEqual([{ a: 1 }]);
	});

	it("laisse un tableau tel quel", () => {
		expect(toArray([{ a: 1 }, { a: 2 }])).toEqual([{ a: 1 }, { a: 2 }]);
	});

	it("rend un tableau vide pour une valeur absente", () => {
		expect(toArray(undefined)).toEqual([]);
	});
});

describe("isRecord", () => {
	it("distingue un objet simple d'un tableau, de null et d'un scalaire", () => {
		expect(isRecord({})).toBe(true);
		expect(isRecord([])).toBe(false);
		expect(isRecord(null)).toBe(false);
		expect(isRecord("x")).toBe(false);
	});
});
