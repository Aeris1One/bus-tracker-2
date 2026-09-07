// Balayage périodique : purge des trains obsolètes, purge des associations orphelines, purge des
// messages temps réel orphelins périmés.

import { TRAIN_RETENTION_MS } from "../constants.js";
import type { ProviderContext } from "../context.js";
import { lastArrivalTime } from "../domain/train.js";

export function sweep(context: ProviderContext, nowMs: number): void {
	// Collecte des trains à supprimer
	const toDelete: { ssd: string; rid: string }[] = [];
	for (const train of context.trains.values()) {
		const arrival = lastArrivalTime(train);
		if (arrival !== undefined && nowMs - arrival > TRAIN_RETENTION_MS) {
			toDelete.push({ ssd: train.ssd, rid: train.rid });
		}
	}
	// Supprimer les trains collectés
	for (const { ssd, rid } of toDelete) {
		context.trains.delete(ssd, rid);
	}

	// Associations : on supprime les associations qui ne sont plus liées à aucun train
	const knownRids = new Set<string>();
	for (const train of context.trains.values()) {
		knownRids.add(train.rid);
	}
	context.associations.prune((rid) => knownRids.has(rid));

	// Messages TS orphelins périmés.
	context.pendingStatuses.purge(nowMs);
}
