// Associations NP, indexées par RID. 

import type { Association } from "../domain/destination.js";

export type AssociationStore = {
	/** Enregistre sous les DEUX rid, en évitant les doublons sur (mainRid, assocRid, tiploc). */
	add(association: Association): void;
	forRid(rid: string): Association[];
	/** Élague les associations référençant un RID supprimé ; supprime les listes vides. */
	prune(isKnownRid: (rid: string) => boolean): void;
};

function sameTriplet(a: Association, b: Association): boolean {
	return a.mainRid === b.mainRid && a.assocRid === b.assocRid && a.tiploc === b.tiploc;
}

export function createAssociationStore(): AssociationStore {
	const byRid = new Map<string, Association[]>();

	function addUnder(rid: string, association: Association): void {
		const list = byRid.get(rid);
		if (list === undefined) {
			byRid.set(rid, [association]);
			return;
		}
		// Évite le doublon sur le triplet (mainRid, assocRid, tiploc).
		if (list.some((existing) => sameTriplet(existing, association))) {
			return;
		}
		list.push(association);
	}

	return {
		add(association) {
			// Enregistrée sous les DEUX rid : un train peut être retrouvé qu'il soit le train
			// principal ou le train associé.
			addUnder(association.mainRid, association);
			addUnder(association.assocRid, association);
		},
		forRid(rid) {
			return byRid.get(rid) ?? [];
		},
		prune(isKnownRid) {
			for (const [rid, list] of byRid) {
				const kept = list.filter((association) => isKnownRid(association.mainRid) && isKnownRid(association.assocRid));
				if (kept.length === 0) {
					byRid.delete(rid);
				} else {
					byRid.set(rid, kept);
				}
			}
		},
	};
}
