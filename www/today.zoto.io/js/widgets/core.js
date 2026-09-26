import {
  drawHourlyChart,
  renderDaily,
  renderNews,
  renderTransit,
  renderWeatherStats,
} from '../lib-ui.js';
import { weatherIcon, weatherLabel } from '../weather-utils.js';
import { attachSettingsPopover } from '../widget-helpers.js';
import { getSettingsFields } from '../widget-registry.js';
import { setWidgetGridHeight } from '../widget-grid-resize.js';

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
}

function newsItemLimit(bodyEl, settings) {
  const explicit = settings?.maxItems;
  if (explicit) return Number(explicit);
  return Math.max(3, Math.floor(bodyEl.clientHeight / 72));
}

export async function mount(type, body, ctx, settings = {}, onSettings) {
  const { loc, weather, news, transit } = ctx;
  const wrap = body.closest('.widget');

  switch (type) {
    case 'location':
      body.innerHTML = `
        <p class="eyebrow">Today</p>
        <h1 class="loc-title">${loc.placeName || 'Today'}</h1>
        <p class="meta loc-meta">${[loc.city, loc.region, loc.country, loc.timezone, loc.source ? `via ${loc.source}` : '']
          .filter(Boolean)
          .join(' · ')}</p>`;
      return { resize() {}, destroy() {} };
    case 'weather': {
      body.innerHTML = `
        <div class="weather-now"><div class="wx-icon"></div><div><p class="temp"></p><p class="wx-label"></p></div></div>
        <div class="chart-wrap"><canvas class="hourly-chart"></canvas></div>
        <div class="daily-strip"></div><dl class="weather-stats"></dl>`;
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
      attachSettingsPopover(wrap, {
        title: 'News',
        fields: getSettingsFields(type),
        settings,
        onSave: (s) => {
          if (onSettings) onSettings(s);
          else render();
        },
      });
      return { resize: render, destroy() {} };
    }
    case 'transit': {
      let payload = transit;
      let searchRadius = payload.radiusM || 900;

      const applyCompactLayout = (hasStops) => {
        body.classList.toggle('widget-body-transit-compact', !hasStops);
        if (!hasStops) {
          setWidgetGridHeight(body, 4);
        }
      };

      body.innerHTML = '<div class="transit-map"></div><ol class="transit-list"></ol>';
      const mapEl = body.querySelector('.transit-map');
      const listEl = body.querySelector('.transit-list');

      const render = () => {
        const stops = payload.stops || [];
        const hasStops = stops.length > 0;
        applyCompactLayout(hasStops);
        const mapHeight = hasStops
          ? Math.max(120, Math.floor(body.clientHeight * 0.45))
          : 92;
        renderTransit(mapEl, listEl, loc, payload, {
          mapHeight,
          onWidenSearch: async () => {
            searchRadius = 2500;
            try {
              payload = await ctx.fetch('/api/transit', {
                lat: loc.lat,
                lon: loc.lon,
                radiusM: searchRadius,
              });
            } catch {
              payload = { source: 'overpass', stops: [], radiusM: searchRadius };
            }
            render();
          },
        });
        mapEl._leaflet?.invalidateSize();
      };

      render();

      return {
        resize: () => {
          render();
        },
        destroy() {
          mapEl._leafletResizeObserver?.disconnect();
          mapEl._leaflet?.remove();
        },
      };
    }
    case 'map': {
      body.innerHTML = '<div class="leaflet-map"></div>';
      const mapEl = body.querySelector('.leaflet-map');
      mapEl.style.height = '100%';
      mapEl.style.minHeight = '160px';
      const map = L.map(mapEl).setView([loc.lat, loc.lon], 13);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OSM' }).addTo(map);
      mapEl._leaflet = map;
      return { resize: () => map.invalidateSize(), destroy: () => map.remove() };
    }
    default:
      return null;
  }
}
