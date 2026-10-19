// Unit tests for the botz.ai idle autoplay controller (www/botz.ai/autoplay.js), with fake timers.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'www', 'botz.ai', 'autoplay.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'botz-autoplay-'));
fs.copyFileSync(src, path.join(tmp, 'autoplay.mjs'));   // browser .js under a package without "type": "module"
const A = await import(pathToFileURL(path.join(tmp, 'autoplay.mjs')).href);
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function clock() {
  let now = 0, id = 0; const q = new Map();
  return {
    now: () => now,
    timers: { setTimeout: (fn, ms) => { q.set(++id, { at: now + ms, fn }); return id; }, clearTimeout: i => q.delete(i) },
    advance(ms) { const end = now + ms; for (;;) { let n = null; for (const [k, v] of q) if (v.at <= end && (!n || v.at < n[1].at)) n = [k, v]; if (!n) break; q.delete(n[0]); now = n[1].at; n[1].fn(); } now = end; },
    pending: () => q.size,
  };
}
const make = (opts = {}) => { const c = clock(); const steps = []; let why = ''; const ap = A.createAutoplay({ idleMs: 30000, stepMs: 6000, step: () => steps.push(c.now()), blocked: () => why, now: c.now, timers: c.timers, ...opts }); return { c, ap, steps, block: w => { why = w; } }; };

test('defaults and URL config', () => {
  assert.equal(A.AUTOPLAY_IDLE_MS, 30000);
  assert.equal(A.AUTOPLAY_STEP_MS, 6000);
  assert.deepEqual(A.autoplayConfig(new URLSearchParams('')), { enabled: true, idleMs: 30000, stepMs: 6000 });
  assert.equal(A.autoplayConfig(new URLSearchParams('autoplay=0')).enabled, false);
  assert.deepEqual(A.autoplayConfig(new URLSearchParams('autoplayidle=2000&autoplaystep=1500')), { enabled: true, idleMs: 2000, stepMs: 1500 });
  assert.equal(A.autoplayConfig(new URLSearchParams('autoplayidle=5')).idleMs, 30000, 'too-small values are ignored');
});

test('first step after the idle period, then one step every stepMs', () => {
  const { c, ap, steps } = make();
  ap.resume();
  c.advance(29999); assert.equal(steps.length, 0);
  c.advance(1); assert.deepEqual(steps, [30000]);
  c.advance(18000); assert.deepEqual(steps, [30000, 36000, 42000, 48000]);
  assert.equal(ap.st.state, 'playing');
});

test('any input stops autoplay at once and restarts the idle timer', () => {
  const { c, ap, steps } = make();
  ap.resume(); c.advance(36000); assert.equal(steps.length, 2);
  ap.activity('pointermove');
  assert.equal(ap.st.state, 'waiting'); assert.equal(ap.st.stops, 1);
  c.advance(29000); assert.equal(steps.length, 2, 'no step during the new idle period');
  ap.activity('keydown'); c.advance(29000); assert.equal(steps.length, 2, 'input keeps pushing it back');
  c.advance(1000); assert.equal(steps.length, 3);
});

test('blocked ticks are skipped (read more, modal, dice, hidden, off-screen, busy) and retried', () => {
  const { c, ap, steps, block } = make();
  ap.resume(); block('read-more');
  c.advance(30000 + 6000 * 3);
  assert.equal(steps.length, 0); assert.equal(ap.st.skipped, 4); assert.equal(ap.st.lastSkip, 'read-more');
  block(''); c.advance(6000); assert.equal(steps.length, 1);
});

test('scroll caused by an autoplay step is not input; a later scroll is', () => {
  const { c, ap, steps } = make();
  ap.resume(); c.advance(30000); assert.equal(steps.length, 1);
  c.advance(500); ap.activity('scroll'); assert.equal(ap.st.state, 'playing');
  c.advance(1500); ap.activity('scroll'); assert.equal(ap.st.state, 'waiting');
});

test('suspend (mobile layout / reduced motion) stops everything; resume waits a full idle period', () => {
  const { c, ap, steps } = make();
  ap.resume(); c.advance(36000); assert.equal(steps.length, 2);
  ap.suspend(); assert.equal(ap.st.state, 'off'); assert.equal(c.pending(), 0);
  ap.activity('pointermove'); c.advance(120000); assert.equal(steps.length, 2, 'input while off does not start it');
  ap.resume(); c.advance(29999); assert.equal(steps.length, 2); c.advance(1); assert.equal(steps.length, 3);
});
