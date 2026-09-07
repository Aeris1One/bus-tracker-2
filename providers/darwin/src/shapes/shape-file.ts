// Index des tracés sur disque, sous DATA_DIR.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createShape, type Shape, type ShapeVertex } from "../domain/shape.js";
import { writeFileAtomic } from "../utils/atomic-write.js";
import { createBinaryReader } from "../utils/binary-reader.js";
import { logger } from "../utils/logger.js";

/** Magic ASCII attendue en tête du fichier. */
const SHAPE_FILE_MAGIC = "SHP1";

function shapeFilePath(dataDir: string, timetableId: string, graphVersion: string): string {
	// Le nom porte les deux versions : un changement d'horaires OU de graphe rend le fichier
	// inutilisable sans qu'il faille l'invalider explicitement.
	return join(dataDir, `shapes-${timetableId}-${graphVersion}.bin`);
}

function encodeString(value: string): Buffer {
	const body = Buffer.from(value, "utf8");
	const length = Buffer.alloc(4);
	length.writeUInt32LE(body.length, 0);
	return Buffer.concat([length, body]);
}

/**
 * Lit l'index des tracés en cache. Absent, tronqué ou de magie incorrecte ⇒ liste vide, **jamais**
 * d'exception.
 */
export async function readShapeFile(dataDir: string, timetableId: string, graphVersion: string): Promise<Shape[]> {
	const path = shapeFilePath(dataDir, timetableId, graphVersion);

	let buffer: Buffer;
	try {
		buffer = await readFile(path);
	} catch {
		// Fichier absent (ou illisible) : traité comme absent, sans avertissement — c'est le cas
		// nominal du tout premier démarrage sur une version d'horaires ou de graphe donnée.
		return [];
	}

	try {
		const reader = createBinaryReader(buffer);
		const magic = reader.readMagic(SHAPE_FILE_MAGIC.length);
		if (magic !== SHAPE_FILE_MAGIC) {
			logger.warning("fichier de tracés %s avec magic incorrecte, traité comme absent.", path);
			return [];
		}

		const entryCount = reader.readUInt32();
		const shapes: Shape[] = [];
		for (let entry = 0; entry < entryCount; entry += 1) {
			const canonicalKey = reader.readString();
			const redisKey = reader.readString();
			const pointCount = reader.readUInt32();
			const latitudes = reader.readFloat64Array(pointCount);
			const longitudes = reader.readFloat64Array(pointCount);
			const distances = reader.readFloat64Array(pointCount);

			const vertices: ShapeVertex[] = [];
			for (let index = 0; index < pointCount; index += 1) {
				const callOrder = reader.readInt32();
				const latitude = latitudes[index];
				const longitude = longitudes[index];
				const distance = distances[index];
				if (latitude === undefined || longitude === undefined || distance === undefined) {
					// `createBinaryReader` aurait déjà levé une erreur sur un tampon trop court ; ce garde-fou ne
					// couvre qu'une incohérence interne entre `pointCount` et les tableaux lus.
					// noinspection ExceptionCaughtLocallyJS
					throw new Error("fichier de tracés incohérent : point hors bornes");
				}
				vertices.push({ latitude, longitude, distance, callOrder });
			}
			shapes.push(createShape(canonicalKey, redisKey, vertices));
		}
		return shapes;
	} catch (error) {
		logger.warning("fichier de tracés %s illisible, traité comme absent : %s", path, String(error));
		return [];
	}
}

/**
 * Écrit l'index des tracés
 */
export async function writeShapeFile(
	dataDir: string,
	timetableId: string,
	graphVersion: string,
	shapes: Iterable<Shape>,
): Promise<void> {
	const path = shapeFilePath(dataDir, timetableId, graphVersion);
	try {
		const shapeList = [...shapes];
		const chunks: Buffer[] = [];

		const header = Buffer.alloc(8);
		header.write(SHAPE_FILE_MAGIC, 0, "latin1");
		header.writeUInt32LE(shapeList.length, 4);
		chunks.push(header);

		for (const shape of shapeList) {
			chunks.push(encodeString(shape.canonicalKey));
			chunks.push(encodeString(shape.redisKey));

			const pointCount = shape.length;
			const countBuffer = Buffer.alloc(4);
			countBuffer.writeUInt32LE(pointCount, 0);
			chunks.push(countBuffer);

			// Les tableaux typés du tracé sont déjà dans la disposition du fichier (petit-boutiste,
			// float64 puis int32), pas de conversion.
			chunks.push(
				Buffer.from(shape.latitudes.buffer, shape.latitudes.byteOffset, pointCount * 8),
				Buffer.from(shape.longitudes.buffer, shape.longitudes.byteOffset, pointCount * 8),
				Buffer.from(shape.distances.buffer, shape.distances.byteOffset, pointCount * 8),
				Buffer.from(shape.callOrders.buffer, shape.callOrders.byteOffset, pointCount * 4),
			);
		}

		await writeFileAtomic(path, Buffer.concat(chunks));
	} catch (error) {
		logger.warning("échec de l'écriture du fichier de tracés %s : %s", path, String(error));
	}
}
