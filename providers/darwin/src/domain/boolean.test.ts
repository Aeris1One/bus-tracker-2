import { describe, expect, it } from "vitest";

import { toBoolean } from "./boolean.js";

describe("toBoolean(value)", () => {
	it.each([
		[true, true],
		["true", true],
		[false, false],
		["false", false],
		["1", false],
		[1, false],
		["yes", false],
		[undefined, false],
		[null, false],
		["", false],
		["TRUE", false],
	])("toBoolean(%o) === %o", (value, expected) => {
		expect(toBoolean(value)).toBe(expected);
	});
});
