// Assemblage des dépendances du provider.

import type { Configuration } from "./configuration/configuration.js";
import { SHAPE_KEY_LOCAL_VERSION } from "./constants.js";
import type { Publisher } from "./publish/publisher.js";
import type { RailRouter } from "./shapes/route-shape.js";
import type { ShapeStore } from "./shapes/shape-store.js";
import { createShapeStore } from "./shapes/shape-store.js";
import type { AssociationStore } from "./state/association-store.js";
import { createAssociationStore } from "./state/association-store.js";
import type { Counters } from "./state/counters.js";
import { createCounters } from "./state/counters.js";
import type { PendingStatusStore } from "./state/pending-status-store.js";
import { createPendingStatusStore } from "./state/pending-status-store.js";
import type { ReferenceStore } from "./state/reference-store.js";
import { createReferenceStore } from "./state/reference-store.js";
import type { TimetableVersionState } from "./state/timetable-version.js";
import { createTimetableVersionState } from "./state/timetable-version.js";
import type { TrainStore } from "./state/train-store.js";
import { createTrainStore } from "./state/train-store.js";

export type ProviderContext = {
	readonly configuration: Configuration;
	readonly counters: Counters;
	readonly references: ReferenceStore;
	readonly trains: TrainStore;
	readonly associations: AssociationStore;
	readonly pendingStatuses: PendingStatusStore;
	readonly shapes: ShapeStore;
	readonly timetable: TimetableVersionState;
	readonly publisher: Publisher;
	/**
	 * Version du graphe ferroviaire employée dans les clés Redis de tracés, ou
	 * `SHAPE_KEY_LOCAL_VERSION` tant qu'aucun graphe n'est chargé.
	 */
	graphVersion: string;
	/** Absent tant qu'aucun graphe n'est chargé -> tracés rectilignes. */
	router?: RailRouter;
};

/**
 * Assemble le contexte du provider.
 */
export function createContext(configuration: Configuration, publisher: Publisher): ProviderContext {
	return {
		configuration,
		graphVersion: SHAPE_KEY_LOCAL_VERSION,
		counters: createCounters(),
		references: createReferenceStore(),
		trains: createTrainStore(),
		associations: createAssociationStore(),
		pendingStatuses: createPendingStatusStore(),
		shapes: createShapeStore(),
		timetable: createTimetableVersionState(),
		publisher,
	};
}
