import { formatDay, weatherIcon, weatherLabel } from './weather-utils.js';
import {
  drawHourlyChart,
  fetchJson,
  forceDemo,
  renderDaily,
  renderNews,
  renderTransit,
  setBackdrop,
} from './lib-ui.js';

async function resolveLocation() {
  if (forceDemo) {
    return fetchJson('/api/location');
  }

  const geoPromise = new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          source: 'browser',
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          placeName: 'Your location',
        });
      },
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
    );
  });

  const browserLoc = await geoPromise;
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
    hint.textContent = 'Demo mode (?demo=1) — sample data for all panels.';
  }

  let loc;
  try {
    loc = await resolveLocation();
  } catch {
    loc = await fetchJson('/api/location');
  }

  const placeName = document.getElementById('place-name');
  const placeMeta = document.getElementById('place-meta');
  placeName.textContent = loc.placeName || 'Today';
  placeMeta.textContent = [
    loc.city,
    loc.region,
    loc.country,
    loc.timezone,
    loc.source ? `via ${loc.source}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  setBackdrop(loc.lat, loc.lon);

  const locale = (loc.countryCode || 'us').toLowerCase().slice(0, 2);

  const [weather, news, transit] = await Promise.all([
    fetchJson('/api/weather', { lat: loc.lat, lon: loc.lon }).catch(() => fetchJson('/api/weather', { demo: 1 })),
    fetchJson('/api/news', { locale }).catch(() => fetchJson('/api/news', { demo: 1 })),
    fetchJson('/api/transit', { lat: loc.lat, lon: loc.lon }).catch(() => fetchJson('/api/transit', { demo: 1 })),
  ]);

  document.getElementById('weather-source').textContent = weather.source || 'weather';
  document.getElementById('news-source').textContent = news.source || 'news';
  document.getElementById('transit-source').textContent = transit.source || 'transit';

  const cur = weather.current || {};
  document.getElementById('wx-temp').textContent = `${Math.round(cur.temperature_2m ?? 0)}°`;
  document.getElementById('wx-label').textContent = weatherLabel(cur.weather_code);
  document.getElementById('wx-icon').textContent = weatherIcon(cur.weather_code);

  drawHourlyChart(document.getElementById('hourly-chart'), weather.hourly || {});
  renderDaily(document.getElementById('daily-strip'), weather.daily || {});

  renderNews(document.getElementById('news-list'), news);
  renderTransit(
    document.getElementById('transit-map'),
    document.getElementById('transit-list'),
    loc,
    transit
  );
}

bootstrap().catch(() => {
  document.getElementById('place-name').textContent = 'Today (offline demo)';
  fetchJson('/api/location').then((loc) => {
    setBackdrop(loc.lat, loc.lon);
  });
});
