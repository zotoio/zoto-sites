/** Ultrawide layout: wider canvas, 24-col grid, side library. */

export const ULTRAWIDE_STORAGE_KEY = 'today.zoto.io.ultrawide.v1';

/** ~21:9 at 1600px+ or very wide 16:9 */
export const ULTRAWIDE_MQ =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(min-width: 2400px), (min-aspect-ratio: 21/9) and (min-width: 1600px)')
    : { matches: false, addEventListener() {}, removeEventListener() {} };

export const GRID_COLUMNS_STANDARD = 12;
export const GRID_COLUMNS_ULTRAWIDE = 24;

/**
 * @returns {'auto' | 'on' | 'off'}
 */
export function getUltrawidePreference(storage = globalThis.localStorage) {
  const v = storage?.getItem(ULTRAWIDE_STORAGE_KEY);
  if (v === 'on' || v === 'off' || v === 'auto') return v;
  return 'auto';
}

/**
 * @param {'auto' | 'on' | 'off'} value
 */
export function setUltrawidePreference(value, storage = globalThis.localStorage) {
  storage?.setItem(ULTRAWIDE_STORAGE_KEY, value);
}

/**
 * @param {'auto' | 'on' | 'off'} preference
 * @param {boolean} mqMatches
 */
export function isUltrawideActive(preference, mqMatches = ULTRAWIDE_MQ.matches) {
  if (preference === 'on') return true;
  if (preference === 'off') return false;
  return mqMatches;
}

export function applyUltrawideClass(active) {
  document.documentElement.classList.toggle('ultrawide-mode', active);
}

export function syncUltrawideMode(storage = globalThis.localStorage) {
  const pref = getUltrawidePreference(storage);
  const active = isUltrawideActive(pref);
  applyUltrawideClass(active);
  return { active, preference: pref };
}

/**
 * @returns {'auto' | 'on' | 'off'}
 */
export function cycleUltrawidePreference(storage = globalThis.localStorage) {
  const order = ['auto', 'on', 'off'];
  const cur = getUltrawidePreference(storage);
  const next = order[(order.indexOf(cur) + 1) % order.length];
  setUltrawidePreference(next, storage);
  syncUltrawideMode(storage);
  return next;
}

export function ultrawidePreferenceLabel(preference) {
  if (preference === 'on') return 'On';
  if (preference === 'off') return 'Off';
  return 'Auto';
}

/**
 * @param {(active: boolean) => void} onChange
 */
export function watchUltrawide(onChange, storage = globalThis.localStorage) {
  const run = () => {
    const { active } = syncUltrawideMode(storage);
    onChange(active);
  };
  ULTRAWIDE_MQ.addEventListener('change', run);
  return () => ULTRAWIDE_MQ.removeEventListener('change', run);
}
