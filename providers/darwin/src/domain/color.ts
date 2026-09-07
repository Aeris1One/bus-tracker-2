// Couleur déterministe dérivée du nom d'opérateur, utilisée s'il n'y a pas de couleur configurée pour
// cet opérateur.

export type BrandColors = { color: string; textColor: string };
export type TocColors = Record<string, BrandColors>;

const HASH_MULTIPLIER = 31;
const HUE_MODULO = 360;
const COLOR_SATURATION = 0.65;
const COLOR_LIGHTNESS = 0.55;
/** Seuil de luminance WCAG séparant texte noir et texte blanc. */
const TEXT_LUMINANCE_THRESHOLD = 0.179;
const SRGB_LINEAR_THRESHOLD = 0.04045;

/**
 * Hachage entier 32 bits signé du nom : `h = (h * 31 + code) | 0`.
 */
function hashName(name: string): number {
	let h = 0;
	for (let index = 0; index < name.length; index++) {
		h = (h * HASH_MULTIPLIER + name.charCodeAt(index)) | 0;
	}
	return h;
}

/** Conversion TSL → RVB, composantes dans [0, 255]. */
function hslToRgb(hue: number, saturation: number, lightness: number): { r: number; g: number; b: number } {
	// Algorithme standard : on convertit d'abord en composantes normalisées [0, 1].
	const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
	const hPrime = hue / 60;
	const x = c * (1 - Math.abs((hPrime % 2) - 1));
	const m = lightness - c / 2;

	let r1 = 0;
	let g1 = 0;
	let b1 = 0;
	if (hPrime < 1) {
		r1 = c;
		g1 = x;
	} else if (hPrime < 2) {
		r1 = x;
		g1 = c;
	} else if (hPrime < 3) {
		g1 = c;
		b1 = x;
	} else if (hPrime < 4) {
		g1 = x;
		b1 = c;
	} else if (hPrime < 5) {
		r1 = x;
		b1 = c;
	} else {
		r1 = c;
		b1 = x;
	}

	return {
		r: Math.round((r1 + m) * 255),
		g: Math.round((g1 + m) * 255),
		b: Math.round((b1 + m) * 255),
	};
}

function toHex(component: number): string {
	return component.toString(16).padStart(2, "0");
}

/** Linéarisation sRGB d'un canal, formule WCAG. */
function linearize(channel8bit: number): number {
	const c = channel8bit / 255;
	return c <= SRGB_LINEAR_THRESHOLD ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Luminance relative WCAG d'une couleur RVB. */
function relativeLuminance(r: number, g: number, b: number): number {
	return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/**
 * Couleur déterministe dérivée du nom d'opérateur
 */
export function deriveColor(operatorName: string): BrandColors {
	const hash = hashName(operatorName);
	// Modulo négatif de JavaScript : `hash % 360` peut être négatif si `hash` l'est. On le ramène
	// dans [0, 360) en ajoutant 360 puis en reprenant le modulo.
	const hue = ((hash % HUE_MODULO) + HUE_MODULO) % HUE_MODULO;

	const { r, g, b } = hslToRgb(hue, COLOR_SATURATION, COLOR_LIGHTNESS);
	const color = `${toHex(r)}${toHex(g)}${toHex(b)}`;

	const luminance = relativeLuminance(r, g, b);
	const textColor = luminance > TEXT_LUMINANCE_THRESHOLD ? "000000" : "ffffff";

	return { color, textColor };
}
