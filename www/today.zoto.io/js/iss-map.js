/** Equirectangular ISS map (SVG) — Natural Earth 110m land; no API keys. */

const LAND_SVG_URL = new URL('../assets/world-land-110m.svg', import.meta.url);

/** @type {Promise<string> | null} */
let landLayerPromise = null;

function loadLandLayerInner() {
  return fetch(LAND_SVG_URL)
    .then((r) => {
      if (!r.ok) throw new Error('land svg');
      return r.text();
    })
    .then((text) => {
      const match = text.match(/<g[^>]*class="ne-land"[^>]*>([\s\S]*?)<\/g>/i);
      if (match) return match[1];
      return text.replace(/^[\s\S]*?<svg[^>]*>/i, '').replace(/<\/svg>[\s\S]*$/i, '');
    });
}

function loadLandLayer() {
  landLayerPromise ??= loadLandLayerInner();
  return landLayerPromise;
}

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
 * @param {string} [landPathsHtml] - inner SVG for Natural Earth land (360×180 coords)
 */
export function renderIssMap(container, state, track = [], landPathsHtml = '') {
  const w = Math.max(120, container.clientWidth);
  const h = Math.max(80, Math.min(container.clientHeight - 56, w * 0.52));
  const pos = project(state.lon, state.lat, w, h);
  const trail = trackToPolyline(track, w, h);
  const orbit = trackToPolyline(track.slice(-40), w, h);
  const landPaths = landPathsHtml || '';

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
        ${landPaths ? `<g transform="scale(${w / 360} ${h / 180})">${landPaths}</g>` : ''}
        ${orbit ? `<path d="${orbit}" fill="none" stroke="rgba(167,139,250,0.55)" stroke-width="1.5" stroke-dasharray="4 3"/>` : ''}
        ${trail ? `<path d="${trail}" fill="none" stroke="rgba(110,231,255,0.45)" stroke-width="1.2"/>` : ''}
        <circle cx="${pos.x}" cy="${pos.y}" r="5" fill="#f472b6" filter="url(#iss-glow)"/>
        <circle cx="${pos.x}" cy="${pos.y}" r="2.2" fill="#fff"/>
      </svg>
      <figcaption class="iss-meta">
        <span>${Number(state.lat).toFixed(2)}°, ${Number(state.lon).toFixed(2)}°</span>
        <span>${Math.round(state.altitude ?? 0)} km · ${Math.round(state.velocity ?? 0)} km/h</span>
        <span class="iss-vis">${state.visibility || '—'}</span>
        <span class="iss-credit">Land © Natural Earth</span>
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
  /** @type {string} */
  let landPathsHtml = '';

  const paint = () => renderIssMap(container, state, trail, landPathsHtml);

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
  void loadLandLayer()
    .then((paths) => {
      landPathsHtml = paths;
      return refresh();
    })
    .catch(() => refresh());

  const id = setInterval(() => void refresh(), 30000);

  return {
    resize: paint,
    destroy: () => clearInterval(id),
  };
}
