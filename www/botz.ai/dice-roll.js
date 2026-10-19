// botz.ai dice tumble: a physics-driven, PBR-rendered roll of two dice over the page when the
// random (dice) button is clicked. Loaded with import() on the first click only, together with the
// vendored cannon-es; three.js is the copy the carousel already loads (same module URL, one instance).
//
// Scale: 1 world unit = one die edge = 19 mm (casino size), so gravity is 9.81 m/s^2 / 0.019 m = 516 units/s^2 and the
// visible "table" is the viewport (one die ~ DIE_PX css px). The floor is the screen plane (y = 0), seen
// from a camera straight above it; invisible walls sit at the viewport bounds and a ceiling above.
// The physics part (createDicePhysics) has no DOM/three dependency so it is unit-tested under node.

export const DIE_M = 0.019;                  // 19 mm casino-size dice
export const GRAVITY = 9.81 / DIE_M;          // units/s^2
export const STEP = 1 / 120;                  // fixed physics timestep (s)
export const MAX_SUBSTEPS = 12;
export const MAX_ROLL_S = 7;                  // safety cap; dice normally sleep long before this
export const HOLD_MS = 800, FADE_MS = 450;
export const DESKTOP_MIN_W = 761;
export const FOV = 28;                         // camera vertical field of view (deg)             // same breakpoint as the page (max-width: 760px = mobile)
// opposite faces sum to 7; order = BoxGeometry material groups (+x, -x, +y, -y, +z, -z)
export const FACE_VALUES = [3, 4, 1, 6, 2, 5];
const FACE_AXES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

const VENDOR = new URL('./vendor/', import.meta.url);
const THREE_URL = new URL('three.module.min.js', VENDOR).href;   // must match carousel-app.js's import
const CANNON_URL = new URL('cannon-es.min.js', VENDOR).href;

/** Which face points up for a body quaternion {x,y,z,w}: { value, dot } (dot = cos of the tilt from vertical). */
export function faceUp(q) {
  let best = -2, value = 0;
  for (let i = 0; i < 6; i++) {
    const [ax, ay, az] = FACE_AXES[i];
    // y component of q * axis (rotate the local face normal, read its world-up part)
    const ix = q.w * ax + q.y * az - q.z * ay, iy = q.w * ay + q.z * ax - q.x * az,
      iz = q.w * az + q.x * ay - q.y * ax, iw = -q.x * ax - q.y * ay - q.z * az;
    const y = iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z;
    if (y > best) { best = y; value = FACE_VALUES[i]; }
  }
  return { value, dot: best };
}

/** Viewport-sized table in world units. */
export function tableFor(widthPx, heightPx) {
  const mobile = widthPx < DESKTOP_MIN_W;
  const diePx = Math.round(Math.min(84, Math.max(mobile ? 44 : 52, Math.min(widthPx, heightPx) * (mobile ? 0.12 : 0.068))));
  const hw = widthPx / diePx / 2, hh = heightPx / diePx / 2;
  // camera straight above: the floor rectangle fills the viewport; a die's top face (1 unit up) is drawn
  // slightly further out by perspective, so the walls are pulled in by that factor (+1 px)
  const dist = hh / Math.tan(FOV / 2 * Math.PI / 180);
  const k = (dist - 1) / dist;
  return { widthPx, heightPx, mobile, diePx, hw, hh, dist, wallX: hw * k - 1 / diePx, wallZ: hh * k - 1 / diePx };
}

/**
 * Rigid-body world for one roll. rng() in [0,1) so tests can seed it.
 * Desktop: dice start off-screen left, above the table, and are thrown to the right; the left wall only
 * starts colliding with a die once that die is fully on screen. Mobile: dropped near the top and thrown
 * in a random direction; they bounce off all four viewport walls.
 */
export const TUNING = { floorFriction: 0.18, floorRestitution: 0.42, speedLo: 5.0, speedHi: 5.8, angularDamping: 0.06, linearDamping: 0.04, spinLo: 18, spinHi: 34, dropLo: 4, dropHi: 6 };
export function createDicePhysics(CANNON, table, { count = 2, rng = Math.random, tune = {} } = {}) {
  const { hw, hh, mobile, wallX, wallZ } = table;
  const K = { ...TUNING, ...tune };
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -GRAVITY, 0), allowSleep: true });
  world.broadphase = new CANNON.NaiveBroadphase();
  world.solver.iterations = 14;
  world.defaultContactMaterial.contactEquationStiffness = 1e8;
  world.defaultContactMaterial.contactEquationRelaxation = 3;

  const mDie = new CANNON.Material('die'), mFloor = new CANNON.Material('floor'), mWall = new CANNON.Material('wall');
  world.addContactMaterial(new CANNON.ContactMaterial(mDie, mFloor, { friction: K.floorFriction, restitution: K.floorRestitution, contactEquationStiffness: 1e8, contactEquationRelaxation: 3 }));
  world.addContactMaterial(new CANNON.ContactMaterial(mDie, mDie, { friction: 0.22, restitution: 0.45, contactEquationStiffness: 1e8, contactEquationRelaxation: 3 }));
  world.addContactMaterial(new CANNON.ContactMaterial(mDie, mWall, { friction: 0.12, restitution: 0.5, contactEquationStiffness: 1e8, contactEquationRelaxation: 3 }));

  const DIE_GROUPS = (1 << count) - 1;           // dice use bits 0..count-1, statics use bit 30
  const STATIC = 1 << 30;
  const plane = (pos, euler, mask = DIE_GROUPS, material = mWall) => {
    const b = new CANNON.Body({ type: CANNON.Body.STATIC, shape: new CANNON.Plane(), material, collisionFilterGroup: STATIC, collisionFilterMask: mask });
    b.position.set(...pos); b.quaternion.setFromEuler(...euler); world.addBody(b); return b;
  };
  const floor = plane([0, 0, 0], [-Math.PI / 2, 0, 0], DIE_GROUPS, mFloor);
  const walls = {
    left: plane([-wallX, 0, 0], [0, Math.PI / 2, 0], mobile ? DIE_GROUPS : 0),   // desktop: armed per die on entry
    right: plane([wallX, 0, 0], [0, -Math.PI / 2, 0]),
    top: plane([0, 0, -wallZ], [0, 0, 0]),
    bottom: plane([0, 0, wallZ], [0, Math.PI, 0]),
    ceiling: plane([0, 9, 0], [Math.PI / 2, 0, 0]),
  };

  const half = new CANNON.Vec3(0.5, 0.5, 0.5);
  const dice = [];
  for (let i = 0; i < count; i++) {
    const b = new CANNON.Body({ mass: 1, shape: new CANNON.Box(half), material: mDie, linearDamping: K.linearDamping, angularDamping: K.angularDamping,
      collisionFilterGroup: 1 << i, collisionFilterMask: STATIC | DIE_GROUPS, allowSleep: true, sleepSpeedLimit: 0.6, sleepTimeLimit: 0.3 });
    world.addBody(b); dice.push(b);
  }
  const R = (a, b) => a + (b - a) * rng();
  const spin = (lo, hi) => { const v = new CANNON.Vec3(R(-1, 1), R(-1, 1), R(-1, 1)); v.normalize(); v.scale(R(lo, hi), v); return v; };
  const entered = new Set();

  function reset() {
    entered.clear(); propped.fill(0);
    walls.left.collisionFilterMask = mobile ? DIE_GROUPS : 0;
    const lane = R(-0.25, 0.25) * hh;                     // shared vertical lane on screen, per roll
    dice.forEach((b, i) => {
      b.wakeUp();
      b.velocity.setZero(); b.angularVelocity.setZero(); b.force.setZero(); b.torque.setZero();
      b.quaternion.setFromEuler(R(0, 2 * Math.PI), R(0, 2 * Math.PI), R(0, 2 * Math.PI));
      if (mobile) {
        b.position.set(R(-0.4, 0.4) * hw, R(3, 4.5), -hh * R(0.35, 0.6) + i * 1.6);
        const a = R(0, 2 * Math.PI), s = R(28, 42);
        b.velocity.set(Math.cos(a) * s, R(-4, 3), Math.sin(a) * s * 0.6 + R(4, 12));
      } else {
        // off-screen left, staggered, thrown rightwards with a little sideways scatter
        b.position.set(-hw - 2.5 - i * R(1.2, 2.2), R(K.dropLo, K.dropHi), lane + (i - (count - 1) / 2) * R(1.2, 2.2));
        const speed = Math.max(hw, 10) * R(K.speedLo, K.speedHi);      // scales with the table so it crosses most of it
        b.velocity.set(speed, R(-2, 4), R(-0.12, 0.12) * speed);
      }
      b.angularVelocity.copy(spin(K.spinLo, K.spinHi));
      b.previousPosition.copy(b.position); b.interpolatedPosition.copy(b.position);
      b.previousQuaternion.copy(b.quaternion); b.interpolatedQuaternion.copy(b.quaternion);
    });
  }

  /** Arm the left wall for each die once it is fully on screen (desktop entry from off-screen left). */
  function armWalls() {
    if (mobile) return;
    dice.forEach((b, i) => {
      if (!entered.has(i) && b.position.x > -wallX + 0.9) { entered.add(i); walls.left.collisionFilterMask |= 1 << i; }
    });
  }

  /** Re-toss a cocked die: hop it up and away from whatever it leans on (the other die, or a wall). */
  function hop(b) {
    let dx = 0, dz = 0;
    for (const o of dice) if (o !== b && o.position.distanceTo(b.position) < 1.9) { dx += b.position.x - o.position.x; dz += b.position.z - o.position.z; }
    if (Math.abs(b.position.x) > wallX - 1.2) dx -= Math.sign(b.position.x);
    if (Math.abs(b.position.z) > wallZ - 1.2) dz -= Math.sign(b.position.z);
    if (!dx && !dz) { const a = R(0, 2 * Math.PI); dx = Math.cos(a); dz = Math.sin(a); }
    const l = Math.hypot(dx, dz), s = R(4, 7);
    b.wakeUp();
    b.velocity.set(dx / l * s, R(5, 8), dz / l * s);
    b.angularVelocity.copy(spin(6, 10));
  }

  /**
   * A die that went to sleep cocked (leaning on the other die or a wall) gets a small nudge, like a re-toss;
   * on desktop a die that stopped before reaching the screen gets pushed on rightwards.
   */
  function nudgeCocked() {
    let n = 0;
    dice.forEach((b, i) => {
      if (b.sleepState !== CANNON.Body.SLEEPING) return;
      if (!mobile && !entered.has(i)) {
        b.wakeUp(); b.velocity.set(R(25, 35), R(2, 5), R(-2, 2)); b.angularVelocity.copy(spin(10, 20)); n++;
      } else if (faceUp(b.quaternion).dot < 0.985) { hop(b); n++; }
    });
    return n;
  }

  const asleep = () => dice.every(b => b.sleepState === CANNON.Body.SLEEPING);
  // a die propped on the other die can jitter there without ever falling asleep: treat ~0.6 s of slow,
  // tilted resting as cocked and nudge it as well
  const propped = dice.map(() => 0);
  function unprop(dt) {
    let n = 0;
    dice.forEach((b, i) => {
      const slow = b.velocity.length() < 6 && b.angularVelocity.length() < 8 && b.position.y < 1.3;   // jitter spikes allowed
      propped[i] = slow && b.sleepState !== CANNON.Body.SLEEPING && faceUp(b.quaternion).dot < 0.985 ? propped[i] + dt : 0;
      if (propped[i] > 0.6) { propped[i] = 0; hop(b); n++; }
    });
    return n;
  }
  let unpropped = 0;
  const step = dt => { world.step(STEP, dt, MAX_SUBSTEPS); armWalls(); unpropped += unprop(dt); };
  return { world, dice, walls, floor, reset, step, asleep, nudgeCocked, entered, get unpropped() { return unpropped; } };
}

/** Run a roll to completion without rendering (tests). */
export function simulate(CANNON, table, opts = {}) {
  const P = createDicePhysics(CANNON, table, opts);
  P.reset();
  const track = P.dice.map(b => [b.position.x]);
  let t = 0, nudges = 0;
  for (; t < MAX_ROLL_S; t += 1 / 60) {
    P.step(1 / 60);
    P.dice.forEach((b, i) => track[i].push(b.position.x));
    if (P.asleep()) { const n = P.nudgeCocked(); nudges += n; if (!n) break; }
  }
  return { P, t, nudges, track, settled: P.asleep() };
}

// ---------------------------------------------------------------------------------------------------
// Rendering (browser only)

const state = { phase: 'idle', rolls: 0, restarts: 0, ignored: 0, renderersCreated: 0, frames: 0, last: null, skipped: 0 };
if (typeof window !== 'undefined') window.__botzDice = state;   // read-only test hook (counts, last roll)

let ctx = null;          // { THREE, CANNON, renderer, scene, camera, ... } created on the first roll
let loading = null;
let raf = 0, holdT = 0, fadeT = 0;
let run = null;          // the active roll

function reducedMotion() {
  return matchMedia('(prefers-reduced-motion: reduce)').matches || new URLSearchParams(location.search).get('mode') === 'reduced';
}

/** Ivory face: colour map with dark pips and a matching normal map with spherical dimples (recessed pips). */
function faceTextures(THREE, value, size = 256) {
  const P = { 1: [[.5, .5]], 2: [[.27, .27], [.73, .73]], 3: [[.27, .27], [.5, .5], [.73, .73]],
    4: [[.27, .27], [.73, .27], [.27, .73], [.73, .73]], 5: [[.27, .27], [.73, .27], [.5, .5], [.27, .73], [.73, .73]],
    6: [[.27, .25], [.73, .25], [.27, .5], [.73, .5], [.27, .75], [.73, .75]] }[value];
  const r = (value === 1 ? 0.115 : 0.085) * size;
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const bg = g.createRadialGradient(size * .45, size * .4, size * .1, size / 2, size / 2, size * .75);
  bg.addColorStop(0, '#fbf7ee'); bg.addColorStop(1, '#ece4d2');
  g.fillStyle = bg; g.fillRect(0, 0, size, size);
  for (const [u, v] of P) {
    const x = u * size, y = v * size;
    const pg = g.createRadialGradient(x - r * .25, y - r * .3, r * .1, x, y, r);
    pg.addColorStop(0, value === 1 ? '#5e0b12' : '#141210'); pg.addColorStop(1, value === 1 ? '#9e111b' : '#050404');
    g.fillStyle = pg; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  // normal map from a height field: a spherical dimple h = -depth * sqrt(1 - (d/r)^2) inside each pip
  const n = new Uint8ClampedArray(size * size * 4);
  const h = new Float32Array(size * size);
  for (const [u, v] of P) {
    const cx = u * size, cy = v * size;
    for (let y = Math.max(0, Math.floor(cy - r - 1)); y < Math.min(size, cy + r + 1); y++)
      for (let x = Math.max(0, Math.floor(cx - r - 1)); x < Math.min(size, cx + r + 1); x++) {
        const d = Math.hypot(x + .5 - cx, y + .5 - cy);
        if (d < r) h[y * size + x] = -0.35 * r * Math.sqrt(1 - (d / r) ** 2);
      }
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const hx = h[y * size + Math.min(size - 1, x + 1)] - h[y * size + Math.max(0, x - 1)];
    const hy = h[Math.min(size - 1, y + 1) * size + x] - h[Math.max(0, y - 1) * size + x];
    // canvas y runs down while texture v runs up (flipY), so the green term flips sign
    let nx = -hx / 2, ny = hy / 2, nz = 1; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const o = (y * size + x) * 4;
    n[o] = (nx * .5 + .5) * 255; n[o + 1] = (ny * .5 + .5) * 255; n[o + 2] = (nz * .5 + .5) * 255; n[o + 3] = 255;
  }
  const nc = document.createElement('canvas'); nc.width = nc.height = size;
  nc.getContext('2d').putImageData(new ImageData(n, size, size), 0, 0);
  const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4;
  const normalMap = new THREE.CanvasTexture(nc); normalMap.anisotropy = 4;
  return { map, normalMap };
}

async function setup() {
  const [THREE, CANNON, { RoundedBoxGeometry }, { RoomEnvironment }] = await Promise.all([
    import(THREE_URL), import(CANNON_URL),
    import(new URL('three-RoundedBoxGeometry.js', VENDOR).href), import(new URL('three-RoomEnvironment.js', VENDOR).href),
  ]);
  const canvas = document.createElement('canvas');
  canvas.className = 'dice-overlay';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:1500;display:none;opacity:1;transition:opacity ' + FADE_MS + 'ms ease';
  document.body.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: true });
  state.renderersCreated++;
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const envRT = pmrem.fromScene(room, 0.04);
  room.traverse(o => { o.geometry?.dispose(); o.material?.dispose?.(); });
  pmrem.dispose();
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.55;

  const key = new THREE.DirectionalLight(0xfff6ea, 1.9);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
  scene.add(key, key.target);
  const fill = new THREE.HemisphereLight(0xffffff, 0x4a443c, 0.25);
  scene.add(fill);

  const catcher = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.45, transparent: true }));
  catcher.rotation.x = -Math.PI / 2; catcher.receiveShadow = true;
  scene.add(catcher);

  const geometry = new RoundedBoxGeometry(1, 1, 1, 5, 0.12);
  const materials = FACE_VALUES.map(v => {
    const { map, normalMap } = faceTextures(THREE, v);
    return new THREE.MeshPhysicalMaterial({
      color: 0xf4ecdc, map, normalMap, normalScale: new THREE.Vector2(1.2, 1.2),
      roughness: 0.38, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08, clearcoatNormalMap: normalMap,
      sheen: 0.35, sheenRoughness: 0.6, sheenColor: new THREE.Color(0xfff1d6),   // soft resin "glow" at grazing angles
      specularIntensity: 0.7, ior: 1.5,
    });
  });
  const meshes = [0, 1].map(() => { const m = new THREE.Mesh(geometry, materials); m.castShadow = true; m.receiveShadow = true; scene.add(m); return m; });
  const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 200);

  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); finish('context-lost'); teardown(); });
  if (!setup.listening) {   // once per page, also across a rebuild after context loss
    setup.listening = true;
    document.addEventListener('visibilitychange', () => { if (document.hidden && run) finish('hidden'); });
    addEventListener('resize', () => { if (run) finish('resized'); });
  }
  return { THREE, CANNON, canvas, renderer, scene, camera, key, catcher, meshes, geometry, materials, envRT };
}

/** Full disposal (context loss); a later click rebuilds everything. */
function teardown() {
  if (!ctx) return;
  const c = ctx; ctx = null;
  c.geometry.dispose();
  c.materials.forEach(m => { m.map?.dispose(); m.normalMap?.dispose(); m.dispose(); });
  c.catcher.geometry.dispose(); c.catcher.material.dispose();
  c.envRT.dispose();
  c.renderer.dispose();
  c.canvas.remove();
}

function layout(c, table) {
  const { THREE, renderer, camera, key, catcher } = c;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setSize(table.widthPx, table.heightPx, false);
  camera.aspect = table.widthPx / table.heightPx;
  // straight down at the table so the floor's visible rectangle is exactly the viewport (in world units)
  const dist = table.dist;
  camera.position.set(0, dist, 0); camera.up.set(0, 0, -1); camera.lookAt(0, 0, 0);
  camera.near = Math.max(0.5, dist - 12); camera.far = dist + 5;
  camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  // light from the top left (screen), shadows fall down-right
  key.position.set(-14, 30, -17); key.target.position.set(0, 0, 0);   // shadows fall ~0.5 die per die of height
  const s = key.shadow.camera; s.left = -table.hw - 3; s.right = table.hw + 3; s.top = table.hh + 3; s.bottom = -table.hh - 3;
  s.near = 1; s.far = 60; s.updateProjectionMatrix();
}

/** The shadow catcher only covers the dice (plus room for their shadows), not the whole viewport. */
function fitCatcher(c, dice) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const b of dice) { const p = b.interpolatedPosition; x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
  const pad = 2.2;
  c.catcher.position.set((x0 + x1) / 2 + 0.6, 0, (z0 + z1) / 2 + 0.6);
  c.catcher.scale.set(x1 - x0 + 2 * pad, z1 - z0 + 2 * pad, 1);
}

function project(c, b) {
  const { THREE, camera } = c;
  const v = new THREE.Vector3(b.position.x, b.position.y, b.position.z).project(camera);
  return [Math.round((v.x * .5 + .5) * innerWidth), Math.round((-v.y * .5 + .5) * innerHeight)];
}
function screenBox(c, b) {
  const { THREE, camera } = c;
  const xs = [], ys = [];
  for (const sx of [-.5, .5]) for (const sy of [-.5, .5]) for (const sz of [-.5, .5]) {
    const v = new THREE.Vector3(sx, sy, sz).applyQuaternion(b.quaternion).add(b.position).project(camera);
    xs.push((v.x * .5 + .5) * innerWidth); ys.push((-v.y * .5 + .5) * innerHeight);
  }
  return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
}

function finish(reason) {
  if (!run) return;
  cancelAnimationFrame(raf); raf = 0; clearTimeout(holdT); clearTimeout(fadeT);
  const r = run; run = null;
  if (state.last && state.last.id === r.id && !state.last.endReason) state.last.endReason = reason;
  if (ctx) { ctx.canvas.style.display = 'none'; ctx.canvas.style.opacity = '1'; }
  state.phase = 'idle';
}

function frame(now) {
  raf = 0;
  const r = run, c = ctx;
  if (!r || !c) return;
  const dt = r.frameDt || Math.min(0.1, (now - r.prev) / 1000); r.prev = now;
  if (!r.settledAt) {
    r.P.step(dt); r.simT += dt;
    r.info.timeline.push([Date.now(), +r.simT.toFixed(4)]);
    if (r.P.asleep()) {
      const n = r.P.nudgeCocked(); r.info.nudges += n;
      if (!n) settle(now, 'sleep');
    } else if (r.simT > MAX_ROLL_S) settle(now, 'timeout');
    if (r.trackT <= now) { r.trackT = now + 50; r.info.track.push(r.P.dice.map(b => project(c, b)[0])); }
  }
  r.P.dice.forEach((b, i) => { c.meshes[i].position.copy(b.interpolatedPosition); c.meshes[i].quaternion.copy(b.interpolatedQuaternion); });
  fitCatcher(c, r.P.dice);
  c.renderer.render(c.scene, c.camera);
  state.frames++;
  if (!r.settledAt) raf = requestAnimationFrame(frame);   // once settled the last frame stays on the canvas: no idle rendering
}

function settle(now, how) {
  const r = run, c = ctx;
  r.settledAt = now;
  const vw = innerWidth, vh = innerHeight;
  r.info.settledBy = how; r.info.unpropped = r.P.unpropped;
  r.info.settleMs = Math.round(now - r.start);
  r.info.dice = r.P.dice.map(b => {
    const f = faceUp(b.quaternion), box = screenBox(c, b);
    return { value: f.value, upDot: +f.dot.toFixed(4), screen: project(c, b), box: Object.fromEntries(Object.entries(box).map(([k, v]) => [k, Math.round(v)])),
      inViewport: box.left >= -1 && box.top >= -1 && box.right <= vw + 1 && box.bottom <= vh + 1, sleeping: b.sleepState === c.CANNON.Body.SLEEPING };
  });
  r.info.values = r.info.dice.map(d => d.value);
  state.phase = 'holding';
  r.info.settleWall = Date.now();
  holdT = setTimeout(() => {
    if (run !== r) return;
    state.phase = 'fading';
    c.canvas.style.opacity = '0';
    fadeT = setTimeout(() => { if (run === r) { r.info.endReason = 'done'; finish('done'); } }, FADE_MS + 30);
  }, r.holdMs);
}

/**
 * Roll the dice over the page. Never awaited by navigation; resolves when the roll has started (or was skipped).
 * A click during an active roll restarts it cleanly (same renderer and scene, a fresh physics world and throw); clicks while the
 * modules are still loading on the very first roll are ignored.
 */
export async function rollDice() {
  if (reducedMotion()) { state.skipped++; state.lastSkip = 'reduced-motion'; return { skipped: 'reduced-motion' }; }
  if (loading) { state.ignored++; return { ignored: true }; }
  if (!ctx) {
    state.phase = 'loading';
    const t0 = performance.now();
    loading = setup().then(c => { state.setupMs = Math.round(performance.now() - t0); return c; }).then(c => { ctx = c; }).finally(() => { loading = null; });
    try { await loading; } catch (e) { state.phase = 'idle'; throw e; }
  }
  if (run) { state.restarts++; finish('restarted'); }
  const c = ctx;
  const table = tableFor(innerWidth, innerHeight);
  layout(c, table);
  const P = createDicePhysics(c.CANNON, table);
  P.reset();
  const id = ++state.rolls;
  const info = { id, mobile: table.mobile, diePx: table.diePx, viewport: [table.widthPx, table.heightPx], track: [], nudges: 0 };
  state.last = info;
  const now = performance.now();
  // test-only overrides (window.__botzDiceTest): a longer hold for screenshots, and a fixed simulated dt per
  // rendered frame so recordings on a GPU-less VM can be time-remapped; unset in normal use
  const T = window.__botzDiceTest || {};
  run = { id, P, start: now, prev: now, trackT: 0, info, settledAt: 0, simT: 0, holdMs: T.holdMs ?? HOLD_MS, frameDt: T.frameDt || 0 };
  info.timeline = []; info.startWall = Date.now();
  info.startScreenX = P.dice.map(b => project(c, b)[0]);
  c.canvas.style.transition = 'none'; c.canvas.style.opacity = '1'; c.canvas.style.display = 'block';
  c.canvas.offsetWidth; c.canvas.style.transition = `opacity ${FADE_MS}ms ease`;
  state.phase = 'rolling';
  raf = requestAnimationFrame(frame);
  return { started: id };
}
