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

test('searchPlaces forces IPv4 for the Open-Meteo request', async () => {
  const { default: axios } = await import('axios');
  const orig = axios.get;
  let seen;
  axios.get = async (url, opts) => { seen = { url, opts }; return { data: { results: [] } }; };
  try {
    assert.deepEqual(await searchPlaces(`ipv4-test-${Date.now()}`), []);
  } finally {
    axios.get = orig;
  }
  assert.match(seen.url, /geocoding-api\.open-meteo\.com\/v1\/search/);
  assert.equal(seen.opts.family, 4);
  assert.equal(seen.opts.timeout, 8000);
});
