// Règle de sélection commune aux quatre chargeurs du bucket.

export type DatedObject<T> = { name: string; date: string; extra: T };

/**
 * Compare deux dates extraites
 */
function compareDates(a: string, b: string): number {
	const diff = BigInt(a) - BigInt(b);
	if (diff < 0n) {
		return -1;
	}
	if (diff > 0n) {
		return 1;
	}
	return 0;
}

/**
 * Sélectionne l'objet dont la date extraite du nom est la plus récente ; en cas d'égalité,
 * `compareExtra` départage.
 */
export function pickLatest<T>(
	names: string[],
	parse: (name: string) => DatedObject<T> | undefined,
	compareExtra?: (a: T, b: T) => number,
): DatedObject<T> | undefined {
	let best: DatedObject<T> | undefined;

	for (const name of names) {
		const candidate = parse(name);
		if (candidate === undefined) {
			continue;
		}
		if (best === undefined) {
			best = candidate;
			continue;
		}

		const dateComparison = compareDates(candidate.date, best.date);
		if (dateComparison > 0) {
			best = candidate;
		} else if (dateComparison === 0 && compareExtra !== undefined && compareExtra(candidate.extra, best.extra) > 0) {
			best = candidate;
		}
	}

	return best;
}
