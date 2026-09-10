export const positionTypes = ["GPS", "ESTIMATED", "SCHEDULED"] as const;

export type PositionType = (typeof positionTypes)[number];

/** Structure minimale acceptée : aussi bien un `VehicleJourney` qu'un `DisposeableVehicleJourney`. */
export type PositionTypeInput = {
	position: { type: string };
	calls?: readonly { expectedTime?: string }[];
};

/**
 * Qualifie la provenance d'une position : GPS lorsqu'elle vient du véhicule, sinon ESTIMATED
 * si la course porte des horaires temps réel, et SCHEDULED lorsqu'elle est purement théorique.
 */
export function getPositionType(journey: PositionTypeInput): PositionType {
	if (journey.position.type === "GPS") return "GPS";
	return journey.calls?.some((call) => call.expectedTime !== undefined) ? "ESTIMATED" : "SCHEDULED";
}
