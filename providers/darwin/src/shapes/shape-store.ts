// Mutualisation des tracés.

import type { Shape } from "../domain/shape.js";

export type ShapeStore = {
	get(canonicalKey: string): Shape | undefined;
	set(shape: Shape): void;
	/** Retire les clés d'un train dont l'horaire vient d'être remplacé, calculées sur son ancien parcours. */
	invalidate(canonicalKeys: Iterable<string>): void;
	/** Vidage intégral à chaque rechargement des horaires statiques. */
	clear(): void;
	values(): IterableIterator<Shape>;
	readonly size: number;
};

export function createShapeStore(): ShapeStore {
	const shapes = new Map<string, Shape>();

	return {
		get(canonicalKey) {
			return shapes.get(canonicalKey);
		},
		set(shape) {
			shapes.set(shape.canonicalKey, shape);
		},
		invalidate(canonicalKeys) {
			for (const key of canonicalKeys) {
				shapes.delete(key);
			}
		},
		clear() {
			shapes.clear();
		},
		values() {
			return shapes.values();
		},
		get size() {
			return shapes.size;
		},
	};
}
