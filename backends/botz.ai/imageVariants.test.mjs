import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import {
    VARIANT_WIDTHS,
    ReadOnlySourceError,
    assertSafeVariantTarget,
    isSourceImageName,
    isValidWebpFile,
    isVariantTempName,
    missingVariantWidths,
    removeStaleVariantTemps,
    variantName,
    variantPath,
    writeFileAtomic,
    writeVariantsForPng,
} from './imageVariants.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(here, '../../scripts/backfill-image-variants.mjs');
const { run } = await import(SCRIPT);

const KEY = h => `2026-10-${String(h).padStart(2, '0')}-12-${crypto.createHash('sha256').update(String(h)).digest('hex')}`;

const tempRoots = [];
test.after(() => { for (const r of tempRoots) fs.rmSync(r, { recursive: true, force: true }); });

async function makeCache(count = 3, size = 1024) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'botz-variants-'));
    tempRoots.push(root);
    const images = path.join(root, 'images');
    fs.mkdirSync(images);
    for (let i = 1; i <= count; i++) {
        const png = await sharp({ create: { width: size, height: size, channels: 3, background: { r: 20 * i, g: 120, b: 200 - 10 * i } } })
            .png().toBuffer();
        fs.writeFileSync(path.join(images, `${KEY(i)}.png`), png);
        fs.writeFileSync(path.join(root, `2026-10-${String(i).padStart(2, '0')}-12.json`), JSON.stringify([{ article: { image_url: `/cache/images/${KEY(i)}.png` } }]));
    }
    return { root, images };
}

/** sha256 + mtime + mode of every source PNG and article JSON under root. */
function snapshotSources(root) {
    const out = {};
    const walk = dir => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) walk(p);
            else if (/\.(png|json)$/i.test(e.name)) {
                const st = fs.statSync(p);
                out[path.relative(root, p)] = `${crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')}|${st.mtimeMs}|${st.mode}|${st.ino}`;
            }
        }
    };
    walk(root);
    return out;
}

const listing = dir => fs.readdirSync(dir).sort();
const variantMtimes = images => Object.fromEntries(listing(images).filter(n => n.endsWith('.webp')).map(n => [n, fs.statSync(path.join(images, n)).mtimeMs]));

/** Spy on every fs write/rename/delete; returns the touched paths. */
function spyWrites() {
    const touched = [];
    const restore = [];
    const wrap = (obj, name, pick) => {
        const orig = obj[name];
        obj[name] = function (...args) { const p = pick(args); if (p) touched.push(String(p)); return orig.apply(this, args); };
        restore.push(() => { obj[name] = orig; });
    };
    const isWriteFlag = f => typeof f === 'string' && /[wa+]/.test(f);
    for (const n of ['writeFileSync', 'appendFileSync', 'unlinkSync', 'rmSync', 'truncateSync', 'copyFileSync', 'chmodSync', 'utimesSync']) wrap(fs, n, a => a[0]);
    wrap(fs, 'renameSync', a => `${a[0]} -> ${a[1]}`);
    wrap(fs, 'openSync', a => (isWriteFlag(a[1]) ? a[0] : null));
    for (const n of ['writeFile', 'appendFile', 'unlink', 'rm', 'truncate', 'copyFile', 'chmod', 'utimes']) wrap(fs.promises, n, a => a[0]);
    wrap(fs.promises, 'rename', a => `${a[0]} -> ${a[1]}`);
    wrap(fs.promises, 'open', a => (isWriteFlag(a[1]) ? a[0] : null));
    return { touched, restore: () => restore.forEach(r => r()) };
}
/** Every write landed on a WebP variant or our own temp file, never on a .png/.json. */
function assertOnlyVariantWrites(touched, images) {
    for (const t of touched) {
        for (const p of t.split(' -> ')) {
            if (!p.startsWith(images) && !p.startsWith(os.tmpdir() + path.sep + 'botz-image-variants-')) assert.fail(`write outside images dir: ${p}`);
            const name = path.basename(p);
            assert.ok(!/\.(png|json)$/i.test(name), `write touched a protected file: ${p}`);
            assert.ok(/-\d+w\.webp$/.test(name) || isVariantTempName(name) || /^botz-image-variants-.*\.lock$/.test(name), `unexpected write target: ${p}`);
        }
    }
}

test('variant names derive from the PNG name; temp and source patterns are distinct', () => {
    assert.equal(variantName('a-b_c.png', 480), 'a-b_c-480w.webp');
    assert.equal(variantPath('/x/y/k.png', 768), path.join('/x/y', 'k-768w.webp'));
    assert.ok(isSourceImageName('2026-10-19-08-abc.png'));
    assert.ok(!isSourceImageName('2026-10-19-08-abc-480w.webp'));
    assert.ok(!isSourceImageName('.hidden.png'));
    assert.ok(isVariantTempName('.k-480w.webp.123.0a1b2c3d.tmp'));
    assert.ok(!isVariantTempName('.k.png.123.0a1b2c3d.tmp'));
    assert.throws(() => variantName('k.json', 480));
    assert.throws(() => variantName('k.png', 0));
});

test('read-only guard: refuses any target that is not a WebP variant next to its source', () => {
    const src = '/c/images/k.png';
    assert.equal(assertSafeVariantTarget('/c/images/k-480w.webp', src), '/c/images/k-480w.webp');
    for (const bad of ['/c/images/k.png', '/c/images/other.png', '/c/images/k-480w.png', '/c/2026-10-19-08.json', '/c/images/k-480w.json',
        '/c/other/k-480w.webp', '/c/images/j-480w.webp', '/c/images/k.webp', '/c/images/k-480w.webp.png', '/c/images/../images2/k-480w.webp']) {
        assert.throws(() => assertSafeVariantTarget(bad, src), ReadOnlySourceError, bad);
    }
});

test('writeFileAtomic refuses to write over a PNG or JSON (files untouched)', async () => {
    const { root, images } = await makeCache(1);
    const before = snapshotSources(root);
    const png = path.join(images, `${KEY(1)}.png`);
    const json = path.join(root, '2026-10-01-12.json');
    await assert.rejects(writeFileAtomic(png, Buffer.from('x'), png), ReadOnlySourceError);
    await assert.rejects(writeFileAtomic(json, Buffer.from('x'), png), ReadOnlySourceError);
    await assert.rejects(writeFileAtomic(path.join(images, `${KEY(1)}-480w.png`), Buffer.from('x'), png), ReadOnlySourceError);
    assert.deepEqual(snapshotSources(root), before);
    assert.deepEqual(listing(images), [`${KEY(1)}.png`]);
});

test('writeVariantsForPng writes 480/768/1024 WebP q80 next to the PNG; the PNG is only read', async () => {
    const { root, images } = await makeCache(1);
    const png = path.join(images, `${KEY(1)}.png`);
    fs.chmodSync(png, 0o444);   // works with a read-only source
    const before = snapshotSources(root);
    const spy = spyWrites();
    let r;
    try { r = await writeVariantsForPng(png); } finally { spy.restore(); }
    assert.deepEqual(r.created, [...VARIANT_WIDTHS]);
    assert.deepEqual(r.failed, []);
    for (const w of VARIANT_WIDTHS) {
        const v = variantPath(png, w);
        assert.ok(isValidWebpFile(v), v);
        const meta = await sharp(v).metadata();
        assert.equal(meta.format, 'webp');
        assert.equal(meta.width, w);
    }
    assert.deepEqual(snapshotSources(root), before, 'PNG/JSON bytes, mtime, mode and inode unchanged');
    assert.ok(!listing(images).some(isVariantTempName), 'no temp files left');
    assertOnlyVariantWrites(spy.touched, images);
});

test('idempotent: a second run skips valid variants; truncated or junk variants are rebuilt', async () => {
    const { root, images } = await makeCache(1);
    const png = path.join(images, `${KEY(1)}.png`);
    await writeVariantsForPng(png);
    const m1 = variantMtimes(images);
    const again = await writeVariantsForPng(png);
    assert.deepEqual(again.created, []);
    assert.deepEqual(again.skipped, [...VARIANT_WIDTHS]);
    assert.deepEqual(variantMtimes(images), m1);
    const v480 = variantPath(png, 480), v1024 = variantPath(png, 1024);
    fs.truncateSync(v480, 100);
    fs.writeFileSync(v1024, 'not a webp');
    assert.deepEqual(missingVariantWidths(png), [480, 1024]);
    const before = snapshotSources(root);
    const fixed = await writeVariantsForPng(png);
    assert.deepEqual(fixed.created, [480, 1024]);
    assert.ok(isValidWebpFile(v480) && isValidWebpFile(v1024));
    assert.deepEqual(snapshotSources(root), before);
});

test('stale temp cleanup only removes our own old temp files', async () => {
    const { images } = await makeCache(1);
    const old = path.join(images, `.${KEY(1)}-480w.webp.999.deadbeef.tmp`);
    const fresh = path.join(images, `.${KEY(1)}-768w.webp.999.cafebabe.tmp`);
    const other = path.join(images, `.${KEY(1)}.png.999.deadbeef.tmp`);
    for (const p of [old, fresh, other]) fs.writeFileSync(p, 'x');
    const past = new Date(Date.now() - 2 * 3600 * 1000);
    fs.utimesSync(old, past, past); fs.utimesSync(other, past, past);
    assert.equal(removeStaleVariantTemps(images), 1);
    assert.ok(!fs.existsSync(old) && fs.existsSync(fresh) && fs.existsSync(other));
});

const quiet = async fn => { const orig = console.log; console.log = () => {}; try { return await fn(); } finally { console.log = orig; } };

test('backfill: dry run writes nothing; --limit then rerun resumes; third run is a no-op', async () => {
    const { root, images } = await makeCache(5, 600);
    const before = snapshotSources(root);
    const files0 = listing(images);
    const dry = await quiet(() => run(['--dir', images, '--dry-run', '--ionice', 'none', '--delay-ms', '0']));
    assert.equal(dry.exitCode, 0);
    assert.equal(dry.summary.wouldCreate, 15);
    assert.deepEqual(listing(images), files0, 'dry run created nothing');

    const spy = spyWrites();
    let first, second, third;
    try {
        first = await quiet(() => run(['--dir', images, '--limit', '2', '--ionice', 'none', '--delay-ms', '0']));
        second = await quiet(() => run(['--dir', images, '--concurrency', '3', '--ionice', 'none', '--delay-ms', '0']));
        third = await quiet(() => run(['--dir', images, '--ionice', 'none', '--delay-ms', '0']));
    } finally { spy.restore(); }
    assert.equal(first.summary.processed, 2);
    assert.equal(first.summary.variantsCreated, 6);
    assert.equal(second.summary.alreadyDone, 2, 'resume skips the images done by the first run');
    assert.equal(second.summary.processed, 3);
    assert.equal(second.summary.variantsCreated, 9);
    assert.equal(third.summary.processed, 0);
    assert.equal(third.summary.alreadyDone, 5);
    assert.equal(listing(images).filter(n => n.endsWith('.webp')).length, 15);
    assert.deepEqual(snapshotSources(root), before, 'sources untouched');
    assertOnlyVariantWrites(spy.touched, images);
});

test('backfill: SIGTERM mid-run stops cleanly (exit 130, no temp files) and a restart completes the rest', async () => {
    const { root, images } = await makeCache(8, 700);
    const before = snapshotSources(root);
    const child = spawn(process.execPath, [SCRIPT, '--dir', images, '--delay-ms', '400', '--ionice', 'none', '--progress-every', '1'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    await new Promise((resolve, reject) => {
        const fail = setTimeout(() => { clearInterval(t); reject(new Error(`no progress: ${out}`)); }, 20000);
        const t = setInterval(() => { if (/progress 2\//.test(out)) { clearInterval(t); clearTimeout(fail); child.kill('SIGTERM'); resolve(); } }, 20);
    });
    const code = await new Promise(r => child.on('exit', c => r(c)));
    assert.equal(code, 130, out);
    const done = listing(images).filter(n => n.endsWith('.webp')).length;
    assert.ok(done >= 6 && done < 24, `partial run wrote ${done} variants`);
    assert.equal(done % 3, 0, 'images are finished whole before stopping');
    assert.ok(!listing(images).some(isVariantTempName), 'no temp files left after the stop');
    const resumed = await quiet(() => run(['--dir', images, '--ionice', 'none', '--delay-ms', '0']));
    assert.equal(resumed.summary.alreadyDone, done / 3);
    assert.equal(listing(images).filter(n => n.endsWith('.webp')).length, 24);
    assert.deepEqual(snapshotSources(root), before);
});

test('saveImageToFile never replaces an existing PNG (exclusive create) and only adds variants via writeVariantsForPng', () => {
    const src = fs.readFileSync(path.join(here, 'index.js'), 'utf8');
    const fn = src.slice(src.indexOf('const saveImageToFile'), src.indexOf('function parseFilename'));
    assert.ok(fn.length > 100, 'saveImageToFile found');
    const writes = [...fn.matchAll(/fs\.(\w*(?:write|rename|unlink|copy|rm)\w*)\(([^;]*)/gi)];
    assert.ok(writes.length >= 1);
    for (const [, call, args] of writes) {
        assert.equal(call, 'writeFileSync', `unexpected fs call in saveImageToFile: ${call}`);
        assert.match(args, /flag: 'wx'/, 'PNG writes must use exclusive create');
    }
    assert.match(fn, /writeVariantsForPng\(cacheFilePath\)/);
});
