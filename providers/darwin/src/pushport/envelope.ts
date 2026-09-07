// Décapsulation d'un message Push Port brut. Le message Kafka est un JSON externe qui encapsule un dictionnaire de
// types de messages, chacun valant un objet ou un tableau d'objets.

export type Envelope = {
	payload: Record<string, unknown>;
	/** Numéro de séquence, ou undefined si absent ou non numérique. */
	sequence?: number;
	/** Horodatage d'observation `ts` de la charge utile, en millisecondes, si parsable. */
	observedAtMs?: number;
	/** Vrai pour un instantané `sR` : abaisse le drapeau de discontinuité (voir `sequence-tracker.ts`). */
	isSnapshot: boolean;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Une valeur de message est soit un objet, soit un tableau d'objets.
 * Normalise vers un tableau, y compris pour un objet isolé.
 */
export function toArray(value: unknown): unknown[] {
	if (value === undefined) {
		return [];
	}
	return Array.isArray(value) ? value : [value];
}

/** Nombre depuis une chaîne, tolérant aux espaces ; undefined sur toute chaîne vide ou non numérique. */
function parseNumericString(raw: unknown): number | undefined {
	if (typeof raw !== "string") {
		return undefined;
	}
	const trimmed = raw.trim();
	if (trimmed === "") {
		return undefined;
	}
	const parsed = Number(trimmed);
	return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Décode un message Kafka brut. Rend undefined si la valeur est nulle (rien à faire) ou si la
 * charge utile ne porte ni `uR` ni `sR` sous forme d'objet. Une charge JSON malformée lève une erreur.
 */
export function readEnvelope(value: Buffer | null): Envelope | undefined {
	if (value === null) {
		return undefined;
	}

	// JSON externe ; si `bytes` est une chaîne, elle encapsule la charge utile réelle, sinon l'objet
	// externe EST la charge utile.
	const outer = JSON.parse(value.toString("utf8")) as Record<string, unknown>;
	const darwinPayload = typeof outer.bytes === "string" ? (JSON.parse(outer.bytes) as Record<string, unknown>) : outer;

	const properties = isRecord(outer.properties) ? outer.properties : undefined;
	const pushPortSequence =
		properties !== undefined && isRecord(properties.PushPortSequence) ? properties.PushPortSequence : undefined;
	const sequence = parseNumericString(pushPortSequence?.string);

	const rawTs = darwinPayload.ts;
	let observedAtMs: number | undefined;
	if (typeof rawTs === "string") {
		const parsed = Date.parse(rawTs);
		observedAtMs = Number.isNaN(parsed) ? undefined : parsed;
	}

	const uR = darwinPayload.uR;
	const sR = darwinPayload.sR;
	// uR et sR sont traités de façon identique, à l'exception du drapeau de discontinuité porté par
	// `isSnapshot`.
	const body = isRecord(uR) ? uR : isRecord(sR) ? sR : undefined;
	if (body === undefined) {
		return undefined;
	}

	return {
		payload: body,
		sequence,
		observedAtMs,
		isSnapshot: body === sR,
	};
}
