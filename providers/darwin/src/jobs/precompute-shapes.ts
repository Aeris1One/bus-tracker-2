// Pré-calcul d'arrière-plan des tracés manquants.

import { setImmediate } from "node:timers/promises";
import { PRECOMPUTE_BATCH_SIZE } from "../constants.js";
import type { ProviderContext } from "../context.js";
import { splitIntoSegments } from "../domain/segment.js";
import { ensureShapes } from "../shapes/shape-builder.js";
import { writeShapeFile } from "../shapes/shape-file.js";
import { logger } from "../utils/logger.js";

export async function precomputeShapes(context: ProviderContext, dataDir: string, timetableId: string): Promise<void> {
	let processed = 0;

	for (const train of context.trains.values()) {
		try {
			const segments = splitIntoSegments(train.calls);
			ensureShapes(segments, {
				sourceId: context.configuration.id,
				shapePaths: context.configuration.shapePaths ?? false,
				graphVersion: context.graphVersion,
				shapes: context.shapes,
				counters: context.counters,
				router: context.router,
				coordinatesOf: context.references.coordinatesOf,
			});
		} catch (error) {
			// Une erreur sur un train n'interrompt jamais le parcours des autres.
			logger.warning("échec du pré-calcul de tracé pour le train %s : %s", train.rid, String(error));
		}

		processed += 1;
		// On cède la main tous les PRECOMPUTE_BATCH_SIZE trains pour ne pas bloquer la boucle
		if (processed % PRECOMPUTE_BATCH_SIZE === 0) {
			await setImmediate();
		}
	}

	// On écris l'index sur le disque.
	await writeShapeFile(dataDir, timetableId, context.graphVersion, context.shapes.values());
}
