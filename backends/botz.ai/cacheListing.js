import fs from 'fs';

const CACHE_FILE_RE = /^(\d{4}-\d{2}-\d{2})-\d{2}(-\d{13})?\.json$/;

/** Top-level public editorial JSON filenames (excludes dot-directories like .replaced). */
export function isPublicEditorialCacheFileName(name) {
    if (!name || name.startsWith('.')) {
        return false;
    }
    return CACHE_FILE_RE.test(name);
}

export function listPublicEditorialCacheFileNames(cacheDir) {
    if (!fs.existsSync(cacheDir)) {
        return [];
    }
    return fs
        .readdirSync(cacheDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && isPublicEditorialCacheFileName(entry.name))
        .map((entry) => entry.name);
}
