// Cycle de publication : re-dérive et publie l'ensemble des trains actuellement visibles

import type { VehicleJourney } from "@bus-tracker/contracts";
import { captureException, type PositionTypeCounts, totalPositionTypeCounts } from "@bus-tracker/monitoring";
import type { ProviderContext } from "../context.js";
import type { Shape } from "../domain/shape.js";
import { buildJourney } from "../publish/build-journey.js";
import { logger } from "../utils/logger.js";

export async function runPublishCycle(
	context: ProviderContext,
): Promise<{ published: PositionTypeCounts; errorCount: number }> {
	const nowMs = Date.now();

	const journeys: VehicleJourney[] = [];
	// Indexées par clé Redis : un tracé partagé par plusieurs trains (même relation, compagnies
	// différentes) n'est téléversé qu'une seule fois par cycle.
	const shapesToPublish = new Map<string, Shape>();
	let buildErrors = 0;
	let omittedCalls = 0;

	for (const train of context.trains.values()) {
		try {
			const built = buildJourney(context, train, nowMs);
			if (built === undefined) {
				// Écarté par `evaluateTrain` dans `buildJourney`
				continue;
			}
			journeys.push(built.journey);
			omittedCalls += built.omitted;
			// Les TROIS tracés de chaque train sont téléversés, même ceux qui ne sont
			// pas actifs, comme ça le passage d'un segment à l'autre est instantanné.
			// Seul le segment actif est RÉFÉRENCÉ par le train (`pathRef`, déjà posé par
			// `buildJourney`).
			for (const shape of built.shapes.values()) {
				shapesToPublish.set(shape.redisKey, shape);
			}
		} catch (error) {
			buildErrors += 1;
			logger.failure("échec de construction de l'entrée publiée pour le train %s : %s", train.rid, String(error));
			captureException(error);
		}
	}

	// Publication sur le canal.
	const published = await context.publisher.publishJourneys(journeys);
	// Écriture des clés de tracés.
	await context.publisher.publishShapes(shapesToPublish.values(), nowMs);

	// Décompte agrégé des points omis (faute d'heure théorique résoluble), des entrées écartées
	// (échecs de construction ci-dessus) et rejetés par la validation de `vehicleJourneySchema`.
	const publishedCount = totalPositionTypeCounts(published);
	const rejectedByValidation = journeys.length - publishedCount;
	logger.success(
		"cycle de publication : %d train(s) publié(s), %d point(s) omis, %d train(s) en erreur, %d entrée(s) rejetée(s) par validation.",
		publishedCount,
		omittedCalls,
		buildErrors,
		rejectedByValidation,
	);

	return { published, errorCount: buildErrors };
}
