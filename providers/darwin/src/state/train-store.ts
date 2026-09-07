// Trains indexés par `${ssd}|${rid}`. Durée de vie : remplacé à chaque rechargement d'horaires,
// purgé individuellement par balayage.

import type { Train } from "../domain/train.js";
import { trainKey } from "../domain/train.js";

export type TrainStore = {
	get(ssd: string, rid: string): Train | undefined;
	set(train: Train): void;
	delete(ssd: string, rid: string): void;
	clear(): void;
	values(): IterableIterator<Train>;
	readonly size: number;
};

export function createTrainStore(): TrainStore {
	const trains = new Map<string, Train>();

	return {
		get(ssd, rid) {
			return trains.get(trainKey(ssd, rid));
		},
		set(train) {
			trains.set(trainKey(train.ssd, train.rid), train);
		},
		delete(ssd, rid) {
			trains.delete(trainKey(ssd, rid));
		},
		clear() {
			trains.clear();
		},
		values() {
			return trains.values();
		},
		get size() {
			return trains.size;
		},
	};
}
