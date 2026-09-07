import { describe, expect, it } from "vitest";

import type { Call } from "./call.js";
import { computePosition } from "./position.js";
import { createShape, locateOnShape, type Shape, type ShapeVertex } from "./shape.js";

function makeCall(overrides: Partial<Call> = {}): Call {
	return {
		tag: "IP",
		tiploc: "TIPLOC1",
		activity: "",
		order: 0,
		platformSuppressed: false,
		locationSuppressed: false,
		platformConfirmed: false,
		cancelled: false,
		...overrides,
	};
}

function vertex(overrides: Partial<ShapeVertex> = {}): ShapeVertex {
	return { latitude: 0, longitude: 0, distance: 0, callOrder: 0, ...overrides };
}

/** Coordonnées par TIPLOC, pour construire facilement un `coordinatesOf` de test. */
function coordinatesFrom(table: Record<string, { latitude: number; longitude: number } | undefined>) {
	return (tiploc: string) => table[tiploc];
}

// Tracé synthétique à trois sommets alignés sur l'équateur (mêmes coordonnées que shape.test.ts),
// couvrant les rangs 0, 1 et 2 — mêmes rangs que les calls A, B, C ci-dessous.
function threePointShape(): Shape {
	return createShape("A>B>C", "NR:RoutePath:test", [
		vertex({ latitude: 0, longitude: 0, distance: 0, callOrder: 0 }),
		vertex({ latitude: 0, longitude: 1, distance: 1000, callOrder: 1 }),
		vertex({ latitude: 0, longitude: 2, distance: 2000, callOrder: 2 }),
	]);
}

describe("computePosition — cas 1 : aucun point non annulé", () => {
	it("ancre sur le tout premier point du train, même s'il est lui-même annulé", () => {
		const calls = [
			makeCall({ tiploc: "A", order: 0, cancelled: true, aimedPublicDeparture: 0 }),
			makeCall({ tiploc: "B", order: 1, cancelled: true, aimedPublicArrival: 1000 }),
		];
		const coordinatesOf = coordinatesFrom({ A: { latitude: 51, longitude: -1 }, B: { latitude: 52, longitude: -2 } });
		const result = computePosition(calls, coordinatesOf, undefined, 500);
		expect(result).toEqual({ latitude: 51, longitude: -1, atStop: true });
	});
});

describe("computePosition — cas 2 : avant le départ effectif du premier point", () => {
	it("ancre sur le premier point", () => {
		const calls = [
			makeCall({ tiploc: "A", order: 0, aimedPublicDeparture: 1000 }),
			makeCall({ tiploc: "B", order: 1, aimedPublicArrival: 2000 }),
		];
		const coordinatesOf = coordinatesFrom({ A: { latitude: 51, longitude: -1 }, B: { latitude: 52, longitude: -2 } });
		const result = computePosition(calls, coordinatesOf, undefined, 500);
		expect(result).toEqual({ latitude: 51, longitude: -1, atStop: true });
	});

	it("l'égalité stricte à l'instant du départ effectif ancre aussi sur le premier point", () => {
		const calls = [
			makeCall({ tiploc: "A", order: 0, aimedPublicDeparture: 1000 }),
			makeCall({ tiploc: "B", order: 1, aimedPublicArrival: 2000 }),
		];
		const coordinatesOf = coordinatesFrom({ A: { latitude: 51, longitude: -1 }, B: { latitude: 52, longitude: -2 } });
		const result = computePosition(calls, coordinatesOf, undefined, 1000);
		expect(result.atStop).toBe(true);
		expect(result.latitude).toBe(51);
	});
});

describe("computePosition — cas 3 : après l'arrivée effective du dernier point", () => {
	it("ancre sur le dernier point", () => {
		const calls = [
			makeCall({ tiploc: "A", order: 0, aimedPublicDeparture: 0 }),
			makeCall({ tiploc: "B", order: 1, aimedPublicArrival: 1000 }),
		];
		const coordinatesOf = coordinatesFrom({ A: { latitude: 51, longitude: -1 }, B: { latitude: 52, longitude: -2 } });
		const result = computePosition(calls, coordinatesOf, undefined, 5000);
		expect(result).toEqual({ latitude: 52, longitude: -2, atStop: true });
	});
});

describe("computePosition — cas 4 : entre deux points", () => {
	it("sous-cas « à quai » : nowMs n'a pas atteint le départ effectif du dernier point franchi", () => {
		const calls = [
			makeCall({ tiploc: "A", order: 0, aimedPublicDeparture: 0 }),
			makeCall({ tiploc: "B", order: 1, aimedPublicArrival: 1000, aimedPublicDeparture: 2000 }),
			makeCall({ tiploc: "C", order: 2, aimedPublicArrival: 3000 }),
		];
		const coordinatesOf = coordinatesFrom({
			A: { latitude: 0, longitude: 0 },
			B: { latitude: 0, longitude: 1 },
			C: { latitude: 0, longitude: 2 },
		});
		// nowMs = 1500 : entre l'arrivée (1000) et le départ (2000) de B, donc à quai sur B.
		const result = computePosition(calls, coordinatesOf, undefined, 1500);
		expect(result).toEqual({ latitude: 0, longitude: 1, atStop: true });
	});

	it("sous-cas « span non calculable » (traité comme span <= 0) : ancre sur le point courant plutôt que de propager un NaN", () => {
		// D, le véritable dernier point, porte une arrivée lointaine pour ne jamais déclencher le cas
		// 3 : le point suivant immédiat de B, c'est C, qui lui ne porte AUCUNE heure. `span` (arrivée
		// effective de C moins départ effectif de B) est donc indéfini — jamais négatif au sens
		// numérique strict, car un `s` non encore franchi a par construction une heure effective
		// postérieure à `nowMs` dès qu'elle est connue (sinon `s` serait lui-même le point franchi).
		// L'unique façon réaliste d'obtenir un span non exploitable est donc son absence, traitée par
		// le code exactement comme un span <= 0.
		const calls = [
			makeCall({ tiploc: "A", order: 0, aimedPublicDeparture: 0 }),
			makeCall({ tiploc: "B", order: 1, aimedPublicArrival: 500, aimedPublicDeparture: 1000 }),
			makeCall({ tiploc: "C", order: 2 }),
			makeCall({ tiploc: "D", order: 3, aimedPublicArrival: 5000 }),
		];
		const coordinatesOf = coordinatesFrom({
			A: { latitude: 0, longitude: 0 },
			B: { latitude: 0, longitude: 1 },
			C: { latitude: 0, longitude: 2 },
			D: { latitude: 0, longitude: 3 },
		});
		// nowMs = 1500 : postérieur au départ de B (1000, donc pas « à quai »), très antérieur à
		// l'arrivée de D (5000, donc toujours en cas 4). Le dernier point franchi est B (C n'a aucune
		// heure, donc jamais considéré franchi).
		const result = computePosition(calls, coordinatesOf, undefined, 1500);
		expect(result).toEqual({ latitude: 0, longitude: 1, atStop: true });
	});

	it("interpolation : ratio temporel borné, position sur la corde entre les deux points", () => {
		const calls = [
			makeCall({ tiploc: "A", order: 0, aimedPublicDeparture: 0 }),
			makeCall({ tiploc: "B", order: 1, aimedPublicArrival: 1000 }),
		];
		const coordinatesOf = coordinatesFrom({ A: { latitude: 0, longitude: 0 }, B: { latitude: 0, longitude: 1 } });
		const result = computePosition(calls, coordinatesOf, undefined, 500);
		expect(result.atStop).toBe(false);
		expect(result.longitude).toBeCloseTo(0.5, 6);
		expect(result.latitude).toBeCloseTo(0, 6);
		// Cap de la corde : plein est, longitude croissante sur l'équateur.
		expect(result.bearing).toBeCloseTo(90, 0);
	});

	it("le ratio est borné à [0, 1] même si nowMs déborde légèrement (défense en profondeur)", () => {
		const calls = [
			makeCall({ tiploc: "A", order: 0, aimedPublicDeparture: 0 }),
			makeCall({ tiploc: "B", order: 1, aimedPublicArrival: 1000 }),
		];
		const coordinatesOf = coordinatesFrom({ A: { latitude: 0, longitude: 0 }, B: { latitude: 0, longitude: 1 } });
		// nowMs = 999 : très proche de l'arrivée de B sans l'atteindre (sinon cas 3 s'applique).
		const result = computePosition(calls, coordinatesOf, undefined, 999);
		expect(result.longitude).toBeLessThanOrEqual(1);
		expect(result.longitude).toBeGreaterThan(0.9);
	});
});

describe("computePosition — report d'ancrage (arrière puis avant)", () => {
	it("se reporte vers l'arrière quand le point d'ancrage est sans coordonnée et qu'un point antérieur en a une", () => {
		const calls = [
			makeCall({ tiploc: "A", order: 0, aimedPublicDeparture: 0 }),
			makeCall({ tiploc: "B", order: 1, aimedPublicArrival: 1000 }), // point d'ancrage, sans coordonnée
		];
		const coordinatesOf = coordinatesFrom({ A: { latitude: 51, longitude: -1 } }); // B absent
		// nowMs >= arrivée du dernier point ⇒ cas 3, ancrage sur B.
		const result = computePosition(calls, coordinatesOf, undefined, 5000);
		expect(result).toEqual({ latitude: 51, longitude: -1, atStop: true });
	});

	it("se reporte vers l'avant quand rien n'est trouvé vers l'arrière", () => {
		const calls = [
			makeCall({ tiploc: "A", order: 0, aimedPublicDeparture: 0 }), // point d'ancrage, sans coordonnée
			makeCall({ tiploc: "B", order: 1, aimedPublicArrival: 1000 }),
		];
		const coordinatesOf = coordinatesFrom({ B: { latitude: 52, longitude: -2 } }); // A absent
		// nowMs <= départ effectif du premier point ⇒ cas 2, ancrage sur A, reporté sur B.
		const result = computePosition(calls, coordinatesOf, undefined, -1000);
		expect(result).toEqual({ latitude: 52, longitude: -2, atStop: true });
	});

	it("préfère l'arrière même quand un point coordonné existe aussi vers l'avant", () => {
		const calls = [
			makeCall({ tiploc: "A", order: 0, aimedPublicDeparture: -1000 }),
			// Point d'ancrage (cas 4, sous-cas « à quai »), sans coordonnée : A (arrière) et C (avant)
			// en ont une toutes les deux — l'arrière doit l'emporter.
			makeCall({ tiploc: "B", order: 1, aimedPublicArrival: 0, aimedPublicDeparture: 100 }),
			makeCall({ tiploc: "C", order: 2, aimedPublicArrival: 1000 }),
		];
		const coordinatesOf = coordinatesFrom({
			A: { latitude: 1, longitude: 1 },
			C: { latitude: 3, longitude: 3 },
		});
		// nowMs = 50 : entre l'arrivée (0) et le départ (100) de B ⇒ à quai sur B.
		const result = computePosition(calls, coordinatesOf, undefined, 50);
		expect(result).toEqual({ latitude: 1, longitude: 1, atStop: true });
	});
});

describe("computePosition — atStop", () => {
	it("vaut vrai à l'ancrage", () => {
		const calls = [makeCall({ tiploc: "A", order: 0, aimedPublicDeparture: 0 })];
		const coordinatesOf = coordinatesFrom({ A: { latitude: 1, longitude: 1 } });
		const result = computePosition(calls, coordinatesOf, undefined, -100);
		expect(result.atStop).toBe(true);
	});

	it("vaut faux à l'interpolation", () => {
		const calls = [
			makeCall({ tiploc: "A", order: 0, aimedPublicDeparture: 0 }),
			makeCall({ tiploc: "B", order: 1, aimedPublicArrival: 1000 }),
		];
		const coordinatesOf = coordinatesFrom({ A: { latitude: 0, longitude: 0 }, B: { latitude: 0, longitude: 1 } });
		const result = computePosition(calls, coordinatesOf, undefined, 500);
		expect(result.atStop).toBe(false);
	});
});

describe("computePosition — sans tracé actif", () => {
	it("aucune distanceTraveled n'est publiée et la coordonnée reste celle du calcul de base", () => {
		const calls = [
			makeCall({ tiploc: "A", order: 0, aimedPublicDeparture: 0 }),
			makeCall({ tiploc: "B", order: 1, aimedPublicArrival: 1000 }),
		];
		const coordinatesOf = coordinatesFrom({ A: { latitude: 0, longitude: 0 }, B: { latitude: 0, longitude: 1 } });
		const result = computePosition(calls, coordinatesOf, undefined, 500);
		expect(result.distanceTraveled).toBeUndefined();
		expect(result.longitude).toBeCloseTo(0.5, 6);
	});
});

describe("computePosition — invariant distance/coordonnée", () => {
	it("quand distanceTraveled est publiée, la coordonnée est exactement celle de locateOnShape à cette distance, à plusieurs instants", () => {
		const shape = threePointShape();
		const calls = [
			makeCall({ tiploc: "A", order: 0, aimedPublicDeparture: 0 }),
			makeCall({ tiploc: "B", order: 1, aimedPublicArrival: 1000, aimedPublicDeparture: 1000 }),
			makeCall({ tiploc: "C", order: 2, aimedPublicArrival: 2000 }),
		];
		const coordinatesOf = coordinatesFrom({
			A: { latitude: 0, longitude: 0 },
			B: { latitude: 0, longitude: 1 },
			C: { latitude: 0, longitude: 2 },
		});

		for (const nowMs of [1, 250, 500, 750, 999, 1001, 1250, 1500, 1750, 1999]) {
			const result = computePosition(calls, coordinatesOf, shape, nowMs);
			expect(result.distanceTraveled).toBeDefined();
			const distance = result.distanceTraveled as number;
			const expected = locateOnShape(shape, distance);
			expect(result.latitude).toBeCloseTo(expected.latitude, 9);
			expect(result.longitude).toBeCloseTo(expected.longitude, 9);
			expect(result.bearing).toBeCloseTo(expected.bearing, 9);
		}
	});

	it("les distances publiées croissent avec le temps, conformément au sens de marche", () => {
		const shape = threePointShape();
		const calls = [
			makeCall({ tiploc: "A", order: 0, aimedPublicDeparture: 0 }),
			makeCall({ tiploc: "B", order: 1, aimedPublicArrival: 1000, aimedPublicDeparture: 1000 }),
			makeCall({ tiploc: "C", order: 2, aimedPublicArrival: 2000 }),
		];
		const coordinatesOf = coordinatesFrom({
			A: { latitude: 0, longitude: 0 },
			B: { latitude: 0, longitude: 1 },
			C: { latitude: 0, longitude: 2 },
		});

		let previous = -1;
		for (const nowMs of [1, 500, 999, 1001, 1500, 1999]) {
			const result = computePosition(calls, coordinatesOf, shape, nowMs);
			const distance = result.distanceTraveled as number;
			expect(distance).toBeGreaterThan(previous);
			previous = distance;
		}
	});

	it("un point absent du tracé n'abandonne PAS la géométrie : le calcul se restreint aux points retenus", () => {
		// Régression observée en conditions réelles : 60 % des trains publiant un `pathRef` sans
		// distance se trouvaient à plus de 50 m de leur propre tracé, jusqu'à 28 km. `selectShapeCalls`
		// ne retient que les arrêts voyageurs, si bien qu'un train encadré par des points de passage
		// voyait le calcul abandonner le tracé et retomber sur la corde — tout en publiant le `pathRef`
		// suivant les rails. Le marqueur tombait alors à côté de la ligne dessinée.
		//
		// Le tracé ne porte que les rangs 0 et 2 ; le rang 1 est un point de passage non retenu.
		// L'interpolation doit se faire ENTRE LES POINTS RETENUS, et la position rester sur le tracé.
		const shape = createShape("A>C", "NR:RoutePath:test", [
			vertex({ latitude: 0, longitude: 0, distance: 0, callOrder: 0 }),
			// Sommet intermédiaire : le tracé passe physiquement par le lieu du rang 1 sans le porter.
			vertex({ latitude: 0.5, longitude: 1, distance: 1000, callOrder: 2 }),
			vertex({ latitude: 0, longitude: 2, distance: 2000, callOrder: 2 }),
		]);
		const calls = [
			makeCall({ tiploc: "A", order: 0, aimedPublicDeparture: 0 }),
			makeCall({ tiploc: "PASSAGE", order: 1, aimedWorkingPass: 1000 }),
			makeCall({ tiploc: "C", order: 2, aimedPublicArrival: 2000 }),
		];
		const coordinatesOf = coordinatesFrom({
			A: { latitude: 0, longitude: 0 },
			PASSAGE: { latitude: 0, longitude: 1 },
			C: { latitude: 0, longitude: 2 },
		});

		const result = computePosition(calls, coordinatesOf, shape, 1000);

		// Une distance est publiée, et la position est celle du tracé à cette distance — pas la corde,
		// qui passerait par [0, 1] alors que le tracé culmine à [0.5, 1].
		expect(result.distanceTraveled).toBeDefined();
		const located = locateOnShape(shape, result.distanceTraveled as number);
		expect(result.latitude).toBeCloseTo(located.latitude, 9);
		expect(result.longitude).toBeCloseTo(located.longitude, 9);
		expect(result.latitude).not.toBeCloseTo(0, 3);
	});

	it("les heures des POINTS DE PASSAGE sont honorées, et la position reste sur le tracé", () => {
		// `selectShapeCalls` ne retient que les arrêts voyageurs comme sommets étiquetés, mais le
		// chemin, lui, continue de passer physiquement par les lieux non retenus. Un point de passage
		// doit donc à la fois caler l'interpolation dans le temps ET fournir une distance, par projection.
		//
		// Tracé : A (0 m) ─ point de passage à mi-chemin géométrique (1000 m) ─ C (2000 m).
		// Horaire : A à t=0, PASSAGE à t=100 (donc très tôt), C à t=1000.
		// À t=100 le train est AU point de passage, soit à 1000 m — et non à 10 % de la distance,
		// ce que donnerait une interpolation linéaire ignorant l'heure de passage.
		const shape = createShape("A>C", "NR:RoutePath:test", [
			vertex({ latitude: 0, longitude: 0, distance: 0, callOrder: 0 }),
			vertex({ latitude: 0, longitude: 1, distance: 1000, callOrder: 2 }),
			vertex({ latitude: 0, longitude: 2, distance: 2000, callOrder: 2 }),
		]);
		const calls = [
			makeCall({ tiploc: "A", order: 0, aimedPublicDeparture: 0 }),
			makeCall({ tiploc: "PASSAGE", order: 1, aimedWorkingPass: 100 }),
			makeCall({ tiploc: "C", order: 2, aimedPublicArrival: 1000 }),
		];
		const coordinatesOf = coordinatesFrom({
			A: { latitude: 0, longitude: 0 },
			PASSAGE: { latitude: 0, longitude: 1 },
			C: { latitude: 0, longitude: 2 },
		});

		const result = computePosition(calls, coordinatesOf, shape, 100);

		// Le point de passage a bien servi de borne : on est à sa distance projetée, pas à 10 % du
		// trajet total qu'aurait donné une interpolation d'un bout à l'autre.
		expect(result.distanceTraveled).toBeCloseTo(1000, 0);
		expect(result.distanceTraveled).not.toBeCloseTo(200, 0);
		// Et la position reste exactement sur le tracé.
		const located = locateOnShape(shape, result.distanceTraveled as number);
		expect(result.latitude).toBeCloseTo(located.latitude, 9);
		expect(result.longitude).toBeCloseTo(located.longitude, 9);
	});

	it("la distance projetée d'un rang non étiqueté est mémoïsée sur le tracé", () => {
		const shape = createShape("A>C", "NR:RoutePath:test", [
			vertex({ latitude: 0, longitude: 0, distance: 0, callOrder: 0 }),
			vertex({ latitude: 0, longitude: 2, distance: 2000, callOrder: 2 }),
		]);
		const calls = [
			makeCall({ tiploc: "A", order: 0, aimedPublicDeparture: 0 }),
			makeCall({ tiploc: "PASSAGE", order: 1, aimedWorkingPass: 500 }),
			makeCall({ tiploc: "C", order: 2, aimedPublicArrival: 1000 }),
		];
		const coordinatesOf = coordinatesFrom({
			A: { latitude: 0, longitude: 0 },
			PASSAGE: { latitude: 0, longitude: 1 },
			C: { latitude: 0, longitude: 2 },
		});

		expect(shape.projectedByCallOrder.has(1)).toBe(false);
		computePosition(calls, coordinatesOf, shape, 600);
		expect(shape.projectedByCallOrder.get(1)).toBeCloseTo(1000, 0);
	});

	it("un point ancré présent dans le tracé publie sa distance et voit sa coordonnée redérivée du tracé", () => {
		const shape = threePointShape();
		const calls = [
			makeCall({ tiploc: "A", order: 0, aimedPublicDeparture: 0 }),
			makeCall({ tiploc: "B", order: 1, aimedPublicArrival: 1000 }),
		];
		const coordinatesOf = coordinatesFrom({ A: { latitude: 0, longitude: 0 }, B: { latitude: 0, longitude: 1 } });
		// nowMs >= arrivée effective du dernier point ⇒ cas 3, ancrage sur B (rang 1, présent au tracé).
		const result = computePosition(calls, coordinatesOf, shape, 5000);
		expect(result.atStop).toBe(true);
		expect(result.distanceTraveled).toBe(1000);
		expect(result.latitude).toBeCloseTo(0, 9);
		expect(result.longitude).toBeCloseTo(1, 9);
	});
});

describe("computePosition — cap cohérent avec le sens de marche", () => {
	it("le cap pointe vers l'avant du mouvement, tracé ou corde", () => {
		const shape = threePointShape();
		const calls = [
			makeCall({ tiploc: "A", order: 0, aimedPublicDeparture: 0 }),
			makeCall({ tiploc: "B", order: 1, aimedPublicArrival: 1000, aimedPublicDeparture: 1000 }),
			makeCall({ tiploc: "C", order: 2, aimedPublicArrival: 2000 }),
		];
		const coordinatesOf = coordinatesFrom({
			A: { latitude: 0, longitude: 0 },
			B: { latitude: 0, longitude: 1 },
			C: { latitude: 0, longitude: 2 },
		});
		const onShape = computePosition(calls, coordinatesOf, shape, 500);
		expect(onShape.bearing).toBeCloseTo(90, 0); // longitude croissante ⇒ plein est

		const onChord = computePosition(calls, coordinatesOf, undefined, 500);
		expect(onChord.bearing).toBeCloseTo(90, 0);
	});
});
