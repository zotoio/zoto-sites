import fs from 'fs';
import path from 'path';

export function replacedArchiveDir(cacheDir) {
    return path.join(cacheDir, '.replaced');
}

export function parseLocalImageFilename(imageUrl) {
    if (!imageUrl || typeof imageUrl !== 'string') {
        return null;
    }
    const match = imageUrl.match(/\/cache\/images\/([^/?#]+)$/);
    return match ? match[1] : null;
}

function moveFileSafe(fromPath, toPath) {
    fs.mkdirSync(path.dirname(toPath), { recursive: true });
    if (fs.existsSync(toPath)) {
        throw new Error(`Refusing to overwrite archived file: ${toPath}`);
    }
    fs.renameSync(fromPath, toPath);
}

/**
 * Move a backfilled editorial JSON (and local hero image) into cache/.replaced/.
 * @returns {{ jsonArchived: string, imageArchived?: string }}
 */
export function archiveBackfilledEditorial(cacheDir, cacheKey) {
    const cacheFilePath = path.join(cacheDir, `${cacheKey}.json`);
    if (!fs.existsSync(cacheFilePath)) {
        throw new Error(`Cache file not found: ${cacheFilePath}`);
    }

    const payload = JSON.parse(fs.readFileSync(cacheFilePath, 'utf8'));
    const article = payload?.[0]?.article;
    if (!article?.backfilled) {
        throw new Error(`Refusing --replace: ${cacheKey} is not a backfilled editorial`);
    }

    const archiveRoot = replacedArchiveDir(cacheDir);
    const jsonArchivePath = path.join(archiveRoot, `${cacheKey}.json`);
    moveFileSafe(cacheFilePath, jsonArchivePath);

    let imageArchived;
    const imageName = parseLocalImageFilename(article.image_url);
    if (imageName) {
        const fromImage = path.join(cacheDir, 'images', imageName);
        if (fs.existsSync(fromImage)) {
            imageArchived = path.join(archiveRoot, 'images', imageName);
            moveFileSafe(fromImage, imageArchived);
        }
    }

    return { jsonArchived: jsonArchivePath, imageArchived };
}
