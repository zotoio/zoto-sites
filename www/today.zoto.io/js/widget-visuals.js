/** Compact SVG/canvas visuals for widgets that are naturally graphical. */

import { project } from './iss-map.js';

export function aqiGaugeSvg(usAqi) {
  const v = Math.max(0, Math.min(500, Number(usAqi) || 0));
  const pct = v / 300;
  const color =
    v <= 50 ? '#4ade80' : v <= 100 ? '#fde047' : v <= 150 ? '#fb923c' : v <= 200 ? '#f87171' : '#c084fc';
  const angle = -90 + pct * 180;
  const rad = (angle * Math.PI) / 180;
  const cx = 50;
  const cy = 52;
  const r = 36;
  const x = cx + r * Math.cos(rad);
  const y = cy + r * Math.sin(rad);
  return `<svg class="viz-gauge" viewBox="0 0 100 60" aria-hidden="true">
    <path d="M 14 52 A 36 36 0 0 1 86 52" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="8" stroke-linecap="round"/>
    <path d="M 14 52 A 36 36 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)}" fill="none" stroke="${color}" stroke-width="8" stroke-linecap="round"/>
    <text x="50" y="48" text-anchor="middle" fill="${color}" font-size="16" font-weight="600">${v || '—'}</text>
  </svg>`;
}

/**
 * @param {{ lat: number, lon: number }} center
 * @param {{ lat?: number, lon?: number, mag?: number }[]} quakes
 */
export function quakeMiniMapSvg(center, quakes, w = 200, h = 100) {
  const c = project(center.lon, center.lat, w, h);
  const dots = (quakes || [])
    .slice(0, 8)
    .map((q) => {
      const p = project(q.lon ?? center.lon, q.lat ?? center.lat, w, h);
      const r = 2 + Math.min(6, (q.mag || 2) * 1.2);
      return `<circle cx="${p.x}" cy="${p.y}" r="${r}" fill="rgba(251,191,36,0.85)" stroke="#fff" stroke-width="0.5"/>`;
    })
    .join('');
  return `<svg class="viz-quake-map" viewBox="0 0 ${w} ${h}" aria-hidden="true">
    <rect width="${w}" height="${h}" rx="6" fill="rgba(8,20,36,0.9)"/>
    <circle cx="${c.x}" cy="${c.y}" r="4" fill="#6ee7ff" opacity="0.9"/>
    ${dots}
  </svg>`;
}

export function waveSparklineSvg(values, w = 200, h = 56) {
  const vals = (values || []).map(Number).filter((n) => !Number.isNaN(n));
  if (!vals.length) {
    return `<svg class="viz-wave" viewBox="0 0 ${w} ${h}" aria-hidden="true"><text x="8" y="28" fill="var(--muted)" font-size="11">No wave data</text></svg>`;
  }
  const max = Math.max(...vals, 0.5);
  const pts = vals
    .map((v, i) => {
      const x = 8 + (i / (vals.length - 1 || 1)) * (w - 16);
      const y = h - 8 - (v / max) * (h - 16);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return `<svg class="viz-wave" viewBox="0 0 ${w} ${h}" aria-hidden="true">
    <polyline points="${pts}" fill="none" stroke="#38bdf8" stroke-width="2"/>
    <polyline points="${pts} ${w - 8},${h - 8} 8,${h - 8}" fill="rgba(56,189,248,0.15)" stroke="none"/>
  </svg>`;
}

export function bikeBarsSvg(stations, w = 200, h = 72) {
  const list = (stations || []).slice(0, 5);
  const max = Math.max(1, ...list.map((s) => s.freeBikes ?? 0));
  const barH = Math.max(8, (h - 8) / list.length - 4);
  const bars = list
    .map((s, i) => {
      const bikes = s.freeBikes ?? 0;
      const bw = ((bikes / max) * (w - 60)) | 0;
      const y = 4 + i * (barH + 4);
      return `<rect x="52" y="${y}" width="${bw}" height="${barH}" rx="3" fill="#6ee7ff" opacity="0.75"/>
        <text x="4" y="${y + barH - 2}" fill="var(--muted)" font-size="9">${(s.name || '').slice(0, 6)}</text>`;
    })
    .join('');
  return `<svg class="viz-bikes" viewBox="0 0 ${w} ${h}" aria-hidden="true">${bars}</svg>`;
}

export function pollenBarsSvg(pollen) {
  const items = [
    { label: 'Grass', v: pollen?.grass ?? 1 },
    { label: 'Tree', v: pollen?.tree ?? 1 },
    { label: 'Weed', v: pollen?.weed ?? 0 },
  ];
  const rows = items
    .map(
      (it) =>
        `<li><span>${it.label}</span><meter value="${Math.min(5, it.v)}" min="0" max="5"></meter></li>`
    )
    .join('');
  return `<ul class="pollen-bars">${rows}</ul>`;
}

export function tideCurveSvg(w = 200, h = 64) {
  const path =
    'M 4 40 C 30 10, 50 55, 75 35 S 120 8, 150 38 S 185 58, 196 28 L 196 60 L 4 60 Z';
  return `<svg class="viz-tide" viewBox="0 0 200 64" aria-hidden="true">
    <path d="${path}" fill="rgba(56,189,248,0.2)" stroke="#38bdf8" stroke-width="1.5"/>
    <line x1="4" y1="48" x2="196" y2="48" stroke="rgba(255,255,255,0.15)" stroke-dasharray="3 3"/>
  </svg>`;
}

export function planetsSkySvg() {
  return `<svg class="viz-planets" viewBox="0 0 200 80" aria-hidden="true">
    <rect width="200" height="80" rx="6" fill="rgba(6,12,28,0.85)"/>
    <circle cx="40" cy="50" r="6" fill="#fcd34d"/>
    <circle cx="90" cy="35" r="9" fill="#fbbf24" opacity="0.9"/>
    <circle cx="130" cy="45" r="5" fill="#f87171"/>
    <circle cx="165" cy="38" r="7" fill="#fde68a" opacity="0.75"/>
    <text x="40" y="68" font-size="8" fill="var(--muted)" text-anchor="middle">Venus</text>
    <text x="90" y="68" font-size="8" fill="var(--muted)" text-anchor="middle">Jupiter</text>
    <text x="130" y="68" font-size="8" fill="var(--muted)" text-anchor="middle">Mars</text>
    <text x="165" y="68" font-size="8" fill="var(--muted)" text-anchor="middle">Saturn</text>
  </svg>`;
}

/**
 * @param {{ lat: number, lon: number }} center
 * @param {{ lat?: number, lon?: number }[]} points
 */
export function chargerDotsSvg(center, points, w = 200, h = 80) {
  const c = project(center.lon, center.lat, w, h);
  const dots = (points || [])
    .slice(0, 12)
    .map((p) => {
      const pt = project(p.lon ?? center.lon + 0.02, p.lat ?? center.lat + 0.02, w, h);
      return `<circle cx="${pt.x}" cy="${pt.y}" r="3" fill="#a78bfa"/>`;
    })
    .join('');
  return `<svg class="viz-chargers" viewBox="0 0 ${w} ${h}" aria-hidden="true">
    <rect width="${w}" height="${h}" rx="6" fill="rgba(8,20,36,0.9)"/>
    <circle cx="${c.x}" cy="${c.y}" r="4" fill="#6ee7ff"/>
    ${dots}
  </svg>`;
}

export function sunArcSvg(w = 200, h = 56) {
  return `<svg class="viz-sun-arc" viewBox="0 0 ${w} ${h}" aria-hidden="true">
    <path d="M 12 ${h - 8} Q ${w / 2} 4, ${w - 12} ${h - 8}" fill="none" stroke="#fde047" stroke-width="2" opacity="0.85"/>
    <circle cx="${w / 2}" cy="18" r="8" fill="#fde047" opacity="0.9"/>
    <line x1="12" y1="${h - 8}" x2="${w - 12}" y2="${h - 8}" stroke="rgba(255,255,255,0.2)"/>
  </svg>`;
}

export function bestOutsideStripSvg(hours, temps, precip, bestIdx, w = 200, h = 48) {
  const n = Math.min(12, hours?.length || 0);
  if (!n) return '';
  const bars = Array.from({ length: n }, (_, i) => {
    const t = temps[i] ?? 0;
    const p = precip[i] ?? 0;
    const score = t - p * 0.3;
    const bh = 8 + (score / 35) * (h - 12);
    const x = 4 + (i / n) * (w - 8);
    const fill = i === bestIdx ? '#6ee7ff' : 'rgba(110,231,255,0.35)';
    return `<rect x="${x}" y="${h - bh}" width="${(w - 8) / n - 2}" height="${bh}" fill="${fill}" rx="2"/>`;
  }).join('');
  return `<svg class="viz-best-out" viewBox="0 0 ${w} ${h}" aria-hidden="true">${bars}</svg>`;
}
