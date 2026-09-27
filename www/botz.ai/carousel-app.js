// botz.ai GenAI News — WebGL cover-flow carousel + flat HTML centre card (production).
const $ = (s, r = document) => r.querySelector(s);
const stage = $('#stage'), cardEl = $('#card'), measureEl = $('#measure'), scene = $('#scene');
const canvas = $('#gl');
const endMarker = $('#end-marker');
const storyAnnouncer = $('#story-announcer');
const gridEl = $('#grid');
const loadingEl = $('#loading');

const params = new URLSearchParams(location.search);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches || params.get('mode') === 'reduced';
const wide = matchMedia('(min-width: 1600px)');
const FLIP_MS = 520;
const PERSP = 2200;
const SIDE_W0 = 440, SIDE_ASPECT = 704 / 512;
const SLOTS = { S: [1, 0.8, 0.65, 0.52, 0.42], R: [0, 40, 40, 40, 40], Z: [0, -70, -150, -230, -310],
                DIM: [1, 0.8, 0.6, 0.44, 0.3], BIAS: [0, 0.2, 0.9, 1.7, 2.4] };
const WINDOW_RADIUS = 4;
const isLocalDev = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const SYDNEY_TZ = 'Australia/Sydney';

/** In-flight + settled JSON cache keyed by request URL (dedupes parallel fetches). */
const jsonFlight = new Map();
let archivePage1Flight = null;

function fetchJsonMemo(url, stubUrl) {
  if (!jsonFlight.has(url)) {
    jsonFlight.set(url, fetchJsonWithLocalStub(url, stubUrl).catch(err => {
      jsonFlight.delete(url);
      throw err;
    }));
  }
  return jsonFlight.get(url);
}

function fetchArchivePage1() {
  if (!archivePage1Flight) {
    archivePage1Flight = fetchJsonMemo('/archive?page=1', '/stubs/archive.json');
  }
  return archivePage1Flight;
}

let FEAT = [];   // oldest -> newest
let active = 0;
let offsets = [];
let busy = false, pending = null;
let geom = { W: 0, H: 0, cx: 0, cy: 0, cardW: 0, cardH: 0, k: 1, sideW: 0, sideH: 0, floorY: 0, showSides: true };
let sideBtns = [];
let archivePage = 1;
let archiveLoading = false;
let archiveHasMore = true;

async function fetchJsonWithLocalStub(url, stubUrl) {
  const requestOptions = isLocalDev ? { cache: 'no-store' } : {};
  try {
    const response = await fetch(url, requestOptions);
    if (!response.ok) throw new Error(`Request failed: ${response.status}`);
    return response.json();
  } catch (error) {
    if (!isLocalDev) throw error;
    console.warn(`Using local stub for ${url}`, error);
    const response = await fetch(stubUrl, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Stub request failed: ${response.status}`);
    return response.json();
  }
}

async function fetchEditorial(cacheKey) {
  const stub = cacheKey ? `/stubs/editorials/${cacheKey}.json` : '/stubs/editorials/latest.json';
  if (isLocalDev) {
    const response = await fetch(stub, { cache: 'no-store' });
    if (response.ok) return response.json();
  }
  let url = '/editorials';
  if (cacheKey) url += `?cacheKey=${encodeURIComponent(cacheKey)}`;
  return fetchJsonMemo(url, stub);
}

function sydneyPartsFromUtcMs(ms) {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: SYDNEY_TZ,
    year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', hour12: false,
  });
  const parts = Object.fromEntries(f.formatToParts(new Date(ms)).filter(p => p.type !== 'literal').map(p => [p.type, +p.value]));
  let h = parts.hour;
  if (h === 24) h = 0;
  return { y: parts.year, mo: parts.month, d: parts.day, h };
}

function sydneyWallHourToUtcMs(y, mo, d, h) {
  for (let utc = 0; utc < 48; utc++) {
    const ms = Date.UTC(y, mo - 1, d, utc, 0, 0);
    const p = sydneyPartsFromUtcMs(ms);
    if (p.y === y && p.mo === mo && p.d === d && p.h === h) return ms;
  }
  return Date.UTC(y, mo - 1, d, h - 10, 0, 0);
}

function utcMsToSydneyCacheKey(ms) {
  const p = sydneyPartsFromUtcMs(ms);
  return `${p.y}-${String(p.mo).padStart(2, '0')}-${String(p.d).padStart(2, '0')}-${String(p.h).padStart(2, '0')}`;
}

/** Next hourly editorial cache key in Australia/Sydney (23:00 rolls to next calendar day). */
function incrementHourCacheKey(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})$/.exec(key || '');
  if (!m) return null;
  const ms = sydneyWallHourToUtcMs(+m[1], +m[2], +m[3], +m[4]);
  return utcMsToSydneyCacheKey(ms + 3600000);
}
if (incrementHourCacheKey('2026-09-30-23') !== '2026-10-01-00') {
  console.warn('incrementHourCacheKey: expected 2026-09-30-23 → 2026-10-01-00 in Sydney');
}

/** Match a /editorials payload to the cache key used to store it (never from generated_at). */
async function resolveCacheKeyForPayload(entry) {
  const targetGen = entry.article?.generated_at;
  const targetTitle = entry.article?.title;
  if (!targetGen && !targetTitle) throw new Error('Cannot resolve cache key');

  const candidates = [];
  try {
    const arch = await fetchArchivePage1();
    const keys = (arch.editorials || []).map(e => e.cache_key).filter(Boolean);
    if (keys[0]) {
      candidates.push(incrementHourCacheKey(keys[0]));
      candidates.push(...keys.slice(0, 8));
    }
  } catch (_) { /* archive optional for resolution */ }

  const seen = new Set();
  for (const key of candidates) {
    if (!key || seen.has(key)) continue;
    seen.add(key);
    try {
      const payload = await fetchEditorial(key);
      const row = payload[0];
      if (!row) continue;
      if (targetGen && row.article?.generated_at === targetGen) return key;
      if (targetTitle && row.article?.title === targetTitle) return key;
    } catch (_) { /* try next candidate */ }
  }
  throw new Error('Could not resolve editorial cache key from API');
}

function editorialAgentSuffixFromH2(h2Inner, authorAlias) {
  const aliasPlain = (authorAlias || '').replace(/^Agent\s+/i, '').trim();
  if (!aliasPlain) return null;
  const patterns = [
    new RegExp(`\\s*<(?:strong|em|span)[^>]*>\\s*Agent\\s+${aliasPlain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*<\\/(?:strong|em|span)>\\s*$`, 'i'),
    new RegExp(`\\s*Agent\\s+${aliasPlain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i'),
  ];
  for (const re of patterns) {
    if (re.test(h2Inner)) return re;
  }
  return null;
}

function splitTitleAndAgent(h2Inner, authorAlias) {
  const suffixRe = editorialAgentSuffixFromH2(h2Inner, authorAlias);
  let titleHtml = h2Inner;
  if (suffixRe) titleHtml = h2Inner.replace(suffixRe, '');
  else titleHtml = h2Inner.replace(/<(?:strong|em|span)[^>]*>[\s\S]*?<\/(?:strong|em|span)>/gi, ' ');
  let title = titleHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const agent = authorAlias || '';
  const agentPlain = agent.replace(/^Agent\s+/i, '').trim();
  const showAgent = !!(agentPlain && !title.toLowerCase().includes(agentPlain.toLowerCase()));
  return { title, agent, showAgent };
}

/** Archive titles glue the agent onto the headline with no space; do not strip bare trailing "Agent". */
function parseArchiveTileTitle(raw) {
  const t = String(raw ?? '').trim();
  const m = t.match(/^(.+?)(Agent\s+[A-Z][\w\s.'♟️🤖-]+)$/);
  if (m && m[2].split(/\s+/).length >= 2) {
    return { title: m[1].trim(), agent: m[2].trim() };
  }
  return { title: t, agent: '' };
}

function normalizeArticle(entry, cacheKey) {
  if (!cacheKey) throw new Error('normalizeArticle requires an explicit cache key');
  const raw = entry.editorial || '';
  let editorial = raw.replaceAll('```html\n', '').replaceAll('\n```', '');
  editorial = editorial.replaceAll("<span style='display:none'", '<span class="byline-alias" style="display:none"');
  editorial = editorial.replace(/<span>(Agent\s+[^<]+)<\/span>/gi, '');
  const titleMatch = editorial.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
  const parsed = titleMatch
    ? splitTitleAndAgent(titleMatch[1], entry.article.authorAlias)
    : { title: entry.article.title, agent: entry.article.authorAlias || '', showAgent: !!entry.article.authorAlias };
  const bodyHtml = editorial.replace(/<h2[^>]*>[\s\S]*?<\/h2>/i, '').trim();
  const nav = entry.navigation || {};
  return {
    id: cacheKey,
    title: parsed.title,
    agent: parsed.agent || entry.article.authorAlias || '',
    showAgent: parsed.showAgent,
    bodyHtml,
    generated: entry.article.generated_at || entry.article.published_at,
    source: entry.article.source,
    published: entry.article.published_at,
    origTitle: entry.article.title,
    url: entry.article.url,
    hn: entry.article.hn_url || '',
    img: entry.article.image_url || '',
    navigation: {
      next: nav.next || '',
      previous: nav.previous || '',
      random: nav.random || '',
    },
  };
}

async function buildFeaturedWindow(centerKey, opts = {}) {
  const { anchorPayload = null, pinNewestKey = null, pinNewestPayload = null } = opts;
  const byId = new Map();

  async function add(key, payload) {
    if (!key || byId.has(key)) return;
    const p = payload || await fetchEditorial(key);
    byId.set(key, normalizeArticle(p[0], key));
  }

  if (pinNewestKey && pinNewestPayload) await add(pinNewestKey, pinNewestPayload);
  await add(centerKey, anchorPayload);

  let key = centerKey;
  for (let i = 0; i < WINDOW_RADIUS; i++) {
    const older = byId.get(key)?.navigation.next;
    if (!older) break;
    await add(older);
    key = older;
  }

  key = centerKey;
  for (let i = 0; i < WINDOW_RADIUS; i++) {
    const newer = byId.get(key)?.navigation.previous;
    if (!newer) break;
    await add(newer);
    key = newer;
  }

  return orderFeaturedArticles(byId, pinNewestKey || centerKey);
}

function orderFeaturedArticles(byId, rightMostKey) {
  const ids = new Set(byId.keys());
  let oldestKey = [...byId.values()].find(a => !a.navigation.next || !ids.has(a.navigation.next))?.id;
  if (!oldestKey) oldestKey = [...byId.keys()][0];

  const ordered = [];
  const seen = new Set();
  let k = oldestKey;
  while (k && byId.has(k) && !seen.has(k)) {
    seen.add(k);
    ordered.push(byId.get(k));
    k = byId.get(k).navigation.previous;
  }

  if (rightMostKey && byId.has(rightMostKey)) {
    const lastId = ordered[ordered.length - 1]?.id;
    if (lastId !== rightMostKey) {
      return [...ordered.filter(a => a.id !== rightMostKey), byId.get(rightMostKey)];
    }
  }
  return ordered;
}

/* ---------------- images ---------------- */
const imgs = {};
function preloadImages() {
  return Promise.all(FEAT.map(a => new Promise(res => {
    if (!a.img) { imgs[a.id] = null; res(); return; }
    const im = new Image(); im.onload = im.onerror = () => res(); im.src = a.img; imgs[a.id] = im;
  })));
}

/* ---------------- DOM rendering ---------------- */
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function canGoOlder(i) {
  if (i > 0) return true;
  return !!FEAT[0]?.navigation?.next;
}
function canGoNewer(i) {
  if (i < FEAT.length - 1) return true;
  return !!FEAT[FEAT.length - 1]?.navigation?.previous;
}
function cardHTML(a, i) {
  return `
  <header class="card-head">
    <span class="kicker" data-snap="text">Featured <b>${i + 1}</b> of ${FEAT.length} · newest on the right</span>
    <div class="card-nav">
      <button type="button" data-snap="button" data-nav="-1" ${canGoOlder(i) ? '' : 'disabled'} aria-label="Older story">‹ Older</button>
      <button type="button" data-snap="button" data-nav="1" ${canGoNewer(i) ? '' : 'disabled'} aria-label="Newer story">Newer ›</button>
    </div>
  </header>
  <div class="card-body">
    <img class="card-img" data-snap="img" src="${esc(a.img)}" alt="" width="340" height="340">
    <div class="card-text">
      <h2 class="card-title" data-snap="text">${esc(a.title)}</h2>
      ${a.showAgent ? `<p class="card-agent" data-snap="text">${esc(a.agent)}</p>` : ''}
      <div class="card-paras">${a.bodyHtml}</div>
      <button type="button" class="card-read-more" hidden aria-expanded="false">Read more</button>
      <div class="card-meta">
        <div data-snap="text">Generated: ${esc(a.generated)}</div>
        <div data-snap="text">Original source: ${esc(a.source)} | ${esc(a.published)}</div>
        <div data-snap="text">Original title: ${esc(a.origTitle)}</div>
        <div><a href="${esc(a.url)}" data-snap="text" target="_blank" rel="noopener">Read original article</a>${a.hn ? ` <span class="sep" data-snap="text">·</span> <a href="${esc(a.hn)}" data-snap="text" target="_blank" rel="noopener">Hacker News discussion</a>` : ''}</div>
      </div>
    </div>
  </div>`;
}
function renderCard(el, i) {
  el.innerHTML = cardHTML(FEAT[i], i);
  el.dataset.id = FEAT[i].id;
  el.querySelectorAll('.card-paras p, .card-paras li').forEach(n => { n.dataset.snap = 'text'; });
  wireByline(el);
  updateReadMoreState(el);
}
function wireByline(el) {
  const byline = el.querySelector('.byline');
  const alias = el.querySelector('.byline-alias');
  if (!byline || !alias) return;
  byline.addEventListener('click', e => {
    e.preventDefault();
    const a = byline.innerHTML;
    const b = alias.innerHTML;
    byline.innerHTML = b;
    alias.innerHTML = a;
  });
}
function updateReadMoreState(el = cardEl) {
  const compact = window.innerHeight <= 900 || (window.innerWidth <= 1500 && window.innerHeight <= 920);
  const paras = el.querySelector('.card-paras');
  const btn = el.querySelector('.card-read-more');
  if (!paras || !btn) return;
  if (compact && !el.classList.contains('is-expanded')) {
    el.classList.add('has-read-more');
    btn.hidden = false;
  } else {
    el.classList.remove('has-read-more', 'is-expanded');
    btn.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  }
}
cardEl.addEventListener('click', e => {
  if (e.target.closest('.card-read-more')) {
    cardEl.classList.add('is-expanded');
    cardEl.classList.remove('has-read-more');
    e.target.hidden = true;
    e.target.setAttribute('aria-expanded', 'true');
    relayout();
    return;
  }
  const b = e.target.closest('[data-nav]'); if (b) go(active + Number(b.dataset.nav));
});

function rebuildSideButtons() {
  scene.innerHTML = '';
  sideBtns = FEAT.map((a, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'side'; b.dataset.i = i;
    b.innerHTML = `<img class="side-img" src="${esc(a.img)}" alt=""><span class="side-txt"><span class="side-t">${esc(a.title)}</span><span class="side-a">${esc(a.agent)}</span></span>`;
    b.addEventListener('click', () => go(i));
    b.addEventListener('focus', () => { gl && gl.setHighlight(i, 1); });
    b.addEventListener('blur', () => { gl && gl.setHighlight(i, 0); });
    scene.appendChild(b);
    return b;
  });
}

/* ---------------- browse grid (archive) ---------------- */
function appendArchiveTiles(items) {
  items.forEach(editorial => {
    if (gridEl.querySelector(`[data-id="${editorial.cache_key}"]`)) return;
    const a = document.createElement('a');
    a.className = 'tile';
    a.href = `#${editorial.cache_key}`;
    a.dataset.id = editorial.cache_key;
    const tile = parseArchiveTileTitle(editorial.title);
    a.innerHTML = `<img src="${esc(editorial.image_url)}" alt="" loading="lazy" width="400" height="400">
      <div class="tile-body"><div class="tile-title">${esc(tile.title)}</div>${tile.agent ? `<div class="tile-agent">${esc(tile.agent)}</div>` : ''}</div>`;
    a.addEventListener('click', e => {
      e.preventDefault();
      openStory(editorial.cache_key, false);
    });
    gridEl.appendChild(a);
  });
}
async function fetchArchive(page) {
  if (archiveLoading || !archiveHasMore) return;
  archiveLoading = true;
  if (loadingEl) loadingEl.style.display = 'block';
  const stub = page === 2 ? '/stubs/archive-page2.json' : '/stubs/archive.json';
  try {
    let data;
    if (isLocalDev) {
      const response = await fetch(stub, { cache: 'no-store' });
      if (response.ok) data = await response.json();
    }
    if (!data) data = await fetchJsonMemo(`/archive?page=${page}`, stub);
    appendArchiveTiles(data.editorials || []);
    archiveHasMore = !!data.pagination?.has_next;
    archivePage = page;
  } catch (e) {
    console.error(e);
  } finally {
    archiveLoading = false;
    if (loadingEl) loadingEl.style.display = 'none';
  }
}
function isBottomOfPage() {
  return (window.innerHeight + window.scrollY) >= document.body.offsetHeight - 700;
}
window.addEventListener('scroll', () => {
  if (isBottomOfPage() && !archiveLoading && archiveHasMore) fetchArchive(archivePage + 1);
});
function updateEndMarker() {
  if (!endMarker) return;
  const atNewest = active === FEAT.length - 1;
  endMarker.hidden = !(geom.showSides && atNewest);
}
function markActiveTile() {
  document.querySelectorAll('.tile').forEach(t => t.classList.toggle('is-active', t.dataset.id === FEAT[active]?.id));
}
let toastT;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2600);
}

/* ---------------- slot layout (shared by WebGL meshes and CSS buttons) ---------------- */
function lerpArr(arr, a) {
  const i = Math.min(Math.floor(a), arr.length - 2), f = Math.min(a - i, 1);
  return arr[i] + (arr[i + 1] - arr[i]) * f;
}
function computeGeom() {
  const cr = canvas.getBoundingClientRect(), kr = cardEl.getBoundingClientRect();
  const g = geom;
  g.W = cr.width; g.H = cr.height;
  g.cardW = kr.width; g.cardH = kr.height;
  g.cx = kr.left - cr.left + kr.width / 2;
  g.cy = kr.top - cr.top + kr.height / 2;
  g.floorY = -g.cardH / 2 - 6;
  // fit 3 side cards beside the centre card, solving positions in *projected* screen space so the
  // perspective pull toward the centre never tucks the first side card under the article card
  const vw = document.documentElement.clientWidth, cxV = g.cx - (g.W - vw) / 2;   // canvas is 100vw; exclude scrollbar
  const limit = Math.min(cxV, vw - cxV) - 24, gap = Math.max(44, g.cardW * 0.04);
  let spread = 0.56;
  const c = Math.cos(40 * Math.PI / 180), sn = Math.sin(40 * Math.PI / 180), D = PERSP;
  const place = (k, spread) => {
    const sw = SIDE_W0 * k, X = [0]; let inner = g.cardW / 2 + gap, outer3 = 0;
    for (let i = 1; i <= 4; i++) {
      const half = sw * SLOTS.S[i] / 2, zc = SLOTS.Z[i];
      const xc = inner * (D - (zc - half * sn)) / D + half * c;        // inner edge recedes (z - half*sin)
      const outer = (xc + half * c) * D / (D - (zc + half * sn));      // outer edge comes forward
      X[i] = xc; if (i === 3) outer3 = outer;
      inner = inner + (outer - inner) * (i === 3 ? 0.75 : spread);        // next card peeks out ~45% behind this one
    }
    return { X, outer3 };
  };
  // size: fill the width out to the viewport edges, but never let the nearest side card get taller than the article card
  let lo = 0.3, hi = Math.max(0.35, Math.min(2.2, (g.cardH * 0.9) / (SIDE_W0 * SIDE_ASPECT * SLOTS.S[1])));
  if (place(hi, spread).outer3 <= limit) lo = hi;
  else for (let it = 0; it < 24; it++) { const m = (lo + hi) / 2; if (place(m, spread).outer3 <= limit) lo = m; else hi = m; }
  // height-capped with room to spare: fan the cards out further (less overlap) to reach the edges
  if (lo === hi && place(lo, spread).outer3 < limit) {
    let a = spread, b = 0.9;
    for (let it = 0; it < 20; it++) { const m = (a + b) / 2; if (place(lo, m).outer3 <= limit) a = m; else b = m; }
    spread = a;
  }
  g.k = lo; g.sideW = SIDE_W0 * g.k; g.sideH = g.sideW * SIDE_ASPECT; g.X = place(g.k, spread).X;
  g.showSides = wide.matches;
}
function slot(o) {
  const g = geom, s = Math.sign(o), a = Math.abs(o);
  const S0 = g.cardH / g.sideH;                     // grows toward card size as it merges into the centre
  const S = a < 1 ? S0 + (SLOTS.S[1] - S0) * a : lerpArr(SLOTS.S, a);
  const x = s * lerpArr(g.X, Math.min(a, 4));
  const rot = s * lerpArr(SLOTS.R, Math.min(a, 4));   // left cards face right, right cards face left
  const z = lerpArr(SLOTS.Z, Math.min(a, 4));
  const h = g.sideH * S;
  const y = g.floorY + 4 + h / 2;                     // bottoms share one glossy floor
  const alpha = smooth(0.35, 0.9, a) * (1 - smooth(3.05, 3.8, a));
  return { x, y, z, rot: -rot, S, dim: lerpArr(SLOTS.DIM, Math.min(a, 4)), bias: lerpArr(SLOTS.BIAS, Math.min(a, 4)), alpha };
}
function smooth(e0, e1, x) { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); }

function layoutButtons() {
  const g = geom;
  scene.style.perspective = PERSP + 'px';
  scene.style.perspectiveOrigin = `${g.cx}px ${g.cy}px`;
  sideBtns.forEach((b, i) => {
    const o = offsets[i], L = slot(o), a = Math.abs(o);
    const vis = g.showSides && a > 0.5 && a < 3.5 && L.alpha > 0.02;
    if (b.hidden === vis) b.hidden = !vis;
    if (!vis) return;
    b.style.width = g.sideW + 'px'; b.style.height = g.sideH + 'px';
    b.style.left = g.cx + 'px'; b.style.top = g.cy + 'px';
    b.style.margin = `${-g.sideH / 2}px 0 0 ${-g.sideW / 2}px`;
    b.style.setProperty('--sw', g.sideW + 'px');
    b.style.setProperty('--fs1', (g.sideW * 0.058) + 'px');
    b.style.setProperty('--fs2', (g.sideW * 0.044) + 'px');
    // CSS y is down; rotateY sign matches three.js rotation.y
    b.style.transform = `translate3d(${L.x}px, ${-L.y}px, ${L.z}px) rotateY(${L.rot}deg) scale(${L.S})`;
    b.style.zIndex = String(100 - Math.round(a * 10));
    b.style.opacity = gl ? '' : String(L.alpha);
    b.style.filter = gl ? '' : `brightness(${L.dim})`;
    const rel = o < 0 ? 'Older' : 'Newer';
    b.setAttribute('aria-label', `${rel} story (${Math.round(a)} ${Math.round(a) === 1 ? 'step' : 'steps'} away): ${FEAT[i].title} — ${FEAT[i].agent}`);
  });
  updateEndMarker();
}

/* ---------------- card snapshot -> canvas (texture for the WebGL flip surface) ---------------- */
function snapshot(el, i, dpr = 1.5) {
  const a = FEAT[i], r0 = el.getBoundingClientRect();
  const w = Math.round(r0.width), h = Math.round(Math.max(r0.height, geom.cardH || r0.height));
  const cv = document.createElement('canvas'); cv.width = w * dpr; cv.height = h * dpr;
  const ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
  const cs = getComputedStyle(el);
  ctx.save(); rr(ctx, 0.5, 0.5, w - 1, h - 1, 16);
  const grd = ctx.createLinearGradient(0, 0, 0, h); grd.addColorStop(0, '#151916'); grd.addColorStop(1, '#0f1210');
  ctx.fillStyle = grd; ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,.09)'; ctx.lineWidth = 1; ctx.stroke(); ctx.restore();
  // divider lines
  el.querySelectorAll('.card-head, .card-meta').forEach(d => {
    const r = d.getBoundingClientRect(), cs2 = getComputedStyle(d);
    ctx.fillStyle = 'rgba(255,255,255,.09)';
    if (d.classList.contains('card-head')) ctx.fillRect(r.left - r0.left, r.bottom - r0.top - 1, r.width, 1);
    else ctx.fillRect(r.left - r0.left, r.top - r0.top, r.width, 1);
  });
  el.querySelectorAll('[data-snap]').forEach(n => {
    const r = n.getBoundingClientRect(), x = r.left - r0.left, y = r.top - r0.top, st = getComputedStyle(n);
    const kind = n.dataset.snap;
    if (kind === 'img') {
      const im = imgs[a.id]; ctx.save(); rr(ctx, x, y, r.width, r.height, 10); ctx.clip();
      ctx.fillStyle = '#1a1d1b'; ctx.fillRect(x, y, r.width, r.height);
      if (im && im.naturalWidth) ctx.drawImage(im, x, y, r.width, r.height); ctx.restore(); return;
    }
    ctx.font = `${st.fontStyle} ${st.fontWeight} ${st.fontSize} ${st.fontFamily}`;
    if (kind === 'button') {
      ctx.save(); rr(ctx, x, y, r.width, r.height, 6); ctx.fillStyle = st.backgroundColor; ctx.fill();
      ctx.fillStyle = st.color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(n.textContent.trim(), x + r.width / 2, y + r.height / 2 + 1); ctx.restore(); return;
    }
    const lh = parseFloat(st.lineHeight) || parseFloat(st.fontSize) * 1.4;
    ctx.fillStyle = st.color; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    if (n.classList.contains('kicker')) {   // mixed bold run
      let cx = x; n.childNodes.forEach(c => {
        const t = c.textContent; const bold = c.nodeName === 'B';
        ctx.font = `${bold ? 'bold' : 'normal'} ${st.fontSize} ${st.fontFamily}`; ctx.fillStyle = bold ? '#e9ece9' : st.color;
        ctx.fillText(t, cx, y + lh / 2); cx += ctx.measureText(t).width;
      }); return;
    }
    wrap(ctx, n.textContent.replace(/\s+/g, ' ').trim(), r.width + 1).forEach((ln, k) => ctx.fillText(ln, x, y + k * lh + lh / 2));
  });
  return { canvas: cv, w, h };
}
function wrap(ctx, text, maxW) {
  const words = text.split(' '), lines = []; let line = '';
  for (const wd of words) {
    const t = line ? line + ' ' + wd : wd;
    if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = wd; } else line = t;
  }
  if (line) lines.push(line); return lines;
}
function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }

function sideTexture(i) {
  const a = FEAT[i], W = 512, H = 704, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.save(); rr(ctx, 0, 0, W, H, 22); ctx.clip();
  ctx.fillStyle = '#101311'; ctx.fillRect(0, 0, W, H);
  const im = imgs[a.id]; if (im && im.naturalWidth) ctx.drawImage(im, 0, 0, W, W);
  const g = ctx.createLinearGradient(0, W - 60, 0, W); g.addColorStop(0, 'rgba(16,19,17,0)'); g.addColorStop(1, 'rgba(16,19,17,.9)');
  ctx.fillStyle = g; ctx.fillRect(0, W - 60, W, 60);
  ctx.fillStyle = '#eef1ee'; ctx.font = 'bold 31px Arial, sans-serif'; ctx.textBaseline = 'top';
  let lines = wrap(ctx, a.title, W - 48);
  if (lines.length > 2) { lines = lines.slice(0, 2); while (ctx.measureText(lines[1] + '…').width > W - 48) lines[1] = lines[1].slice(0, -1); lines[1] += '…'; }
  lines.forEach((l, k) => ctx.fillText(l, 24, W + 26 + k * 40));
  ctx.fillStyle = '#2fcf37'; ctx.font = 'bold 23px Arial, sans-serif'; ctx.fillText(a.agent, 24, W + 26 + 2 * 40 + 14);
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = 2; rr(ctx, 1, 1, W - 2, H - 2, 21); ctx.stroke();
  return cv;
}

/* ---------------- WebGL renderer ---------------- */
let gl = null;
async function initGL() {
  if (reduced || params.get('mode') === 'css') return null;
  let THREE;
  try { THREE = await import('./vendor/three.module.min.js'); } catch (e) { console.warn('three.js failed', e); return null; }
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, premultipliedAlpha: false });
  } catch (e) { console.warn('WebGL unavailable, CSS fallback', e); return null; }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
  renderer.setClearColor(0x000000, 0);
  const s3 = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 10, 20000);
  const sideGroup = new THREE.Group(); s3.add(sideGroup);
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const mkTex = cv => { const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.NoColorSpace; t.anisotropy = maxAniso;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; return t; };

  const reflectVS = `
    uniform float uReflect, uFloorY, uReflLen;
    varying float vFade;
    vec4 reflectWorld(vec4 w){
      vFade = 1.0;
      if (uReflect > 0.5) { float dy = w.y - uFloorY; w.y = uFloorY - dy; vFade = 1.0 - clamp(dy / uReflLen, 0.0, 1.0); }
      return w;
    }`;
  // --- side cards: textured planes, darkened + mip-bias blur for a cheap depth-of-field ---
  const sideVS = reflectVS + `
    varying vec2 vUv;
    void main(){ vUv = uv; vec4 w = reflectWorld(modelMatrix * vec4(position, 1.0)); gl_Position = projectionMatrix * viewMatrix * w; }`;
  const sideFS = `
    uniform sampler2D uTex; uniform float uDim, uAlpha, uBias, uReflect, uHi;
    varying vec2 vUv; varying float vFade;
    void main(){
      vec4 c = texture2D(uTex, vUv, uBias);
      c.rgb *= uDim;
      float e = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
      c.rgb = mix(c.rgb, vec3(0.18, 0.81, 0.22), uHi * (1.0 - smoothstep(0.004, 0.014, e)) * c.a);
      c.rgb += uHi * 0.06;
      float a = c.a * uAlpha;
      if (uReflect > 0.5) a *= 0.24 * vFade * vFade;
      if (a < 0.004) discard;
      gl_FragColor = vec4(c.rgb, a);
    }`;
  const common = () => ({ uReflect: { value: 0 }, uFloorY: { value: 0 }, uReflLen: { value: 260 } });
  const plane = new THREE.PlaneGeometry(1, 1);
  const sides = FEAT.map((a, i) => {
    const tex = mkTex(sideTexture(i));
    const mk = refl => {
      const m = new THREE.ShaderMaterial({ vertexShader: sideVS, fragmentShader: sideFS, transparent: true, side: THREE.DoubleSide, depthWrite: !refl,
        uniforms: { ...common(), uTex: { value: tex }, uDim: { value: 1 }, uAlpha: { value: 1 }, uBias: { value: 0 }, uHi: { value: 0 } } });
      m.uniforms.uReflect.value = refl ? 1 : 0;
      const mesh = new THREE.Mesh(plane, m); mesh.frustumCulled = false; sideGroup.add(mesh); return mesh;
    };
    return { main: mk(false), refl: mk(true), hi: 0, hiT: 0 };
  });

  // --- centre flip surface: bent plane, front = current article, back = destination ---
  const flipVS = reflectVS + `
    uniform vec2 uSize; uniform float uProg, uDir, uTopY, uBend, uLift;
    varying vec2 vUv; varying float vShade;
    void main(){
      vUv = uv;
      float PI = 3.14159265;
      float s = sin(uProg * PI);
      vec3 p = vec3(position.x * uSize.x, position.y * uSize.y, 0.0);
      float nx = position.x * 2.0;
      // card flexes while flipping: edges lag behind, trailing edge a bit more (page-like curl)
      float lagEdge = max(0.0, -nx * uDir);
      p.z -= s * uSize.x * (uBend * nx * nx + uBend * 0.9 * lagEdge * lagEdge * lagEdge);
      float a = -uDir * uProg * PI;
      vec3 r = vec3(p.x * cos(a) + p.z * sin(a), p.y, -p.x * sin(a) + p.z * cos(a));
      r.z += s * uLift;
      r.y += uTopY - uSize.y * 0.5;
      float slope = -2.0 * s * uBend * nx;              // local bend -> shading gradient
      vShade = clamp(0.5 + 0.5 * abs(cos(a)) + slope * 0.9 * uDir * sign(cos(a)) * 0.25, 0.3, 1.1);
      vec4 w = reflectWorld(vec4(r, 1.0));
      gl_Position = projectionMatrix * viewMatrix * w;
    }`;
  const flipFS = `
    uniform sampler2D uFront, uBack; uniform float uReflect, uShowBack;
    varying vec2 vUv; varying float vShade; varying float vFade;
    void main(){
      bool f = gl_FrontFacing; if (uReflect > 0.5) f = !f;
      vec4 c = f ? texture2D(uFront, vUv) : texture2D(uBack, vec2(1.0 - vUv.x, vUv.y));
      c.rgb *= vShade;
      float a = c.a;
      if (uReflect > 0.5) a *= 0.2 * vFade * vFade;
      if (a < 0.004) discard;
      gl_FragColor = vec4(c.rgb, a);
    }`;
  const flipGeo = new THREE.PlaneGeometry(1, 1, 80, 1);
  const blank = mkTex(document.createElement('canvas'));
  const mkFlip = refl => {
    const m = new THREE.ShaderMaterial({ vertexShader: flipVS, fragmentShader: flipFS, transparent: true, side: THREE.DoubleSide, depthWrite: !refl,
      uniforms: { ...common(), uFront: { value: blank }, uBack: { value: blank }, uSize: { value: new THREE.Vector2(1, 1) },
        uProg: { value: 0 }, uDir: { value: 1 }, uTopY: { value: 0 }, uBend: { value: 0.12 }, uLift: { value: 80 }, uShowBack: { value: 0 } } });
    m.uniforms.uReflect.value = refl ? 1 : 0;
    const mesh = new THREE.Mesh(flipGeo, m); mesh.frustumCulled = false; mesh.renderOrder = refl ? 1 : 20; s3.add(mesh); return mesh;
  };
  const flip = mkFlip(false), flipRefl = mkFlip(true);
  flip.visible = false;

  // --- glossy floor sheen ---
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `varying vec2 vUv; void main(){ vec2 d = (vUv - vec2(0.5, 0.62)) * vec2(1.0, 2.6);
      float a = 0.07 * (1.0 - smoothstep(0.0, 0.55, length(d))); float line = 0.05 * (1.0 - smoothstep(0.0, 0.004, abs(vUv.y - 1.0))) * (1.0 - smoothstep(0.1, 0.5, abs(vUv.x - 0.5)));
      gl_FragColor = vec4(vec3(0.75, 0.9, 0.78), a + line); }` }));
  floor.rotation.x = -Math.PI / 2; floor.renderOrder = -10; s3.add(floor);

  let frontSnap = null, needs = true, mouse = { x: 0, y: 0, tx: 0, ty: 0 };
  function setFrontTexture(snap) {
    const old = flip.material.uniforms.uFront.value;
    const t = mkTex(snap.canvas);
    [flip, flipRefl].forEach(m => { m.material.uniforms.uFront.value = t; m.material.uniforms.uSize.value.set(snap.w, snap.h); });
    if (old !== blank && old !== flip.material.uniforms.uBack.value) old.dispose();
    frontSnap = snap;
  }
  function resize() {
    const g = geom, pr = renderer.getPixelRatio();
    renderer.setSize(g.W, g.H, false);
    const fullW = 2 * Math.max(g.cx, g.W - g.cx), fullH = 2 * Math.max(g.cy, g.H - g.cy);
    camera.fov = 2 * Math.atan(fullH / 2 / PERSP) * 180 / Math.PI;
    camera.aspect = fullW / fullH; camera.position.set(0, 0, PERSP); camera.lookAt(0, 0, 0);
    camera.setViewOffset(fullW, fullH, fullW / 2 - g.cx, fullH / 2 - g.cy, g.W, g.H);
    camera.updateProjectionMatrix();
    floor.scale.set(g.W * 1.6, 2400, 1); floor.position.set(0, g.floorY, -1200 + 1);
    const all = [...sides.flatMap(s => [s.main, s.refl]), flip, flipRefl];
    all.forEach(m => { m.material.uniforms.uFloorY.value = g.floorY; m.material.uniforms.uReflLen.value = Math.min(240, g.H - g.cy - g.cardH / 2 - 20); });
    [flip, flipRefl].forEach(m => { m.material.uniforms.uTopY.value = g.cardH / 2; });
    needs = true;
  }
  function update() {
    const g = geom;
    sides.forEach((s, i) => {
      const L = slot(offsets[i]), vis = g.showSides && L.alpha > 0.004 && Math.abs(offsets[i]) > 0.02;
      s.hi += (s.hiT - s.hi) * 0.25;
      [s.main, s.refl].forEach(m => {
        m.visible = vis; if (!vis) return;
        m.position.set(L.x, L.y, L.z); m.rotation.set(0, L.rot * Math.PI / 180, 0);
        m.scale.set(g.sideW * L.S, g.sideH * L.S, 1);
        const u = m.material.uniforms; u.uDim.value = L.dim; u.uAlpha.value = L.alpha; u.uBias.value = L.bias; u.uHi.value = s.hi;
        m.renderOrder = (m === s.refl ? 0 : 10) - Math.abs(offsets[i]);
      });
    });
    // subtle parallax: the flanking arc and floor turn slightly toward the pointer (centre stays aligned with the HTML card)
    mouse.x += (mouse.tx - mouse.x) * 0.08; mouse.y += (mouse.ty - mouse.y) * 0.08;
    sideGroup.rotation.y = mouse.x * 0.035; sideGroup.rotation.x = mouse.y * 0.012;
    sideGroup.position.x = mouse.x * -14;
    renderer.render(s3, camera);
  }
  let raf = 0;
  function loop() {
    raf = 0; update();
    const moving = Math.abs(mouse.tx - mouse.x) > 0.001 || Math.abs(mouse.ty - mouse.y) > 0.001 || busy || sides.some(s => Math.abs(s.hiT - s.hi) > 0.01);
    if (moving || needs) { needs = false; kick(); }
  }
  function kick() { if (!raf) raf = requestAnimationFrame(loop); }
  stage.addEventListener('pointermove', e => {
    const r = stage.getBoundingClientRect();
    mouse.tx = ((e.clientX - r.left) / r.width - 0.5) * 2; mouse.ty = ((e.clientY - r.top) / r.height - 0.5) * 2; kick();
  });
  stage.addEventListener('pointerleave', () => { mouse.tx = 0; mouse.ty = 0; kick(); });

  return {
    resize, kick, setFrontTexture,
    setHighlight(i, v) { if (sides[i]) { sides[i].hiT = v; kick(); } },
    rebuildSideMeshes() {
      sides.forEach(s => {
        [s.main, s.refl].forEach(m => {
          m.material.uniforms.uTex.value.dispose();
          m.material.dispose();
          sideGroup.remove(m);
        });
      });
      sides.length = 0;
      FEAT.forEach((a, i) => {
        const tex = mkTex(sideTexture(i));
        const mk = refl => {
          const m = new THREE.ShaderMaterial({ vertexShader: sideVS, fragmentShader: sideFS, transparent: true, side: THREE.DoubleSide, depthWrite: !refl,
            uniforms: { ...common(), uTex: { value: tex }, uDim: { value: 1 }, uAlpha: { value: 1 }, uBias: { value: 0 }, uHi: { value: 0 } } });
          m.uniforms.uReflect.value = refl ? 1 : 0;
          const mesh = new THREE.Mesh(plane, m); mesh.frustumCulled = false; sideGroup.add(mesh); return mesh;
        };
        sides.push({ main: mk(false), refl: mk(true), hi: 0, hiT: 0 });
      });
      kick();
    },
    dispose() {
      cancelAnimationFrame(raf);
      sides.forEach(s => {
        [s.main, s.refl].forEach(m => {
          m.material.uniforms.uTex.value.dispose();
          m.material.dispose();
          m.geometry.dispose();
        });
      });
      [flip, flipRefl].forEach(m => { m.material.dispose(); m.geometry.dispose(); });
      floor.geometry.dispose(); floor.material.dispose();
      renderer.dispose();
    },
    // flip from current card to card `to`; returns promise resolved at the end
    flipTo(to, dir, backSnap, onProgress) {
      const back = mkTex(backSnap.canvas);
      [flip, flipRefl].forEach(m => { const u = m.material.uniforms; u.uBack.value = back; u.uDir.value = dir; u.uProg.value = 0;
        u.uSize.value.set(Math.max(frontSnap.w, backSnap.w), Math.max(frontSnap.h, backSnap.h)); });
      flip.visible = true;
      return new Promise(res => {
        let t0 = performance.now();
        const step = now => {
          let t = Math.min(1, (now - t0) / FLIP_MS);
          // test hook: window.__flipHold = 0.48 freezes the flip at that fraction (used for the mid-flip screenshot)
          if (window.__flipHold != null && t >= window.__flipHold) { t = window.__flipHold; t0 = now - t * FLIP_MS; window.__flipHeld = true; }
          const e = t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
          [flip, flipRefl].forEach(m => m.material.uniforms.uProg.value = e);
          onProgress(e); update();
          if (t < 1) requestAnimationFrame(step); else res(back);
        };
        requestAnimationFrame(step);
      });
    },
    endFlip(backSnap) {
      flip.visible = false;
      [flip, flipRefl].forEach(m => m.material.uniforms.uProg.value = 0);
      setFrontTexture(backSnap); kick();
    },
    get renderer() { return renderer; }
  };
}

/* ---------------- navigation ---------------- */
function indexFromHash() { const id = decodeURIComponent(location.hash.slice(1)); return FEAT.findIndex(a => a.id === id); }
function snapFor(i) { renderCard(measureEl, i); measureEl.style.width = geom.cardW + 'px'; return snapshot(measureEl, i); }

async function go(target, fromHash = false) {
  if (target === active) return;
  if (target < 0 && FEAT[0]?.navigation?.next) {
    await openStory(FEAT[0].navigation.next, fromHash);
    return;
  }
  if (target >= FEAT.length && FEAT[FEAT.length - 1]?.navigation?.previous) {
    await openStory(FEAT[FEAT.length - 1].navigation.previous, fromHash);
    return;
  }
  if (target < 0 || target >= FEAT.length) return;
  if (busy) { pending = target; return; }
  busy = true;
  const from = active, dir = Math.sign(target - from);
  const start = FEAT.map((_, i) => i - from), end = FEAT.map((_, i) => i - target);
  const setOff = e => { offsets = start.map((s, i) => s + (end[i] - s) * e); layoutButtons(); };
  if (!fromHash) history.pushState(null, '', '#' + FEAT[target].id);   // updates location.hash without re-entrancy
  const hadFocus = document.activeElement && document.activeElement.closest('.side, .card-nav') ? document.activeElement : null;

  if (gl) {
    const backSnap = snapFor(target);
    cardEl.style.opacity = '0';
    await gl.flipTo(target, dir, backSnap, setOff);
    active = target; renderCard(cardEl, target); cardEl.style.opacity = '1';
    gl.endFlip(backSnap);
  } else if (reduced) {                         // crossfade only, no rotation
    cardEl.classList.add('fade-out'); scene.classList.add('fading');
    await wait(180);
    active = target; renderCard(cardEl, target); setOff(1);
    cardEl.classList.remove('fade-out'); scene.classList.remove('fading');
  } else {                                      // CSS 3D flip fallback
    cardEl.style.setProperty('--flip-to', dir > 0 ? '90deg' : '-90deg');
    cardEl.classList.add('css-flip-out');
    await animate(FLIP_MS / 2, e => setOff(e * 0.5));
    active = target; renderCard(cardEl, target);
    cardEl.classList.remove('css-flip-out');
    cardEl.style.transition = 'none'; cardEl.style.transform = `perspective(2000px) rotateY(${dir > 0 ? -90 : 90}deg)`;
    cardEl.offsetWidth; cardEl.style.transition = ''; cardEl.style.transform = '';
    cardEl.classList.add('css-flip-in');
    await animate(FLIP_MS / 2, e => setOff(0.5 + e * 0.5));
    cardEl.classList.remove('css-flip-in');
  }
  offsets = end; layoutButtons(); markActiveTile();
  document.title = `botz.ai - GenAI News - ${FEAT[active].id}`;
  if (storyAnnouncer) storyAnnouncer.textContent = FEAT[active].title;
  trackPageView();
  if (hadFocus && hadFocus.classList.contains('side')) { const nb = sideBtns[Number(hadFocus.dataset.i)]; (nb.hidden ? cardEl.querySelector('.card-title') : nb)?.focus?.(); }
  else if (hadFocus) { const b = cardEl.querySelector(`[data-nav="${dir}"]`); (b && !b.disabled ? b : cardEl.querySelector(`[data-nav="${-dir}"]`))?.focus(); }
  busy = false;
  if (pending !== null) { const p = pending; pending = null; go(p); }
}
const wait = ms => new Promise(r => setTimeout(r, ms));
function animate(ms, fn) {
  return new Promise(res => { const t0 = performance.now(); const f = now => { const t = Math.min(1, (now - t0) / ms); fn(t); t < 1 ? requestAnimationFrame(f) : res(); }; requestAnimationFrame(f); });
}

window.addEventListener('keydown', e => {
  if (e.altKey || e.ctrlKey || e.metaKey || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  if (e.key === 'ArrowRight') { e.preventDefault(); go(active + 1); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); go(active - 1); }
});
window.addEventListener('hashchange', () => {
  const id = decodeURIComponent(location.hash.slice(1));
  if (!id) { openStoryFromLatest(false); return; }
  openStory(id, true);
});
window.addEventListener('popstate', () => {
  const id = decodeURIComponent(location.hash.slice(1));
  if (!id) { openStoryFromLatest(true); return; }
  const i = FEAT.findIndex(a => a.id === id);
  if (i >= 0 && i !== active) go(i, true);
  else if (i < 0) openStory(id, true);
});
// swipe (touch/pen anywhere on the stage; mouse drags only outside the text card so text stays selectable)
let sw = null;
stage.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse' && e.target.closest('.card')) return; sw = { x: e.clientX, y: e.clientY }; });
stage.addEventListener('pointerup', e => {
  if (!sw) return; const dx = e.clientX - sw.x, dy = e.clientY - sw.y; sw = null;
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.3) go(active + (dx < 0 ? 1 : -1));
});
$('.random-link')?.addEventListener('click', async e => {
  e.preventDefault();
  const rnd = FEAT[active]?.navigation?.random;
  if (!rnd) return;
  const icon = $('#random-icon');
  if (icon) icon.className = icon.className === 'random-icon' ? 'random-icon-roll' : 'random-icon';
  await openStory(rnd, false);
});
$('.site-head h1 a')?.addEventListener('click', e => { e.preventDefault(); history.pushState(null, '', '/'); openStoryFromLatest(false); });

function trackPageView() {
  if (typeof gtag === 'function') {
    gtag('config', 'G-3HMC4TBL9L', { page_location: window.location.href, page_title: document.title });
    gtag('event', 'page_view', { page_title: document.title, page_location: window.location.href, page_path: location.pathname });
  }
}

async function applyFeaturedState(feat, activeIndex, fromHash, { omitHash = false } = {}) {
  if (gl?.dispose) { gl.dispose(); gl = null; }
  FEAT = feat;
  active = activeIndex;
  offsets = FEAT.map((_, i) => i - active);
  rebuildSideButtons();
  await preloadImages();
  if (!reduced && params.get('mode') !== 'css') gl = await initGL();
  document.documentElement.classList.toggle('mode-gl', !!gl);
  document.documentElement.classList.toggle('mode-css', !gl && !reduced);
  document.documentElement.classList.toggle('mode-reduced', reduced);
  renderCard(cardEl, active);
  markActiveTile();
  await relayout();
  const id = FEAT[active]?.id;
  if (!omitHash && id && !id.startsWith('__')) {
    if (!fromHash) history.pushState(null, '', '#' + id);
  } else if (!fromHash && omitHash) {
    history.replaceState(null, '', location.pathname + location.search);
  }
  document.title = id && !id.startsWith('__')
    ? `botz.ai - GenAI News - ${id}`
    : 'botz.ai - GenAI News';
  if (storyAnnouncer) storyAnnouncer.textContent = FEAT[active].title;
  trackPageView();
}

async function openStory(cacheKey, fromHash = false) {
  window.scrollTo(0, 0);
  const existing = FEAT.findIndex(a => a.id === cacheKey);
  if (existing >= 0) {
    if (existing !== active) await go(existing, fromHash);
    return;
  }
  stage.classList.add('is-loading');
  try {
    const anchorPayload = await fetchEditorial(cacheKey);
    const feat = await buildFeaturedWindow(cacheKey, {
      anchorPayload,
      pinNewestKey: cacheKey,
      pinNewestPayload: anchorPayload,
    });
    let activeIndex = feat.findIndex(a => a.id === cacheKey);
    if (activeIndex < 0) activeIndex = feat.length - 1;
    await applyFeaturedState(feat, activeIndex, fromHash);
  } catch (err) {
    console.error(err);
    toast('Could not load that story.');
  } finally {
    stage.classList.remove('is-loading');
  }
}

async function openStoryFromLatest(fromHash) {
  window.scrollTo(0, 0);
  stage.classList.add('is-loading');
  try {
    const latestPayload = await fetchEditorial(null);
    let latestKey = null;
    try {
      latestKey = await resolveCacheKeyForPayload(latestPayload[0]);
    } catch (err) {
      console.warn(err);
    }

    if (!latestKey) {
      const solo = [normalizeArticle(latestPayload[0], '__live_latest__')];
      await applyFeaturedState(solo, 0, fromHash, { omitHash: true });
      return;
    }

    const feat = await buildFeaturedWindow(latestKey, {
      anchorPayload: latestPayload,
      pinNewestKey: latestKey,
      pinNewestPayload: latestPayload,
    });
    const activeIndex = feat.findIndex(a => a.id === latestKey);
    await applyFeaturedState(feat, activeIndex >= 0 ? activeIndex : feat.length - 1, fromHash, { omitHash: !fromHash });
    if (!fromHash && !location.hash) history.replaceState(null, '', '/');
  } catch (err) {
    console.error(err);
    toast('Failed to load GenAI News.');
  } finally {
    stage.classList.remove('is-loading');
  }
}

/* ---------------- boot ---------------- */
function fixCardHeight() {
  // equalise card height across the featured set so the floor/reflections do not jump between stories
  cardEl.style.minHeight = '';
  measureEl.style.width = cardEl.getBoundingClientRect().width + 'px';
  let maxH = 0; FEAT.forEach((_, i) => { renderCard(measureEl, i); maxH = Math.max(maxH, measureEl.getBoundingClientRect().height); });
  cardEl.style.minHeight = Math.ceil(maxH) + 'px';
}
async function relayout() {
  fixCardHeight(); computeGeom(); layoutButtons();
  updateReadMoreState();
  if (gl) { gl.resize(); gl.setFrontTexture(snapFor(active)); gl.kick(); }
}
async function boot() {
  stage.classList.add('is-loading');
  try {
    const arch = await fetchArchivePage1();
    appendArchiveTiles(arch.editorials || []);
    archivePage = 1;
    archiveHasMore = !!arch.pagination?.has_next;
    const hashKey = decodeURIComponent(location.hash.slice(1));
    if (hashKey) await openStory(hashKey, true);
    else await openStoryFromLatest(true);
  } catch (e) {
    console.error(e);
    toast('Failed to load GenAI News.');
  } finally {
    stage.classList.remove('is-loading');
  }
}
await boot();
let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(relayout, 120); });
wide.addEventListener('change', relayout);
window.__botzCarousel = { go, openStory, get active() { return active; }, get mode() { return gl ? 'webgl' : (reduced ? 'reduced' : 'css'); }, ready: true };
