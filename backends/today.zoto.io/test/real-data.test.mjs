import test from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';
import { cached, clearCacheForTests } from '../lib/cache.js';
import { fetchPollen, mapPollen } from '../lib/pollen.js';
import { fetchTides, findTideExtremes } from '../lib/tides.js';
import { fetchHazards, nearbyHazards } from '../lib/hazards.js';
import { fetchQuoteOfDay } from '../lib/quote.js';
import { unavailable } from '../lib/unavailable.js';

const realGet = axios.get;
function mockGet(impl) {
  const calls = [];
  axios.get = async (url, opts) => {
    calls.push({ url, opts });
    return impl(url, opts);
  };
  return calls;
}
test.afterEach(() => {
  axios.get = realGet;
  clearCacheForTests();
});

test('cached serves stale last-good value when loader fails after ttl', async () => {
  await cached('s', async () => ({ v: 1 }), 0);
  const out = await cached('s', async () => { throw new Error('down'); }, 0);
  assert.equal(out.v, 1);
  assert.equal(out.stale, true);
  assert.ok(out.staleSince);
});

test('cached throws when no previous value exists', async () => {
  await assert.rejects(cached('none', async () => { throw new Error('down'); }, 1000));
});

test('cached de-duplicates concurrent loads', async () => {
  let n = 0;
  const loader = async () => { n += 1; await new Promise((r) => setTimeout(r, 10)); return { ok: true }; };
  await Promise.all([cached('d', loader, 1000), cached('d', loader, 1000), cached('d', loader, 1000)]);
  assert.equal(n, 1);
});

test('unavailable payload is explicit and has no demo source', () => {
  const u = unavailable('weather');
  assert.equal(u.source, 'unavailable');
  assert.equal(u.widget, 'weather');
});

test('mapPollen scales grains and flags missing coverage', () => {
  const p = mapPollen({ grass_pollen: 60, birch_pollen: 5, alder_pollen: 0, ragweed_pollen: null });
  assert.equal(p.available, true);
  assert.equal(p.grass, 3);
  assert.equal(p.tree, 1);
  assert.equal(p.weed, null);
  assert.equal(mapPollen({}).available, false);
});

test('fetchPollen calls Open-Meteo once and caches', async () => {
  const calls = mockGet(async () => ({ data: { current: { grass_pollen: 12 } } }));
  const a = await fetchPollen(48.85, 2.35);
  await fetchPollen(48.85, 2.35);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /air-quality-api\.open-meteo\.com/);
  assert.equal(a.source, 'open-meteo-pollen');
  assert.equal(a.grass, 2);
});

test('findTideExtremes finds highs and lows', () => {
  const ex = findTideExtremes(['a', 'b', 'c', 'd', 'e'], [0.1, 0.9, 0.2, -0.5, 0.3]);
  assert.deepEqual(ex.map((e) => e.type), ['High', 'Low']);
});

test('fetchTides maps marine sea level, and reports unavailable for null series', async () => {
  mockGet(async () => ({ data: { timezone: 'X', hourly: { time: ['t0', 't1', 't2'], sea_level_height_msl: [0, 1, 0] } } }));
  const t = await fetchTides(-33.86, 151.2);
  assert.equal(t.source, 'open-meteo-marine');
  assert.equal(t.extremes[0].type, 'High');
  clearCacheForTests();
  mockGet(async () => ({ data: { hourly: { time: ['t0'], sea_level_height_msl: [null] } } }));
  const inland = await fetchTides(-25, 135);
  assert.equal(inland.source, 'unavailable');
});

const feature = (lat, lon, extra = {}) => ({
  geometry: { coordinates: [lon, lat] },
  properties: { eventtype: 'EQ', eventid: 1, name: 'Quake', alertlevel: 'Orange', url: { report: 'https://gdacs.org/r' }, ...extra },
});

test('nearbyHazards filters by radius and sorts by distance', () => {
  const ev = nearbyHazards([feature(0, 50), feature(-33, 151.5), feature(-34, 151.3)], -33.86, 151.2);
  assert.equal(ev.length, 2);
  assert.ok(ev[0].distKm <= ev[1].distKm);
  assert.equal(ev[0].alert, 'orange');
});

test('fetchHazards queries GDACS and returns nearby events', async () => {
  const calls = mockGet(async () => ({ data: { features: [feature(-33.9, 151.2)] } }));
  const h = await fetchHazards(-33.86, 151.2);
  assert.match(calls[0].url, /gdacs\.org/);
  assert.equal(h.source, 'gdacs');
  assert.equal(h.events.length, 1);
});

test('fetchQuoteOfDay maps ZenQuotes and rejects rate-limit text', async () => {
  mockGet(async () => ({ data: [{ q: 'Be kind.', a: 'Someone' }] }));
  const q = await fetchQuoteOfDay();
  assert.equal(q.quote, 'Be kind.');
  assert.equal(q.source, 'zenquotes');
  clearCacheForTests();
  mockGet(async () => ({ data: [{ q: 'Too many requests. Obtain an auth key', a: '' }] }));
  await assert.rejects(fetchQuoteOfDay());
});

test('fetchCountryFacts maps Wikidata SPARQL rows (REST Countries v3 is shut down)', async () => {
  const calls = mockGet(async () => ({
    data: { results: { bindings: [
      { cLabel: { value: 'Australia' }, capLabel: { value: 'Canberra' }, pop: { value: '27614411' }, langs: { value: 'English' }, curs: { value: 'AUD' } },
      { cLabel: { value: 'Australia' }, capLabel: { value: 'Canberra' }, pop: { value: '25000000' }, langs: { value: 'English' }, curs: { value: 'AUD' } },
    ] } },
  }));
  const { fetchCountryFacts } = await import('../lib/country.js');
  const c = await fetchCountryFacts('au');
  assert.match(calls[0].url, /query\.wikidata\.org/);
  assert.match(calls[0].opts.params.query, /"AU"/);
  assert.equal(c.name, 'Australia');
  assert.equal(c.population, 27614411);
  assert.equal(c.flag, '🇦🇺');
  clearCacheForTests();
  mockGet(async () => ({ data: { results: { bindings: [] } } }));
  await assert.rejects(fetchCountryFacts('zz'));
});

test('issTrackTimestamps returns 10 ascending unix seconds ending now', async () => {
  const { issTrackTimestamps } = await import('../lib/iss.js');
  const ts = issTrackTimestamps(360, 1_000_000_000);
  assert.equal(ts.length, 10);
  assert.equal(ts[9], 1_000_000);
  assert.equal(ts[0], 1_000_000 - 360);
});

test('fetchIssTrack sends timestamps (not seconds) to wheretheiss.at', async () => {
  const calls = mockGet(async () => ({ data: [{ latitude: 1, longitude: 2, timestamp: 3 }] }));
  const { fetchIssTrack } = await import('../lib/iss.js');
  const t = await fetchIssTrack(360);
  assert.ok(calls[0].opts.params.timestamps.split(',').length === 10);
  assert.equal(t.positions[0].lat, 1);
});

test('fetchNearbyBikes uses api.citybik.es and its {networks} shape', async () => {
  const calls = mockGet(async (url) =>
    url.endsWith('/networks/n1')
      ? { data: { network: { stations: [{ name: 'S1', free_bikes: 4, empty_slots: 2 }] } } }
      : { data: { networks: [{ id: 'n1', name: 'Net', location: { latitude: -33.8, longitude: 151.2 } }] } }
  );
  const { fetchNearbyBikes } = await import('../lib/bikes.js');
  const b = await fetchNearbyBikes(-33.87, 151.21);
  assert.match(calls[0].url, /api\.citybik\.es/);
  assert.equal(b.stations[0].freeBikes, 4);
});

test('installDefaultHeaders sets an identifying User-Agent', async () => {
  const { installDefaultHeaders, USER_AGENT } = await import('../lib/http.js');
  const inst = { defaults: { headers: { common: {} } } };
  installDefaultHeaders(inst);
  assert.equal(inst.defaults.headers.common['User-Agent'], USER_AGENT);
});

test('fetchNearbyBikes ignores networks far away', async () => {
  mockGet(async () => ({ data: { networks: [{ id: 'tw', name: 'YouBike', location: { latitude: 25, longitude: 121.5 } }] } }));
  const { fetchNearbyBikes } = await import('../lib/bikes.js');
  const b = await fetchNearbyBikes(-33.87, 151.21);
  assert.equal(b.stations.length, 0);
  assert.match(b.message, /No bike-share/);
});
