import { fetchJson, forceDemo, setBackdrop } from './lib-ui.js';
import { demoShowcaseLayout, loadLayout, STORAGE_KEY } from './layout-storage.js';
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
  const locale = (loc.countryCode || 'us').toLowerCase().slice(0, 2);
  const geo = { lat: loc.lat, lon: loc.lon };

  const [weather, news, transit, airQuality] = await Promise.all([
    fetchJson('/api/weather', geo).catch(() => fetchJson('/api/weather', { demo: 1 })),
    fetchJson('/api/news', { locale }).catch(() => fetchJson('/api/news', { demo: 1 })),
    fetchJson('/api/transit', geo).catch(() => fetchJson('/api/transit', { demo: 1 })),
    fetchJson('/api/air-quality', geo).catch(() => fetchJson('/api/air-quality', { demo: 1 })),
  ]);

  const initialLayout =
    forceDemo && !localStorage.getItem(STORAGE_KEY) ? demoShowcaseLayout() : loadLayout();

  initWidgetCanvas(
    {
      loc,
      weather,
      news,
      transit,
      airQuality,
      forceDemo,
      fetch: (path, extra = {}) => fetchJson(path, extra),
    },
    { initialLayout }
  );
}

bootstrap().catch(async () => {
  document.getElementById('demo-hint').textContent = 'Offline — loading demo layout.';
  const loc = await fetchJson('/api/location');
  setBackdrop(loc.lat, loc.lon);
  initWidgetCanvas(
    {
      loc,
      weather: await fetchJson('/api/weather', { demo: 1 }),
      news: await fetchJson('/api/news', { demo: 1 }),
      transit: await fetchJson('/api/transit', { demo: 1 }),
      airQuality: await fetchJson('/api/air-quality', { demo: 1 }),
      forceDemo: true,
      fetch: (path, extra = {}) => fetchJson(path, extra),
    },
    { initialLayout: demoShowcaseLayout() }
  );
});
