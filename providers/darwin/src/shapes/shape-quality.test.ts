import { afterEach, describe, expect, it, vi } from "vitest";
import { createCounters } from "../state/counters.js";
import { logger } from "../utils/logger.js";
import { checkShapeQuality } from "./shape-quality.js";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("checkShapeQuality", () => {
	it("silencieux quand shape:total === 0, quels que soient les autres compteurs", () => {
		const warning = vi.spyOn(logger, "warning").mockImplementation(() => {});
		const counters = createCounters();
		counters.increment("shape:bridge", 1000); // ne devrait jamais être lu : total est nul

		checkShapeQuality(counters);

		expect(warning).not.toHaveBeenCalled();
	});

	it("silencieux quand les trois seuils sont respectés", () => {
		const warning = vi.spyOn(logger, "warning").mockImplementation(() => {});
		const counters = createCounters();
		counters.increment("shape:total", 100);
		counters.increment("shape:bridge", 1); // 1 % < 2 %
		counters.increment("shape:bridge:len", 100); // moyenne 100 m < 800 m
		counters.increment("shape:ratio:1-1.6", 99);
		counters.increment("shape:ratio:<1", 1); // 1 % < 2 %

		checkShapeQuality(counters);

		expect(warning).not.toHaveBeenCalled();
	});

	it("déclenche sur le seuil du taux de ponts (> 2 %)", () => {
		const warning = vi.spyOn(logger, "warning").mockImplementation(() => {});
		const counters = createCounters();
		counters.increment("shape:total", 100);
		counters.increment("shape:bridge", 3); // 3 % > 2 %
		counters.increment("shape:bridge:len", 100); // moyenne 33 m, sous le seuil
		counters.increment("shape:ratio:1-1.6", 100);

		checkShapeQuality(counters);

		expect(warning).toHaveBeenCalledTimes(1);
		const message = warning.mock.calls[0]?.[0];
		expect(message).toContain("taux de ponts");
		expect(message).toContain("shape:total=100");
	});

	it("déclenche sur le seuil de longueur moyenne des ponts (> 800 m)", () => {
		const warning = vi.spyOn(logger, "warning").mockImplementation(() => {});
		const counters = createCounters();
		counters.increment("shape:total", 100);
		counters.increment("shape:bridge", 1); // 1 % < 2 %, sous le seuil de taux
		counters.increment("shape:bridge:len", 900); // moyenne 900 m > 800 m
		counters.increment("shape:ratio:1-1.6", 100);

		checkShapeQuality(counters);

		expect(warning).toHaveBeenCalledTimes(1);
		expect(warning.mock.calls[0]?.[0]).toContain("longueur moyenne des ponts");
	});

	it("déclenche sur le seuil de tracés hors bande saine (> 2 %)", () => {
		const warning = vi.spyOn(logger, "warning").mockImplementation(() => {});
		const counters = createCounters();
		counters.increment("shape:total", 100);
		counters.increment("shape:ratio:<1", 2);
		counters.increment("shape:ratio:>2", 1); // (2+1)/100 = 3 % > 2 %
		counters.increment("shape:ratio:1-1.6", 97);

		checkShapeQuality(counters);

		expect(warning).toHaveBeenCalledTimes(1);
		expect(warning.mock.calls[0]?.[0]).toContain("hors bande saine");
	});

	it("énumère tous les seuils franchis et les compteurs concernés quand plusieurs sont dépassés à la fois", () => {
		const warning = vi.spyOn(logger, "warning").mockImplementation(() => {});
		const counters = createCounters();
		counters.increment("shape:total", 100);
		counters.increment("shape:bridge", 5); // 5 % > 2 %
		counters.increment("shape:bridge:len", 5000); // moyenne 1000 m > 800 m
		counters.increment("shape:ratio:<1", 5); // 5 % > 2 %

		checkShapeQuality(counters);

		expect(warning).toHaveBeenCalledTimes(1);
		const message = warning.mock.calls[0]?.[0];
		expect(message).toContain("taux de ponts");
		expect(message).toContain("longueur moyenne des ponts");
		expect(message).toContain("hors bande saine");
		expect(message).toContain("shape:bridge=5");
		expect(message).toContain("shape:bridge:len=5000");
	});
});
