import { rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Écrit `data` dans un fichier temporaire puis le renomme à sa place définitive
 */
export async function writeFileAtomic(path: string, data: Buffer | string): Promise<void> {
	const temporaryPath = join(dirname(path), `.${crypto.randomUUID()}.tmp`);
	await writeFile(temporaryPath, data);
	await rename(temporaryPath, path);
}
