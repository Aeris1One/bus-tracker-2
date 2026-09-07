// Rafraîchissement des horaires

import { captureException } from "@bus-tracker/monitoring";
import { peekTimetableId } from "../bucket/load-timetable.js";
import type { ObjectStore } from "../bucket/object-store.js";
import { TIMETABLE_CHECK_INTERVAL_MS } from "../constants.js";
import type { ProviderContext } from "../context.js";
import { logger } from "../utils/logger.js";
import { loadResources } from "./load-resources.js";

export async function refreshTimetableIfNeeded(
	context: ProviderContext,
	store: ObjectStore,
	dataDir: string,
	nowMs: number,
): Promise<void> {
	const { timetable } = context;

	const requested = timetable.reloadRequested;
	timetable.reloadRequested = false;

	const periodicCheckDue = nowMs - timetable.lastCheckedAtMs > TIMETABLE_CHECK_INTERVAL_MS;
	if (!requested && !periodicCheckDue) {
		return;
	}
	timetable.lastCheckedAtMs = nowMs;

	try {
		// Condition 1 — une version a été annoncée dans le temps-réel ET diffère de la version chargée.
		const announcedDiffers = timetable.announced !== undefined && timetable.announced !== timetable.loaded;

		// Condition 2 — la version du dernier fichier du bucket diffère de la version chargée.
		const peekedId = await peekTimetableId(store);
		const bucketDiffers = peekedId !== undefined && peekedId !== timetable.loaded;

		if (announcedDiffers || bucketDiffers) {
			await loadResources(context, store, dataDir);
		}
	} catch (error) {
		logger.failure("échec du rafraîchissement des horaires : %s", String(error));
		captureException(error);
	}
}
