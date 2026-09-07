// Message `TimeTableId` : annonce la publication d'un nouveau fichier d'horaires statique.

import type { ProviderContext } from "../../context.js";
import { isRecord } from "../envelope.js";

export function handleTimetableId(context: ProviderContext, message: unknown): void {
	// Une valeur scalaire nue (non-objet) est ignorée, faute de pouvoir être filtrée sur `ttfile`.
	if (!isRecord(message)) {
		return;
	}

	// `ttfile` (lu comme propriété directe ou comme `@_ttfile`) doit être présent et non blanc.
	const raw = message.ttfile ?? message["@_ttfile"];
	if (typeof raw !== "string") {
		return;
	}
	const trimmed = raw.trim();
	if (trimmed === "") {
		return;
	}

	context.timetable.announced = trimmed;
	context.timetable.reloadRequested = true;
}
