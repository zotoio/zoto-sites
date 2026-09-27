/** Equirectangular ISS map (SVG) — Natural Earth 110m land; no API keys. */

const MAP_W = 360;
const MAP_H = 180;

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
 * @param {number} [w]
 * @param {number} [h]
 */
export function project(lon, lat, w = MAP_W, h = MAP_H) {
  const x = ((lon + 180) / 360) * w;
  const y = ((90 - lat) / 180) * h;
  return { x, y };
}

/**
 * @param {{ lat: number, lon: number }[]} track
 */
function trackToPolyline(track) {
  if (!track?.length) return '';
  return track
    .map((p, i) => {
      const { x, y } = project(p.lon, p.lat);
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
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
  const pos = project(state.lon, state.lat);
  const trail = trackToPolyline(track);
  const orbit = trackToPolyline(track.slice(-40));
  const landPaths = landPathsHtml || '';

  container.innerHTML = `
    <figure class="iss-map-wrap" role="img" aria-label="World map showing ISS position">
      <div class="iss-map-stage">
        <svg class="iss-map" viewBox="0 0 ${MAP_W} ${MAP_H}" preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id="iss-ocean" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="rgba(14,36,58,0.98)"/>
              <stop offset="100%" stop-color="rgba(5,12,24,0.99)"/>
            </linearGradient>
            <filter id="iss-glow">
              <feGaussianBlur stdDeviation="1.2" result="blur"/>
              <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
          </defs>
          <rect width="${MAP_W}" height="${MAP_H}" fill="url(#iss-ocean)" rx="4"/>
          ${Array.from({ length: 7 }, (_, i) => {
            const y = (MAP_H / 6) * i;
            return `<line x1="0" y1="${y}" x2="${MAP_W}" y2="${y}" stroke="rgba(110,231,255,0.1)" stroke-width="0.35"/>`;
          }).join('')}
          ${Array.from({ length: 13 }, (_, i) => {
            const x = (MAP_W / 12) * i;
            return `<line x1="${x}" y1="0" x2="${x}" y2="${MAP_H}" stroke="rgba(110,231,255,0.07)" stroke-width="0.35"/>`;
          }).join('')}
          ${landPaths ? `<g class="ne-land">${landPaths}</g>` : ''}
          ${orbit ? `<path class="iss-orbit" d="${orbit}" fill="none" stroke="rgba(192,132,252,0.75)" stroke-width="0.9" stroke-dasharray="3 2.5" vector-effect="non-scaling-stroke"/>` : ''}
          ${trail ? `<path class="iss-trail" d="${trail}" fill="none" stroke="rgba(56,189,248,0.82)" stroke-width="0.85" vector-effect="non-scaling-stroke"/>` : ''}
          <circle class="iss-marker-glow" cx="${pos.x}" cy="${pos.y}" r="3.2" fill="#f472b6" filter="url(#iss-glow)"/>
          <circle class="iss-marker-core" cx="${pos.x}" cy="${pos.y}" r="1.35" fill="#fff" stroke="#831843" stroke-width="0.35"/>
        </svg>
      </div>
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
