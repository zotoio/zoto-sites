// botz.ai idle autoplay (desktop carousel only). After a period with no user input the carousel steps one story
// towards OLDER stories (the same path as ArrowLeft / Older) every few seconds; any input stops it at once and
// restarts the idle timer. Loaded by carousel-app.js only on the desktop layout, unless reduced motion or
// ?autoplay=0. The controller (createAutoplay) is DOM-free so it is unit-tested with mocked timers.

export const AUTOPLAY_IDLE_MS = 30000;   // inactivity before the first step
export const AUTOPLAY_STEP_MS = 6000;    // between steps while autoplaying
export const SCROLL_QUIET_MS = 1500;     // scroll events this soon after an autoplay step are the step's own layout, not input
export const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'];

/** ?autoplay=0 disables; ?autoplayidle=<ms> / ?autoplaystep=<ms> shorten the delays (tests and demo recordings). */
export function autoplayConfig(params) {
  const ms = (k, d) => { const v = Number(params.get(k)); return Number.isFinite(v) && v >= 300 ? Math.round(v) : d; };
  return { enabled: params.get('autoplay') !== '0', idleMs: ms('autoplayidle', AUTOPLAY_IDLE_MS), stepMs: ms('autoplaystep', AUTOPLAY_STEP_MS) };
}

/**
 * step(): advance one story. blocked(): '' when a step may run now, otherwise the reason (skipped, retried next tick).
 * States: 'off' (suspended, e.g. mobile), 'waiting' (idle timer running), 'playing'.
 */
export function createAutoplay({ idleMs = AUTOPLAY_IDLE_MS, stepMs = AUTOPLAY_STEP_MS, step, blocked = () => '', now = () => Date.now(), timers = globalThis }) {
  const st = { state: 'off', steps: 0, skipped: 0, lastSkip: '', stops: 0, idleMs, stepMs, lastStepAt: 0 };
  let t = 0;
  const clear = () => { if (t) timers.clearTimeout(t); t = 0; };
  function tick() {
    t = 0;
    if (st.state !== 'playing') return;
    const why = blocked();
    if (why) { st.skipped++; st.lastSkip = why; }
    else { st.steps++; st.lastStepAt = now(); step(); }
    t = timers.setTimeout(tick, stepMs);
  }
  /** Any user input: stop playing and wait for a fresh idle period. */
  function activity(type = '') {
    if (st.state === 'off') return;
    if (type === 'scroll' && st.lastStepAt && now() - st.lastStepAt < SCROLL_QUIET_MS) return;
    if (st.state === 'playing') st.stops++;
    clear();
    st.state = 'waiting';
    t = timers.setTimeout(() => { t = 0; if (st.state === 'waiting') { st.state = 'playing'; tick(); } }, idleMs);
  }
  function suspend() { clear(); st.state = 'off'; }
  function resume() { if (st.state === 'off') { st.state = 'waiting'; activity(); } }
  return { st, activity, suspend, resume, tick };
}

/** Browser wiring: input listeners, tab visibility, stage visibility, layout and reduced-motion changes. */
export function startAutoplay({ params, step, blocked, stage, small }) {
  const cfg = autoplayConfig(params);
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let offscreen = false;
  const ap = createAutoplay({
    idleMs: cfg.idleMs, stepMs: cfg.stepMs, step,
    blocked: () => small.matches ? 'mobile' : motion.matches ? 'reduced-motion' : document.hidden ? 'hidden'
      : offscreen ? 'offscreen' : blocked(),
  });
  window.__botzAutoplay = ap.st;   // read-only test hook
  if (!cfg.enabled) return ap;
  let lx = -1, ly = -1;
  const onInput = e => {
    if (e.type === 'pointermove') {   // a stationary pointer can still report moves when content shifts under it
      if (e.clientX === lx && e.clientY === ly) return;
      lx = e.clientX; ly = e.clientY;
    }
    ap.activity(e.type);
  };
  for (const type of ACTIVITY_EVENTS) addEventListener(type, onInput, { capture: true, passive: true });
  document.addEventListener('visibilitychange', () => ap.activity('visibility'));   // coming back = a fresh idle period
  if (stage) new IntersectionObserver(es => { offscreen = !es[es.length - 1].isIntersecting; }).observe(stage);
  const layout = () => { if (small.matches || motion.matches) ap.suspend(); else ap.resume(); };
  small.addEventListener('change', layout);
  motion.addEventListener('change', layout);
  if (!small.matches && !motion.matches) { ap.st.state = 'waiting'; ap.activity('start'); }
  return ap;
}
