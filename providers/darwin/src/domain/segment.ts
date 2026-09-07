import { type Call, isPassengerTag } from "./call.js";

export type SegmentKind = "WHOLE" | "TRAIL_IN" | "PASSENGER" | "TRAIL_OUT";
export type Segment = { readonly kind: SegmentKind; readonly calls: Call[] };

/**
 * Découpe un train en au plus trois segments, depuis la liste des calls. 
 * 
 * - WHOLE : si le train n'a aucun arrêt voyageur, sinon :
 * - TRAIL_IN : entre l'origine opérationnelle et le premier arrêt voyageur
 * - PASSENGER : entre le premier et le dernier arrêt voyageur
 * - TRAIL_OUT : entre le dernier arrêt voyageur et la destination opérationnelle
 * Évidement, il peut n'y avoir qu'un seul segment PASSENGER si le train commence et termine
 * dans une gare ouverte en prenant/lachant des voyageurs.
 */
export function splitIntoSegments(calls: Call[]): Segment[] {
	const firstPassengerIndex = calls.findIndex((call) => isPassengerTag(call.tag));
	if (firstPassengerIndex === -1) {
		// Train ECS
		return [{ kind: "WHOLE", calls }];
	}
	// `findLastIndex` est sûr ici : on sait déjà qu'au moins un call voyageur existe.
	const lastPassengerIndex = calls.findLastIndex((call) => isPassengerTag(call.tag));
	const lastIndex = calls.length - 1;

	const segments: Segment[] = [];
	if (firstPassengerIndex > 0) {
		segments.push({ kind: "TRAIL_IN", calls: calls.slice(0, firstPassengerIndex + 1) });
	}
	// La section voyageurs existe toujours, même réduite à un unique point.
	segments.push({ kind: "PASSENGER", calls: calls.slice(firstPassengerIndex, lastPassengerIndex + 1) });
	if (lastPassengerIndex < lastIndex) {
		segments.push({ kind: "TRAIL_OUT", calls: calls.slice(lastPassengerIndex) });
	}
	return segments;
}

/** Filtre les points pour retirer ceux sans coordonnée connue. */
export function selectShapeCalls(
	segment: Segment,
	hasCoordinates: (tiploc: string) => boolean,
): { calls: Call[]; dropped: number } {
    let dropped = 0;

    const withCoordinates = segment.calls.filter((call) => {
        if (hasCoordinates(call.tiploc)) return true;
        dropped++;
        return false;
    });

	if (withCoordinates.length < 2) {
		return { calls: [], dropped };
	}
	return { calls: withCoordinates, dropped };
}

/**
 * Clé canonique d'un tracé : TIPLOC dans l'ordre joints par ">". 
 * Par ex. "PADTON>RDNGSTN>SWINDON"
 */
export function canonicalShapeKey(calls: Call[]): string {
	return [...calls]
		.sort((a, b) => a.order - b.order)
		.map((call) => call.tiploc)
		.join(">");
}
