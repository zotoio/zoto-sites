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
const WINDOW_RADIUS = 3;
const isLocalDev = ['localhost', '127.0.0.1'].includes(window.location.hostname);

/** No-key /editorials is a dedicated LATEST slot (empty URL hash when centered). */
const LATEST_SLOT_ID = '__latest__';
const LATEST_PROBE_MAX = 4;

let globalLatestPayload = null;
/** Proven hourly cache key whose payload matches LATEST identity (e.g. 2026-09-27-07). */
let globalLatestKey = null;
/** { generated_at, headline } — never match by source article.title alone. */
let latestIdentity = null;
let newestArchiveKey = null;
let newestRealHourlyKey = null;
let latestSlotResolved = false;

const knownAuthorPlain = new Set();
const knownAuthorLabels = new Set();

const STATIC_AUTHOR_SEED = [
  'AInonymous',
  'Agent ChatGPT',
  'Agent Mao Zedong',
  'Agent Henry Ford',
  'Agent Steve Jobs',
  'Agent Angela Merkel',
  'Agent Tony Blair',
];

function seedStaticAuthors() {
  STATIC_AUTHOR_SEED.forEach(registerKnownAuthor);
}

async function refreshArchiveKeyIndex(extraKeys = []) {
  try {
    const arch = await fetchArchivePage1();
    const keys = (arch.editorials || []).map(e => e.cache_key).filter(Boolean);
    archiveKeysChrono = [...new Set([...archiveKeysChrono, ...keys, ...extraKeys])].sort();
  } catch (_) {
    if (extraKeys.length) archiveKeysChrono = [...new Set([...archiveKeysChrono, ...extraKeys])].sort();
  }
}

function neighborArchiveKeys(centerKey, radius = WINDOW_RADIUS) {
  if (!centerKey) return [];
  const idx = archiveKeysChrono.indexOf(centerKey);
  if (idx < 0) return [centerKey];
  const lo = Math.max(0, idx - radius);
  const hi = Math.min(archiveKeysChrono.length - 1, idx + radius);
  return archiveKeysChrono.slice(lo, hi + 1);
}

function authorSuffixAllowed(suffix) {
  if (!suffix) return false;
  if (STATIC_AUTHOR_SEED.includes(suffix)) return true;
  if (knownAuthorLabels.has(suffix)) return true;
  const plain = suffix.replace(/^Agent\s+/i, '').trim();
  return !!(plain && knownAuthorPlain.has(plain));
}

/** Never split when the headline ends with the word "Agent" (e.g. "…Change the Agent"). */
function titleEndsWithBareAgent(title) {
  return /\bAgent\s*$/i.test(String(title ?? '').trim());
}

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
let busy = false;
let navQueue = 0;
let archiveKeysChrono = [];
window.__navLog = [];

function logCenteredKey() {
  const id = FEAT[active]?.id || LATEST_SLOT_ID;
  window.__navLog.push(id);
  console.debug('[nav]', id);
}
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

let editorialRequestCount = 0;
const editorialUrlsSeen = new Set();

async function fetchEditorial(cacheKey) {
  const stub = cacheKey ? `/stubs/editorials/${cacheKey}.json` : '/stubs/editorials/latest.json';
  if (isLocalDev) {
    const response = await fetch(stub, { cache: 'no-store' });
    if (response.ok) return response.json();
    return [];
  }
  let url = '/editorials';
  if (cacheKey) url += `?cacheKey=${encodeURIComponent(cacheKey)}`;
  if (!editorialUrlsSeen.has(url)) {
    editorialUrlsSeen.add(url);
    editorialRequestCount++;
  }
  return fetchJsonMemo(url, stub);
}

function cacheKeyToUtcMs(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})$/.exec(key || '');
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], 0, 0);
}

function utcMsToCacheKey(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}-${String(d.getUTCHours()).padStart(2, '0')}`;
}

/** Next hourly editorial cache key in UTC (23:00 rolls to next calendar day). */
function incrementHourCacheKey(key) {
  const ms = cacheKeyToUtcMs(key);
  if (ms == null) return null;
  return utcMsToCacheKey(ms + 3600000);
}

function decrementHourCacheKey(key) {
  const ms = cacheKeyToUtcMs(key);
  if (ms == null) return null;
  return utcMsToCacheKey(ms - 3600000);
}
if (incrementHourCacheKey('2026-09-30-23') !== '2026-10-01-00') {
  console.warn('incrementHourCacheKey: expected 2026-09-30-23 → 2026-10-01-00 in UTC');
}

function storyIdentity(entry) {
  return {
    generated_at: entry?.article?.generated_at || '',
    headline: editorialHeadlineFromEntry(entry),
  };
}

function sameStoryIdentity(a, b) {
  return !!(a?.generated_at && b?.generated_at && a.generated_at === b.generated_at
    && a?.headline && b?.headline && a.headline === b.headline);
}

function matchesLatestIdentity(entry) {
  return !!(latestIdentity && entry && sameStoryIdentity(storyIdentity(entry), latestIdentity));
}

function agentFromH2Markup(h2Inner) {
  const inner = String(h2Inner ?? '');
  const patterns = [
    /<span[^>]*>\s*(<(?:strong|em)[^>]*>\s*)*(Agent\s+[^<]+)\s*(<\/(?:strong|em)>\s*)*<\/span>\s*(?:<br\s*\/?>)?\s*$/i,
    /<span[^>]*>\s*(Agent\s+[^<]+)\s*<\/span>\s*(?:<br\s*\/?>)?\s*$/i,
    /<(?:strong|em)[^>]*>\s*<(?:strong|em)[^>]*>\s*(Agent\s+[^<]+)\s*<\/(?:strong|em)>\s*<\/(?:strong|em)>\s*(?:<br\s*\/?>)?\s*$/i,
    /<(?:strong|em)[^>]*>\s*<(?:strong|em)[^>]*>\s*([^<]+)\s*<\/(?:strong|em)>\s*<\/(?:strong|em)>\s*(?:<br\s*\/?>)?\s*$/i,
  ];
  for (const re of patterns) {
    const m = inner.match(re);
    const name = m?.[2]?.trim() || m?.[1]?.trim();
    if (name) return name.startsWith('Agent ') ? name : name;
  }
  return '';
}

function headlineFromH2Html(h2Inner) {
  let html = String(h2Inner ?? '');
  html = html.replace(/<span[^>]*class="[^"]*byline-alias[^"]*"[^>]*>[\s\S]*?<\/span>/gi, '');
  const agent = agentFromH2Markup(html);
  if (agent) {
    const esc = agent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    html = html
      .replace(new RegExp(`<span[^>]*>\\s*(<(?:strong|em)[^>]*>\\s*)*${esc}\\s*(<\\/(?:strong|em)>\\s*)*<\\/span>\\s*(?:<br\\s*\\/?>)?\\s*$`, 'i'), '')
      .replace(new RegExp(`<span[^>]*>\\s*${esc}\\s*<\\/span>\\s*(?:<br\\s*\\/?>)?\\s*$`, 'i'), '')
      .replace(new RegExp(`<(?:strong|em)[^>]*>\\s*<(?:strong|em)[^>]*>\\s*${esc}\\s*<\\/(?:strong|em)>\\s*<\\/(?:strong|em)>\\s*(?:<br\\s*\\/?>)?\\s*$`, 'i'), '')
      .replace(new RegExp(`\\s*${esc}\\s*$`), '');
  }
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function editorialHeadlineFromEntry(entry) {
  const h2 = entry?.editorial?.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1];
  if (h2) return headlineFromH2Html(h2);
  return entry?.article?.title || '';
}

function cardTitleAndAgent(entry) {
  const art = entry?.article || {};
  const h2m = entry?.editorial?.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
  if (!h2m) {
    const agent = formatDisplayAgent(art.authorAlias);
    return { title: art.title || '', agent, showAgent: !!agent };
  }
  const agent = agentFromH2Markup(h2m[1]) || formatDisplayAgent(art.authorAlias);
  const title = headlineFromH2Html(h2m[1]);
  const agentPlain = agent.replace(/^Agent\s+/i, '').trim();
  const showAgent = !!(agentPlain && !title.toLowerCase().includes(agentPlain.toLowerCase()));
  return { title, agent, showAgent };
}

function formatDisplayAgent(authorAlias) {
  const raw = String(authorAlias ?? '').trim();
  if (!raw) return '';
  if (/^agent\s+/i.test(raw)) return raw;
  if (raw === 'AInonymous' || /^AI/i.test(raw)) return raw;
  if (raw.length <= 3) return '';
  return `Agent ${raw.replace(/^Agent\s+/i, '').trim()}`;
}

async function ensureLatestSlotResolved() {
  if (latestSlotResolved) return;
  globalLatestPayload = await fetchEditorial(null);
  latestIdentity = storyIdentity(globalLatestPayload[0]);
  globalLatestKey = null;
  try {
    const arch = await fetchArchivePage1();
    newestArchiveKey = arch.editorials?.[0]?.cache_key || null;
    if (newestArchiveKey) {
      let k = incrementHourCacheKey(newestArchiveKey);
      let lastReal = newestArchiveKey;
      for (let i = 0; i < LATEST_PROBE_MAX && k; i++) {
        const payload = await fetchEditorial(k);
        if (payload[0] && matchesLatestIdentity(payload[0])) {
          globalLatestKey = k;
          newestRealHourlyKey = lastReal === newestArchiveKey ? k : lastReal;
          break;
        }
        if (payload[0]) lastReal = k;
        k = incrementHourCacheKey(k);
      }
      if (!newestRealHourlyKey) newestRealHourlyKey = lastReal;
    }
  } catch (err) {
    console.warn(err);
  }
  latestSlotResolved = true;
}

/** Hourly slot only — returns null when the API echoes LATEST (missing hour). */
async function fetchHourlyEditorial(cacheKey, prefetchedPayload = null) {
  if (!cacheKey || cacheKey === LATEST_SLOT_ID) return null;
  await ensureLatestSlotResolved();
  const payload = prefetchedPayload || await fetchEditorial(cacheKey);
  const row = payload?.[0];
  if (!row) return null;
  if (matchesLatestIdentity(row) && cacheKey !== newestRealHourlyKey) return null;
  return payload;
}

async function findNewestRealHourlyKey() {
  await ensureLatestSlotResolved();
  return newestRealHourlyKey || newestArchiveKey;
}

async function resolveNewerTarget(fromKey) {
  if (!fromKey || fromKey === LATEST_SLOT_ID) return null;
  await ensureLatestSlotResolved();
  if (fromKey === newestRealHourlyKey) return LATEST_SLOT_ID;
  await refreshArchiveKeyIndex();
  const idx = archiveKeysChrono.indexOf(fromKey);
  if (idx >= 0 && idx < archiveKeysChrono.length - 1) {
    const next = archiveKeysChrono[idx + 1];
    if (newestRealHourlyKey && next > newestRealHourlyKey) return LATEST_SLOT_ID;
    if (next > fromKey) return next;
  }
  if (newestRealHourlyKey && fromKey >= newestRealHourlyKey) return LATEST_SLOT_ID;
  let k = incrementHourCacheKey(fromKey);
  for (let steps = 0; k && steps < 8; steps++) {
    const payload = await fetchEditorial(k);
    if (!payload[0]) break;
    if (matchesLatestIdentity(payload[0])) {
      if (k === newestRealHourlyKey) return k;
      if (globalLatestKey && k === globalLatestKey) return LATEST_SLOT_ID;
      k = incrementHourCacheKey(k);
      continue;
    }
    return k;
  }
  return null;
}

async function resolveOlderCacheKey(fromKey) {
  if (!fromKey) return null;
  if (fromKey === LATEST_SLOT_ID) return newestRealHourlyKey;
  await ensureLatestSlotResolved();
  await refreshArchiveKeyIndex();
  const idx = archiveKeysChrono.indexOf(fromKey);
  if (idx > 0) return archiveKeysChrono[idx - 1];
  let k = decrementHourCacheKey(fromKey);
  for (let steps = 0; k && steps < 8; steps++) {
    if (await fetchHourlyEditorial(k)) return k;
    k = decrementHourCacheKey(k);
  }
  return null;
}

function registerKnownAuthor(authorAlias) {
  const raw = String(authorAlias ?? '').trim();
  if (!raw) return;
  const plain = raw.replace(/^Agent\s+/i, '').trim();
  if (plain) knownAuthorPlain.add(plain);
  knownAuthorLabels.add(raw);
  if (plain && !/^agent\s+/i.test(raw)) knownAuthorLabels.add(`Agent ${plain}`);
}

function registerKnownAuthorsFromEntry(entry) {
  const { agent } = cardTitleAndAgent(entry);
  registerKnownAuthor(agent);
  registerKnownAuthor(entry?.article?.authorAlias);
}

function splitTitleAndAgentFromGluedArchive(t, label) {
  if (!label || !t.endsWith(label)) return null;
  let title = t.slice(0, -label.length).trim();
  if (/\bAgent\s+Agent\s*$/i.test(title)) title = title.replace(/\sAgent\s*$/i, '').trim();
  if (titleEndsWithBareAgent(title) && !STATIC_AUTHOR_SEED.includes(label) && !knownAuthorLabels.has(label)) {
    return null;
  }
  return { title, agent: label };
}

/** Archive titles glue the agent onto the headline; only split when suffix matches a known author. */
function parseArchiveTileTitle(raw) {
  const t = String(raw ?? '').trim();
  if (!t) return { title: t, agent: '' };

  for (const label of [...knownAuthorLabels, ...STATIC_AUTHOR_SEED].sort((a, b) => b.length - a.length)) {
    if (!label || !t.endsWith(label) || t.length <= label.length) continue;
    const split = splitTitleAndAgentFromGluedArchive(t, label);
    if (split) return split;
  }

  const agentSuffix = t.match(/(Agent\s+[A-Z][\w\s.'♟️🤖-]+)$/);
  if (agentSuffix) {
    const suffix = agentSuffix[1].trim();
    if (!authorSuffixAllowed(suffix)) return { title: t, agent: '' };
    const split = splitTitleAndAgentFromGluedArchive(t, suffix);
    if (split) return split;
  }

  return { title: t, agent: '' };
}

function refreshArchiveTileTitles() {
  gridEl.querySelectorAll('.tile[data-raw-title]').forEach(a => {
    const tile = parseArchiveTileTitle(a.dataset.rawTitle);
    const body = a.querySelector('.tile-body');
    if (!body) return;
    body.innerHTML = `<div class="tile-title">${esc(tile.title)}</div>${tile.agent ? `<div class="tile-agent">${esc(tile.agent)}</div>` : ''}`;
  });
}

function normalizeArticle(entry, cacheKey) {
  if (!cacheKey) throw new Error('normalizeArticle requires an explicit cache key');
  const parsed = cardTitleAndAgent(entry);
  registerKnownAuthor(parsed.agent);
  registerKnownAuthor(entry.article?.authorAlias);
  const raw = entry.editorial || '';
  let editorial = raw.replaceAll('```html\n', '').replaceAll('\n```', '');
  editorial = editorial.replaceAll("<span style='display:none'", '<span class="byline-alias" style="display:none"');
  editorial = editorial.replace(/<span>(Agent\s+[^<]+)<\/span>/gi, '');
  const bodyHtml = editorial.replace(/<h2[^>]*>[\s\S]*?<\/h2>/i, '').trim();
  const nav = entry.navigation || {};
  return {
    id: cacheKey,
    title: parsed.title,
    agent: parsed.agent,
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

function normalizeLatestSlotArticle(entry) {
  const a = normalizeArticle(entry, LATEST_SLOT_ID);
  a.isLatestSlot = true;
  return a;
}

async function buildFeaturedWindow(centerKey, opts = {}) {
  const { anchorPayload = null, centerOnLatest = false } = opts;
  await ensureLatestSlotResolved();
  await refreshArchiveKeyIndex(centerKey ? [centerKey] : []);
  const byId = new Map();

  async function addHourly(key, payload) {
    if (!key || key === LATEST_SLOT_ID || byId.has(key)) return;
    const p = await fetchHourlyEditorial(key, payload);
    if (!p?.[0]) return;
    byId.set(key, normalizeArticle(p[0], key));
  }

  let center = centerKey;
  if (centerOnLatest) {
    center = await findNewestRealHourlyKey();
    if (!center) center = newestArchiveKey;
  }

  if (center) {
    const keys = archiveKeysChrono.includes(center)
      ? neighborArchiveKeys(center, WINDOW_RADIUS)
      : [center];
    await Promise.all(keys.filter(k => k !== center).map(k => addHourly(k)));
    await addHourly(center, anchorPayload);
    if (!byId.has(center) && !archiveKeysChrono.includes(center)) {
      await expandFeaturedByHour(center, byId, addHourly);
    }
  }

  if (globalLatestPayload?.[0]) {
    byId.set(LATEST_SLOT_ID, normalizeLatestSlotArticle(globalLatestPayload[0]));
  }
  return orderFeaturedArticles(byId);
}

async function expandFeaturedByHour(center, byId, addHourly) {
  await addHourly(center);
  let key = center;
  for (let i = 0; i < WINDOW_RADIUS; i++) {
    const probe = decrementHourCacheKey(key);
    if (!probe || byId.has(probe)) break;
    if (!(await fetchHourlyEditorial(probe))) break;
    await addHourly(probe);
    key = probe;
  }
  key = center;
  for (let i = 0; i < WINDOW_RADIUS; i++) {
    let probe = incrementHourCacheKey(key);
    for (let hop = 0; probe && hop < 4; hop++) {
      if (byId.has(probe)) break;
      const payload = await fetchEditorial(probe);
      if (!payload[0]) break;
      if (matchesLatestIdentity(payload[0])) break;
      await addHourly(probe);
      key = probe;
      break;
    }
    if (!probe || byId.get(key)?.id === center) break;
  }
}

function orderFeaturedArticles(byId) {
  const hourly = [...byId.keys()].filter(k => k !== LATEST_SLOT_ID).sort();
  const ordered = hourly.map(k => byId.get(k));
  if (byId.has(LATEST_SLOT_ID)) ordered.push(byId.get(LATEST_SLOT_ID));
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
  return false;
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
  const b = e.target.closest('[data-nav]'); if (b) navRelative(Number(b.dataset.nav));
});

function rebuildSideButtons() {
  scene.innerHTML = '';
  sideBtns = FEAT.map((a, i) => {
    if (a.id === LATEST_SLOT_ID) return null;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'side'; b.dataset.i = String(i);
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
    a.dataset.rawTitle = editorial.title;
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
  const atNewest = FEAT[active]?.id === LATEST_SLOT_ID;
  const hasLatestSlot = FEAT.some(a => a.id === LATEST_SLOT_ID);
  endMarker.hidden = !(geom.showSides && atNewest);
  endMarker.classList.toggle('is-separated', geom.showSides && hasLatestSlot);
  endMarker.style.pointerEvents = atNewest ? 'auto' : 'none';
  endMarker.setAttribute('role', atNewest ? 'button' : 'presentation');
  endMarker.tabIndex = atNewest ? 0 : -1;
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
    if (!b || FEAT[i]?.id === LATEST_SLOT_ID) return;
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

async function navRelative(delta, fromHash = false) {
  if (!delta) return;
  navQueue += delta;
  if (busy) return;
  await pumpNavQueue(fromHash);
}

async function pumpNavQueue(fromHash = false) {
  while (!busy && navQueue !== 0) {
    const delta = Math.sign(navQueue);
    navQueue -= delta;
    const instant = navQueue !== 0;
    busy = true;
    try {
      await stepRelative(delta, fromHash, { instant });
    } catch (err) {
      console.error(err);
    } finally {
      busy = false;
    }
  }
}

async function stepRelative(delta, fromHash = false, { instant = false } = {}) {
  await ensureLatestSlotResolved();
  const curId = FEAT[active]?.id;
  if (!curId) return;

  if (delta < 0) {
    const olderKey = await resolveOlderCacheKey(curId);
    if (!olderKey) return;
    const idx = FEAT.findIndex(a => a.id === olderKey);
    if (idx >= 0) {
      await goToIndex(idx, fromHash, { instant });
      return;
    }
    await openStory(olderKey, fromHash);
    return;
  }

  const newerKey = await resolveNewerTarget(curId);
  if (!newerKey) return;
  if (newerKey === LATEST_SLOT_ID) {
    const idx = FEAT.findIndex(a => a.id === LATEST_SLOT_ID);
    if (idx >= 0) await goToIndex(idx, fromHash, { instant });
    else await openLatestView(fromHash);
    return;
  }
  const idx = FEAT.findIndex(a => a.id === newerKey);
  if (idx >= 0) {
    await goToIndex(idx, fromHash, { instant });
    return;
  }
  await openStory(newerKey, fromHash);
}

async function goToIndex(target, fromHash = false, { instant = false } = {}) {
  if (target === active || target < 0 || target >= FEAT.length) return;
  const from = active, dir = Math.sign(target - from);
  const start = FEAT.map((_, i) => i - from), end = FEAT.map((_, i) => i - target);
  const setOff = e => { offsets = start.map((s, i) => s + (end[i] - s) * e); layoutButtons(); };
  if (!fromHash) {
    const id = FEAT[target].id;
    if (id === LATEST_SLOT_ID) history.replaceState(null, '', location.pathname + location.search);
    else history.pushState(null, '', '#' + id);
  }
  const hadFocus = document.activeElement && document.activeElement.closest('.side, .card-nav') ? document.activeElement : null;

  if (gl && !instant && !reduced) {
    const backSnap = snapFor(target);
    cardEl.style.opacity = '0';
    await gl.flipTo(target, dir, backSnap, setOff);
    active = target; renderCard(cardEl, target); cardEl.style.opacity = '1';
    gl.endFlip(backSnap);
  } else if (instant || reduced) {
    if (!instant && reduced) {
      cardEl.classList.add('fade-out'); scene.classList.add('fading');
      await wait(180);
    }
    active = target; renderCard(cardEl, target); setOff(1);
    cardEl.style.opacity = '1';
    cardEl.classList.remove('fade-out'); scene.classList.remove('fading');
  } else {
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
  const activeId = FEAT[active]?.id;
  document.title = activeId && activeId !== LATEST_SLOT_ID
    ? `botz.ai - GenAI News - ${activeId}`
    : 'botz.ai - GenAI News';
  if (storyAnnouncer) storyAnnouncer.textContent = FEAT[active].title;
  trackPageView();
  logCenteredKey();
  if (hadFocus && hadFocus.classList.contains('side')) { const nb = sideBtns[Number(hadFocus.dataset.i)]; (nb?.hidden ? cardEl.querySelector('.card-title') : nb)?.focus?.(); }
  else if (hadFocus) { const b = cardEl.querySelector(`[data-nav="${dir}"]`); (b && !b.disabled ? b : cardEl.querySelector(`[data-nav="${-dir}"]`))?.focus(); }
}

async function go(target, fromHash = false) {
  if (target === active) return;
  if (target < 0 || target >= FEAT.length) return;
  if (busy) return;
  busy = true;
  try {
    await goToIndex(target, fromHash, { instant: false });
  } finally {
    busy = false;
  }
}
const wait = ms => new Promise(r => setTimeout(r, ms));
function animate(ms, fn) {
  return new Promise(res => { const t0 = performance.now(); const f = now => { const t = Math.min(1, (now - t0) / ms); fn(t); t < 1 ? requestAnimationFrame(f) : res(); }; requestAnimationFrame(f); });
}

window.addEventListener('keydown', e => {
  if (e.altKey || e.ctrlKey || e.metaKey || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  if (e.key === 'ArrowRight') { e.preventDefault(); navRelative(1); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); navRelative(-1); }
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
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.3) navRelative(dx < 0 ? 1 : -1);
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
  logCenteredKey();
  const id = FEAT[active]?.id;
  if (id === LATEST_SLOT_ID) {
    history.replaceState(null, '', location.pathname + location.search);
  } else if (!omitHash && id) {
    if (!fromHash) history.pushState(null, '', '#' + id);
  } else if (!fromHash && omitHash) {
    history.replaceState(null, '', location.pathname + location.search);
  }
  document.title = id && id !== LATEST_SLOT_ID
    ? `botz.ai - GenAI News - ${id}`
    : 'botz.ai - GenAI News';
  if (storyAnnouncer) storyAnnouncer.textContent = FEAT[active].title;
  trackPageView();
  refreshArchiveTileTitles();
}

async function openLatestView(fromHash = false) {
  window.scrollTo(0, 0);
  stage.classList.add('is-loading');
  try {
    await ensureLatestSlotResolved();
    const feat = await buildFeaturedWindow(null, { centerOnLatest: true });
    const idx = feat.findIndex(a => a.id === LATEST_SLOT_ID);
    await applyFeaturedState(feat, idx >= 0 ? idx : feat.length - 1, fromHash, { omitHash: true });
  } catch (err) {
    console.error(err);
    toast('Failed to load GenAI News.');
  } finally {
    stage.classList.remove('is-loading');
  }
}

async function openStory(cacheKey, fromHash = false) {
  window.scrollTo(0, 0);
  await ensureLatestSlotResolved();
  if (!cacheKey) {
    await openLatestView(fromHash);
    return;
  }
  if (cacheKey === globalLatestKey && cacheKey !== newestRealHourlyKey) {
    await openLatestView(fromHash);
    return;
  }
  const existing = FEAT.findIndex(a => a.id === cacheKey);
  if (existing >= 0) {
    if (existing !== active) await goToIndex(existing, fromHash, { instant: navQueue !== 0 });
    return;
  }
  stage.classList.add('is-loading');
  cardEl.classList.add('card-loading');
  cardEl.setAttribute('aria-busy', 'true');
  const ownedBusy = !busy;
  if (ownedBusy) busy = true;
  try {
    const anchorPayload = await fetchEditorial(cacheKey);
    await ensureLatestSlotResolved();
    if (!anchorPayload[0]) {
      await openLatestView(fromHash);
      return;
    }
    if (matchesLatestIdentity(anchorPayload[0]) && cacheKey !== newestRealHourlyKey && cacheKey !== globalLatestKey) {
      await openLatestView(fromHash);
      return;
    }
    const feat = await buildFeaturedWindow(cacheKey, { anchorPayload });
    let activeIndex = feat.findIndex(a => a.id === cacheKey);
    if (activeIndex < 0) activeIndex = Math.max(0, feat.findIndex(a => a.id === LATEST_SLOT_ID) - 1);
    await applyFeaturedState(feat, activeIndex, fromHash);
  } catch (err) {
    console.error(err);
    toast('Could not load that story.');
  } finally {
    stage.classList.remove('is-loading');
    cardEl.classList.remove('card-loading');
    cardEl.removeAttribute('aria-busy');
    if (ownedBusy) busy = false;
    await pumpNavQueue(fromHash);
  }
}

async function openStoryFromLatest(fromHash) {
  await openLatestView(fromHash);
  if (!fromHash && !location.hash) history.replaceState(null, '', location.pathname + location.search);
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
  editorialRequestCount = 0;
  editorialUrlsSeen.clear();
  seedStaticAuthors();
  stage.classList.add('is-loading');
  try {
    const arch = await fetchArchivePage1();
    const archItems = arch.editorials || [];
    await refreshArchiveKeyIndex();
    appendArchiveTiles(archItems);
    refreshArchiveTileTitles();
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
endMarker?.addEventListener('click', () => {
  const idx = FEAT.findIndex(a => a.id === LATEST_SLOT_ID);
  if (idx >= 0 && active !== idx) go(idx);
});
endMarker?.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); endMarker?.click(); }
});
let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(relayout, 120); });
wide.addEventListener('change', relayout);
window.__botzCarousel = { go, navRelative, openStory, get active() { return active; }, get busy() { return busy; }, get navQueue() { return navQueue; }, get navLog() { return window.__navLog; }, get centerKey() { return FEAT[active]?.id; }, get featIds() { return FEAT.map(a => a.id); }, get newestRealHourlyKey() { return newestRealHourlyKey; }, get mode() { return gl ? 'webgl' : (reduced ? 'reduced' : 'css'); }, get editorialRequestCount() { return editorialRequestCount; }, get latestSlotId() { return LATEST_SLOT_ID; }, ready: true };
