import { describe, expect, it } from "vitest";
import { decodeRailGraph } from "./rail-graph.js";

/** Fabrique un `.bin` synthétique au format binaire attendu par `decodeRailGraph`. */
function buildRailGraphBuffer(options: {
	magic?: string;
	graphDate?: number;
	latitudes: number[];
	longitudes: number[];
	arcCount?: number;
	/** Tronque le tampon après ce nombre d'octets, pour simuler un fichier coupé. */
	truncateAt?: number;
}): Buffer {
	const magic = options.magic ?? "RGR1";
	const nodeCount = options.latitudes.length;
	const arcCount = options.arcCount ?? 0;
	const legacyArcTablesSize = 4 * nodeCount + 4 * (nodeCount + 1) + 4 * arcCount * 6 + 4 * arcCount;

	const headerSize = 4 + 4 + 4 + 4 + 4;
	const coordsSize = 4 * nodeCount * 2;
	const totalSize = headerSize + coordsSize + legacyArcTablesSize;

	const buffer = Buffer.alloc(totalSize);
	let offset = 0;
	buffer.write(magic, offset, "latin1");
	offset += 4;
	buffer.writeUInt32LE(options.graphDate ?? 20250101, offset);
	offset += 4;
	buffer.writeUInt32LE(nodeCount, offset);
	offset += 4;
	buffer.writeUInt32LE(arcCount, offset);
	offset += 4;
	buffer.writeUInt32LE(0, offset); // drapeau ignoré
	offset += 4;
	for (const latitude of options.latitudes) {
		buffer.writeFloatLE(latitude, offset);
		offset += 4;
	}
	for (const longitude of options.longitudes) {
		buffer.writeFloatLE(longitude, offset);
		offset += 4;
	}
	// Le reste (tables d'arcs héritées) est laissé à zéro : son contenu n'est jamais lu.

	if (options.truncateAt !== undefined) {
		return buffer.subarray(0, options.truncateAt);
	}
	return buffer;
}

describe("decodeRailGraph", () => {
	it("decodes coordinates and version from a well-formed file", () => {
		const buffer = buildRailGraphBuffer({
			graphDate: 20250315,
			latitudes: [51.5, 52.25, 53.75],
			longitudes: [-0.1, -1.5, 0.25],
			arcCount: 2,
		});

		const graph = decodeRailGraph(buffer);

		// La version est la date rendue en chaîne décimale, jamais un nombre.
		expect(graph.version).toBe("20250315");
		expect(typeof graph.version).toBe("string");
		expect(Array.from(graph.latitudes)).toEqual([Math.fround(51.5), Math.fround(52.25), Math.fround(53.75)]);
		expect(Array.from(graph.longitudes)).toEqual([Math.fround(-0.1), Math.fround(-1.5), Math.fround(0.25)]);
	});

	it("skips the legacy arc tables without materialising them", () => {
		// Un fichier avec un grand nombre d'arcs mais peu de nœuds doit tout de même se décoder :
		// la table héritée est sautée, pas allouée.
		const buffer = buildRailGraphBuffer({
			latitudes: [10, 20],
			longitudes: [30, 40],
			arcCount: 500_000,
		});

		const graph = decodeRailGraph(buffer);
		expect(graph.latitudes.length).toBe(2);
		expect(graph.longitudes.length).toBe(2);
	});

	it("throws on an incorrect magic value", () => {
		const buffer = buildRailGraphBuffer({ magic: "XXXX", latitudes: [1], longitudes: [2] });
		expect(() => decodeRailGraph(buffer)).toThrow();
	});

	it("throws on a truncated file cut in the middle of the header", () => {
		const buffer = buildRailGraphBuffer({ latitudes: [1, 2], longitudes: [3, 4], truncateAt: 10 });
		expect(() => decodeRailGraph(buffer)).toThrow();
	});

	it("throws on a truncated file cut in the middle of the coordinates", () => {
		const full = buildRailGraphBuffer({ latitudes: [1, 2, 3], longitudes: [4, 5, 6] });
		// Coupe avant la fin des longitudes.
		const truncated = full.subarray(0, full.length - 4);
		expect(() => decodeRailGraph(truncated)).toThrow();
	});

	it("throws when the legacy arc tables are truncated", () => {
		const full = buildRailGraphBuffer({ latitudes: [1, 2], longitudes: [3, 4], arcCount: 3 });
		const truncated = full.subarray(0, full.length - 1);
		expect(() => decodeRailGraph(truncated)).toThrow();
	});
});
