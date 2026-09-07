// Registre en mémoire des clés Redis de tracés déjà écrites, avec leur instant d'écriture. Durée
// de vie : purgé intégralement à chaque rechargement d'horaires ; entrées évincées au-delà de 900 s.

import { SHAPE_KEY_REGISTRY_TTL_MS, SHAPE_KEY_REWRITE_MS } from "../constants.js";

export type PublishedKeyStore = {
	/** Vrai si la clé n'a jamais été écrite, ou si sa dernière écriture remonte à > 600 s. */
	shouldWrite(key: string, nowMs: number): boolean;
	markWritten(key: string, nowMs: number): void;
	/** Évince les entrées écrites il y a plus de 900 s. */
	evict(nowMs: number): void;
	/** Purge intégrale à chaque rechargement d'horaires. */
	clear(): void;
	/** Nombre d'entrées en mémoire. */
	readonly size: number;
};

export function createPublishedKeyStore(): PublishedKeyStore {
	const writtenAtMs = new Map<string, number>();

	return {
		shouldWrite(key, nowMs) {
			const last = writtenAtMs.get(key);
			return last === undefined || nowMs - last > SHAPE_KEY_REWRITE_MS;
		},
		markWritten(key, nowMs) {
			writtenAtMs.set(key, nowMs);
		},
		evict(nowMs) {
			for (const [key, last] of writtenAtMs) {
				if (nowMs - last > SHAPE_KEY_REGISTRY_TTL_MS) {
					writtenAtMs.delete(key);
				}
			}
		},
		clear() {
			writtenAtMs.clear();
		},
		get size() {
			return writtenAtMs.size;
		},
	};
}
