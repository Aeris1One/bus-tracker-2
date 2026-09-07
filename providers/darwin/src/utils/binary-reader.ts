/** Lecteur petit-boutiste séquentiel sur un tampon, utilisé pour décoder les fichiers binaires. */
export type BinaryReader = {
	readUInt32(): number;
	readInt32(): number;
	readFloat32Array(count: number): Float32Array;
	readFloat64Array(count: number): Float64Array;
	/** Chaîne préfixée par sa longueur (uint32) encodée en UTF-8. */
	readString(): string;
	skip(count: number): void;
	/** Lit `length` octets et les rend tels quels, pour comparaison à une signature attendue. */
	readMagic(length: number): string;
	readonly offset: number;
	readonly length: number;
};

/**
 * Fabrique un lecteur sur `buffer`.
 */
export function createBinaryReader(buffer: Buffer): BinaryReader {
	let offset = 0;

	function ensure(size: number): void {
		if (offset + size > buffer.length) {
			throw new RangeError(
				`Lecture hors limites : ${size} octet(s) demandé(s) à l'offset ${offset}, tampon de ${buffer.length} octet(s).`,
			);
		}
	}

	return {
		readUInt32() {
			ensure(4);
			const value = buffer.readUInt32LE(offset);
			offset += 4;
			return value;
		},
		readInt32() {
			ensure(4);
			const value = buffer.readInt32LE(offset);
			offset += 4;
			return value;
		},
		readFloat32Array(count) {
			ensure(count * 4);
			const values = new Float32Array(count);
			for (let i = 0; i < count; i += 1) {
				values[i] = buffer.readFloatLE(offset);
				offset += 4;
			}
			return values;
		},
		readFloat64Array(count) {
			ensure(count * 8);
			const values = new Float64Array(count);
			for (let i = 0; i < count; i += 1) {
				values[i] = buffer.readDoubleLE(offset);
				offset += 8;
			}
			return values;
		},
		readString() {
			ensure(4);
			const length = buffer.readUInt32LE(offset);
			offset += 4;
			ensure(length);
			const value = buffer.toString("utf8", offset, offset + length);
			offset += length;
			return value;
		},
		skip(count) {
			ensure(count);
			offset += count;
		},
		readMagic(length) {
			ensure(length);
			const value = buffer.toString("latin1", offset, offset + length);
			offset += length;
			return value;
		},
		get offset() {
			return offset;
		},
		get length() {
			return buffer.length;
		},
	};
}
