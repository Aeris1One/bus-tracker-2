// noinspection NonAsciiCharacters

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/**
 * Distance de haversine. Implémentation reprise à l'identique de
 * `providers/gtfs/src/utils/get-distance.ts`.
 */
export function distanceBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
	const R = 6371e3; // metres
	const φ1 = toRad(lat1);
	const φ2 = toRad(lat2);
	const Δφ = toRad(lat2 - lat1);
	const Δλ = toRad(lon2 - lon1);

	const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
	const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

	return R * c;
}

/** Cap en degrés, 0 = nord, 90 = est. */
export function bearingBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
	const φ1 = toRad(lat1);
	const φ2 = toRad(lat2);
	const Δλ = toRad(lon2 - lon1);

	const y = Math.sin(Δλ) * Math.cos(φ2);
	const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);

	return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Écart angulaire absolu entre deux caps, ramené dans [0, 180]. */
export function bearingDifference(a: number, b: number): number {
	// On passe par un modulo dans [0, 360) avant de replier autour de 180, pour gérer
	// correctement le franchissement de la coupure 0/360 (ex. 350° et 10° ne sont écartés que de 20°).
	const diff = Math.abs(a - b) % 360;
	return diff > 180 ? 360 - diff : diff;
}

/** Interpolation linéaire entre deux coordonnées. */
export function interpolate(
	lat1: number,
	lon1: number,
	lat2: number,
	lon2: number,
	ratio: number,
): { latitude: number; longitude: number } {
	return {
		latitude: lat1 + (lat2 - lat1) * ratio,
		longitude: lon1 + (lon2 - lon1) * ratio,
	};
}
