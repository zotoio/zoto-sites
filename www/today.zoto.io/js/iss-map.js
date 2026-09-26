/** Equirectangular ISS map (SVG) — no API keys; scales with container. */

// Simplified continent silhouettes (viewBox 0 0 360 180, lon/lat degrees)
const CONTINENTS = [
  'M 280 75 295 70 310 72 325 68 340 75 335 90 320 95 300 92 285 88 275 80 Z',
  'M 345 55 355 50 358 62 352 72 345 68 Z',
  'M 10 45 25 38 45 42 55 55 50 70 35 78 20 72 8 58 Z',
  'M 60 35 95 30 110 38 105 55 85 62 65 58 55 45 Z',
  'M 115 70 135 65 150 72 145 95 125 100 110 88 Z',
  'M 155 55 175 50 190 58 185 75 165 78 150 68 Z',
  'M 200 45 230 40 250 48 245 65 220 70 205 58 Z',
  'M 255 95 275 88 290 95 285 115 265 118 250 108 Z',
  'M 300 115 320 108 335 115 330 135 310 138 295 128 Z',
];

/**
 * @param {number} lon -180..180
 * @param {number} lat -90..90
 * @param {number} w
 * @param {number} h
 */
export function project(lon, lat, w, h) {
  const x = ((lon + 180) / 360) * w;
  const y = ((90 - lat) / 180) * h;
  return { x, y };
}

/**
 * @param {{ lat: number, lon: number }[]} track
 */
function trackToPolyline(track, w, h) {
  if (!track?.length) return '';
  return track
    .map((p, i) => {
      const { x, y } = project(p.lon, p.lat, w, h);
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
}

/**
 * @param {HTMLElement} container
 * @param {{ lat: number, lon: number, altitude?: number, velocity?: number, visibility?: string, source?: string }} state
 * @param {{ lat: number, lon: number }[]} [track]
 */
export function renderIssMap(container, state, track = []) {
  const w = Math.max(120, container.clientWidth);
  const h = Math.max(80, Math.min(container.clientHeight - 48, w * 0.52));
  const pos = project(state.lon, state.lat, w, h);
  const trail = trackToPolyline(track, w, h);
  const orbit = trackToPolyline(track.slice(-40), w, h);

  container.innerHTML = `
    <figure class="iss-map-wrap" role="img" aria-label="World map showing ISS position">
      <svg class="iss-map" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="iss-ocean" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="rgba(12,28,48,0.95)"/>
            <stop offset="100%" stop-color="rgba(6,14,28,0.98)"/>
          </linearGradient>
          <filter id="iss-glow">
            <feGaussianBlur stdDeviation="2" result="blur"/>
            <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>
        <rect width="${w}" height="${h}" fill="url(#iss-ocean)" rx="6"/>
        ${Array.from({ length: 7 }, (_, i) => {
          const y = (h / 6) * i;
          return `<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="rgba(110,231,255,0.08)" stroke-width="1"/>`;
        }).join('')}
        ${Array.from({ length: 13 }, (_, i) => {
          const x = (w / 12) * i;
          return `<line x1="${x}" y1="0" x2="${x}" y2="${h}" stroke="rgba(110,231,255,0.06)" stroke-width="1"/>`;
        }).join('')}
        ${CONTINENTS.map((d) => `<path d="${d}" transform="scale(${w / 360} ${h / 180})" fill="rgba(34,197,94,0.22)" stroke="rgba(134,239,172,0.35)" stroke-width="0.6"/>`).join('')}
        ${orbit ? `<path d="${orbit}" fill="none" stroke="rgba(167,139,250,0.55)" stroke-width="1.5" stroke-dasharray="4 3"/>` : ''}
        ${trail ? `<path d="${trail}" fill="none" stroke="rgba(110,231,255,0.45)" stroke-width="1.2"/>` : ''}
        <circle cx="${pos.x}" cy="${pos.y}" r="5" fill="#f472b6" filter="url(#iss-glow)"/>
        <circle cx="${pos.x}" cy="${pos.y}" r="2.2" fill="#fff"/>
      </svg>
      <figcaption class="iss-meta">
        <span>${Number(state.lat).toFixed(2)}°, ${Number(state.lon).toFixed(2)}°</span>
        <span>${Math.round(state.altitude ?? 0)} km · ${Math.round(state.velocity ?? 0)} km/h</span>
        <span class="iss-vis">${state.visibility || '—'}</span>
      </figcaption>
    </figure>`;
}

/**
 * @param {HTMLElement} container
 * @param {(lat: number, lon: number) => Promise<{ lat: number, lon: number, altitude?: number, velocity?: number, visibility?: string, source?: string }>} fetchNow
 * @param {() => Promise<{ positions?: { lat: number, lon: number }[] }>} fetchTrack
 */
export function mountIssMapWidget(container, fetchNow, fetchTrack) {
  /** @type {{ lat: number, lon: number }[]} */
  let trail = [];
  let state = { lat: 0, lon: 0, altitude: 0, velocity: 0, visibility: '—' };

  const paint = () => renderIssMap(container, state, trail);

  const refresh = async () => {
    try {
      const [now, trackData] = await Promise.all([fetchNow(), fetchTrack().catch(() => ({ positions: [] }))]);
      state = now;
      const fromApi = (trackData.positions || []).map((p) => ({ lat: p.lat, lon: p.lon }));
      if (fromApi.length) {
        trail = fromApi;
      } else {
        trail = [...trail, { lat: now.lat, lon: now.lon }].slice(-60);
      }
      paint();
    } catch {
      state = {
        lat: 37.5,
        lon: -122.2,
        altitude: 420,
        velocity: 27600,
        visibility: 'daylight',
        source: 'demo',
      };
      if (!trail.length) {
        trail = Array.from({ length: 24 }, (_, i) => ({
          lat: 30 + Math.sin(i / 4) * 25,
          lon: -180 + i * 15,
        }));
      }
      paint();
    }
  };

  container.innerHTML = '<p class="muted-note">Loading ISS…</p>';
  void refresh();
  const id = setInterval(() => void refresh(), 30000);

  return {
    resize: paint,
    destroy: () => clearInterval(id),
  };
}
