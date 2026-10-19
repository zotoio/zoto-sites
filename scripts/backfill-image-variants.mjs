#!/usr/bin/env node
/**
 * One-off backfill: write the resized WebP variants (480/768/1024 wide, q80) next to every existing story PNG.
 *
 * Read-only for the sources: PNGs (and the article JSON, which this never opens) are only read. New files only:
 * <name>-<w>w.webp, each written to a temp file and renamed into place (see backends/botz.ai/imageVariants.js).
 *
 * Resumable: variants that already exist and are complete WebP files are skipped, so it can be stopped
 * (Ctrl-C / SIGTERM: in-flight images finish, nothing half-written is left) and simply run again.
 *
 * Run inside the botz container (sharp there is the musl build):
 *   docker exec botz node /home/root/scripts/backfill-image-variants.mjs --dry-run
 *   docker exec botz node /home/root/scripts/backfill-image-variants.mjs --concurrency 1 --delay-ms 50
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { spawnSync } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const botzPackageRoot = process.env.BOTZ_PACKAGE_ROOT || path.resolve(__dirname, '../backends/botz.ai');
const iv = await import(pathToFileURL(path.join(botzPackageRoot, 'imageVariants.js')).href);

const HELP = `Usage: backfill-image-variants.mjs [options]

  --dir <path>           images directory (default: $CACHE_DIR/images, else /home/root/cache/images)
  --dry-run              count what would be written; write nothing
  --concurrency <n>      images processed in parallel (default 1)
  --delay-ms <n>         pause after each image, per worker (default 25)
  --limit <n>            stop after n images that needed work (default: all)
  --widths <list>        comma-separated widths (default ${iv.VARIANT_WIDTHS.join(',')})
  --quality <n>          WebP quality (default ${iv.WEBP_QUALITY})
  --order <newest|oldest> processing order by file name (default newest)
  --nice <n>             process niceness 0-19 (default 10)
  --ionice <idle|best-effort|none>  I/O priority via ionice when available (default idle)
  --progress-every <n>   log a progress line every n images (default 250; also every 15 s)
  --help
`;

function parseArgs(argv) {
    const o = { dir: null, dryRun: false, concurrency: 1, delayMs: 25, limit: Infinity, widths: [...iv.VARIANT_WIDTHS],
        quality: iv.WEBP_QUALITY, order: 'newest', nice: 10, ionice: 'idle', progressEvery: 250 };
    const num = (v, name, min, max) => {
        const n = Number(v);
        if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${name} must be a number from ${min} to ${max}`);
        return n;
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i], next = () => { if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); return argv[++i]; };
        switch (a) {
            case '--help': case '-h': o.help = true; break;
            case '--dir': o.dir = next(); break;
            case '--dry-run': o.dryRun = true; break;
            case '--concurrency': o.concurrency = num(next(), a, 1, 16); break;
            case '--delay-ms': o.delayMs = num(next(), a, 0, 60000); break;
            case '--limit': o.limit = num(next(), a, 1, 1e9); break;
            case '--widths': o.widths = next().split(',').map(s => num(s.trim(), a, 16, 4096)); break;
            case '--quality': o.quality = num(next(), a, 1, 100); break;
            case '--order': o.order = next(); if (!['newest', 'oldest'].includes(o.order)) throw new Error('--order is newest or oldest'); break;
            case '--nice': o.nice = num(next(), a, 0, 19); break;
            case '--ionice': o.ionice = next(); if (!['idle', 'best-effort', 'none'].includes(o.ionice)) throw new Error('--ionice is idle, best-effort or none'); break;
            case '--progress-every': o.progressEvery = num(next(), a, 1, 1e9); break;
            default: throw new Error(`unknown option ${a}`);
        }
    }
    o.dir = path.resolve(o.dir || path.join(process.env.CACHE_DIR || '/home/root/cache', 'images'));
    return o;
}

const log = (...args) => console.log(`[${new Date().toISOString()}]`, ...args);

function lowerPriority(o) {
    try { os.setPriority(0, o.nice); log(`nice ${o.nice}`); } catch (e) { log(`nice not applied: ${e.message}`); }
    if (o.ionice === 'none') return;
    const cls = o.ionice === 'idle' ? '3' : '2';
    const r = spawnSync('ionice', ['-c', cls, '-p', String(process.pid)], { stdio: 'pipe' });
    log(r.status === 0 ? `ionice class ${o.ionice}` : `ionice not applied (${r.error?.code || r.stderr?.toString().trim() || r.status})`);
}

/** One run per directory at a time (lock lives in the OS temp dir, never in the images directory). */
function acquireLock(dir) {
    const lock = path.join(os.tmpdir(), `botz-image-variants-${crypto.createHash('sha1').update(dir).digest('hex').slice(0, 12)}.lock`);
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            fs.writeFileSync(lock, String(process.pid), { flag: 'wx' });
            return () => { try { fs.unlinkSync(lock); } catch { /* already gone */ } };
        } catch (e) {
            if (e.code !== 'EEXIST') throw e;
            const pid = Number(fs.readFileSync(lock, 'utf8'));
            let alive = false;
            try { process.kill(pid, 0); alive = true; } catch { /* stale */ }
            if (alive && pid !== process.pid) throw new Error(`another backfill (pid ${pid}) is running on ${dir}`);
            fs.unlinkSync(lock);
        }
    }
    throw new Error('could not take the lock');
}

export async function run(argv = process.argv.slice(2)) {
    const o = parseArgs(argv);
    if (o.help) { process.stdout.write(HELP); return { exitCode: 0 }; }
    if (!fs.statSync(o.dir, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`no such directory: ${o.dir}`);
    lowerPriority(o);
    const release = o.dryRun ? () => {} : acquireLock(o.dir);
    let stopping = false, signal = null;
    const onSignal = sig => { if (!stopping) log(`${sig}: finishing in-flight images, then stopping (rerun to resume)`); stopping = true; signal = sig; };
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
    try {
        if (!o.dryRun) {
            const stale = iv.removeStaleVariantTemps(o.dir);
            if (stale) log(`removed ${stale} stale temp file(s) from an earlier interrupted run`);
        }
        const sharp = o.dryRun ? null : await iv.loadSharp();
        if (!o.dryRun && !sharp) throw new Error('sharp is not available in this environment');
        if (sharp) sharp.concurrency(1);   // one libvips thread per image: predictable, low CPU
        const names = fs.readdirSync(o.dir).filter(iv.isSourceImageName).sort();
        if (o.order === 'newest') names.reverse();
        const s = { sources: names.length, scanned: 0, alreadyDone: 0, processed: 0, variantsCreated: 0, wouldCreate: 0, failedImages: 0, failures: [] };
        log(`${o.dryRun ? 'DRY RUN ' : ''}${names.length} source PNGs in ${o.dir}; widths ${o.widths.join('/')} q${o.quality}; concurrency ${o.concurrency}; delay ${o.delayMs} ms`);
        const t0 = Date.now();
        let lastLog = t0, next = 0;
        const progress = force => {
            const now = Date.now();
            if (!force && s.scanned % o.progressEvery !== 0 && now - lastLog < 15000) return;
            lastLog = now;
            const rate = s.processed / Math.max(1, (now - t0) / 1000);
            const left = s.sources - s.scanned;
            log(`progress ${s.scanned}/${s.sources} scanned; ${s.alreadyDone} already done; ${o.dryRun ? `${s.wouldCreate} variants to create` : `${s.processed} processed, ${s.variantsCreated} variants written`}; ${s.failedImages} failed${!o.dryRun && rate > 0 ? `; ~${rate.toFixed(1)} img/s` : ''}${left && !o.dryRun && rate > 0 ? `; worst-case ETA ${Math.round(left / rate / 60)} min` : ''}`);
        };
        const worker = async () => {
            while (!stopping && next < names.length && s.processed < o.limit) {
                const name = names[next++];
                const png = path.join(o.dir, name);
                s.scanned++;
                const missing = iv.missingVariantWidths(png, o.widths);
                if (!missing.length) { s.alreadyDone++; progress(false); continue; }
                if (o.dryRun) { s.processed++; s.wouldCreate += missing.length; progress(false); continue; }
                s.processed++;
                try {
                    const r = await iv.writeVariantsForPng(png, { sharp, widths: o.widths, quality: o.quality });
                    s.variantsCreated += r.created.length;
                    if (r.failed.length) { s.failedImages++; s.failures.push({ name, failed: r.failed }); }
                } catch (error) {
                    if (error instanceof iv.ReadOnlySourceError) { stopping = true; throw error; }   // a guard tripped: stop everything
                    s.failedImages++; s.failures.push({ name, error: error?.message || String(error) });
                }
                progress(false);
                if (o.delayMs) await new Promise(r => setTimeout(r, o.delayMs));
            }
        };
        await Promise.all(Array.from({ length: o.concurrency }, worker));
        progress(true);
        const summary = { dryRun: o.dryRun, dir: o.dir, stoppedBy: signal, complete: !signal && s.scanned === s.sources, seconds: Math.round((Date.now() - t0) / 1000),
            ...s, failures: s.failures.slice(0, 50) };
        log('summary', JSON.stringify(summary));
        return { exitCode: signal ? 130 : (s.failedImages ? 2 : 0), summary };
    } finally {
        process.off('SIGINT', onSignal);
        process.off('SIGTERM', onSignal);
        release();
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    run().then(r => { process.exitCode = r.exitCode; }, error => { console.error(`backfill-image-variants: ${error.message}`); process.exitCode = 1; });
}
