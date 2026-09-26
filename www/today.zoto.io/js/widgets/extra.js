import {
  drawHourlyChart,
  renderNews,
  renderTransit,
} from '../lib-ui.js';
import { demoBadge, attachSettingsPopover, PRODUCTIVITY_STORE } from '../widget-helpers.js';
import { formatSunTime, moonPhaseInfo, weatherIcon, weatherLabel } from '../weather-utils.js';
import { getSettingsFields } from '../widget-registry.js';
import { mountIssMapWidget } from '../iss-map.js';
import { mountLeafletInWidget } from '../leaflet-widget.js';
import {
  aqiGaugeSvg,
  bestOutsideStripSvg,
  bikeBarsSvg,
  chargerDotsSvg,
  planetsSkySvg,
  pollenBarsSvg,
  quakeMiniMapSvg,
  sunArcSvg,
  tideCurveSvg,
  waveSparklineSvg,
} from '../widget-visuals.js';

function fitCanvas(canvas, container) {
  const ratio = window.devicePixelRatio || 1;
  const w = Math.max(200, container.clientWidth - 4);
  const h = Math.max(100, container.clientHeight - 4);
  canvas.width = w * ratio;
  canvas.height = h * ratio;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  canvas.getContext('2d').setTransform(ratio, 0, 0, ratio, 0, 0);
  return { w, h };
}

const QUOTES = [
  '"The Earth has music for those who listen." — George Santayana',
  '"In every walk with nature, one receives far more than he seeks." — John Muir',
  '"Adapt what is useful, reject what is useless." — Bruce Lee',
];

export async function mount(type, body, ctx, settings = {}, onSettings) {
  const { loc, weather, news, transit, airQuality, fetch } = ctx;
  const wrap = body.closest('.widget');
  const fields = getSettingsFields(type);
  if (fields.length) {
    attachSettingsPopover(wrap, {
      title: type,
      fields,
      settings,
      onSave: (s) => onSettings?.(s),
    });
  }

  switch (type) {
    case 'clock': {
      const tz = loc.timezone || weather.timezone;
      body.innerHTML = '<p class="clock-time"></p><p class="clock-date"></p><ul class="clock-sun"></ul>';
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
        body.querySelector('.clock-sun').innerHTML = `<li>Sunrise ${formatSunTime(weather.daily?.sunrise?.[0], tz)}</li><li>Sunset ${formatSunTime(weather.daily?.sunset?.[0], tz)}</li>`;
      };
      tick();
      const id = setInterval(tick, 1000);
      return { resize: tick, destroy: () => clearInterval(id) };
    }
    case 'world-clocks': {
      const cities = String(settings.cities || 'America/Los_Angeles,Europe/London,Asia/Tokyo')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const listEl = document.createElement('ul');
      listEl.className = 'world-clocks';
      body.innerHTML = '';
      body.appendChild(listEl);
      const tick = () => {
        listEl.innerHTML = cities
          .map(
            (tz) =>
              `<li><strong>${tz.split('/').pop()}</strong> ${new Intl.DateTimeFormat(undefined, {
                hour: 'numeric',
                minute: '2-digit',
                timeZone: tz,
              }).format(new Date())}</li>`
          )
          .join('');
      };
      tick();
      const id = setInterval(tick, 30000);
      return { resize: tick, destroy: () => clearInterval(id) };
    }
    case 'countdown': {
      const target = new Date(settings.target || '2026-12-31T23:59');
      const label = settings.label || 'Event';
      const tick = () => {
        const diff = target - Date.now();
        const abs = Math.max(0, diff);
        const h = Math.floor(abs / 3600000);
        const m = Math.floor((abs / 60000) % 60);
        const s = Math.floor((abs / 1000) % 60);
        body.innerHTML = `<p class="count-label">${label}</p><p class="count-time">${h}h ${m}m ${s}s</p>`;
      };
      tick();
      const id = setInterval(tick, 1000);
      return { resize: tick, destroy: () => clearInterval(id) };
    }
    case 'pomodoro': {
      let phase = 'work';
      let left = Number(settings.workMin || 25) * 60;
      body.innerHTML = '<p class="pomo-phase"></p><p class="pomo-time"></p><button type="button" class="btn-ghost pomo-toggle">Start</button>';
      const phaseEl = body.querySelector('.pomo-phase');
      const timeEl = body.querySelector('.pomo-time');
      let timer;
      const render = () => {
        phaseEl.textContent = phase === 'work' ? 'Focus' : 'Break';
        timeEl.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
      };
      body.querySelector('.pomo-toggle').onclick = () => {
        if (timer) {
          clearInterval(timer);
          timer = null;
          return;
        }
        timer = setInterval(() => {
          left -= 1;
          if (left <= 0) {
            phase = phase === 'work' ? 'break' : 'work';
            left = (phase === 'work' ? Number(settings.workMin || 25) : Number(settings.breakMin || 5)) * 60;
          }
          render();
        }, 1000);
      };
      render();
      return { resize: render, destroy: () => clearInterval(timer) };
    }
    case 'calendar-month': {
      const tz = loc.timezone || weather.timezone;
      const now = new Date();
      const month = now.toLocaleString(undefined, { month: 'long', year: 'numeric', timeZone: tz });
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      const startDay = first.getDay();
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      let cells = '';
      for (let i = 0; i < startDay; i += 1) cells += '<span class="cal-pad"></span>';
      for (let d = 1; d <= daysInMonth; d += 1) {
        cells += `<span class="${d === now.getDate() ? 'cal-today' : ''}">${d}</span>`;
      }
      body.innerHTML = `<p class="cal-title">${month}</p><div class="cal-grid">${cells}</div>`;
      return { resize() {}, destroy() {} };
    }
    case 'holidays': {
      body.innerHTML = '<p>Loading holidays…</p>';
      const cc = (loc.countryCode || 'US').toUpperCase();
      const data = await fetch('/api/holidays', { country: cc });
      body.innerHTML =
        demoBadge(data.source) +
        `<ul class="compact-list">${(data.holidays || [])
          .slice(0, 12)
          .map((h) => `<li><strong>${h.date}</strong> ${h.localName || h.name}</li>`)
          .join('')}</ul>`;
      return { resize() {}, destroy() {} };
    }
    case 'day-progress': {
      const now = new Date();
      const startDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const dayPct = ((now - startDay) / 86400000) * 100;
      const startWeek = new Date(startDay);
      startWeek.setDate(startDay.getDate() - ((startDay.getDay() + 6) % 7));
      const weekPct = ((now - startWeek) / (7 * 86400000)) * 100;
      const yearPct =
        ((now - new Date(now.getFullYear(), 0, 1)) / (365.25 * 86400000)) * 100;
      body.innerHTML = `<ul class="progress-list">
        <li>Day <meter value="${dayPct}" max="100"></meter> ${dayPct.toFixed(1)}%</li>
        <li>Week <meter value="${weekPct}" max="100"></meter> ${weekPct.toFixed(1)}%</li>
        <li>Year <meter value="${yearPct}" max="100"></meter> ${yearPct.toFixed(1)}%</li>
      </ul>`;
      return { resize() {}, destroy() {} };
    }
    case 'moon': {
      const info = moonPhaseInfo();
      body.innerHTML = `<p class="moon-emoji">${info.emoji}</p><p class="moon-name">${info.name}</p><p class="moon-meta">${info.illumination}% lit</p>`;
      return { resize() {}, destroy() {} };
    }
    case 'uv': {
      const curUv = weather.current?.uv_index ?? 0;
      body.innerHTML = `<p class="uv-now">${Number(curUv).toFixed(1)}</p><p class="uv-label">UV index</p><canvas class="uv-chart"></canvas>`;
      const canvas = body.querySelector('.uv-chart');
      const draw = () => {
        const { w, h } = fitCanvas(canvas, body);
        const ctx2 = canvas.getContext('2d');
        const vals = (airQuality.hourly?.uv_index || []).slice(0, 12);
        const pad = 16;
        ctx2.strokeStyle = '#fde047';
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
    case 'air-quality': {
      const c = airQuality.current || {};
      body.innerHTML =
        demoBadge(airQuality.source) +
        `<div class="viz-row">${aqiGaugeSvg(c.us_aqi)}</div>
        <dl class="aq-grid">
        <div><dt>US AQI</dt><dd>${c.us_aqi ?? '—'}</dd></div>
        <div><dt>PM2.5</dt><dd>${c.pm2_5 ?? '—'}</dd></div>
        <div><dt>PM10</dt><dd>${c.pm10 ?? '—'}</dd></div>
        </dl>`;
      return { resize() {}, destroy() {} };
    }
    case 'pollen': {
      body.innerHTML =
        demoBadge('demo') +
        pollenBarsSvg(airQuality.pollen) +
        `<p class="muted-note">${airQuality.pollen?.label || 'Pollen data unavailable'}</p>`;
      return { resize() {}, destroy() {} };
    }
    case 'sun-hours': {
      const tz = loc.timezone || weather.timezone;
      body.innerHTML = `${sunArcSvg()}<ul class="compact-list">
        <li>Sunrise ${formatSunTime(weather.daily?.sunrise?.[0], tz)}</li>
        <li>Sunset ${formatSunTime(weather.daily?.sunset?.[0], tz)}</li>
        <li>Golden hour: ~1h after sunrise / before sunset</li>
        <li>Blue hour: ~twilight around sun times</li>
      </ul>`;
      return { resize() {}, destroy() {} };
    }
    case 'iss': {
      body.classList.add('widget-body-iss');
      body.innerHTML = '<div class="iss-widget-mount"></div>';
      const mapHost = body.querySelector('.iss-widget-mount');
      const first = await fetch('/api/iss').catch(() => ({ source: 'demo' }));
      mapHost.before(document.createRange().createContextualFragment(demoBadge(first.source)));
      return mountIssMapWidget(
        mapHost,
        () => fetch('/api/iss'),
        () => fetch('/api/iss/track', { seconds: 360 })
      );
    }
    case 'planets': {
      body.innerHTML = `<p class="demo-badge" role="note">Approximate evening guide (demo model)</p>
        ${planetsSkySvg()}
        <ul class="compact-list"><li>Venus — often visible at dusk</li><li>Jupiter — evening sky when up</li><li>Mars — reddish object after dark</li><li>Saturn — faint yellowish point</li></ul>`;
      return { resize() {}, destroy() {} };
    }
    case 'tides': {
      body.innerHTML =
        demoBadge('demo') +
        `${tideCurveSvg()}<ul class="compact-list"><li>06:12 High 1.8m</li><li>12:04 Low 0.4m</li><li>18:30 High 1.6m</li></ul><p class="muted-note">Demo tide table — not live for all coasts</p>`;
      return { resize() {}, destroy() {} };
    }
    case 'earthquakes': {
      body.innerHTML = '<p>Loading…</p>';
      const data = await fetch('/api/earthquakes', { lat: loc.lat, lon: loc.lon });
      body.innerHTML =
        demoBadge(data.source) +
        `<div class="viz-row">${quakeMiniMapSvg({ lat: loc.lat, lon: loc.lon }, data.earthquakes)}</div>
        <ul class="compact-list">${(data.earthquakes || [])
          .map((e) => `<li>M${e.mag?.toFixed(1)} · ${e.place} (${e.distKm} km)</li>`)
          .join('')}</ul>`;
      return { resize() {}, destroy() {} };
    }
    case 'hazards': {
      body.innerHTML =
        demoBadge('demo') +
        `<p>No keyless hazard feed configured for this region.</p><p class="muted-note">Demo advisory: check local emergency services for real alerts.</p>`;
      return { resize() {}, destroy() {} };
    }
    case 'radar': {
      const leaflet = mountLeafletInWidget(body, (mapEl) => {
        const map = L.map(mapEl, { zoomControl: true, maxZoom: 7 }).setView([loc.lat, loc.lon], 7);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap',
        }).addTo(map);
        return map;
      });

      const caption = document.createElement('p');
      caption.className = 'radar-caption';
      caption.textContent = 'Loading radar…';
      body.appendChild(caption);

      const addDemoRings = () => {
        [40, 80, 120].forEach((km, idx) => {
          L.circle([loc.lat, loc.lon], {
            radius: km * 1000,
            color: ['#38bdf8', '#22d3ee', '#a78bfa'][idx],
            weight: 1.5,
            fillOpacity: 0.12,
          }).addTo(leaflet.map);
        });
        caption.textContent = 'Precipitation overlay unavailable (demo rings)';
      };

      try {
        const data = await fetch('/api/radar');
        if (data.demo || !data.tileUrlTemplate) {
          addDemoRings();
        } else {
          L.tileLayer(data.tileUrlTemplate, { opacity: 0.68, maxZoom: 7, minZoom: 2 }).addTo(leaflet.map);
          caption.textContent = 'RainViewer · latest frame';
        }
      } catch {
        addDemoRings();
      }

      return {
        resize: leaflet.resize,
        destroy: () => {
          leaflet.destroy();
          caption.remove();
        },
      };
    }
    case 'wind-feels': {
      const cur = weather.current || {};
      const deg = cur.wind_direction_10m ?? 0;
      body.innerHTML = `<p>Feels ${Math.round(cur.apparent_temperature ?? cur.temperature_2m ?? 0)}°</p>
        <p>Wind ${Math.round(cur.wind_speed_10m ?? 0)} km/h</p>
        <p class="wind-compass" style="transform:rotate(${deg}deg)">↑</p>`;
      return { resize() {}, destroy() {} };
    }
    case 'what-to-wear': {
      const t = weather.current?.temperature_2m ?? 15;
      const code = weather.current?.weather_code ?? 0;
      let tip = 'Light layers';
      if (t < 5) tip = 'Coat, hat, gloves';
      else if (t < 12) tip = 'Jacket and layers';
      else if (t > 25) tip = 'Light breathable clothing';
      if (code >= 61) tip += ', waterproof outer layer';
      body.innerHTML = `<p class="wear-tip">${tip}</p><p class="muted-note">Based on current forecast</p>`;
      return { resize() {}, destroy() {} };
    }
    case 'best-outside': {
      const hours = weather.hourly?.time || [];
      const temps = weather.hourly?.temperature_2m || [];
      const precip = weather.hourly?.precipitation_probability || [];
      let best = 0;
      let score = -999;
      hours.slice(0, 24).forEach((_, i) => {
        const s = (temps[i] ?? 0) - (precip[i] ?? 0) * 0.5;
        if (s > score) {
          score = s;
          best = i;
        }
      });
      body.innerHTML = `${bestOutsideStripSvg(hours, temps, precip, best)}
        <p>Best window: ${hours[best]?.slice(11, 16) || '—'}</p><p>~${Math.round(temps[best] ?? 0)}° · ${Math.round(precip[best] ?? 0)}% precip chance</p>`;
      return { resize() {}, destroy() {} };
    }
    case 'marine': {
      body.innerHTML = '<p>Loading marine…</p>';
      const data = await fetch('/api/marine', { lat: loc.lat, lon: loc.lon });
      const i = 0;
      body.innerHTML =
        demoBadge(data.source) +
        `<div class="viz-row">${waveSparklineSvg(data.hourly?.wave_height)}</div>
        <p>Wave ${data.hourly?.wave_height?.[i] ?? '—'} m</p><p>Sea ${data.hourly?.sea_surface_temperature?.[i] ?? '—'} °C</p>`;
      return { resize() {}, destroy() {} };
    }
    case 'currency': {
      const from = settings.from || 'USD';
      const to = settings.to || 'EUR';
      const amount = Number(settings.amount || 100);
      const data = await fetch('/api/currency', { from, to });
      const converted = (amount * (data.rate || 0)).toFixed(2);
      body.innerHTML =
        demoBadge(data.source) +
        `<p>${amount} ${from} → ${converted} ${to}</p><p class="muted-note">Rate ${data.rate} (${data.date})</p>`;
      return { resize() {}, destroy() {} };
    }
    case 'wiki-nearby': {
      const data = await fetch('/api/wiki-nearby', { lat: loc.lat, lon: loc.lon });
      body.innerHTML =
        demoBadge(data.source) +
        `<ul class="compact-list">${(data.places || [])
          .map((p) => `<li>${p.title} (${p.distanceM} m)</li>`)
          .join('')}</ul>`;
      return { resize() {}, destroy() {} };
    }
    case 'on-this-day': {
      const now = new Date();
      const data = await fetch('/api/on-this-day', { month: now.getMonth() + 1, day: now.getDate() });
      body.innerHTML =
        demoBadge(data.source) +
        `<ul class="compact-list">${(data.events || [])
          .map((e) => `<li><strong>${e.year}</strong> ${e.text}</li>`)
          .join('')}</ul>`;
      return { resize() {}, destroy() {} };
    }
    case 'phrase-day': {
      const data = await fetch('/api/country', { code: loc.countryCode || 'us' });
      const lang = (data.languages || 'English').split(',')[0];
      body.innerHTML =
        demoBadge(data.source === 'demo' ? 'demo' : null) +
        `<p>Language: ${lang}</p><p class="phrase">Hello → local greeting (demo phrase)</p>`;
      return { resize() {}, destroy() {} };
    }
    case 'country-facts': {
      const data = await fetch('/api/country', { code: loc.countryCode || 'us' });
      body.innerHTML =
        demoBadge(data.source) +
        `<p>${data.flag || ''} ${data.name}</p><p>Capital: ${data.capital}</p><p>Population: ${data.population?.toLocaleString?.() ?? data.population}</p>`;
      return { resize() {}, destroy() {} };
    }
    case 'notes': {
      const key = 'today.notes';
      const text = settings.text ?? PRODUCTIVITY_STORE.load(key, '');
      body.innerHTML = `<textarea class="notes-area" aria-label="Notes">${text}</textarea>`;
      const ta = body.querySelector('textarea');
      ta.oninput = () => {
        PRODUCTIVITY_STORE.save(key, ta.value);
      };
      return { resize() {}, destroy() {} };
    }
    case 'todo': {
      const key = 'today.todo';
      const items = PRODUCTIVITY_STORE.load(key, ['Sample task']);
      body.innerHTML = `<ul class="todo-list">${items
        .map((t, i) => `<li><label><input type="checkbox" data-i="${i}"/> ${t}</label></li>`)
        .join('')}</ul><input class="todo-add" placeholder="Add item" />`;
      body.querySelector('.todo-add').onkeydown = (ev) => {
        if (ev.key === 'Enter' && ev.target.value) {
          items.push(ev.target.value);
          PRODUCTIVITY_STORE.save(key, items);
          mount(type, body, ctx, settings, onSettings);
        }
      };
      return { resize() {}, destroy() {} };
    }
    case 'bookmarks': {
      const key = 'today.bookmarks';
      const links = PRODUCTIVITY_STORE.load(key, [
        { t: 'OpenStreetMap', u: 'https://www.openstreetmap.org' },
        { t: 'Open-Meteo', u: 'https://open-meteo.com' },
      ]);
      body.innerHTML = `<ul class="compact-list">${links
        .map((l) => `<li><a href="${l.u}" target="_blank" rel="noopener">${l.t}</a></li>`)
        .join('')}</ul>`;
      return { resize() {}, destroy() {} };
    }
    case 'search-box': {
      body.innerHTML = `<form class="search-form" action="https://duckduckgo.com/" method="get" target="_blank" rel="noopener">
        <input name="q" placeholder="Search…" aria-label="Search query" /><button type="submit">Go</button></form>`;
      return { resize() {}, destroy() {} };
    }
    case 'calculator': {
      body.innerHTML = `<input class="calc-in" aria-label="Expression" placeholder="1+2*3" /><button type="button" class="btn-ghost calc-eq">=</button><p class="calc-out"></p>`;
      body.querySelector('.calc-eq').onclick = () => {
        try {
          const v = Function(`"use strict"; return (${body.querySelector('.calc-in').value})`)();
          body.querySelector('.calc-out').textContent = String(v);
        } catch {
          body.querySelector('.calc-out').textContent = 'Error';
        }
      };
      return { resize() {}, destroy() {} };
    }
    case 'unit-converter': {
      const units = { km: 1000, m: 1, mi: 1609.34, ft: 0.3048 };
      const v = Number(settings.value || 1);
      const from = settings.from || 'km';
      const to = settings.to || 'mi';
      const base = v * (units[from] || 1);
      const out = base / (units[to] || 1);
      body.innerHTML = `<p>${v} ${from} = ${out.toFixed(3)} ${to}</p>`;
      return { resize() {}, destroy() {} };
    }
    case 'commons-photo': {
      const data = await fetch('/api/commons', { lat: loc.lat, lon: loc.lon });
      const p = data.photos?.[0];
      body.innerHTML =
        demoBadge(data.source) +
        (p?.thumb
          ? `<img class="commons-img" src="${p.thumb}" alt="" /><p>${p.title}</p>`
          : '<p>No photos found</p>');
      return { resize() {}, destroy() {} };
    }
    case 'daily-quote': {
      const q = QUOTES[new Date().getDate() % QUOTES.length];
      body.innerHTML = demoBadge('demo') + `<blockquote>${q}</blockquote>`;
      return { resize() {}, destroy() {} };
    }
    case 'news-topics': {
      const topic = settings.topic || 'tech';
      const data = await fetch('/api/news', { topic });
      body.innerHTML = demoBadge(data.source) + '<ul class="news-list"></ul>';
      renderNews(body.querySelector('.news-list'), data, 8);
      return { resize() {}, destroy() {} };
    }
    case 'bikes': {
      const data = await fetch('/api/bikes', { lat: loc.lat, lon: loc.lon });
      body.innerHTML =
        demoBadge(data.source) +
        `<div class="viz-row">${bikeBarsSvg(data.stations)}</div>
        <ul class="compact-list">${(data.stations || [])
          .map((s) => `<li>${s.name}: ${s.freeBikes ?? '?'} bikes (${s.network})</li>`)
          .join('')}</ul>`;
      return { resize() {}, destroy() {} };
    }
    case 'walk-rings': {
      body.innerHTML = '<div class="leaflet-map"></div>';
      const mapEl = body.querySelector('.leaflet-map');
      mapEl.style.height = '100%';
      const map = L.map(mapEl).setView([loc.lat, loc.lon], 14);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OSM' }).addTo(map);
      String(settings.minutes || '5,10,15')
        .split(',')
        .map((m) => Number(m.trim()))
        .filter(Boolean)
        .forEach((min, idx) => {
          L.circle([loc.lat, loc.lon], {
            radius: min * 80,
            color: ['#6ee7ff', '#a78bfa', '#f472b6'][idx % 3],
            fillOpacity: 0.08,
          }).addTo(map);
        });
      return { resize: () => map.invalidateSize(), destroy: () => map.remove() };
    }
    case 'ev-chargers': {
      const data = await fetch('/api/chargers', { lat: loc.lat, lon: loc.lon });
      body.innerHTML =
        demoBadge(data.source) +
        `<div class="viz-row">${chargerDotsSvg({ lat: loc.lat, lon: loc.lon }, data.stations)}</div>
        <ul class="compact-list">${(data.stations || [])
          .slice(0, 10)
          .map((s) => `<li>${s.name} (${s.amenity})</li>`)
          .join('')}</ul>`;
      return { resize() {}, destroy() {} };
    }
    default:
      body.textContent = `Widget "${type}" not implemented`;
      return { resize() {}, destroy() {} };
  }
}
