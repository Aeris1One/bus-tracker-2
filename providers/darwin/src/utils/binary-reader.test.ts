import { describe, expect, it } from "vitest";
import { createBinaryReader } from "./binary-reader.js";

describe("createBinaryReader", () => {
	it("reads little-endian integers sequentially", () => {
		const buffer = Buffer.alloc(8);
		buffer.writeUInt32LE(0x0000_0001, 0);
		buffer.writeInt32LE(-42, 4);

		const reader = createBinaryReader(buffer);
		expect(reader.readUInt32()).toBe(1);
		expect(reader.readInt32()).toBe(-42);
		expect(reader.offset).toBe(8);
	});

	it("reads float32 and float64 arrays", () => {
		const buffer = Buffer.alloc(4 * 2 + 8 * 2);
		buffer.writeFloatLE(1.5, 0);
		buffer.writeFloatLE(-2.5, 4);
		buffer.writeDoubleLE(3.25, 8);
		buffer.writeDoubleLE(-4.75, 16);

		const reader = createBinaryReader(buffer);
		expect(Array.from(reader.readFloat32Array(2))).toEqual([1.5, -2.5]);
		expect(Array.from(reader.readFloat64Array(2))).toEqual([3.25, -4.75]);
	});

	it("reads a length-prefixed string", () => {
		const text = Buffer.from("RGR1", "utf8");
		const buffer = Buffer.alloc(4 + text.length);
		buffer.writeUInt32LE(text.length, 0);
		text.copy(buffer, 4);

		const reader = createBinaryReader(buffer);
		expect(reader.readString()).toBe("RGR1");
	});

	it("reads a fixed-length magic value", () => {
		const buffer = Buffer.from("RGR1", "latin1");
		const reader = createBinaryReader(buffer);
		expect(reader.readMagic(4)).toBe("RGR1");
	});

	it("skips a given number of bytes", () => {
		const buffer = Buffer.alloc(8);
		buffer.writeUInt32LE(0xdead_beef, 3);
		const reader = createBinaryReader(buffer);
		reader.skip(3);
		expect(reader.offset).toBe(3);
		expect(reader.readUInt32()).toBe(0xdead_beef);
	});

	it("throws when reading past the end of the buffer", () => {
		const buffer = Buffer.alloc(2);
		const reader = createBinaryReader(buffer);
		expect(() => reader.readUInt32()).toThrow(RangeError);
	});

	it("throws when a truncated file is skipped past its end", () => {
		const buffer = Buffer.alloc(3);
		const reader = createBinaryReader(buffer);
		expect(() => reader.skip(4)).toThrow(RangeError);
	});

	it("throws when a length-prefixed string announces more bytes than remain", () => {
		const buffer = Buffer.alloc(4);
		buffer.writeUInt32LE(100, 0);
		const reader = createBinaryReader(buffer);
		expect(() => reader.readString()).toThrow(RangeError);
	});
});
