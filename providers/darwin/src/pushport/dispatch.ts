// Répartition d'une enveloppe décodée vers le gestionnaire de chaque type de message.

import type { ProviderContext } from "../context.js";
import { logger } from "../utils/logger.js";
import type { Envelope } from "./envelope.js";
import { isRecord, toArray } from "./envelope.js";
import { handleAssociation } from "./handlers/handle-association.js";
import { handleDeactivated } from "./handlers/handle-deactivated.js";
import { handleSchedule } from "./handlers/handle-schedule.js";
import { handleTimetableId } from "./handlers/handle-timetable-id.js";
import { handleTrainStatus } from "./handlers/handle-train-status.js";

type Handler = (context: ProviderContext, item: Record<string, unknown>, envelope: Envelope) => void;

/** Types traités par un gestionnaire prenant un objet. */
const HANDLERS: Record<string, Handler> = {
	TS: (context, item, envelope) => handleTrainStatus(context, item, envelope),
	schedule: (context, item) => handleSchedule(context, item),
	association: (context, item) => handleAssociation(context, item),
	deactivated: (context, item) => handleDeactivated(context, item),
};

export function dispatch(context: ProviderContext, envelope: Envelope): void {
	for (const [type, value] of Object.entries(envelope.payload)) {
		// Les clés commençant par `@_` (attributs XML capturés par la conversion amont) sont ignorées.
		if (type.startsWith("@_")) {
			continue;
		}

		if (type === "TimeTableId") {
			// L'argument peut être une valeur scalaire
			for (const item of toArray(value)) {
				handleTimetableId(context, item);
			}
			continue;
		}

		const handler = HANDLERS[type];
		if (handler === undefined) {
			// Type hors périmètre : acquitté et ignoré, compté, journalisé une seule fois dans la vie
			// du process.
			context.counters.increment(type);
			if (context.counters.seenFirstTime(type)) {
				logger.info("Type de message Push Port hors périmètre, acquitté et ignoré : %s", type);
			}
			continue;
		}

		for (const item of toArray(value)) {
			if (isRecord(item)) {
				handler(context, item, envelope);
			}
		}
	}
}
