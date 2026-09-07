// Chargement complet des ressources statiques
import { loadChBuffer, loadRailGraph } from "../bucket/load-rail-graph.js";
import { loadReference } from "../bucket/load-reference.js";
import { loadTimetable } from "../bucket/load-timetable.js";
import { loadTiplocs } from "../bucket/load-tiplocs.js";
import type { ObjectStore } from "../bucket/object-store.js";
import type { ProviderContext } from "../context.js";
import { isRecord } from "../pushport/envelope.js";
import { applyTrainStatus } from "../pushport/handlers/handle-train-status.js";
import { loadChGraph } from "../shapes/ch-graph.js";
import { createNodeGrid } from "../shapes/node-grid.js";
import { createRailRouter } from "../shapes/route-shape.js";
import { readShapeFile } from "../shapes/shape-file.js";
import { logger } from "../utils/logger.js";
import { precomputeShapes } from "./precompute-shapes.js";

export async function loadResources(context: ProviderContext, store: ObjectStore, dataDir: string): Promise<void> {
	logger.step("chargement des ressources statiques (référentiel, horaires, coordonnées, graphe).");

	// Téléchargement en parallèle du référentiel et de l'horaire
	const [referenceData, timetableData] = await Promise.all([loadReference(store), loadTimetable(store)]);

	context.references.setPlaces(referenceData.places);
	context.references.setOperators(referenceData.operators);
	context.references.setVias(referenceData.vias);
	context.references.setReasons(referenceData.lateReasons, referenceData.cancellationReasons);

	// Identifiant de version d'horaires
	const timetableId = timetableData.timetableId;
	context.timetable.loaded = timetableId;

	// Coordonnées
	const coordinates = await loadTiplocs(store);
	context.references.mergeCoordinates(coordinates);

	// Note : s'il y a eu une erreur avant ici, la commande sort juste une erreur et les anciennes données ne sont
	// pas effacées, donc on continue avec les anciens horaires.

	// Remise à zéro. Les associations survivent : indexées par RID, valables d'une version d'horaires
	// à l'autre, leur purge relève de `jobs/sweep.ts`.
	context.trains.clear();
	context.shapes.clear();
	context.publisher.resetKeyRegistry();

	// Installation, application des filtres de configuration
	const { filterTocs, filterTiplocs } = context.configuration;
	for (const train of timetableData.trains) {
		if (filterTocs?.includes(train.toc)) {
			continue;
		}
		const calls =
			filterTiplocs !== undefined && filterTiplocs.length > 0
				? train.calls
						.filter((call) => !filterTiplocs.includes(call.tiploc))
						.map((call, index) => ({ ...call, order: index }))
				: train.calls;
		if (calls.length < 2) {
			continue;
		}
		context.trains.set(calls === train.calls ? train : { ...train, calls });
	}

	// Graphe ferroviaire
	const graph = await loadRailGraph(store, dataDir);
	if (graph === undefined) {
		logger.warning("aucun graphe ferroviaire disponible : tracés rectilignes pour cette version d'horaires.");
	} else {
		const grid = createNodeGrid(graph);
		const chBuffer = await loadChBuffer(store, dataDir, graph.version);
		const ch = chBuffer !== undefined ? loadChGraph(chBuffer, graph) : undefined;
		const router = createRailRouter(graph, grid, ch);

		context.graphVersion = graph.version;
		context.router = router;

		// On charge depuis le disque si on avais cette version en cache.
		const cachedShapes = await readShapeFile(dataDir, timetableId, graph.version);
		for (const shape of cachedShapes) {
			context.shapes.set(shape);
		}

		// On lance le précalcul mais on ne l'attends pas
		void precomputeShapes(context, dataDir, timetableId).catch((error: unknown) => {
			logger.warning("échec du pré-calcul de tracés en arrière-plan : %s", String(error));
		});
	}

	// Rejeu de TOUS les messages temps réel orphelins en attente. `takeAll()` vide le magasin qu'il y
	// ait rejeu ou non : un message dont le train n'existe toujours pas dans la nouvelle version
	// d'horaires ne pourra plus jamais s'appliquer à rien, il est donc perdu plutôt que remis en
	// attente indéfiniment.
	for (const { ssd, rid, message } of context.pendingStatuses.takeAll()) {
		if (!isRecord(message)) {
			continue;
		}
		const train = context.trains.get(ssd, rid);
		if (train !== undefined) {
			applyTrainStatus(train, message, Date.now());
		}
	}

	logger.success(
		"ressources chargées : %d train(s) installé(s), version d'horaires %s.",
		context.trains.size,
		timetableId,
	);
}
