// Message `deactivated` : retrait de service d'un train.

import type { ProviderContext } from "../../context.js";
import { serviceDateFromRid } from "../../domain/service-date.js";

function readString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

export function handleDeactivated(context: ProviderContext, message: Record<string, unknown>): void {
	const rid = readString(message.rid);
	if (rid === undefined) {
		return;
	}
	const ssd = readString(message.ssd) ?? serviceDateFromRid(rid);

	const train = context.trains.get(ssd, rid);
	if (train === undefined) {
		// Train inconnu : rien ne se passe.
		return;
	}

	train.cancelled = true;
	train.calls = train.calls.map((call) => ({ ...call, cancelled: true }));
}
