import { describe, expect, it } from "vitest";

import { deriveColor } from "./color.js";

describe("deriveColor", () => {
	it("est déterministe : le même nom rend toujours la même couleur", () => {
		expect(deriveColor("Great Western Railway")).toEqual(deriveColor("Great Western Railway"));
	});

	it("rend six chiffres hexadécimaux minuscules, sans #", () => {
		const { color, textColor } = deriveColor("South Western Railway");
		expect(color).toMatch(/^[0-9a-f]{6}$/);
		expect(textColor).toMatch(/^[0-9a-f]{6}$/);
	});

	it("des noms différents peuvent rendre des couleurs différentes", () => {
		expect(deriveColor("Avanti West Coast").color).not.toBe(deriveColor("LNER").color);
	});

	// Les quatre cas suivants ont été choisis en calculant hors-ligne le hachage 32 bits signé et la
	// luminance WCAG de chaque nom, pour couvrir le seuil 0.179 des deux côtés, avec un hachage
	// positif et un hachage négatif dans chaque cas.
	it("texte noir quand la luminance dépasse 0.179, avec un hachage positif", () => {
		expect(deriveColor("GW")).toEqual({ color: "42d756", textColor: "000000" });
	});

	it("texte blanc quand la luminance est sous 0.179, avec un hachage positif", () => {
		expect(deriveColor("Zulu")).toEqual({ color: "5f42d7", textColor: "ffffff" });
	});

	it("texte noir quand la luminance dépasse 0.179, avec un hachage négatif (modulo négatif)", () => {
		expect(deriveColor("South Western Railway")).toEqual({ color: "42d79b", textColor: "000000" });
	});

	it("texte blanc quand la luminance est sous 0.179, avec un hachage négatif (modulo négatif)", () => {
		expect(deriveColor("Heathrow Express")).toEqual({ color: "8242d7", textColor: "ffffff" });
	});
});
