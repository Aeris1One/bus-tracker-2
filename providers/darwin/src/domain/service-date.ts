// Date de service dérivée du RID, et pertinence de cette date lors de la sélection des trains à
// publier.

const SERVICE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Reconstruit la SSD depuis les 8 premiers caractères du RID (année, mois, jour).
 */
export function serviceDateFromRid(rid: string): string {
	return `${rid.slice(0, 4)}-${rid.slice(4, 6)}-${rid.slice(6, 8)}`;
}

/** La SSD correspond exactement au motif `^\d{4}-\d{2}-\d{2}$`. */
export function isWellFormedServiceDate(ssd: string): boolean {
	return SERVICE_DATE_PATTERN.test(ssd);
}

/**
 * La SSD est hier, aujourd'hui ou demain.
 */
export function isRelevantServiceDate(ssd: string, nowMs: number): boolean {
	// Le fuseau de la machine se lit sans jamais consulter l'heure courante : seul `nowMs`, fourni
	// par l'appelant, sert à situer la date.
	const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
	const today = Temporal.Instant.fromEpochMilliseconds(nowMs).toZonedDateTimeISO(timeZone).toPlainDate();
	return (
		ssd === today.subtract({ days: 1 }).toString() ||
		ssd === today.toString() ||
		ssd === today.add({ days: 1 }).toString()
	);
}
