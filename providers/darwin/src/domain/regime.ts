// Détermination du segment actif et du régime à un moment donné

import { effectiveArrival, effectiveDeparture, isPassengerTag } from "./call.js";
import type { Segment } from "./segment.js";
import type { Train } from "./train.js";

export type Regime = "PASSENGER" | "ECS";
export type PassengerWindow = { start: number; end: number };

/**
 * Fenêtre de service voyageurs
 */
export function computePassengerWindow(train: Train): PassengerWindow | undefined {
	const eligible = train.calls.filter(
		(call) =>
			isPassengerTag(call.tag) && (effectiveArrival(call) !== undefined || effectiveDeparture(call) !== undefined),
	);
	const first = eligible[0];
	const last = eligible.at(-1);
	if (first === undefined || last === undefined) {
		return undefined;
	}

	const start = effectiveDeparture(first) ?? effectiveArrival(first) ?? 0;
	const end = effectiveArrival(last) ?? effectiveDeparture(last) ?? 0;
	return { start, end };
}

/**
 * Segment actif et régime, à l'instant donné.
 */
export function selectActiveSegment(
	segments: Segment[],
	window: PassengerWindow | undefined,
	nowMs: number,
): { segment: Segment; regime: Regime } {
	const find = (kind: Segment["kind"]) => segments.find((segment) => segment.kind === kind);

	if (window === undefined) {
		const whole = find("WHOLE") ?? segments[0];
		if (whole === undefined) {
			throw new Error("selectActiveSegment: aucun segment fourni");
		}
		return { segment: whole, regime: "ECS" };
	}

	const passenger = find("PASSENGER");
	if (passenger === undefined) {
		throw new Error("selectActiveSegment: fenêtre voyageurs sans section voyageurs");
	}

	if (nowMs < window.start) {
		const trailIn = find("TRAIL_IN");
		return trailIn !== undefined ? { segment: trailIn, regime: "ECS" } : { segment: passenger, regime: "PASSENGER" };
	}
	if (nowMs > window.end) {
		const trailOut = find("TRAIL_OUT");
		return trailOut !== undefined ? { segment: trailOut, regime: "ECS" } : { segment: passenger, regime: "PASSENGER" };
	}
	// Entre début et fin, bornes incluses.
	return { segment: passenger, regime: "PASSENGER" };
}
