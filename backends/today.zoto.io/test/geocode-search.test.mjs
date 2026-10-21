import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePlaceResult, searchPlaces } from '../lib/geocode.js';

test('normalizePlaceResult maps Open-Meteo fields', () => {
  const r = normalizePlaceResult({
    id: 2147714, name: 'Sydney', admin1: 'New South Wales', country: 'Australia',
    country_code: 'AU', latitude: -33.87, longitude: 151.21, timezone: 'Australia/Sydney',
  });
  assert.equal(r.placeName, 'Sydney, New South Wales, Australia');
  assert.equal(r.countryCode, 'au');
  assert.equal(r.lat, -33.87);
  assert.equal(r.lon, 151.21);
});

test('normalizePlaceResult rejects missing coordinates', () => {
  assert.equal(normalizePlaceResult({ name: 'Nowhere' }), null);
});

test('searchPlaces ignores too-short queries without network', async () => {
  assert.deepEqual(await searchPlaces(''), []);
  assert.deepEqual(await searchPlaces('a'), []);
});
