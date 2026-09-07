// Coordonnées des TIPLOC

import { readFile } from "node:fs/promises";
import type { ObjectStore } from "./object-store.js";
import { pickLatest } from "./pick-latest.js";

type Coordinate = { latitude: number; longitude: number };

const TIPLOCS_NAME_PATTERN = /^RAILEASY\/tiplocs-(\d+)\.json$/;

type RawTiplocsFile = { tiplocs?: Record<string, { lat?: unknown; lon?: unknown }> };

function parseTiplocsJson(json: string): Map<string, Coordinate> {
	const coordinates = new Map<string, Coordinate>();
	const parsed = JSON.parse(json) as RawTiplocsFile;
	const tiplocs = parsed.tiplocs;
	if (typeof tiplocs !== "object" || tiplocs === null) {
		return coordinates;
	}
	for (const [tiploc, entry] of Object.entries(tiplocs)) {
		if (typeof entry.lat !== "number" || typeof entry.lon !== "number") {
			continue;
		}
		coordinates.set(tiploc, { latitude: entry.lat, longitude: entry.lon });
	}
	return coordinates;
}

function pickTiplocsObject(names: string[]) {
	return pickLatest(names, (name) => {
		const match = TIPLOCS_NAME_PATTERN.exec(name);
		if (match === null) {
			return undefined;
		}
		return { name, date: match[1] ?? "", extra: undefined };
	});
}

/**
 * `RAILEASY_TIPLOCS_PATH` prend le pas sur le bucket ; sinon on
 * retient l'objet `RAILEASY/tiplocs-<date>.json` de date la plus récente.
 */
export async function loadTiplocs(store: ObjectStore): Promise<Map<string, Coordinate>> {
	const overridePath = process.env.RAILEASY_TIPLOCS_PATH;
	if (overridePath !== undefined && overridePath !== "") {
		const json = await readFile(overridePath, "utf8");
		return parseTiplocsJson(json);
	}

	const names = await store.list("RAILEASY/");
	const picked = pickTiplocsObject(names);
	if (picked === undefined) {
		throw new Error("Aucun fichier RAILEASY/tiplocs-<date>.json trouvé dans le bucket.");
	}

	const buffer = await store.download(picked.name);
	return parseTiplocsJson(buffer.toString("utf8"));
}
