import type { TocColors } from "../domain/color.js";
import type { Train } from "../domain/train.js";

export type Configuration = {
	id: string;
	computeDelayMs: number;
	gcsBucket: string;
	/** Chemin d'un fichier d'identifiants, ou undefined pour l'authentification par environnement. */
	gcsKeyFile?: string;
	kafkaBrokers: string[];
	kafkaTopic: string;
	kafkaGroupId: string;
	kafkaSasl: { username: string; password: string };
	/** Codes opérateur à exclure entièrement au chargement des horaires. */
	filterTocs?: string[];
	/** TIPLOC dont les points de desserte sont retirés des horaires au chargement. */
	filterTiplocs?: string[];
	showDeparturesWithinMs: number;
	keepAfterArrivalMs: number;
	mapOperatorRef?: (toc: string) => string | undefined;
	mapHeadcodeToLineName?: (headcode: string) => string;
	tocColors?: TocColors;
	shapePaths?: boolean;
	getNetworkRef: (train?: Train) => string;
};
