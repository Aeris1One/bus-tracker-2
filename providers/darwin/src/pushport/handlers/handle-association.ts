// Message `association` : correspondance « next portion » entre deux trains.

import type { ProviderContext } from "../../context.js";
import type { Association } from "../../domain/destination.js";
import { isRecord } from "../envelope.js";

/** Chaque champ est lu soit comme propriété directe, soit comme attribut préfixé `@_`. */
function readAttr(node: Record<string, unknown>, name: string): unknown {
	return node[name] ?? node[`@_${name}`];
}

function readStringAttr(node: Record<string, unknown> | undefined, name: string): string | undefined {
	if (node === undefined) {
		return undefined;
	}
	const value = readAttr(node, name);
	return typeof value === "string" ? value : undefined;
}

export function handleAssociation(context: ProviderContext, message: Record<string, unknown>): void {
	// Seules les associations de catégorie NP (next portion) sont retenues ; JJ (jonction) et VV
	// (séparation) n'ont aucun effet observable en sortie.
	const category = readStringAttr(message, "category");
	if (category !== "NP") {
		return;
	}

	const main = isRecord(message.main) ? message.main : undefined;
	const assoc = isRecord(message.assoc) ? message.assoc : undefined;

	const mainRid = readStringAttr(main, "rid");
	const assocRid = readStringAttr(assoc, "rid");
	if (mainRid === undefined || assocRid === undefined) {
		return;
	}

	const association: Association = {
		mainRid,
		assocRid,
		tiploc: readStringAttr(message, "tiploc") ?? "",
		wta: readStringAttr(main, "wta"),
		// wtd et ptd retombent sur ceux de `assoc` s'ils manquent dans `main` (wta/pta n'ont pas ce
		// repli : le contrat ne le prévoit que pour wtd/ptd).
		wtd: readStringAttr(main, "wtd") ?? readStringAttr(assoc, "wtd"),
		pta: readStringAttr(main, "pta"),
		ptd: readStringAttr(main, "ptd") ?? readStringAttr(assoc, "ptd"),
	};

	context.associations.add(association);
}
