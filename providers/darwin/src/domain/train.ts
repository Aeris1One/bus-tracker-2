import { type Call, effectiveArrival, isPassengerTag } from "./call.js";

export type Train = {
	readonly rid: string;
	readonly uid: string;
	readonly ssd: string;
	readonly trainId: string;
	readonly toc: string;
	calls: Call[];
	origin: string;
	destination: string;
	cancelled: boolean;
	cancelReason?: number;
	/** Instant de la dernière observation temps réel, en millisecondes. */
	lastObservedAt?: number;
	/** Dernier message TS reçu, rejoué sur un remplacement d'horaire. */
	lastStatusMessage?: unknown;
};

/** Clé d'indexation d'un train. */
export function trainKey(ssd: string, rid: string): string {
	return `${ssd}|${rid}`;
}

/** Un service voyageur possède au moins un call de tag OR, IP ou DT. */
export function isPassengerService(train: Train): boolean {
	return train.calls.some((call) => isPassengerTag(call.tag));
}

export function firstPassengerCall(train: Train): Call | undefined {
	return train.calls.find((call) => isPassengerTag(call.tag));
}

export function lastPassengerCall(train: Train): Call | undefined {
	// `findLast` évite un tri ou un parcours à rebours manuel : les calls sont déjà dans l'ordre du
	// document (rang croissant).
	return train.calls.findLast((call) => isPassengerTag(call.tag));
}

/**
 * Arrivée effective au dernier point, à défaut son arrivée théorique. Fondée sur l'arrivée, jamais
 * sur le départ : un train arrivé à son terminus a un départ effectif de +∞ (voir
 * `effectiveDeparture`), et un balayage fondé sur le départ ne supprimerait jamais rien.
 */
export function lastArrivalTime(train: Train): number | undefined {
	const last = train.calls.at(-1);
	if (last === undefined) {
		return undefined;
	}
	// `effectiveArrival` retombe déjà, en dernier recours, sur l'arrivée publique théorique : c'est
	// exactement le repli attendu ici.
	return effectiveArrival(last);
}
