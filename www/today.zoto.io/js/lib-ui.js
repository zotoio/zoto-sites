import { attachLeafletResizeObserver } from './leaflet-widget.js';
import { formatDay, formatSunTime, weatherIcon } from './weather-utils.js';

const params = new URLSearchParams(window.location.search);
export const forceDemo = params.get('demo') === '1' || params.get('demo') === 'true';

export function apiQuery(extra = {}) {
  const q = new URLSearchParams(extra);
  if (forceDemo) q.set('demo', '1');
  return q.toString();
}

export async function fetchJson(path, extra = {}) {
  const qs = apiQuery(extra);
  const url = qs ? `${path}?${qs}` : path;
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export function setBackdrop(lat, lon, zoom = 16) {
  const el = document.getElementById('backdrop');
  el.replaceChildren();

  const n = 2 ** zoom;
  const latRad = (lat * Math.PI) / 180;
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  const radius = 2;
  const size = radius * 2 + 1;

  const grid = document.createElement('div');
  grid.className = 'backdrop-grid';
  grid.style.gridTemplateColumns = `repeat(${size}, 256px)`;
  grid.style.gridTemplateRows = `repeat(${size}, 256px)`;

  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const img = document.createElement('img');
      img.src = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${y + dy}/${x + dx}`;
      img.alt = '';
      img.decoding = 'async';
      grid.appendChild(img);
    }
  }
  el.appendChild(grid);

  const fitBackdrop = () => {
    const vw = window.innerWidth;
    const vh = Math.max(window.innerHeight, document.documentElement.scrollHeight);
    const gridW = size * 256;
    const gridH = size * 256;
    const scale = Math.max(vw / gridW, vh / gridH) * 1.12;
    grid.style.transform = `translate(-50%, -50%) scale(${scale})`;
  };

  fitBackdrop();
  if (el._backdropResize) {
    window.removeEventListener('resize', el._backdropResize);
  }
  el._backdropResize = fitBackdrop;
  window.addEventListener('resize', fitBackdrop, { passive: true });
}

export function drawHourlyChart(canvas, hourly) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const temps = hourly.temperature_2m || [];
  const precip = hourly.precipitation_probability || [];
  const n = Math.max(temps.length, 1);
  const pad = 24;

  const tMin = Math.min(...temps, 0) - 1;
  const tMax = Math.max(...temps, 1) + 1;

  ctx.strokeStyle = 'rgba(110,231,255,0.85)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  temps.forEach((t, i) => {
    const x = pad + (i / (n - 1 || 1)) * (w - pad * 2);
    const y = h - pad - ((t - tMin) / (tMax - tMin || 1)) * (h - pad * 2);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.fillStyle = 'rgba(147,197,253,0.35)';
  precip.forEach((p, i) => {
    const x = pad + (i / (n - 1 || 1)) * (w - pad * 2);
    const barH = (p / 100) * (h * 0.35);
    ctx.fillRect(x - 4, h - pad - barH, 8, barH);
  });

  ctx.fillStyle = 'rgba(168,176,192,0.9)';
  ctx.font = '11px system-ui,sans-serif';
  ctx.fillText('24h temperature · precip chance (bars)', pad, 16);

  ctx.fillStyle = 'rgba(168,176,192,0.75)';
  ctx.font = '10px system-ui,sans-serif';
  const labelEvery = Math.max(1, Math.floor(n / 6));
  (hourly.time || []).slice(0, n).forEach((t, i) => {
    if (i % labelEvery !== 0 && i !== n - 1) return;
    const x = pad + (i / (n - 1 || 1)) * (w - pad * 2);
    const label = typeof t === 'string' ? t.slice(11, 16) : '';
    ctx.fillText(label, x - 12, h - 6);
  });
}

export function renderNews(listEl, payload, maxItems = 10) {
  listEl.innerHTML = '';
  const isDemo = payload.source === 'demo';
  if (isDemo) {
    const note = document.createElement('p');
    note.className = 'demo-badge';
    note.setAttribute('role', 'note');
    note.textContent = payload.attribution || 'Demo sample — not live Hacker News';
    listEl.appendChild(note);
  }
  if (payload.source === 'unavailable') {
    const note = document.createElement('p');
    note.className = 'muted-note';
    note.textContent = payload.message || 'News temporarily unavailable';
    listEl.appendChild(note);
    return;
  }
  if (!(payload.articles || []).length) {
    const note = document.createElement('p');
    note.className = 'muted-note';
    note.textContent = 'No stories to show.';
    listEl.appendChild(note);
    return;
  }
  (payload.articles || []).slice(0, maxItems).forEach((a) => {
    const li = document.createElement('li');
    li.className = 'news-item';

    let thumb;
    if (a.image_url) {
      thumb = document.createElement('img');
      thumb.className = 'news-thumb';
      thumb.alt = '';
      thumb.loading = 'lazy';
      thumb.src = a.image_url;
      thumb.onerror = () => {
        const ph = document.createElement('div');
        ph.className = 'news-thumb placeholder hn-placeholder';
        ph.textContent = isDemo ? 'Demo' : 'HN';
        thumb.replaceWith(ph);
      };
    } else {
      thumb = document.createElement('div');
      thumb.className = 'news-thumb placeholder hn-placeholder';
      thumb.textContent = isDemo ? 'Demo' : 'HN';
    }

    const body = document.createElement('div');
    const link = document.createElement('a');
    link.href = a.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = a.title;
    body.appendChild(link);
    if (a.description) {
      const desc = document.createElement('p');
      desc.className = 'news-desc';
      desc.textContent = a.description;
      body.appendChild(desc);
    }
    const meta = document.createElement('p');
    meta.className = 'news-meta';
    const parts = [];
    if (a.points != null) parts.push(`${a.points} pts`);
    if (a.num_comments != null) parts.push(`${a.num_comments} comments`);
    if (a.hn_url) {
      const prefix = parts.length ? `${parts.join(' · ')} · ` : '';
      meta.innerHTML = `${prefix}<a href="${a.hn_url}" target="_blank" rel="noopener noreferrer">HN discussion</a>`;
    } else {
      meta.textContent = parts.join(' · ');
    }
    body.appendChild(meta);

    li.appendChild(thumb);
    li.appendChild(body);
    listEl.appendChild(li);
  });
}

export function renderTransit(mapEl, listEl, center, payload, options = {}) {
  const mapHeight = options.mapHeight || 220;
  listEl.innerHTML = '';
  const stops = payload.stops || [];
  if (payload.source === 'demo') {
    const note = document.createElement('p');
    note.className = 'demo-badge';
    note.setAttribute('role', 'note');
    note.textContent = 'Demo transit stops — not your location';
    listEl.appendChild(note);
  }
  if (!stops.length) {
    const empty = document.createElement('p');
    empty.className = 'muted-note';
    const radius = payload.radiusM ? ` (within ${Math.round(payload.radiusM)} m)` : '';
    empty.textContent =
      payload.source === 'demo'
        ? 'No demo stops.'
        : `No transit stops found nearby for your location${radius}.`;
    listEl.appendChild(empty);
    if (options.onWidenSearch && payload.source !== 'demo') {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn-ghost transit-widen-btn';
      btn.textContent = 'Search wider area (2.5 km)';
      btn.addEventListener('click', () => options.onWidenSearch());
      listEl.appendChild(btn);
    }
  }
  (payload.stops || []).forEach((s) => {
    const li = document.createElement('li');
    const modes = (s.modes || []).join(', ');
    const lines = (s.lines || []).length ? s.lines.join(', ') : '';
    li.innerHTML = `<strong>${s.name}</strong> <span class="dist">(${s.distanceM} m · ${modes})</span>${
      lines ? `<div class="lines">${lines}</div>` : ''
    }`;
    listEl.appendChild(li);
  });

  if (mapEl._leaflet) {
    mapEl._leafletResizeObserver?.disconnect();
    mapEl._leaflet.remove();
  }
  mapEl.style.height = `${mapHeight}px`;
  mapEl.style.minHeight = `${mapHeight}px`;
  mapEl.style.maxHeight = `${mapHeight}px`;
  const map = L.map(mapEl, { zoomControl: false, attributionControl: true }).setView(
    [center.lat, center.lon],
    15
  );
  mapEl._leaflet = map;
  attachLeafletResizeObserver(mapEl, map);
  map.whenReady(() => {
    map.invalidateSize({ animate: false });
    window.setTimeout(() => map.invalidateSize({ animate: false }), 100);
  });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap',
  }).addTo(map);

  const group = L.featureGroup();
  (payload.stops || []).forEach((s) => {
    L.circleMarker([s.lat, s.lon], {
      radius: 7,
      color: '#6ee7ff',
      weight: 2,
      fillColor: '#0ea5e9',
      fillOpacity: 0.85,
    })
      .bindPopup(`<strong>${s.name}</strong><br>${s.distanceM} m`)
      .addTo(group);
  });
  group.addTo(map);
  if (group.getLayers().length) {
    map.fitBounds(group.getBounds().pad(0.2));
  }
}

export function renderWeatherStats(statsEl, weather) {
  const cur = weather.current || {};
  const daily = weather.daily || {};
  const rows = [
    ['Feels like', `${Math.round(cur.apparent_temperature ?? cur.temperature_2m ?? 0)}°`],
    ['Wind', `${Math.round(cur.wind_speed_10m ?? daily.wind_speed_10m_max?.[0] ?? 0)} km/h`],
    ['UV index', `${Number(cur.uv_index ?? daily.uv_index_max?.[0] ?? 0).toFixed(1)}`],
    ['Sunrise', formatSunTime(daily.sunrise?.[0], weather.timezone)],
    ['Sunset', formatSunTime(daily.sunset?.[0], weather.timezone)],
    ['Today', `${Math.round(daily.temperature_2m_min?.[0] ?? 0)}° – ${Math.round(daily.temperature_2m_max?.[0] ?? 0)}°`],
  ];
  statsEl.innerHTML = rows
    .map(
      ([label, value]) =>
        `<div><dt>${label}</dt><dd>${value}</dd></div>`
    )
    .join('');
}

export function renderDaily(stripEl, daily) {
  stripEl.innerHTML = '';
  const { time = [], weather_code = [], temperature_2m_max = [], temperature_2m_min = [] } = daily;
  time.slice(0, 7).forEach((t, i) => {
    const card = document.createElement('div');
    card.className = 'day-card';
    card.innerHTML = `<span>${formatDay(t)}</span><span class="d-icon">${weatherIcon(weather_code[i])}</span><span class="d-temps">${Math.round(temperature_2m_max[i])}° / ${Math.round(temperature_2m_min[i])}°</span>`;
    stripEl.appendChild(card);
  });
}

export { formatDay, weatherIcon };
