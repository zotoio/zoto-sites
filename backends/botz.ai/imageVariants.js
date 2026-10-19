/**
 * Resized WebP variants of the generated story images.
 *
 * The PNG written by saveImageToFile stays the master. Next to it this module writes NEW files only:
 *   <name>.png  ->  <name>-480w.webp, <name>-768w.webp, <name>-1024w.webp
 *
 * Read-only rule: source PNGs and article JSON are never modified, moved, renamed or deleted. Every write here
 * goes through writeFileAtomic(), which calls assertSafeVariantTarget() first: the target must be a "-<w>w.webp"
 * variant of the source, in the same directory, and can never be a .png or .json file.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export const VARIANT_WIDTHS = Object.freeze([480, 768, 1024]);
export const WEBP_QUALITY = 80;

const NAME_BODY = '[A-Za-z0-9][A-Za-z0-9._-]*';
const SOURCE_RE = new RegExp(`^(${NAME_BODY})\\.png$`);
const VARIANT_RE = new RegExp(`^(${NAME_BODY})-(\\d{2,4})w\\.webp$`);
const TEMP_RE = new RegExp(`^\\.(${NAME_BODY}-\\d{2,4}w\\.webp)\\.\\d+\\.[0-9a-f]{8}\\.tmp$`);
const PROTECTED_EXT_RE = /\.(png|json)$/i;

export class ReadOnlySourceError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ReadOnlySourceError';
    }
}

/** Source PNG basename (not a variant, not a temp file). */
export function isSourceImageName(name) {
    return SOURCE_RE.test(String(name ?? ''));
}

export function isVariantName(name) {
    return VARIANT_RE.test(String(name ?? ''));
}

export function isVariantTempName(name) {
    return TEMP_RE.test(String(name ?? ''));
}

/** "x.png" -> "x-768w.webp". */
export function variantName(pngName, width) {
    const m = SOURCE_RE.exec(path.basename(String(pngName ?? '')));
    if (!m) throw new Error(`not a source PNG name: ${pngName}`);
    if (!Number.isInteger(width) || width < 16 || width > 4096) throw new Error(`bad variant width: ${width}`);
    return `${m[1]}-${width}w.webp`;
}

export function variantPath(pngPath, width) {
    return path.join(path.dirname(pngPath), variantName(pngPath, width));
}

/**
 * Throws ReadOnlySourceError unless `targetPath` is a WebP variant of `sourcePath` in the same directory.
 * This is the only gate in front of every write this module makes.
 */
export function assertSafeVariantTarget(targetPath, sourcePath) {
    const target = path.resolve(String(targetPath ?? ''));
    const source = path.resolve(String(sourcePath ?? ''));
    const name = path.basename(target);
    if (PROTECTED_EXT_RE.test(name)) throw new ReadOnlySourceError(`refusing to write a protected file: ${target}`);
    if (target === source) throw new ReadOnlySourceError(`refusing to write over the source: ${target}`);
    if (path.dirname(target) !== path.dirname(source)) throw new ReadOnlySourceError(`variant must sit next to its source: ${target}`);
    const v = VARIANT_RE.exec(name), s = SOURCE_RE.exec(path.basename(source));
    if (!v || !s || v[1] !== s[1]) throw new ReadOnlySourceError(`not a WebP variant of ${path.basename(source)}: ${name}`);
    return target;
}

/** Complete WebP file: RIFF header, WEBP form type, and the RIFF length matches the file size (catches truncation). */
export function isValidWebpFile(filePath) {
    let fd;
    try {
        const st = fs.statSync(filePath);
        if (!st.isFile() || st.size < 20) return false;
        fd = fs.openSync(filePath, 'r');
        const head = Buffer.alloc(12);
        if (fs.readSync(fd, head, 0, 12, 0) !== 12) return false;
        if (head.toString('ascii', 0, 4) !== 'RIFF' || head.toString('ascii', 8, 12) !== 'WEBP') return false;
        const riff = head.readUInt32LE(4);
        return riff + 8 === st.size;   // RIFF size covers everything after the 8-byte header (pad byte included)
    } catch {
        return false;
    } finally {
        if (fd !== undefined) fs.closeSync(fd);
    }
}

/** Write `data` to a new temp file next to the target, fsync, then rename it into place (never a partial file). */
export async function writeFileAtomic(targetPath, data, sourcePath) {
    const target = assertSafeVariantTarget(targetPath, sourcePath);
    const tmp = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`);
    if (!isVariantTempName(path.basename(tmp))) throw new ReadOnlySourceError(`bad temp name: ${tmp}`);
    let fh;
    try {
        fh = await fs.promises.open(tmp, 'wx');
        await fh.writeFile(data);
        await fh.sync();
        await fh.close();
        fh = null;
        assertSafeVariantTarget(target, sourcePath);
        await fs.promises.rename(tmp, target);
    } catch (error) {
        if (fh) await fh.close().catch(() => {});
        await fs.promises.unlink(tmp).catch(() => {});
        throw error;
    }
    return target;
}

/** Remove leftover temp files from an interrupted run (only names matching our own temp pattern, older than maxAgeMs). */
export function removeStaleVariantTemps(dir, { maxAgeMs = 60 * 60 * 1000, now = Date.now() } = {}) {
    let removed = 0;
    for (const name of fs.readdirSync(dir)) {
        if (!isVariantTempName(name)) continue;
        const p = path.join(dir, name);
        try {
            if (now - fs.statSync(p).mtimeMs < maxAgeMs) continue;
            fs.unlinkSync(p);
            removed++;
        } catch { /* gone already */ }
    }
    return removed;
}

let sharpPromise = null;
/** sharp is loaded lazily: when it is missing the PNG path keeps working and variants are simply skipped. */
export function loadSharp() {
    if (!sharpPromise) {
        sharpPromise = import('sharp').then(m => {
            const sharp = m.default || m;
            sharp.cache(false);
            return sharp;
        }).catch(error => {
            console.error('imageVariants: sharp unavailable, WebP variants disabled:', error?.message || error);
            return null;
        });
    }
    return sharpPromise;
}

/** Widths whose variant is missing or invalid. */
export function missingVariantWidths(pngPath, widths = VARIANT_WIDTHS) {
    return widths.filter(w => !isValidWebpFile(variantPath(pngPath, w)));
}

/**
 * Create the missing WebP variants for one PNG. Existing valid variants are skipped (idempotent and resumable).
 * The PNG is only read. Returns { created, skipped, failed } as lists of widths.
 */
export async function writeVariantsForPng(pngPath, { sharp, widths = VARIANT_WIDTHS, quality = WEBP_QUALITY, dryRun = false } = {}) {
    if (!isSourceImageName(path.basename(pngPath))) throw new Error(`not a source PNG: ${pngPath}`);
    const todo = missingVariantWidths(pngPath, widths);
    const result = { created: [], skipped: widths.filter(w => !todo.includes(w)), failed: [] };
    if (!todo.length || dryRun) {
        if (dryRun) result.wouldCreate = todo;
        return result;
    }
    const lib = sharp || await loadSharp();
    if (!lib) {
        result.failed = todo.map(w => ({ width: w, error: 'sharp unavailable' }));
        return result;
    }
    const input = await fs.promises.readFile(pngPath);   // read-only
    for (const w of todo) {
        try {
            const out = await lib(input, { failOn: 'none' })
                .resize({ width: w, withoutEnlargement: true })
                .webp({ quality })
                .toBuffer();
            await writeFileAtomic(variantPath(pngPath, w), out, pngPath);
            result.created.push(w);
        } catch (error) {
            if (error instanceof ReadOnlySourceError) throw error;
            result.failed.push({ width: w, error: error?.message || String(error) });
        }
    }
    return result;
}
