// Identifiant de version d'horaires annoncé / chargé, demande de rechargement, instant de la
// dernière vérification périodique.

export type TimetableVersionState = {
	/** Version effectivement chargée. */
	loaded?: string;
	/** Version annoncée par un message TimeTableId. */
	announced?: string;
	/** Demande de rechargement au cycle suivant. */
	reloadRequested: boolean;
	/** Instant de la dernière vérification périodique. */
	lastCheckedAtMs: number;
};

export function createTimetableVersionState(): TimetableVersionState {
	return {
		loaded: undefined,
		announced: undefined,
		reloadRequested: false,
		lastCheckedAtMs: 0,
	};
}
