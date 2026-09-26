import test from 'node:test';
import assert from 'node:assert/strict';
import { demoTrafficCameras, demoWebcams } from '../lib/demo.js';
import { fetchProxiedCameraImage } from '../lib/camera-images.js';
import { distanceKm } from '../lib/geo-utils.js';

test('demoWebcams uses demo image keys only', () => {
  const d = demoWebcams();
  assert.equal(d.source, 'demo');
  assert.ok(d.cameras.every((c) => c.imageKey.startsWith('demo-')));
});

test('demo traffic cameras are labeled demo', () => {
  const d = demoTrafficCameras();
  assert.equal(d.source, 'demo');
  assert.ok(d.messages[0].includes('Demo'));
});

test('demo camera image proxy returns svg placeholder', async () => {
  const img = await fetchProxiedCameraImage('demo-traffic-1');
  assert.ok(img?.contentType.includes('svg'));
});

test('distanceKm sydney to parramatta is plausible', () => {
  const km = distanceKm(-33.8688, 151.2093, -33.815, 151.0);
  assert.ok(km > 10 && km < 35);
});
