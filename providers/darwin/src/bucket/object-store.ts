// Accès en lecture seule au bucket GCS

import { Storage } from "@google-cloud/storage";

export type ObjectStore = {
	/** Noms complets (avec préfixe) des objets sous `prefix`. */
	list(prefix: string): Promise<string[]>;
	download(name: string): Promise<Buffer>;
};

export function createObjectStore(bucket: string, keyFile?: string): ObjectStore {
	const storage = new Storage(keyFile === undefined ? {} : { keyFilename: keyFile });
	const bucketRef = storage.bucket(bucket);

	return {
		async list(prefix) {
			const [files] = await bucketRef.getFiles({ prefix });
			return files.map((file) => file.name);
		},
		async download(name) {
			const [buffer] = await bucketRef.file(name).download();
			return buffer;
		},
	};
}
