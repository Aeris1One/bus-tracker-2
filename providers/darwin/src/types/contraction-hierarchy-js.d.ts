// La bibliothèque n'expose pas de types. On déclare uniquement ce que nous employons, vérifié sur
// // la version 2.0.0 installée.
declare module "contraction-hierarchy-js" {
	export type QueryResult = { total_cost: number; nodes?: string[] };
	export type Pathfinder = { queryContractionHierarchy(start: string, end: string): QueryResult };
	export class Graph {
		// Utilisé dans le code
		constructor(geojson?: unknown, options?: { debugMode?: boolean });
		_nodeToIndexLookup: Record<string, number>;
		loadPbfCH(buffer: Buffer | Uint8Array): void;
		createPathfinder(options: { ids?: boolean; path?: boolean; nodes?: boolean; properties?: boolean }): Pathfinder;


		// Utilisé dans les tests
		addEdge(
			start: string,
			end: string,
			edgeProperties: { _cost: number } & Record<string, unknown>,
			edgeGeometry?: unknown,
			isUndirected?: boolean,
		): void;
		contractGraph(): void;
		savePbfCH(path: string): Promise<void>;
	}
}
