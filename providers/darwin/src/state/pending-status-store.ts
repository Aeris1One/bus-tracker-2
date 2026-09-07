// Messages TS orphelins en attente, indexés par `${ssd}|${rid}`. Durée de vie : 10 minutes, et au
// plus 5000 entrées.

import { PENDING_STATUS_MAX, PENDING_STATUS_TTL_MS } from "../constants.js";

export type PendingStatusStore = {
	put(ssd: string, rid: string, message: unknown, receivedAtMs: number): void;
	take(ssd: string, rid: string): unknown | undefined;
	takeAll(): { ssd: string; rid: string; message: unknown }[];
	/** Retire les entrées de plus de 10 min, puis ramène le stock à 5000 en supprimant les plus vieilles. */
	purge(nowMs: number): void;
	readonly size: number;
};

type Entry = { ssd: string; rid: string; message: unknown; receivedAtMs: number };

function key(ssd: string, rid: string): string {
	return `${ssd}|${rid}`;
}

export function createPendingStatusStore(): PendingStatusStore {
	// Un `Map` conserve l'ordre d'insertion : ré-insérer une clé existante (via `put`) la déplace en
	// fin d'itération, ce qui suffit à retrouver les plus anciennes entrées lors de l'écrêtage.
	const entries = new Map<string, Entry>();

	return {
		put(ssd, rid, message, receivedAtMs) {
			const k = key(ssd, rid);
			// Un seul message par train : la ré-insertion remplace le précédent et le replace en fin
			// d'ordre d'insertion.
			entries.delete(k);
			entries.set(k, { ssd, rid, message, receivedAtMs });
		},
		take(ssd, rid) {
			const k = key(ssd, rid);
			const entry = entries.get(k);
			entries.delete(k);
			return entry?.message;
		},
		takeAll() {
			const all = [...entries.values()].map(({ ssd, rid, message }) => ({ ssd, rid, message }));
			entries.clear();
			return all;
		},
		purge(nowMs) {
			// Purge par âge : plus de 10 minutes depuis la réception.
			for (const [k, entry] of entries) {
				if (nowMs - entry.receivedAtMs > PENDING_STATUS_TTL_MS) {
					entries.delete(k);
				}
			}
			// Purge par plafond : au-delà de 5000 entrées, les plus anciennes (en tête d'ordre
			// d'insertion) sont supprimées jusqu'à revenir à cette taille.
			const excess = entries.size - PENDING_STATUS_MAX;
			if (excess > 0) {
				const iterator = entries.keys();
				for (let i = 0; i < excess; i++) {
					const oldest = iterator.next().value;
					if (oldest !== undefined) {
						entries.delete(oldest);
					}
				}
			}
		},
		get size() {
			return entries.size;
		},
	};
}
