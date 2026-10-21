import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearSavedLocation,
  loadSavedLocation,
  LOCATION_STORAGE_KEY,
  nextActiveIndex,
  resultLabel,
  saveLocation,
} from '../js/location-search.js';

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

test('save/load/clear round trip', () => {
  const s = memStorage();
  assert.equal(loadSavedLocation(s), null);
  saveLocation({ lat: -33.87, lon: 151.21, placeName: 'Sydney, NSW, Australia', extra: 1 }, s);
  assert.deepEqual(loadSavedLocation(s), { lat: -33.87, lon: 151.21, placeName: 'Sydney, NSW, Australia' });
  clearSavedLocation(s);
  assert.equal(loadSavedLocation(s), null);
});

test('loadSavedLocation ignores corrupt or invalid values', () => {
  const s = memStorage();
  s.setItem(LOCATION_STORAGE_KEY, '{not json');
  assert.equal(loadSavedLocation(s), null);
  s.setItem(LOCATION_STORAGE_KEY, JSON.stringify({ lat: 'x', lon: 1 }));
  assert.equal(loadSavedLocation(s), null);
});

test('nextActiveIndex wraps', () => {
  assert.equal(nextActiveIndex(-1, 1, 3), 0);
  assert.equal(nextActiveIndex(-1, -1, 3), 2);
  assert.equal(nextActiveIndex(2, 1, 3), 0);
  assert.equal(nextActiveIndex(0, -1, 3), 2);
  assert.equal(nextActiveIndex(0, 1, 0), -1);
});

test('resultLabel splits name and context', () => {
  assert.deepEqual(resultLabel({ name: 'Paris', region: 'Île-de-France', country: 'France' }), {
    primary: 'Paris',
    secondary: 'Île-de-France, France',
  });
});
