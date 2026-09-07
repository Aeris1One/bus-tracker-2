// Noms de lieux, coordonnées, opérateurs, libellés « via », libellés de motifs. Durée de vie :
// remplacé intégralement à chaque rechargement d'horaires.

export type Place = { tiploc: string; name?: string; crs?: string; latitude?: number; longitude?: number };

export type ReferenceStore = {
	setPlaces(places: Map<string, Place>): void;
	/** Un lieu ne reçoit une coordonnée que s'il n'en a pas déjà une. */
	mergeCoordinates(coordinates: Map<string, { latitude: number; longitude: number }>): void;
	place(tiploc: string): Place | undefined;
	/** Nom lisible, à défaut le code TIPLOC lui-même. */
	placeName(tiploc: string): string;
	coordinatesOf(tiploc: string): { latitude: number; longitude: number } | undefined;
	hasCoordinates(tiploc: string): boolean;
	operatorName(toc: string): string | undefined;
	setOperators(operators: Map<string, string>): void;
	setVias(vias: Map<string, string>): void;
	via(at: string, dest: string, loc1: string, loc2: string): string | undefined;
	setReasons(late: Map<number, string>, cancellation: Map<number, string>): void;
	lateReason(code: number): string | undefined;
	cancellationReason(code: number): string | undefined;
};

/** Clé d'un libellé « via », dans la même forme que celle interrogée par `buildDestination`. */
function viaKey(at: string, dest: string, loc1: string, loc2: string): string {
	return `${at}|${dest}|${loc1}|${loc2}`;
}

export function createReferenceStore(): ReferenceStore {
	let places = new Map<string, Place>();
	let operators = new Map<string, string>();
	let vias = new Map<string, string>();
	// Motifs collectés et conservés, mais jamais publiés : aucun champ du contrat de sortie ne les
	// accueille pour l'instant.
	let lateReasons = new Map<number, string>();
	let cancellationReasons = new Map<number, string>();

	return {
		setPlaces(newPlaces) {
			places = newPlaces;
		},
		mergeCoordinates(coordinates) {
			for (const [tiploc, coordinate] of coordinates) {
				const existing = places.get(tiploc);
				if (existing === undefined) {
					// Un lieu vu uniquement dans le fichier de coordonnées : on le crée quand même.
					places.set(tiploc, { tiploc, ...coordinate });
					continue;
				}
				// Ne jamais écraser une coordonnée déjà connue.
				if (existing.latitude !== undefined && existing.longitude !== undefined) {
					continue;
				}
				places.set(tiploc, { ...existing, ...coordinate });
			}
		},
		place(tiploc) {
			return places.get(tiploc);
		},
		placeName(tiploc) {
			return places.get(tiploc)?.name ?? tiploc;
		},
		coordinatesOf(tiploc) {
			const found = places.get(tiploc);
			if (found?.latitude === undefined || found.longitude === undefined) {
				return undefined;
			}
			return { latitude: found.latitude, longitude: found.longitude };
		},
		hasCoordinates(tiploc) {
			const found = places.get(tiploc);
			return found?.latitude !== undefined && found.longitude !== undefined;
		},
		operatorName(toc) {
			return operators.get(toc);
		},
		setOperators(newOperators) {
			operators = newOperators;
		},
		setVias(newVias) {
			vias = newVias;
		},
		via(at, dest, loc1, loc2) {
			return vias.get(viaKey(at, dest, loc1, loc2));
		},
		setReasons(late, cancellation) {
			lateReasons = late;
			cancellationReasons = cancellation;
		},
		lateReason(code) {
			return lateReasons.get(code);
		},
		cancellationReason(code) {
			return cancellationReasons.get(code);
		},
	};
}
