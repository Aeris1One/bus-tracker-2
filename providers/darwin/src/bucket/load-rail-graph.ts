// Chargement des graphes ferroviaires

import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { decodeRailGraph, type RailGraph } from "../shapes/rail-graph.js";
import { writeFileAtomic } from "../utils/atomic-write.js";
import { logger } from "../utils/logger.js";
import type { ObjectStore } from "./object-store.js";
import { pickLatest } from "./pick-latest.js";

const LOCAL_BIN_PATTERN = /^rail-graph-(\d+)\.bin$/;
const BUCKET_BIN_PATTERN = /^RAILEASY\/rail-graph-(\d+)\.bin$/;

/** Le plus récent `rail-graph-<date>.bin` déjà présent dans `dataDir`, ou undefined. */
async function latestLocalBinPath(dataDir: string): Promise<string | undefined> {
	let entries: string[];
	try {
		entries = await readdir(dataDir);
	} catch {
		// Répertoire absent au tout premier démarrage : aucun candidat local, ce n'est pas un échec.
		return undefined;
	}
	const picked = pickLatest(entries, (name) => {
		const match = LOCAL_BIN_PATTERN.exec(name);
		return match === null ? undefined : { name, date: match[1] ?? "", extra: undefined };
	});
	return picked === undefined ? undefined : join(dataDir, picked.name);
}

/** Le plus récent objet `RAILEASY/rail-graph-<date>.bin` du bucket, ou undefined. */
function latestBucketBinName(names: string[]): string | undefined {
	const picked = pickLatest(names, (name) => {
		const match = BUCKET_BIN_PATTERN.exec(name);
		return match === null ? undefined : { name, date: match[1] ?? "", extra: undefined };
	});
	return picked?.name;
}

/**
 * Ordre de sélection : `RAILWAY_GRAPH_PATH` ; sinon le `.bin` le plus récent déjà présent
 * dans `dataDir` ; sinon l'objet le plus récent du bucket, alors recopié dans `dataDir` en écriture
 * atomique pour les démarrages suivants.
 */
export async function loadRailGraph(store: ObjectStore, dataDir: string): Promise<RailGraph | undefined> {
	try {
		const overridePath = process.env.RAILWAY_GRAPH_PATH;
		if (overridePath !== undefined && overridePath !== "") {
			return decodeRailGraph(await readFile(overridePath));
		}

		const localPath = await latestLocalBinPath(dataDir);
		if (localPath !== undefined) {
			return decodeRailGraph(await readFile(localPath));
		}

		const bucketName = latestBucketBinName(await store.list("RAILEASY/"));
		if (bucketName === undefined) {
			return undefined;
		}

		const buffer = await store.download(bucketName);
		const graph = decodeRailGraph(buffer);
		// Recopie pour les démarrages suivants : un fichier à moitié écrit ne doit jamais être vu par
		// un lecteur concurrent, d'où l'écriture atomique (renommage après écriture complète).
		await writeFileAtomic(join(dataDir, basename(bucketName)), buffer);
		return graph;
	} catch (error) {
		logger.warning("échec du chargement du graphe ferroviaire, bascule en tracés rectilignes : %s", error);
		return undefined;
	}
}

/**
 * Ordre de sélection : `RAILWAY_CH_PATH` ; sinon `dataDir/rail-graph-<version>.pbf` ;
 * sinon l'objet du bucket au nom exact `RAILEASY/rail-graph-<version>.pbf`, mis en cache localement.
 * Son absence n'est pas une erreur : elle désactive seulement le routage.
 */
export async function loadChBuffer(store: ObjectStore, dataDir: string, version: string): Promise<Buffer | undefined> {
	try {
		const overridePath = process.env.RAILWAY_CH_PATH;
		if (overridePath !== undefined && overridePath !== "") {
			return await readFile(overridePath);
		}

		const localPath = join(dataDir, `rail-graph-${version}.pbf`);
		try {
			return await readFile(localPath);
		} catch {
			// Absent localement : on tente le bucket ci-dessous.
		}

		const objectName = `RAILEASY/rail-graph-${version}.pbf`;
		const buffer = await store.download(objectName);
		await writeFileAtomic(localPath, buffer);
		return buffer;
	} catch (error) {
		logger.warning("graphe pré-contracté indisponible (%s), bascule en tracés rectilignes : %s", version, error);
		return undefined;
	}
}
