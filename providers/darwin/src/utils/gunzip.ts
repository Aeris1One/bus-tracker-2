import { promisify } from "node:util";
import { gunzip as gunzipCallback } from "node:zlib";

/** Décompression gzip */
export const gunzip = promisify(gunzipCallback);
