// Unit tests for the botz.ai dice roll physics (www/botz.ai/dice-roll.js) with the vendored cannon-es.
// The browser modules are plain .js under a package without "type": "module", so they are copied to .mjs
// in a temp dir before importing (the render code is only reached through rollDice(), never here).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'www', 'botz.ai');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'botz-dice-'));
fs.copyFileSync(path.join(root, 'dice-roll.js'), path.join(tmp, 'dice-roll.mjs'));
fs.copyFileSync(path.join(root, 'vendor', 'cannon-es.min.js'), path.join(tmp, 'cannon.mjs'));
const D = await import(pathToFileURL(path.join(tmp, 'dice-roll.mjs')).href);
const CANNON = await import(pathToFileURL(path.join(tmp, 'cannon.mjs')).href);
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

test('faceUp reads the upward face; opposite faces sum to 7', () => {
  const q = new CANNON.Quaternion();
  assert.deepEqual(D.faceUp(q), { value: 1, dot: 1 });                       // +y face
  q.setFromEuler(Math.PI, 0, 0); assert.equal(D.faceUp(q).value, 6);
  q.setFromEuler(0, 0, Math.PI / 2); assert.equal(D.faceUp(q).value, 3);    // +x rotated to +y
  q.setFromEuler(0, 0, -Math.PI / 2); assert.equal(D.faceUp(q).value, 4);
  q.setFromEuler(-Math.PI / 2, 0, 0); assert.equal(D.faceUp(q).value, 2);   // +z rotated to +y
  q.setFromEuler(Math.PI / 2, 0, 0); assert.equal(D.faceUp(q).value, 5);
  for (let i = 0; i < 6; i += 2) assert.equal(D.FACE_VALUES[i] + D.FACE_VALUES[i + 1], 7);
  q.setFromEuler(0.3, 0, 0); assert.ok(D.faceUp(q).dot < 0.97);              // tilted = not flat
});

test('tableFor: desktop above 760 px, walls pulled in for perspective', () => {
  assert.equal(D.tableFor(761, 800).mobile, false);
  assert.equal(D.tableFor(760, 800).mobile, true);
  for (const [w, h] of [[1920, 1080], [1280, 800], [390, 844]]) {
    const t = D.tableFor(w, h);
    assert.ok(t.wallX < t.hw && t.wallZ < t.hh);
    assert.ok(t.wallX * t.dist / (t.dist - 1) <= t.hw + 1e-9, 'top face corner at the wall projects inside the viewport');
  }
  assert.equal(Math.round(D.GRAVITY), Math.round(9.81 / D.DIE_M));
});

for (const [w, h] of [[1920, 1080], [1280, 800], [390, 844]]) {
  test(`${w}x${h}: 40 seeded rolls settle by sleeping, flat, inside the walls${w > 760 ? ', entering from off-screen left and moving right' : ''}`, () => {
    const table = D.tableFor(w, h);
    for (let seed = 1; seed <= 40; seed++) {
      const r = D.simulate(CANNON, table, { rng: mulberry32(seed) });
      assert.ok(r.settled, `seed ${seed}: settled`);
      assert.ok(r.t < D.MAX_ROLL_S, `seed ${seed}: settled in ${r.t.toFixed(2)} s`);
      r.P.dice.forEach((b, i) => {
        assert.ok(D.faceUp(b.quaternion).dot > 0.98, `seed ${seed} die ${i}: flat on a face`);
        assert.ok(Math.abs(b.position.x) <= table.wallX - 0.45 && Math.abs(b.position.z) <= table.wallZ - 0.45, `seed ${seed} die ${i}: inside the walls`);
        assert.ok(b.position.y > 0.45 && b.position.y < 1.6, `seed ${seed} die ${i}: on the floor (or on the other die)`);
        if (!table.mobile) {
          const tr = r.track[i];
          assert.ok(tr[0] < -table.hw, `seed ${seed} die ${i}: starts off-screen left`);
          assert.ok(b.position.x > tr[0] + table.hw * 0.4, `seed ${seed} die ${i}: travelled right`);
        }
      });
      if (!table.mobile) assert.equal(r.P.entered.size, 2, 'left wall armed for both dice');
    }
  });
}

test('reset() re-throws cleanly (restart during a roll) and differs per roll', () => {
  const table = D.tableFor(1920, 1080);
  const P = D.createDicePhysics(CANNON, table, { rng: mulberry32(7) });
  P.reset();
  for (let i = 0; i < 30; i++) P.step(1 / 60);
  const mid = P.dice.map(b => b.position.x);
  P.reset();
  assert.ok(P.dice.every((b, i) => b.position.x < -table.hw && b.position.x !== mid[i]), 'back off-screen left');
  assert.equal(P.entered.size, 0);
  assert.equal(P.walls.left.collisionFilterMask, 0, 'left wall disarmed again');
  const v1 = P.dice[0].velocity.x;
  P.reset();
  assert.notEqual(P.dice[0].velocity.x, v1, 'randomised throw');
});
