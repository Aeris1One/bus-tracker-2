import { createBinaryReader } from "../utils/binary-reader.js";

/** Magic ASCII attendue en tête du fichier. */
const RAIL_GRAPH_MAGIC = "RGR1";

export type RailGraph = {
	/** Date du graphe rendue en chaîne décimale : c'est la version employée dans les clés Redis. */
	readonly version: string;
	readonly latitudes: Float32Array;
	readonly longitudes: Float32Array;
};

/**
 * Décode un `rail-graph-<date>.bin`.
 */
export function decodeRailGraph(buffer: Buffer): RailGraph {
	const reader = createBinaryReader(buffer);

	const magic = reader.readMagic(RAIL_GRAPH_MAGIC.length);
	if (magic !== RAIL_GRAPH_MAGIC) {
		throw new Error(`Magic de graphe ferroviaire invalide : "${magic}" au lieu de "${RAIL_GRAPH_MAGIC}".`);
	}

	const graphDate = reader.readUInt32();
	const nodeCount = reader.readUInt32();
	const arcCount = reader.readUInt32();
	reader.readUInt32(); // flag

	const latitudes = reader.readFloat32Array(nodeCount);
	const longitudes = reader.readFloat32Array(nodeCount);

	// Le reste du fichier — tables d'arcs héritées — n'est jamais lu. On skip pour éviter une erreur.
	const legacyArcTablesSize = 4 * nodeCount + 4 * (nodeCount + 1) + 4 * arcCount * 6 + 4 * arcCount;
	reader.skip(legacyArcTablesSize);

	return {
		version: String(graphDate),
		latitudes,
		longitudes,
	};
}
