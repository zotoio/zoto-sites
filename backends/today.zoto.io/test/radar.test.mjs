import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRadarTileUrlTemplate,
  getRadarPayload,
  pickLatestRadarFrame,
} from '../lib/radar.js';
import { clearCacheForTests } from '../lib/cache.js';

test('buildRadarTileUrlTemplate does not duplicate /v2/radar', () => {
  const path = '/v2/radar/1700000000/5/1_1.png';
  const url = buildRadarTileUrlTemplate(path);
  assert.equal(
    url,
    'https://tilecache.rainviewer.com/v2/radar/1700000000/5/1_1.png/256/{z}/{x}/{y}/2/1_1.png'
  );
  assert.doesNotMatch(url, /\/v2\/radar\/v2\/radar/);
});

test('buildRadarTileUrlTemplate accepts paths without leading slash', () => {
  const url = buildRadarTileUrlTemplate('v2/radar/123/1/1_1.png');
  assert.ok(url.startsWith('https://tilecache.rainviewer.com/v2/radar/123/'));
});

test('pickLatestRadarFrame chooses last past frame', () => {
  const frame = pickLatestRadarFrame({
    radar: { past: [{ path: '/a', time: 1 }, { path: '/b', time: 2 }] },
  });
  assert.equal(frame.path, '/b');
});

test('getRadarPayload falls back to demo on upstream failure', async () => {
  clearCacheForTests();
  const http = {
    get: async () => {
      throw new Error('network down');
    },
  };
  const payload = await getRadarPayload(http);
  assert.equal(payload.demo, true);
  assert.equal(payload.source, 'demo');
});

test('getRadarPayload returns tile template from metadata', async () => {
  clearCacheForTests();
  const http = {
    get: async () => ({
      data: {
        radar: {
          past: [{ path: '/v2/radar/99/3/1_1.png', time: 99 }],
        },
      },
    }),
  };
  const payload = await getRadarPayload(http);
  assert.equal(payload.demo, false);
  assert.equal(payload.source, 'rainviewer');
  assert.match(payload.tileUrlTemplate, /tilecache\.rainviewer\.com\/v2\/radar\/99/);
});
