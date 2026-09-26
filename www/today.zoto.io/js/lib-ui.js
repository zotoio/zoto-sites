import { formatDay, weatherIcon } from './weather-utils.js';

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

export function setBackdrop(lat, lon, zoom = 14) {
  const n = 2 ** zoom;
  const latRad = (lat * Math.PI) / 180;
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);

  const urls = [];
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      urls.push(
        `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${y + dy}/${x + dx}`
      );
    }
  }

  const el = document.getElementById('backdrop');
  el.style.backgroundImage = urls.map((u) => `url("${u}")`).join(', ');
  el.style.backgroundSize = '300% 300%';
  el.style.backgroundPosition = 'center center';
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
  ctx.fillText('24h temp (line) · precip % (bars)', pad, 16);
}

export function renderNews(listEl, payload) {
  listEl.innerHTML = '';
  (payload.articles || []).forEach((a) => {
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
        ph.className = 'news-thumb placeholder';
        ph.textContent = a.source || 'News';
        thumb.replaceWith(ph);
      };
    } else {
      thumb = document.createElement('div');
      thumb.className = 'news-thumb placeholder';
      thumb.textContent = (a.source || 'News').slice(0, 12);
    }

    const body = document.createElement('div');
    const link = document.createElement('a');
    link.href = a.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = a.title;
    const meta = document.createElement('p');
    meta.className = 'news-meta';
    meta.textContent = `${a.source || 'Source'} · ${new Date(a.published_at).toLocaleString()}`;
    body.appendChild(link);
    body.appendChild(meta);

    li.appendChild(thumb);
    li.appendChild(body);
    listEl.appendChild(li);
  });
}

export function renderTransit(mapEl, listEl, center, payload) {
  listEl.innerHTML = '';
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
    mapEl._leaflet.remove();
  }
  const map = L.map(mapEl, { zoomControl: false, attributionControl: true }).setView(
    [center.lat, center.lon],
    15
  );
  mapEl._leaflet = map;
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
