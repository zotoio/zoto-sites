import test from 'node:test';
import assert from 'node:assert/strict';
import { formatSunTime } from '../js/weather-utils.js';

test('formatSunTime uses Open-Meteo local clock time (not browser timezone)', () => {
  const sunrise = '2026-09-26T06:44';
  assert.equal(formatSunTime(sunrise, 'America/Chicago'), '6:44 AM');
});

test('formatSunTime is unchanged when browser TZ differs from location TZ', () => {
  const prior = process.env.TZ;
  process.env.TZ = 'Australia/Sydney';
  try {
    assert.equal(formatSunTime('2026-09-26T18:21', 'America/Chicago'), '6:21 PM');
  } finally {
    if (prior === undefined) delete process.env.TZ;
    else process.env.TZ = prior;
  }
});

test('formatSunTime handles missing values', () => {
  assert.equal(formatSunTime(undefined, 'UTC'), '—');
  assert.equal(formatSunTime('', 'UTC'), '—');
});
