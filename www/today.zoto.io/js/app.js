import { fetchJson, forceDemo, setBackdrop } from './lib-ui.js';
import {
  cycleUltrawidePreference,
  getUltrawidePreference,
  syncUltrawideMode,
  ultrawidePreferenceLabel,
  watchUltrawide,
} from './display-mode.js';
import { demoShowcaseLayout, loadLayout, STORAGE_KEY, ultrawideShowcaseLayout } from './layout-storage.js';
import { initWidgetCanvas } from './widget-canvas.js';

async function resolveLocation() {
  if (forceDemo) {
    return fetchJson('/api/location');
  }

  const browserLoc = await new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          source: 'browser',
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          placeName: 'Your location',
        }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
    );
  });

  if (browserLoc) {
    try {
      return await fetchJson('/api/place', { lat: browserLoc.lat, lon: browserLoc.lon });
    } catch {
      return browserLoc;
    }
  }
  return fetchJson('/api/location');
}

function mountDashboard(ctx, initialLayout) {
  const ultrawideBtn = document.getElementById('ultrawide-mode-btn');

  function refreshUltrawideButton() {
    const pref = getUltrawidePreference();
    const { active } = syncUltrawideMode();
    if (ultrawideBtn) {
      ultrawideBtn.textContent = `Ultrawide: ${ultrawidePreferenceLabel(pref)}`;
      ultrawideBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
  }

  refreshUltrawideButton();

  const canvas = initWidgetCanvas(ctx, { initialLayout });

  ultrawideBtn?.addEventListener('click', () => {
    cycleUltrawidePreference();
    refreshUltrawideButton();
    canvas.setUltrawideGrid(syncUltrawideMode().active);
  });

  watchUltrawide((active) => {
    refreshUltrawideButton();
    canvas.setUltrawideGrid(active);
  });

  return canvas;
}

async function bootstrap() {
  const hint = document.getElementById('demo-hint');
  if (forceDemo) {
    hint.textContent = 'Demo mode (?demo=1) — drag widgets, + to browse the library by category.';
  }

  let loc;
  try {
    loc = await resolveLocation();
  } catch {
    loc = await fetchJson('/api/location');
  }

  setBackdrop(loc.lat, loc.lon);
  const geo = { lat: loc.lat, lon: loc.lon };

  async function loadLive(path, params = {}) {
    if (forceDemo) {
      return fetchJson(path, { ...params, demo: 1 });
    }
    return fetchJson(path, params);
  }

  const [weather, news, transit, airQuality] = await Promise.all([
    loadLive('/api/weather', geo),
    loadLive('/api/news', { topic: 'top' }),
    loadLive('/api/transit', geo),
    loadLive('/api/air-quality', geo),
  ]);

  const initialLayout =
    forceDemo && !localStorage.getItem(STORAGE_KEY)
      ? syncUltrawideMode().active
        ? ultrawideShowcaseLayout()
        : demoShowcaseLayout()
      : loadLayout();

  mountDashboard(
    {
      loc,
      weather,
      news,
      transit,
      airQuality,
      forceDemo,
      fetch: (path, extra = {}) => fetchJson(path, extra),
    },
    initialLayout
  );
}

bootstrap().catch(async () => {
  document.getElementById('demo-hint').textContent = 'Offline — loading demo layout.';
  const loc = await fetchJson('/api/location');
  setBackdrop(loc.lat, loc.lon);
  const initial =
    syncUltrawideMode().active ? ultrawideShowcaseLayout() : demoShowcaseLayout();
  mountDashboard(
    {
      loc,
      weather: await fetchJson('/api/weather', { demo: 1 }),
      news: await fetchJson('/api/news', { demo: 1 }),
      transit: await fetchJson('/api/transit', { demo: 1 }),
      airQuality: await fetchJson('/api/air-quality', { demo: 1 }),
      forceDemo: true,
      fetch: (path, extra = {}) => fetchJson(path, extra),
    },
    initial
  );
});
