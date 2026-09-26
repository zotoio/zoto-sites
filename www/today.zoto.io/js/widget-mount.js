import {
  drawHourlyChart,
  renderDaily,
  renderNews,
  renderTransit,
  renderWeatherStats,
} from './lib-ui.js';
import { formatSunTime, moonPhaseInfo, weatherIcon, weatherLabel } from './weather-utils.js';

function fitCanvas(canvas, container) {
  const ratio = window.devicePixelRatio || 1;
  const w = Math.max(280, container.clientWidth - 4);
  const h = Math.max(120, container.clientHeight - 4);
  canvas.width = w * ratio;
  canvas.height = h * ratio;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { w, h };
}

function newsItemLimit(bodyEl, settings) {
  const explicit = settings?.maxItems;
  if (explicit) return Number(explicit);
  return Math.max(3, Math.floor(bodyEl.clientHeight / 72));
}

/**
 * @param {string} type
 * @param {HTMLElement} body
 * @param {object} ctx
 * @param {Record<string, unknown>} settings
 */
export function mountWidget(type, body, ctx, settings = {}) {
  const { loc, weather, news, transit, airQuality } = ctx;

  switch (type) {
    case 'location': {
      body.innerHTML = `
        <p class="eyebrow">Today</p>
        <h1 class="loc-title">${loc.placeName || 'Today'}</h1>
        <p class="meta loc-meta">${[loc.city, loc.region, loc.country, loc.timezone, loc.source ? `via ${loc.source}` : '']
          .filter(Boolean)
          .join(' · ')}</p>`;
      return { resize() {}, destroy() {} };
    }
    case 'weather': {
      body.innerHTML = `
        <div class="weather-now">
          <div class="wx-icon" aria-hidden="true"></div>
          <div><p class="temp"></p><p class="wx-label"></p></div>
        </div>
        <div class="chart-wrap"><canvas class="hourly-chart" role="img" aria-label="Hourly forecast"></canvas></div>
        <div class="daily-strip"></div>
        <dl class="weather-stats"></dl>`;
      const cur = weather.current || {};
      body.querySelector('.wx-icon').textContent = weatherIcon(cur.weather_code);
      body.querySelector('.temp').textContent = `${Math.round(cur.temperature_2m ?? 0)}°`;
      body.querySelector('.wx-label').textContent = weatherLabel(cur.weather_code);
      const canvas = body.querySelector('.hourly-chart');
      const chartWrap = body.querySelector('.chart-wrap');
      const redraw = () => {
        fitCanvas(canvas, chartWrap);
        drawHourlyChart(canvas, weather.hourly || {});
      };
      renderDaily(body.querySelector('.daily-strip'), weather.daily || {});
      renderWeatherStats(body.querySelector('.weather-stats'), weather);
      redraw();
      return { resize: redraw, destroy() {} };
    }
    case 'news': {
      body.innerHTML = '<ul class="news-list"></ul>';
      const list = body.querySelector('.news-list');
      const render = () => renderNews(list, news, newsItemLimit(body, settings));
      render();
      return { resize: render, destroy() {} };
    }
    case 'transit': {
      body.innerHTML = '<div class="transit-map"></div><ol class="transit-list"></ol>';
      const mapEl = body.querySelector('.transit-map');
      const listEl = body.querySelector('.transit-list');
      const render = () => {
        const mapH = Math.max(120, Math.floor(body.clientHeight * 0.45));
        renderTransit(mapEl, listEl, loc, transit, { mapHeight: mapH });
      };
      render();
      return {
        resize: () => {
          mapEl._leaflet?.invalidateSize();
          render();
        },
        destroy() {
          mapEl._leaflet?.remove();
        },
      };
    }
    case 'clock': {
      body.innerHTML =
        '<p class="clock-time" aria-live="polite"></p><p class="clock-date"></p><ul class="clock-sun"></ul>';
      const tz = loc.timezone || weather.timezone || undefined;
      const tick = () => {
        const now = new Date();
        body.querySelector('.clock-time').textContent = new Intl.DateTimeFormat(undefined, {
          hour: 'numeric',
          minute: '2-digit',
          second: 'numeric',
          timeZone: tz,
        }).format(now);
        body.querySelector('.clock-date').textContent = new Intl.DateTimeFormat(undefined, {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
          timeZone: tz,
        }).format(now);
        body.querySelector('.clock-sun').innerHTML = `
          <li>Sunrise ${formatSunTime(weather.daily?.sunrise?.[0], tz)}</li>
          <li>Sunset ${formatSunTime(weather.daily?.sunset?.[0], tz)}</li>`;
      };
      tick();
      const id = window.setInterval(tick, 1000);
      return { resize() { tick(); }, destroy() { clearInterval(id); } };
    }
    case 'air-quality': {
      const c = airQuality.current || {};
      body.innerHTML = `
        <dl class="aq-grid">
          <div><dt>US AQI</dt><dd>${c.us_aqi ?? '—'}</dd></div>
          <div><dt>EU AQI</dt><dd>${c.european_aqi ?? '—'}</dd></div>
          <div><dt>PM2.5</dt><dd>${c.pm2_5 ?? '—'} µg/m³</dd></div>
          <div><dt>PM10</dt><dd>${c.pm10 ?? '—'} µg/m³</dd></div>
          <div><dt>O₃</dt><dd>${c.ozone ?? '—'} µg/m³</dd></div>
          <div><dt>NO₂</dt><dd>${c.nitrogen_dioxide ?? '—'} µg/m³</dd></div>
        </dl>
        <p class="pollen-note">${airQuality.pollen?.label || 'Pollen estimate unavailable'}</p>`;
      return { resize() {}, destroy() {} };
    }
    case 'uv': {
      const curUv = weather.current?.uv_index ?? airQuality.hourly?.uv_index?.[0] ?? 0;
      body.innerHTML = `
        <p class="uv-now">${Number(curUv).toFixed(1)}</p>
        <p class="uv-label">${Number(curUv) >= 6 ? 'High — seek shade' : Number(curUv) >= 3 ? 'Moderate' : 'Low'}</p>
        <canvas class="uv-chart" role="img" aria-label="UV index next hours"></canvas>`;
      const canvas = body.querySelector('.uv-chart');
      const draw = () => {
        const { w, h } = fitCanvas(canvas, body);
        const ctx2 = canvas.getContext('2d');
        const vals = (airQuality.hourly?.uv_index || weather.hourly?.temperature_2m?.map(() => curUv) || []).slice(
          0,
          12
        );
        const pad = 16;
        ctx2.clearRect(0, 0, w, h);
        ctx2.strokeStyle = 'rgba(250,204,21,0.9)';
        ctx2.beginPath();
        vals.forEach((v, i) => {
          const x = pad + (i / (vals.length - 1 || 1)) * (w - pad * 2);
          const y = h - pad - (Number(v) / 11) * (h - pad * 2);
          if (i === 0) ctx2.moveTo(x, y);
          else ctx2.lineTo(x, y);
        });
        ctx2.stroke();
      };
      draw();
      return { resize: draw, destroy() {} };
    }
    case 'moon': {
      const info = moonPhaseInfo();
      body.innerHTML = `
        <p class="moon-emoji" aria-hidden="true">${info.emoji}</p>
        <p class="moon-name">${info.name}</p>
        <p class="moon-meta">${info.illumination}% lit · day ${Math.round(info.fraction * 29.53) + 1} of ~30</p>`;
      return { resize() {}, destroy() {} };
    }
    case 'map': {
      body.innerHTML = '<div class="leaflet-map"></div>';
      const mapEl = body.querySelector('.leaflet-map');
      mapEl.style.height = '100%';
      mapEl.style.minHeight = '160px';
      const map = L.map(mapEl, { zoomControl: true }).setView([loc.lat, loc.lon], 13);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap',
      }).addTo(map);
      mapEl._leaflet = map;
      return {
        resize: () => map.invalidateSize(),
        destroy() {
          map.remove();
        },
      };
    }
    case 'radar': {
      body.innerHTML = '<div class="leaflet-map"></div><p class="radar-caption">RainViewer precipitation radar</p>';
      const mapEl = body.querySelector('.leaflet-map');
      mapEl.style.height = 'calc(100% - 1.2rem)';
      mapEl.style.minHeight = '140px';
      const map = L.map(mapEl, { zoomControl: false }).setView([loc.lat, loc.lon], 8);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OSM',
      }).addTo(map);
      mapEl._leaflet = map;
      let radarLayer = null;
      fetch('https://api.rainviewer.com/public/weather-maps.json')
        .then((r) => r.json())
        .then((data) => {
          const past = data?.radar?.past;
          if (!past?.length) return;
          const latest = past[past.length - 1];
          radarLayer = L.tileLayer(
            `https://tilecache.rainviewer.com/v2/radar/${latest.path}/256/{z}/{x}/{y}/2/1_1.png`,
            { opacity: 0.65, maxZoom: 10 }
          ).addTo(map);
        })
        .catch(() => {
          body.querySelector('.radar-caption').textContent = 'Radar unavailable — map only (demo)';
        });
      return {
        resize: () => map.invalidateSize(),
        destroy() {
          if (radarLayer) map.removeLayer(radarLayer);
          map.remove();
        },
      };
    }
    default:
      body.textContent = 'Unknown widget';
      return { resize() {}, destroy() {} };
  }
}
