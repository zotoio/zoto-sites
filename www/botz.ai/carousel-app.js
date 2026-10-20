// botz.ai GenAI News — WebGL cover-flow carousel + flat HTML centre card (production).
const $ = (s, r = document) => r.querySelector(s);
const stage = $('#stage'), cardEl = $('#card'), measureEl = $('#measure'), scene = $('#scene'), arrowsEl = $('#stage-arrows');
const canvas = $('#gl');
const endMarker = $('#end-marker');
const storyAnnouncer = $('#story-announcer');
const gridEl = $('#grid');
const browseEl = $('#browse');
/** Skeleton markup ships in index.html (first paint); reuse it for later loads. */
const ARTICLE_SKELETON_HTML = cardEl.innerHTML;
/** Card body skeleton reused when a flick outruns the prefetch buffer. */
const CARD_SKELETON_BODY = cardEl.querySelector('.skel-body')?.outerHTML || '';
const loadingEl = $('#loading');

const params = new URLSearchParams(location.search);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches || params.get('mode') === 'reduced';
const wide = matchMedia('(min-width: 1600px)');
/**
 * Small screens use the earlier (pre-carousel, eded488) single-story flow: the full editorial renders
 * inline at the top of the page and tapping an archive tile loads that story there. No Older/Newer card
 * navigation, no "Read more" clamp, no WebGL/side cards, no swipe.
 */
const small = matchMedia('(max-width: 760px)');
let mobileMode = small.matches;
/** Bumped whenever the layout mode flips; in-flight loads started under an older epoch must not render. */
let layoutEpoch = 0;
const layoutIsStale = epoch => epoch !== layoutEpoch;
/** Story a desktop openStory() is still loading (its hash is only pushed once it renders). */
let pendingDesktopKey = null;
/* Module state read by input handlers must be initialised before the top-level `await boot()`: listeners are
 * live during boot, and a key press that reaches a later `let` would hit its temporal dead zone and be lost. */
let autoplayHistoryReplace = false;   // the next ringMove is an autoplay step (replaceState, not pushState)
let autoplayLoad = null;              // ./autoplay.js import, once started
let rz;                               // resize debounce timer
const FLIP_MS = 520;
const PERSP = 2200;
// image shape shared with the grid tiles (style.css --img-ar 7 / 8, --img-hw): height = width * IMG_HW
const IMG_HW = 8 / 7;
const SIDE_TEX_W = 512, SIDE_TEX_IMG_H = Math.round(SIDE_TEX_W * IMG_HW), SIDE_TEX_H = SIDE_TEX_IMG_H + 192;   // image + title/agent band
const SIDE_W0 = 440, SIDE_ASPECT = SIDE_TEX_H / SIDE_TEX_W;
const SLOTS = { S: [1, 0.8, 0.65, 0.52, 0.42], R: [0, 40, 40, 40, 40], Z: [0, -70, -150, -230, -310],
                DIM: [1, 0.8, 0.6, 0.44, 0.3], BIAS: [0, 0.2, 0.9, 1.7, 2.4] };
const useLocalStubs = params.get('live') !== '1' && ['localhost', '127.0.0.1'].includes(window.location.hostname);

/** No-key /editorials is a dedicated LATEST slot (empty URL hash when centered). */
const LATEST_SLOT_ID = '__latest__';
let globalLatestPayload = null;
/** { generated_at, headline } — never match by source article.title alone. */
let latestIdentity = null;
let newestArchiveKey = null;
/** LATEST /editorials matches the archive page-1 top story (no separate Latest slot). */
let latestIsArchiveTop = false;
/** Distinct LATEST newer than archive top — shown as __latest__ with empty hash. */
let showLatestSlot = false;
let latestSlotResolved = false;
let archivePagesLoaded = 0;
const ARCHIVE_PAGE_SEARCH_CAP = 8;
/** Keys of the first grid batch (newest stories); later batches are not kept here. */
const archiveKeysByPage = {};

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

/** Small LRU map (Map insertion order = recency). `keep(k, v)` pins entries during a trim; onEvict releases them. */
class Lru {
  constructor(max, onEvict = null) { this.max = max; this.onEvict = onEvict; this.m = new Map(); }
  get size() { return this.m.size; }
  has(k) { return this.m.has(k); }
  get(k) { if (!this.m.has(k)) return undefined; const v = this.m.get(k); this.m.delete(k); this.m.set(k, v); return v; }
  peek(k) { return this.m.get(k); }
  set(k, v, keep) { const old = this.m.get(k); this.m.delete(k); this.m.set(k, v); if (old !== undefined && old !== v) this.onEvict?.(k, old); this.trim(keep); return this; }
  delete(k) { if (!this.m.has(k)) return false; const v = this.m.get(k); this.m.delete(k); this.onEvict?.(k, v); return true; }
  trim(keep, max = this.max) {
    if (this.m.size <= max) return;
    for (const [k, v] of this.m) {
      if (this.m.size <= max) break;
      if (keep?.(k, v)) continue;
      this.m.delete(k); this.onEvict?.(k, v);
    }
  }
  keys() { return this.m.keys(); }
  values() { return this.m.values(); }
  entries() { return this.m.entries(); }
  clear() { for (const [k, v] of [...this.m]) { this.m.delete(k); this.onEvict?.(k, v); } }
}
/** Give the browser a chance to paint / handle input between chunks of work (INP). */
const yieldToMain = () => (globalThis.scheduler?.yield ? globalThis.scheduler.yield() : new Promise(r => setTimeout(r, 0)));
const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));

/** In-flight JSON requests keyed by URL (dedupes parallel fetches). Settled bodies live in the day store, not here. */
const jsonFlight = new Map();

function fetchJsonMemo(url, stubUrl) {
  if (!jsonFlight.has(url)) {
    const p = fetchJsonWithLocalStub(url, stubUrl);
    jsonFlight.set(url, p);
    p.then(() => jsonFlight.delete(url), () => jsonFlight.delete(url));
  }
  return jsonFlight.get(url);
}

let FEAT = [];   // oldest -> newest
let active = 0;
let offsets = [];
let busy = false;
let navQueue = 0;
window.__navLog = [];

function logCenteredKey() {
  const id = FEAT[active]?.id || LATEST_SLOT_ID;
  window.__navLog.push(id);
  if (window.__navLog.length > 400) window.__navLog.splice(0, window.__navLog.length - 200);   // bounded test log
  console.debug('[nav]', id);
}
let geom = { W: 0, H: 0, cx: 0, cy: 0, cardW: 0, cardH: 0, k: 1, sideW: 0, sideH: 0, floorY: 0, showSides: true };
let sideBtns = [];
let archivePage = 1;
let archiveLoading = false;
let archiveHasMore = true;

async function fetchJsonWithLocalStub(url, stubUrl) {
  const requestOptions = useLocalStubs ? { cache: 'no-store' } : {};
  try {
    const response = await fetch(url, requestOptions);
    if (!response.ok) throw new Error(`Request failed: ${response.status}`);
    return response.json();
  } catch (error) {
    if (!useLocalStubs) throw error;
    console.warn(`Using local stub for ${url}`, error);
    const response = await fetch(stubUrl, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Stub request failed: ${response.status}`);
    return response.json();
  }
}

/* ---------------- shared archive store ----------------
 * The grid AND the carousel read the same date-paged JSON, one request per URL (memoised in jsonFlight):
 *   /archive/index               { total, days: [{ date, count }] }, newest day first        (short TTL)
 *   /archive/latest              the newest day, same body as /archive/day/<date>          (short TTL)
 *   /archive/day/<date>?n=<count> { date, count, older, editorials: [{ cache_key, title, ..., entry }] }
 *                                past days are immutable for a given count (the n in the URL)
 * Every story's full text rides in its day (`entry`), so opening a story, a grid tile or a carousel card never
 * needs a request of its own. Story data stays here for the session; the ring only evicts textures and images. */
let editorialRequestCount = 0;            // archive JSON requests issued (index, latest and day files)
const archiveUrlsSeen = new Set();
let archiveIndex = null;                  // { total, days: [{ date, count }], start: number[], dayPos: Map }
let archiveIndexFlight = null;
const dayData = new Lru(Infinity);        // date -> day JSON; trimmed by story count (DAY_STORE_MAX_STORIES)
const dayFlight = new Map();              // date -> Promise<day JSON | null> (in flight)
const storyEntries = new Map();           // cache key -> { article, editorial } for the days held in dayData
/** The store holds whole days, newest-used first, up to this many stories. Days around the carousel position and
 *  the newest day are pinned; an evicted day is simply fetched again (past days are immutable and HTTP-cached). */
const DAY_STORE_MAX_STORIES = Math.max(50, Number(params.get('daystore')) || 600);   // ?daystore= lowers it for tests
let dayStoreStories = 0;
const dayStoreStats = { evictedDays: 0 };

function keyDate(key) {
  return /^(\d{4}-\d{2}-\d{2})-\d{2}(?:-\d{13})?$/.exec(key || '')?.[1] || null;
}
function archiveJson(url, stubUrl) {
  if (useLocalStubs) url = stubUrl;   // localhost without ?live=1: the checked-in stubs only
  if (!archiveUrlsSeen.has(url)) { archiveUrlsSeen.add(url); editorialRequestCount++; }
  return fetchJsonMemo(url, stubUrl);
}
function dropDay(date, day) {
  dayStoreStories -= day?.editorials?.length || 0;
  for (const it of day?.editorials || []) if (it?.cache_key) storyEntries.delete(it.cache_key);
  dayStoreStats.evictedDays++;
}
dayData.onEvict = dropDay;
/** Dates that must stay in the store: the newest day, and the days around the carousel centre and buffer. */
function pinnedDays() {
  const pins = new Set();
  if (archiveIndex?.days[0]) pins.add(archiveIndex.days[0].date);
  if (archiveIndex && ringPos >= 0 && ringTotal) {
    const reach = RING_KEEP + RING_PAGE_AHEAD;
    for (let d = -reach; d <= reach; d++) { const r = ringWrap(ringPos + d); if (r < ringTotal) pins.add(ringDayDate(ringDayOf(r))); }
  }
  for (const a of FEAT) { const dt = keyDate(a.key || a.id); if (dt) pins.add(dt); }
  return pins;
}
function trimDayStore() {
  if (dayStoreStories <= DAY_STORE_MAX_STORIES) return;
  const pins = pinnedDays();
  for (const [date, day] of [...dayData.entries()]) {
    if (dayStoreStories <= DAY_STORE_MAX_STORIES) break;
    if (!pins.has(date)) dayData.delete(date);
  }
}
function ingestDay(day) {
  if (!day?.date || !Array.isArray(day.editorials)) return null;
  const old = dayData.peek(day.date);
  if (old) { dayStoreStories -= old.editorials.length; dayData.m.delete(day.date); }
  dayData.set(day.date, day);
  dayStoreStories += day.editorials.length;
  for (const it of day.editorials) if (it?.cache_key && it.entry) storyEntries.set(it.cache_key, it.entry);
  trimDayStore();
  return day;
}
let latestFlight = null;
function fetchArchiveLatest() {
  if (!latestFlight) {
    latestFlight = archiveJson('/archive/latest', '/stubs/archive/latest.json').then(d => {
      noteGeneration(d?.generation);
      const day = ingestDay(d);
      // the newest day is now in the store: its /archive/day/<date> URL is never fetched separately
      if (day && !dayFlight.has(day.date)) dayFlight.set(day.date, Promise.resolve(day));
      return day;
    }).catch(err => { latestFlight = null; throw err; });
  }
  return latestFlight;
}
function setArchiveIndex(days) {
  const start = [], dayPos = new Map();
  let total = 0;
  days.forEach((d, i) => { start.push(total); total += d.count; dayPos.set(d.date, i); });
  archiveIndex = { total, days, start, dayPos };
}
function ensureArchiveIndex() {
  if (archiveIndex) return Promise.resolve(archiveIndex);
  if (!archiveIndexFlight) {
    archiveIndexFlight = Promise.all([
      archiveJson('/archive/index', '/stubs/archive/index.json'),
      fetchArchiveLatest().catch(err => { console.warn(err); return null; }),
    ]).then(([raw, latest]) => {
      noteGeneration(raw?.generation);
      const days = (raw?.days || []).filter(d => d?.date && d.count > 0).map(d => ({ date: d.date, count: d.count }));
      // index and latest load in parallel and can straddle a new story: the day body wins for its own date
      if (latest?.date) {
        const i = days.findIndex(d => d.date === latest.date);
        if (i >= 0) days[i].count = latest.count;
        else if (!days.length || latest.date > days[0].date) days.unshift({ date: latest.date, count: latest.count });
      }
      setArchiveIndex(days);
      return archiveIndex;
    }).catch(err => { archiveIndexFlight = null; throw err; });
  }
  return archiveIndexFlight;
}
/** Day index holding the story `d` places from the newest (0 = newest). */
function dayIndexForOffset(d) {
  const st = archiveIndex.start;
  let lo = 0, hi = st.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (st[mid] <= d) lo = mid; else hi = mid - 1; }
  return lo;
}
function loadDay(date) {
  if (dayData.has(date)) return Promise.resolve(dayData.get(date));
  if (!dayFlight.has(date)) {
    const p = ensureArchiveIndex().then(ix => {
      const i = ix.dayPos.get(date);
      if (i == null) return null;   // no stories that day: nothing to fetch
      return archiveJson(`/archive/day/${date}?n=${ix.days[i].count}`, `/stubs/archive/day/${date}.json`).then(ingestDay);
    });
    dayFlight.set(date, p);
    p.then(() => dayFlight.delete(date), () => dayFlight.delete(date));   // settled: the day lives in dayData
  }
  return dayFlight.get(date);
}
const dayKeysMemo = new WeakMap();   // day object -> its cache keys (ringKeyAt runs in hot loops)
function dayKeysOf(date) {
  const day = dayData.peek(date);
  if (!day) return [];
  let keys = dayKeysMemo.get(day);
  if (!keys) { keys = (day.editorials || []).map(e => e.cache_key).filter(Boolean); dayKeysMemo.set(day, keys); }
  return keys;
}

/** [entry] for a story (the newest story when no key), straight from the shared day store. */
async function fetchStoryPayload(cacheKey) {
  if (!cacheKey) {
    const day = await fetchArchiveLatest().catch(err => { console.warn(err); return null; });
    const it = day?.editorials?.[0];
    if (it?.entry) return [it.entry];
    // no /archive/latest: fall back to the newest day in the index
    const ix = await ensureArchiveIndex().catch(() => null);
    const d = ix?.days[0] && await loadDay(ix.days[0].date).catch(() => null);
    return d?.editorials?.[0]?.entry ? [d.editorials[0].entry] : [];
  }
  if (!storyEntries.has(cacheKey)) {
    const date = keyDate(cacheKey);
    if (date) await loadDay(date).catch(err => console.warn(err));
  }
  const e = storyEntries.get(cacheKey);
  return e ? [e] : [];
}
function fetchLatestEditorial() { return fetchStoryPayload(null); }
function fetchValidatedEditorial(cacheKey) { return fetchStoryPayload(cacheKey); }
function fetchEditorial(cacheKey) { return fetchStoryPayload(cacheKey); }
/** Random story for the dice: a random archive position, resolved through the same day store. */
async function randomStoryKey() {
  const ix = await ensureArchiveIndex();
  const cur = FEAT[active]?.key || FEAT[active]?.id;
  for (let t = 0; t < 4 && ix.total > 1; t++) {
    const d = Math.floor(Math.random() * ix.total), i = dayIndexForOffset(d);
    const day = await loadDay(ix.days[i].date).catch(() => null);
    const key = day?.editorials?.[d - ix.start[i]]?.cache_key;
    if (key && key !== cur) return key;
  }
  return null;
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

function generatedAtUtcMs(entry) {
  const ga = entry?.article?.generated_at || '';
  const m = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})/.exec(ga);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

/** generated_at in [keyHour - 1h, keyHour + 1h) — hourly stories often generate just before the key hour. */
function editorialBelongsToCacheKey(entry, cacheKey) {
  const keyMs = cacheKeyToUtcMs(cacheKey);
  const genMs = generatedAtUtcMs(entry);
  if (keyMs == null || genMs == null) return false;
  return genMs >= keyMs - 3600000 && genMs < keyMs + 3600000;
}

function isFutureCacheKey(cacheKey) {
  const ms = cacheKeyToUtcMs(cacheKey);
  if (ms == null) return false;
  const now = new Date();
  const currentHourMs = Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(), 0, 0
  );
  return ms > currentHourMs;
}

/* ---------------- More stories grid: whole days, newest first, at least GRID_BATCH stories per batch ---------------- */
const GRID_BATCH = 24;
let gridNextDay = 0;
/** In-flight grid batch; concurrent callers wait for it instead of returning before data exists. */
let archiveFlight = null;
async function ensureArchivePageLoaded(page) {
  while (page > archivePagesLoaded && archiveFlight) {
    const f = archiveFlight;
    await f.promise;
    if (f.page === page) return;
  }
  if (page <= archivePagesLoaded) return;
  const promise = loadArchivePageIntoGrid(page);
  archiveFlight = { page, promise };
  try {
    await promise;
  } finally {
    if (archiveFlight?.promise === promise) archiveFlight = null;
  }
}
async function loadArchivePageIntoGrid(page) {
  archiveLoading = true;
  try {
    const ix = await ensureArchiveIndex();
    const dates = [];
    for (let i = gridNextDay, n = 0; i < ix.days.length && n < GRID_BATCH; i++) { dates.push(ix.days[i].date); n += ix.days[i].count; }
    const days = await Promise.all(dates.map(d => loadDay(d).catch(err => { console.warn(err); return null; })));
    const items = days.flatMap(d => d?.editorials || []);
    if (page === 1) archiveKeysByPage[1] = items.map(e => e.cache_key).filter(Boolean);
    appendArchiveTiles(items);
    refreshArchiveTileTitles();
    hideRepeatedFirstTile();
    gridNextDay += dates.length;
    archiveHasMore = gridNextDay < ix.days.length;
    archivePage = page;
    archivePagesLoaded = page;
    ringFeedFromGrid(items.length);
  } catch (err) {
    console.error(err);
  } finally {
    archiveLoading = false;
  }
}

let latestSlotFlight = null;
function ensureLatestSlotResolved() {
  if (latestSlotResolved) return Promise.resolve();
  if (!latestSlotFlight) latestSlotFlight = resolveLatestSlot().finally(() => { latestSlotFlight = null; });
  return latestSlotFlight;
}
async function resolveLatestSlot() {
  // the newest day and the first grid batch load in parallel; the newest story IS the archive top, so there is
  // never a separate Latest slot any more
  await Promise.all([
    fetchArchiveLatest().catch(err => console.warn(err)),
    ensureArchivePageLoaded(1).catch(err => console.warn(err)),
  ]);
  globalLatestPayload = await fetchLatestEditorial();
  latestIdentity = storyIdentity(globalLatestPayload[0]);
  newestArchiveKey = dayData.get(archiveIndex?.days[0]?.date)?.editorials?.[0]?.cache_key || archiveKeysByPage[1]?.[0] || null;
  latestIsArchiveTop = !!newestArchiveKey;
  showLatestSlot = false;
  latestSlotResolved = true;
}

/* ---------------- desktop carousel ring: wrap-around, on-demand loading, rolling prefetch buffer ----------------
 * Chrono positions 0..n-1 (0 = oldest archive story, n-1 = newest; the LATEST slot is n-1 when it is shown).
 * Older from 0 wraps to n-1 and Newer from n-1 wraps to 0. Only the archive pages that hold the stories around
 * the centre are fetched (page 1 + whichever page a position falls in; the oldest page comes from the archive
 * totals), and only ~RING_BUFFER stories each way are loaded ahead of the user. */
const RING_VISIBLE = 3;      // side cards each way (matches the slot layout)
const RING_PRERENDER = 3;    // extra cards each way kept in the window (3: fast queued flicks outran 2) (meshes + uploaded textures, alpha 0 off the
                             // edge) so a card sliding in from an edge fades in already textured instead of popping in
const RING_RADIUS = RING_VISIBLE + RING_PRERENDER;
const RING_BUFFER = RING_RADIUS + 1;   // stories prefetched ahead in BOTH directions (crosses the wrap point): past the window
const RING_PAGE_AHEAD = 6;   // also fetch the archive page holding positions this far past the buffer
const RING_KEEP = 12;        // loaded stories further than this from the centre are evicted
const RING_CONCURRENCY = 4;  // parallel story prefetches
let ringTotal = 0, ringReady = false, ringInitFlight = null;
const ringStories = new Map();      // cache key -> { r, text, article, failed, promise } (bounded by RING_KEEP)
let ringPos = -1;                   // chrono position of the centred story
let wrapCrossed = false;            // seam cards stay skeletons until the user has flicked across the wrap point
let ringQueue = [], ringInflight = 0, ringOpenSeq = 0;
const ringStats = { storyLoads: 0, pageLoads: 0, evicted: 0, skeletonCentres: 0, fedFromGrid: 0, centreFirstOpens: 0 };

function ringLen() { return ringTotal + (showLatestSlot && globalLatestPayload?.[0] ? 1 : 0); }
function ringWrap(r) { const n = ringLen(); return n ? ((r % n) + n) % n : 0; }
function ringDist(a, b) { const n = ringLen(); if (!n) return 0; const d = Math.abs(a - b) % n; return Math.min(d, n - d); }
/** Archive day (index into archiveIndex.days) that holds chrono position r. */
function ringDayOf(r) { return dayIndexForOffset(ringTotal - 1 - r); }
function ringKeyAt(r) {
  if (r === ringTotal && ringLen() > ringTotal) return LATEST_SLOT_ID;
  if (r < 0 || r >= ringTotal || !archiveIndex) return null;
  const i = ringDayOf(r);
  return dayKeysOf(archiveIndex.days[i].date)[ringTotal - 1 - r - archiveIndex.start[i]] || null;
}
function ringIndexOfKey(key) {
  if (key === LATEST_SLOT_ID) return ringLen() > ringTotal ? ringTotal : -1;
  const date = keyDate(key), i = archiveIndex?.dayPos.get(date);
  if (i == null) return -1;
  const j = dayKeysOf(date).indexOf(key);
  return j < 0 ? -1 : ringTotal - 1 - (archiveIndex.start[i] + j);
}
const ringDayDate = i => archiveIndex.days[i].date;
const ringDayPending = i => !dayData.has(ringDayDate(i)) && !dayFlight.has(ringDayDate(i));
function ringLoadDay(i) {
  if (ringDayPending(i)) ringStats.pageLoads++;   // the grid may already have it (shared store): then no request
  return loadDay(ringDayDate(i)).then(() => dayKeysOf(ringDayDate(i)));
}
/** Grid batches land in the same store the ring reads from: re-run the buffer so it picks them up at once. */
function ringFeedFromGrid(count) {
  ringStats.fedFromGrid += count;
  if (ringReady && ringPos >= 0 && !mobileMode) ringSchedule();
}
function ringInit() {
  if (ringReady) return Promise.resolve();
  if (!ringInitFlight) {
    ringInitFlight = (async () => {
      await ensureLatestSlotResolved();
      const ix = await ensureArchiveIndex();
      ringTotal = ix.total;
      ringReady = true;
    })().finally(() => { ringInitFlight = null; });
  }
  return ringInitFlight;
}
/** Chrono position of a cache key: its date names the one day file to look in. */
async function ringLocate(key) {
  await ringInit();
  const r = ringIndexOfKey(key);
  if (r >= 0 || !ringTotal) return r;
  const i = archiveIndex.dayPos.get(keyDate(key));
  if (i == null) return -1;
  await ringLoadDay(i).catch(err => console.warn(err));
  return ringIndexOfKey(key);
}
function loadStoryImage(a) {
  return new Promise(res => {
    if (!a.img) { imgs.set(a.id, null, keepImg); res(); return; }
    const have = imgs.get(a.id);
    if (have?.complete && have.src) { res(); return; }
    const done = () => { clearTimeout(t); res(); };
    const t = setTimeout(done, 4000);
    imgs.set(a.id, loadTextureImage(a.img, done), keepImg);
  });
}
async function loadRingText(key) {
  if (key === LATEST_SLOT_ID) return normalizeLatestSlotArticle(globalLatestPayload[0]);
  const p = await fetchStoryPayload(key);   // from the shared day store (no per-story request)
  if (!p[0]) throw new Error(`story ${key} unavailable`);
  return normalizeArticle(p[0], key);
}
function unavailableArticle(key) {
  return { id: key, title: 'Story unavailable', agent: '', showAgent: false, bodyHtml: '<p>This story could not be loaded. Try Older or Newer.</p>',
    generated: '', generatedAt: '', source: '', published: '', origTitle: '', url: '', hn: '', img: '', navigation: {}, unavailable: true };
}
function ringEnsureStory(r) {
  const key = ringKeyAt(r);
  if (!key) return Promise.resolve(null);
  let st = ringStories.get(key);
  if (st) { st.r = r; return st.promise; }
  st = { r, text: null, article: null, failed: false, promise: null, textPromise: null };
  ringStories.set(key, st);
  ringStats.storyLoads++;
  // text first (the centre card paints from it), then the image: side cards wait for both, so a flick never
  // lands on a half-drawn side card
  st.textPromise = loadRingText(key).then(a => {
    if (ringStories.get(key) !== st) return a;
    st.text = a;
    // an unbuffered centre paints from its text right away (7:8 image box reserved, the <img> streams in);
    // side cards still wait for the image below
    if (FEAT[active]?.placeholder && FEAT[active].key === key) ringStoryArrived(key);
    return a;
  });
  st.promise = st.textPromise
    .then(async a => { await loadStoryImage(a); return a; })
    .then(a => {
      if (ringStories.get(key) === st) { st.article = a; ringStoryArrived(key); if (FEAT[active] === a) centreImageArrived(a); }
      return a;
    })
    .catch(err => { console.warn(err); if (ringStories.get(key) === st) { st.failed = true; ringStoryArrived(key); } return null; });
  st.textPromise.catch(() => {});
  return st.promise;
}
/** Resolves once the story at r has its text (or failed); does not wait for its image. */
function ringEnsureText(r) {
  const key = ringKeyAt(r);
  if (!key) return Promise.resolve(null);
  if (!ringStories.has(key)) ringEnsureStory(r);
  const st = ringStories.get(key);
  return st.textPromise.catch(() => null);
}
/** Rolling buffer: centre first, then +-1, +-2 ... +-RING_BUFFER (wrapping). Re-run on every move. */
function ringSchedule() {
  const n = ringLen();
  if (!n || ringPos < 0 || mobileMode) return;
  // during fast flicks the queue centres on where the queued steps will land, so that story loads first
  const focus = ringWrap(ringPos + navQueue);
  const order = [focus], seen = new Set(order);
  for (let d = 1; d <= RING_BUFFER; d++) for (const sgn of [Math.sign(navQueue) || 1, -(Math.sign(navQueue) || 1)]) {
    const r = ringWrap(focus + sgn * d);
    if (!seen.has(r)) { seen.add(r); order.push(r); }
  }
  ringQueue = order;   // replaces the old queue: positions the user has left behind are dropped before they start
  if (ringKeyAt(focus) && !ringStories.has(ringKeyAt(focus))) ringEnsureStory(focus);   // landing story first, outside the concurrency limit
  const days = new Set();
  for (let d = 0; d <= RING_BUFFER + RING_PAGE_AHEAD; d++) for (const sgn of [1, -1]) {
    const r = ringWrap(focus + sgn * d);
    if (r < ringTotal) days.add(ringDayOf(r));
  }
  for (const i of days) if (ringDayPending(i)) ringLoadDay(i).then(() => ringSchedule(), err => console.warn(err));
  ringPump();
  ringEvict();
}
function ringPump() {
  while (ringInflight < RING_CONCURRENCY && ringQueue.length) {
    const r = ringQueue.shift(), key = ringKeyAt(r);
    if (!key || ringStories.has(key)) continue;   // unknown key: its page is on the way and re-schedules
    ringInflight++;
    ringEnsureStory(r).finally(() => { ringInflight--; ringPump(); });
  }
}
function ringEvict() {
  for (const [key, st] of ringStories) {
    if (ringDist(st.r, ringPos) <= RING_KEEP || FEAT.some(a => a.id === key)) continue;
    ringStories.delete(key);
    // the day store keeps (or evicts) the text on its own terms; the image and its GPU texture go now
    imgs.delete(key);
    gl?.evictStory(key);
    ringStats.evicted++;
  }
}
/** Positions across the wrap point from the centre. While the latest story is centred (and until the user has
 *  crossed the seam once) they show skeleton side cards instead of the wrapped-around oldest stories. */
function ringSeamMasked(o) {
  const n = ringLen();
  const crosses = ringPos + o >= n || ringPos + o < 0;
  return crosses && (ringPos === n - 1 || !wrapCrossed);
}
function ringEntry(o) {
  const r = ringWrap(ringPos + o), key = ringKeyAt(r);
  const st = key ? ringStories.get(key) : null;
  const masked = o !== 0 && ringSeamMasked(o);
  // the centre shows as soon as its text is in (its <img> loads on its own); side cards wait for the image too
  const ready = st?.article || (o === 0 ? st?.text : null);
  if (!masked && ready) { ready.ringIndex = r; return ready; }
  if (!masked && st?.failed) { const u = unavailableArticle(key); u.ringIndex = r; return u; }
  return { id: key || `__pending__${r}`, key, placeholder: true, seam: masked, ringIndex: r, title: '', agent: '', img: '' };
}
function ringRadii() {
  const n = ringLen();
  const left = Math.min(RING_RADIUS, Math.floor((n - 1) / 2));
  return [left, Math.min(RING_RADIUS, n - 1 - left)];
}
function buildRingWindow() {
  const [L, R] = ringRadii(), feat = [];
  for (let o = -L; o <= R; o++) feat.push(ringEntry(o));
  return { feat, active: L };
}
/** Re-centre the window on ringPos (after a move, or when a buffered story lands). Same slots, so nothing jumps. */
function ringRefresh() {
  if (mobileMode || ringPos < 0 || !FEAT.length) return;
  const prevCentre = FEAT[active];
  const focusSide = document.activeElement?.closest?.('.side')?.dataset.i;
  const w = buildRingWindow();
  FEAT = w.feat; active = w.active; offsets = FEAT.map((_, i) => i - active);
  rebuildSideButtons();
  if (gl) gl.rebuildSideMeshes();
  const centreChanged = FEAT[active] !== prevCentre;
  if (centreChanged) {
    renderCard(cardEl, active);   // the arrows are outside the card, so a focused arrow keeps its focus
  }
  fixCardHeight({ sticky: true }); computeGeom(); layoutButtons(); updateReadMoreState();
  if (focusSide != null) (sideBtns[Number(focusSide)] && !sideBtns[Number(focusSide)].hidden ? sideBtns[Number(focusSide)] : cardEl.querySelector('.card-title'))?.focus?.();
  if (gl) {
    gl.resize();
    // only re-snapshot the flip front when the centred story or the card size changed (a finished flip already
    // left the right front texture; side cards arriving do not change it)
    if (centreChanged || gl.frontStale()) { gl.setFrontTexture(snapFor(active)); frontStale = false; }
    gl.kick();
  }
  markActiveTile();
}
let applyingWindow = false, arrivalsPending = false;
/** Stories that landed while a move or a window build was in progress: refresh once it is done. */
function flushRingArrivals() {
  if (!arrivalsPending || busy || applyingWindow || mobileMode || ringPos < 0 || !FEAT.length) return;
  arrivalsPending = false;
  ringRefresh();
}
function ringStoryArrived(key) {
  if (mobileMode || ringPos < 0 || !FEAT.length) return;
  if (busy || applyingWindow) { arrivalsPending = true; return; }   // re-centred when the move/build finishes
  const i = FEAT.findIndex(a => a.placeholder && !a.seam && a.key === key);
  if (i < 0) return;
  ringRefresh();
  if (i === active) {
    const a = FEAT[active];
    if (a.id !== LATEST_SLOT_ID && location.hash !== '#' + a.id && !a.placeholder) history.replaceState(null, '', '#' + a.id);
    if (storyAnnouncer) storyAnnouncer.textContent = a.title;
  }
}
/** Step the ring by delta (|delta| <= visible radius animates, larger jumps re-centre). Never waits on the network:
 *  an unbuffered centre shows the skeleton card until its story lands. */
async function ringMove(delta, fromHash = false, { instant = false } = {}) {
  const replace = autoplayHistoryReplace; autoplayHistoryReplace = false;   // an autoplay step must not grow history
  const n = ringLen();
  if (n <= 1 || !delta || ringPos < 0 || mobileMode) return;
  collapseReadMore();   // every way of moving (buttons, keys, swipe, side cards, tiles, history) lands collapsed
  const epoch = layoutEpoch;
  const newPos = ringWrap(ringPos + delta);
  const crossing = ringPos + delta >= n || ringPos + delta < 0;
  const key = ringKeyAt(newPos);
  const st = key ? ringStories.get(key) : null;
  const ready = st?.article || st?.text;
  // intermediate steps of a fast flick don't fetch; the landing story is requested first (ringSchedule)
  if (!ready && !st?.failed && navQueue === 0) { ringStats.skeletonCentres++; ringEnsureStory(newPos); }
  const target = active + delta;
  if (target >= 0 && target < FEAT.length) {
    if (FEAT[target].placeholder && ready) { ready.ringIndex = newPos; FEAT[target] = ready; }   // seam/unbuffered card becomes the centre
    await goToIndex(target, fromHash, { instant, replace });
    if (mobileMode || layoutIsStale(epoch)) return;
  } else if (!fromHash && key && key !== LATEST_SLOT_ID) history[replace ? 'replaceState' : 'pushState'](null, '', '#' + key);
  if (crossing) wrapCrossed = true;
  ringPos = newPos;
  ringRefresh();
  ringSchedule();
}
/** Open the ring at a story (null = latest view). Waits for the centre and its visible neighbours (bounded), so the
 *  first paint matches the old full-window layout. */
async function ringOpen(key, fromHash = false, { omitHash = false } = {}) {
  const epoch = layoutEpoch, seq = ++ringOpenSeq;
  collapseReadMore();
  await ringInit();
  if (mobileMode || layoutIsStale(epoch) || seq !== ringOpenSeq) return;
  const n = ringLen();
  if (!n) throw new Error('No stories available');
  let r = key ? await ringLocate(key) : n - 1;
  if (r < 0) { r = n - 1; key = null; }   // unknown / unlisted key: latest view, as before
  if (mobileMode || layoutIsStale(epoch) || seq !== ringOpenSeq) return;
  ringPos = r;
  ringSchedule();
  const [L, R] = ringRadii(), days = new Set();
  for (let o = -L; o <= R; o++) { const rr = ringWrap(r + o); if (rr < ringTotal) days.add(ringDayOf(rr)); }
  // only the centre's day is needed to paint; neighbours' days and stories (and every image) fill in afterwards
  const centreDay = r < ringTotal ? ringDayOf(r) : null;
  if (centreDay != null) await ringLoadDay(centreDay).catch(() => []);
  for (const i of days) if (i !== centreDay) ringLoadDay(i).catch(() => []);
  for (let o = -L; o <= R; o++) if (o && !ringSeamMasked(o)) ringEnsureStory(ringWrap(r + o));
  await ringEnsureText(r);
  ringStats.centreFirstOpens++;
  if (mobileMode || layoutIsStale(epoch) || seq !== ringOpenSeq) return;
  const w = buildRingWindow();
  await applyFeaturedState(w.feat, w.active, fromHash, { omitHash: omitHash || !key, epoch });
  ringSchedule();
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

/** Archive tiles: headline + author; uses the API `author` field when present, else the legacy glued-title parse. */
function tileHeadlineAndAuthor(rawTitle, author) {
  const raw = String(rawTitle ?? '').trim();
  const by = String(author ?? '').trim();
  if (!by) return parseArchiveTileTitle(raw);
  registerKnownAuthor(by);
  const title = raw.length > by.length && raw.endsWith(by) ? raw.slice(0, -by.length).trim() : raw;
  return { title, agent: by };
}

const tileDateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const tileDateTitleFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' });

/** Story publish time: generated_at (UTC "YYYY-MM-DD-HH-MM-SS", when botz.ai published it), else source published_at. */
function archiveItemDate(generatedAt, publishedAt) {
  const m = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})/.exec(String(generatedAt ?? ''));
  let ms = m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : NaN;
  if (!Number.isFinite(ms) && publishedAt) ms = Date.parse(publishedAt);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

function tileBodyHTML(rawTitle, { author = '', generatedAt = '', publishedAt = '' } = {}) {
  const tile = tileHeadlineAndAuthor(rawTitle, author);
  const date = archiveItemDate(generatedAt, publishedAt);
  const parts = [];
  if (tile.agent) parts.push(`<span class="tile-agent">${esc(tile.agent)}</span>`);
  if (date) parts.push(`<time class="tile-date" datetime="${esc(date.toISOString())}" title="${esc(tileDateTitleFmt.format(date))}">${esc(tileDateFmt.format(date))}</time>`);
  const meta = parts.length ? `<div class="tile-meta">${parts.join('<span class="tile-sep" aria-hidden="true">·</span>')}</div>` : '';
  return `<div class="tile-title">${esc(tile.title)}</div>${meta}`;
}

/** Only legacy tiles (no `author` from the API) depend on the known-author list; others never change. */
function refreshArchiveTileTitles() {
  gridEl.querySelectorAll('.tile[data-raw-title][data-author=""]').forEach(a => {
    const html = tileBodyHTML(a.dataset.rawTitle, { author: '', generatedAt: a.dataset.generatedAt, publishedAt: a.dataset.publishedAt });
    if (html === a._bodyHtml) return;
    const body = a.querySelector('.tile-body');
    if (!body) return;
    a._bodyHtml = html;
    body.innerHTML = html;
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
  const ident = storyIdentity(entry);
  return {
    id: cacheKey,
    title: parsed.title,
    agent: parsed.agent,
    showAgent: parsed.showAgent,
    bodyHtml,
    generated: entry.article.generated_at || entry.article.published_at,
    generatedAt: entry.article.generated_at || '',
    storyIdentityKey: `${ident.generated_at}|${ident.headline}`,
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

/* ---------------- images: resized WebP variants, PNG master as the fallback ----------------
 * Story images are /cache/images/<name>.png. The server writes <name>-480w.webp, -768w.webp and -1024w.webp next to
 * each PNG (older stories get them from a backfill), so the page derives the variant URLs from the PNG path:
 * <picture> + srcset for the card, tiles and mobile view, and the 768 variant for WebGL textures. When a variant
 * is missing (404), the <source> is dropped and the PNG loads instead. */
const VARIANT_WIDTHS = [480, 768, 1024];
const TEX_WIDTH = 768;
const PNG_IMAGE_RE = /^(\/cache\/images\/[A-Za-z0-9][A-Za-z0-9._-]*)\.png$/;
const variantMisses = new Lru(300);   // PNG bases whose variants 404'd this session: use the PNG directly
const imageStats = { fallbacks: 0, texFallbacks: 0 };
const imageSizes = {
  // the source images are square and cover-cropped to 7:8, so the needed source width is the box HEIGHT (width * 8/7)
  card: '(max-width: 960px) calc((100vw - 64px) * 1.143), 492px',
  tile: '(max-width: 760px) calc((100vw - 32px) * 1.143), 420px',
  mobile: 'calc((100vw - 32px) * 1.143)',
};
function variantBase(png) {
  const m = PNG_IMAGE_RE.exec(png || '');
  return m && !variantMisses.has(m[1]) ? m[1] : null;
}
function variantUrl(png, w) { const b = variantBase(png); return b ? `${b}-${w}w.webp` : png; }
function variantSrcset(png) { const b = variantBase(png); return b ? VARIANT_WIDTHS.map(w => `${b}-${w}w.webp ${w}w`).join(', ') : ''; }
/** <picture> with the WebP srcset and the PNG <img> (also the fallback). `attrs` is trusted markup. */
function pictureHTML(png, attrs, sizes) {
  const img = `<img src="${esc(png)}" data-png="${esc(png)}" ${attrs}>`;
  const srcset = variantSrcset(png);
  return srcset ? `<picture><source type="image/webp" srcset="${esc(srcset)}" sizes="${sizes}">${img}</picture>` : img;
}
// a variant that is not there yet: fall back to the PNG (capture phase: image errors do not bubble)
document.addEventListener('error', e => {
  const im = e.target;
  if (!(im instanceof HTMLImageElement) || !im.dataset.png || im.dataset.fellBack) return;
  const png = im.dataset.png;
  const pic = im.parentElement?.tagName === 'PICTURE' ? im.parentElement : null;
  if (!pic && !/-\d+w\.webp$/.test(im.getAttribute('src') || '')) return;   // the PNG itself failed: nothing to fall back to
  const base = PNG_IMAGE_RE.exec(png)?.[1];
  if (base) variantMisses.set(base, true);
  // every copy of this image on the page (card, tile, side card) switches to the PNG: one 404, not one per copy
  for (const el of document.querySelectorAll(`img[data-png="${CSS.escape(png)}"]`)) {
    if (el.dataset.fellBack) continue;
    el.dataset.fellBack = '1';
    if (el.parentElement?.tagName === 'PICTURE') el.parentElement.querySelectorAll('source').forEach(n => n.remove());
    if (el.getAttribute('src') !== png) el.setAttribute('src', png);
    else if (el === im) el.src = png;   // same attribute value: re-assign so the PNG request starts
    imageStats.fallbacks++;
  }
}, true);
/** Image for canvas/WebGL use: the 768 WebP, retried as the PNG when the variant is missing. */
function loadTextureImage(png, done) {
  const im = new Image();
  im.decoding = 'async';
  im.onload = () => done?.();
  im.onerror = () => {
    const want = new URL(png, location.href).href;
    if (im.src !== want) {
      const base = PNG_IMAGE_RE.exec(png)?.[1];
      if (base) variantMisses.set(base, true);
      imageStats.texFallbacks++;
      im.src = png;
    } else done?.();
  };
  im.src = variantUrl(png, TEX_WIDTH);
  return im;
}
/** Decoded story images for snapshots/textures: bounded, the current carousel window is never evicted. */
const IMG_CACHE_MAX = 40;
const keepImg = id => ringStories.has(id) || FEAT.some(a => a.id === id);
const imgs = new Lru(IMG_CACHE_MAX);
/** Background image loads for the window (never awaited before the centre card paints). */
function preloadImages() {
  for (const a of FEAT) {
    if (a.placeholder || !a.img) continue;
    const have = imgs.get(a.id);
    if (have?.complete && have.naturalWidth) continue;
    if (have && !have.complete) continue;   // already loading
    imgs.set(a.id, loadTextureImage(a.img, () => imageArrived(a)), keepImg);
  }
}
/** A window image finished loading: refresh what was drawn without it (side textures, the flip front). */
function imageArrived(a) {
  if (FEAT[active] === a) centreImageArrived(a);
  else if (FEAT.includes(a)) scheduleSideRefresh();
}
let sideRefreshQueued = false;
function scheduleSideRefresh() {
  if (sideRefreshQueued) return;
  sideRefreshQueued = true;
  requestAnimationFrame(() => { sideRefreshQueued = false; if (gl && !busy && !mobileMode) gl.rebuildSideMeshes(); });
}
let frontStale = false;
function centreImageArrived(a) {
  if (!gl || mobileMode || FEAT[active] !== a) return;
  frontStale = true;
  // re-snapshot the flip surface off the input path, when the main thread is idle
  (window.requestIdleCallback || (f => setTimeout(f, 50)))(() => refreshFrontIfStale(), { timeout: 500 });
}
function refreshFrontIfStale() {
  if (!frontStale || !gl || busy || mobileMode || FEAT[active]?.placeholder) return;
  frontStale = false;
  gl.setFrontTexture(snapFor(active));
  gl.kick();
}

/* ---------------- DOM rendering ---------------- */
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** The desktop ring wraps, so Older/Newer are only disabled when there is a single story. */
function canGoOlder() { return ringLen() > 1; }
function canGoNewer() { return ringLen() > 1; }
function cardHTML(a, i, { measure = false } = {}) {
  const n = ringLen() || FEAT.length, pos = (a.ringIndex ?? i);
  const head = `
  <header class="card-head">
    <span class="kicker" data-snap="text">Featured <b>${pos + 1}</b> of ${n} · newest on the right</span>
  </header>`;
  // Older/Newer are the arrow buttons on the card's edges (#stage-arrows, outside the card: see updateArrows)
  if (a.placeholder) return `${head}<span class="sr-only">Loading story</span>${CARD_SKELETON_BODY}`;
  // off-screen measuring/snapshot copies keep the same box but load nothing (snapshots draw the decoded texture image)
  const img = a.img && measure
    ? `<button type="button" class="card-img-btn" tabindex="-1"><img class="card-img" data-snap="img" alt="" width="350" height="400"></button>`
    : a.img
    ? `<button type="button" class="card-img-btn" aria-haspopup="dialog" aria-label="Enlarge image${a.title ? `: ${esc(a.title)}` : ''}">${pictureHTML(a.img, 'class="card-img" data-snap="img" alt="" width="350" height="400"', imageSizes.card)}</button>`
    : `<img class="card-img" data-snap="img" src="" alt="" width="350" height="400">`;
  return `${head}
  <div class="card-body">
    ${img}
    <div class="card-text">
      <h2 class="card-title" data-snap="text">${esc(a.title)}</h2>
      ${cardBylineHTML(a, true)}
      <div class="card-more" id="card-more-${i}">
        <div class="card-paras">${a.bodyHtml}</div>
        ${cardMetaHTML(a)}
      </div>
      <button type="button" class="card-read-more" data-snap="button" hidden aria-expanded="false" aria-controls="card-more-${i}">Read more</button>
    </div>
  </div>`;
}
/** Article view byline: "Agent ChatGPT · 19 Oct 2026" — same date source/format as the grid tiles; missing parts omitted. */
function cardBylineHTML(a, snap) {
  const ds = snap ? ' data-snap="text"' : '';
  const date = archiveItemDate(a.generatedAt, a.published);
  const parts = [];
  if (a.showAgent && a.agent) parts.push(`<span class="card-agent-name"${ds}>${esc(a.agent)}</span>`);
  if (date) parts.push(`<time class="card-date"${ds} datetime="${esc(date.toISOString())}" title="${esc(tileDateTitleFmt.format(date))}">${esc(tileDateFmt.format(date))}</time>`);
  if (!parts.length) return '';
  return `<p class="card-agent">${parts.join(`<span class="card-sep" aria-hidden="true"${ds}>·</span>`)}</p>`;
}
function cardMetaHTML(a) {
  return `<div class="card-meta">
        <div data-snap="text">Generated: ${esc(a.generated)}</div>
        <div data-snap="text">Original source: ${esc(a.source)} | ${esc(a.published)}</div>
        <div data-snap="text">Original title: ${esc(a.origTitle)}</div>
        <div><a href="${esc(a.url)}" data-snap="text" target="_blank" rel="noopener">Read original article</a>${a.hn ? ` <span class="sep" data-snap="text">·</span> <a href="${esc(a.hn)}" data-snap="text" target="_blank" rel="noopener">Hacker News discussion</a>` : ''}</div>
      </div>`;
}
/** Small screens: the whole story inline (earlier flow) — no Older/Newer header, no Read more clamp. */
function mobileArticleHTML(a) {
  return `
  <div class="card-body">
    ${a.img ? pictureHTML(a.img, 'class="card-img" alt="" width="350" height="400"', imageSizes.mobile) : ''}
    <div class="card-text">
      <h2 class="card-title">${esc(a.title)}</h2>
      ${cardBylineHTML(a, false)}
      <div class="card-paras">${a.bodyHtml}</div>
      ${cardMetaHTML(a)}
    </div>
  </div>`;
}
function renderCard(el, i) {
  el.classList.toggle('is-story-loading', !!FEAT[i].placeholder);
  if (el === cardEl) {
    clearArticleSkeletonState();
    if (FEAT[i].placeholder) el.setAttribute('aria-busy', 'true'); else el.removeAttribute('aria-busy');
    updateArrows(i);
  }
  el.innerHTML = cardHTML(FEAT[i], i, { measure: el !== cardEl });
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
/* ---------------- Read more (desktop card) ----------------
 * The card is always collapsed to one fixed height (text column = image height), so the stage and the grid
 * below never move between stories. Read more opens the full story as an overlay: the card is lifted out of
 * the flow (a spacer keeps its slot) and grows down over the More stories grid, scrolling inside itself when
 * the story is longer than the viewport. Any navigation, Esc, Show less or a click outside collapses it. */
const cardSpacer = document.createElement('div');
cardSpacer.className = 'card-spacer';
cardSpacer.setAttribute('aria-hidden', 'true');
cardEl.after(cardSpacer);
function readMoreExpanded() { return cardEl.classList.contains('is-expanded'); }
function updateReadMoreState(el = cardEl) {
  const paras = el.querySelector('.card-paras');
  const btn = el.querySelector('.card-read-more');
  if (!paras || !btn) return;
  if (mobileMode) { el.classList.remove('has-read-more'); btn.hidden = true; return; }
  el.classList.add('has-read-more');
  btn.hidden = false;
  const open = el === cardEl && readMoreExpanded();
  btn.textContent = open ? 'Show less' : 'Read more';
  btn.setAttribute('aria-expanded', String(open));
}
function sizeExpandedCard() {
  if (!readMoreExpanded()) return;
  // reads first, then writes (one layout)
  // no max-height: the overlay grows to its full content height (no inner scrollbar); the page scrolls instead
  cardEl.style.setProperty('--card-top', cardSpacer.offsetTop + 'px');
}
function expandReadMore() {
  if (mobileMode || readMoreExpanded() || !cardEl.querySelector('.card-read-more')) return;
  cardSpacer.style.height = cardEl.getBoundingClientRect().height + 'px';   // fractional: offsetHeight rounds and would nudge the grid
  stage.classList.add('has-expanded-card');
  cardEl.classList.add('is-expanded');
  sizeExpandedCard();
  updateReadMoreState();
  readMoreStats.expanded++;
}
function collapseReadMore({ focus = false } = {}) {
  if (!readMoreExpanded()) return false;
  cardEl.classList.remove('is-expanded');
  cardEl.style.maxHeight = '';
  cardEl.style.removeProperty('--card-top');
  cardEl.scrollTop = 0;
  stage.classList.remove('has-expanded-card');
  cardSpacer.style.height = '';
  updateReadMoreState();
  readMoreStats.collapsed++;
  if (focus) cardEl.querySelector('.card-read-more')?.focus();
  return true;
}
const readMoreStats = { expanded: 0, collapsed: 0 };
cardEl.addEventListener('click', e => {
  if (e.target.closest('.card-read-more')) {
    if (readMoreExpanded()) collapseReadMore({ focus: true }); else expandReadMore();
    return;
  }
});
/* ---------------- Older / Newer arrows (desktop) ----------------
 * Circles centred on the card's left/right edges (CSS), vertically centred on the COLLAPSED card. --arrow-y is
 * measured from the card while collapsed and from its spacer (which holds the collapsed slot) while expanded, so
 * Read more never moves them. They sit outside the card: the flip, its snapshot and its opacity never touch them. */
arrowsEl?.addEventListener('click', e => {
  const b = e.target.closest('[data-nav]');
  if (b && !b.disabled) navRelative(Number(b.dataset.nav));
});
function updateArrows(i = active) {
  if (!arrowsEl) return;
  const a = FEAT[i]; if (!a) return;
  const n = ringLen() || FEAT.length, pos = a.ringIndex ?? i;
  const older = arrowsEl.querySelector('[data-nav="-1"]'), newer = arrowsEl.querySelector('[data-nav="1"]');
  older.disabled = !canGoOlder(i); newer.disabled = !canGoNewer(i);
  older.setAttribute('aria-label', pos === 0 ? 'Older story (wraps around to the newest)' : 'Older story');
  newer.setAttribute('aria-label', pos === n - 1 ? 'Newer story (wraps around to the oldest)' : 'Newer story');
}
function positionArrows() {
  if (!arrowsEl || mobileMode) return;
  const ref = readMoreExpanded() ? cardSpacer : cardEl;
  const h = ref.getBoundingClientRect().height;
  if (!h) return;
  const y = Math.round(ref.offsetTop + h / 2);   // whole px: sub-pixel skeleton -> story height differences must not nudge the arrows
  if (arrowsEl._y !== y) { arrowsEl._y = y; arrowsEl.style.setProperty('--arrow-y', y + 'px'); }
}
if (arrowsEl) {
  new ResizeObserver(positionArrows).observe(cardEl);   // runs before paint: skeleton -> story, fixCardHeight, resize
  window.addEventListener('resize', positionArrows);
  positionArrows();
}
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || !readMoreExpanded() || imageModalOpen()) return;
  e.preventDefault();
  collapseReadMore({ focus: cardEl.contains(document.activeElement) || document.activeElement === document.body });
});
document.addEventListener('pointerdown', e => {
  if (readMoreExpanded() && !cardEl.contains(e.target) && !imageModalOpen() && !e.target.closest?.('.img-modal')) collapseReadMore();
});
window.addEventListener('resize', () => sizeExpandedCard());

/* ---------------- next-story countdown ----------------
 * When the newest story is centred, the first Newer side card (where the next story will appear; across the wrap
 * point it would otherwise be a faint skeleton, never the oldest story) shows a pale "next story in mm:ss". The
 * schedule comes from the backend (`generation` in /archive/index and /archive/latest: the next few cron runs and
 * the typical publish delay), never from the client. Past the due time it reads "any moment now" and polls
 * /archive/latest every NEXT_POLL_MS until the new story is there, then adds it to the ring (it takes that card's
 * place). The visible text is aria-hidden; screen readers get a polite status at most once a minute. The ticker
 * only runs while the card is on screen and the tab is visible. */
const NEXT_STORY_HTML = '<div class="side-next-box"><span class="side-next-l">next story in</span><span class="side-next-t">--:--</span></div>';
const NEXT_GRACE_MS = 10 * 60e3;   // a run that published nothing: move on to the following run after this
const NEXT_POLL_MS = Math.max(1000, Number(params.get('nextpoll')) || 30e3);   // ?nextpoll= shortens it for tests
let generation = null;             // { upcoming: ms[], delayMs }
let nextTick = 0, nextPollAt = 0, nextPollFlight = null, nextSrMinute = null;
const nextStats = { ticks: 0, polls: 0, pickedUp: 0, srUpdates: 0 };
const nextSr = document.createElement('div');
nextSr.className = 'sr-only'; nextSr.id = 'next-story-status'; nextSr.setAttribute('role', 'status'); nextSr.setAttribute('aria-live', 'polite');
document.body.appendChild(nextSr);
function noteGeneration(g) {
  if (!g || !Array.isArray(g.upcoming)) return;
  const upcoming = g.upcoming.map(t => Date.parse(t)).filter(Number.isFinite).sort((a, b) => a - b);
  if (!upcoming.length) return;
  generation = { upcoming, delayMs: Math.max(0, Number(g.typical_delay_s) || 0) * 1000 };
  nextStoryRefresh();
}
function centreIsNewest() { return !mobileMode && ringPos >= 0 && ringPos === ringLen() - 1; }
function newestGeneratedMs() {
  const it = archiveIndex?.days[0] && dayData.peek(archiveIndex.days[0].date)?.editorials?.[0];
  const m = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})/.exec(it?.generated_at || '');
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : 0;
}
/** When the next story should appear (epoch ms): the first run after the newest story, unless it is long overdue. */
function nextStoryDue(now = Date.now()) {
  if (!generation) return null;
  const newest = newestGeneratedMs();
  for (const run of generation.upcoming) {
    const due = run + generation.delayMs;
    if (run > newest && due + NEXT_GRACE_MS > now) return due;
  }
  return null;
}
function fmtCountdown(ms) {
  const t = Math.ceil(ms / 1000), h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, sec = t % 60;
  const p2 = n => String(n).padStart(2, '0');
  return h ? `${h}:${p2(m)}:${p2(sec)}` : `${p2(m)}:${p2(sec)}`;
}
function nextStoryEl() {
  const el = scene.querySelector('.side-next');
  return el && !el.hidden ? el : null;
}
/** Paint the countdown now and (re)arm the ticker at the next whole second; stops when nothing needs it. */
function nextStoryRefresh() {
  clearTimeout(nextTick); nextTick = 0;
  const el = nextStoryEl(), due = el && centreIsNewest() ? nextStoryDue() : null;
  if (!el || due == null) {
    if (el) el.classList.add('is-unknown');   // no schedule (stubs / old backend): a plain faint card
    if (nextSrMinute !== null) { nextSrMinute = null; nextSr.textContent = ''; }
    return;
  }
  el.classList.remove('is-unknown');
  const now = Date.now(), left = due - now, t = el.querySelector('.side-next-t'), l = el.querySelector('.side-next-l');
  const label = left > 0 ? 'next story in' : 'next story', time = left > 0 ? fmtCountdown(left) : 'any moment now';
  if (l.textContent !== label) l.textContent = label;
  if (t.textContent !== time) t.textContent = time;
  el.classList.toggle('is-due', left <= 0);
  nextStats.ticks++;
  // screen readers: one polite update per whole minute at most
  const mins = left > 0 ? Math.ceil(left / 60e3) : 0;
  if (mins !== nextSrMinute) {
    nextSrMinute = mins; nextStats.srUpdates++;
    nextSr.textContent = mins ? `Next story expected in about ${mins} minute${mins === 1 ? '' : 's'}` : 'Next story expected any moment now';
  }
  if (left <= 0 && now >= nextPollAt) pollForNewStory();
  if (document.visibilityState !== 'hidden') nextTick = setTimeout(nextStoryRefresh, 1000 - (now % 1000) + 5);
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { clearTimeout(nextTick); nextTick = 0; } else nextStoryRefresh();
});
/** Past the due time: re-read /archive/latest (bypassing the browser cache) until the newest story changes. */
function pollForNewStory() {
  if (nextPollFlight || useLocalStubs) return;
  nextPollAt = Date.now() + NEXT_POLL_MS; nextStats.polls++;
  nextPollFlight = fetch('/archive/latest', { cache: 'no-cache' }).then(r => (r.ok ? r.json() : null)).then(day => {
    noteGeneration(day?.generation);
    const top = day?.editorials?.[0]?.cache_key;
    if (top && archiveIndex && !storyEntries.has(top)) pickUpNewStory(day);
  }).catch(() => {}).finally(() => { nextPollFlight = null; });
}
/** A newer day body arrived: extend the index and the ring. Chrono positions count from the oldest story, so every
 *  existing position (and the centre) stays put; the new story takes the countdown card's slot on the Newer side. */
function pickUpNewStory(day) {
  if (!day?.date || !Array.isArray(day.editorials) || !archiveIndex) return;
  const days = archiveIndex.days.map(d => ({ ...d }));
  const i = days.findIndex(d => d.date === day.date);
  if (i > 0) return;                        // an older day changed: not a new newest story
  if (i === 0) { if (day.count <= days[0].count) return; days[0].count = day.count; }
  else if (day.date > days[0].date) days.unshift({ date: day.date, count: day.count });
  else return;
  ingestDay(day);
  setArchiveIndex(days);
  latestFlight = Promise.resolve(day);
  newestArchiveKey = day.editorials[0].cache_key;
  if (day.editorials[0].entry) { globalLatestPayload = [day.editorials[0].entry]; latestIdentity = storyIdentity(globalLatestPayload[0]); }
  if (ringReady) ringTotal = archiveIndex.total;
  nextStats.pickedUp++;
  if (storyAnnouncer) storyAnnouncer.textContent = `New story: ${day.editorials[0].title || ''}`;
  if (!mobileMode && ringPos >= 0 && FEAT.length) {
    if (busy || applyingWindow) arrivalsPending = true; else ringRefresh();
    ringSchedule();
  }
}

const SIDE_SKEL_HTML = '<div class="skel side-skel-img"></div><div class="side-skel-txt"><div class="skel skel-line"></div><div class="skel skel-line skel-w60"></div></div>';
/** Side cards: nodes are reused by story (a flick only re-orders them), listeners are delegated on the scene. */
function rebuildSideButtons() {
  const reuse = new Map();
  for (const n of scene.children) if (n._storyId && !reuse.has(n._storyId)) reuse.set(n._storyId, n);
  sideBtns = FEAT.map((a, i) => {
    if (a.placeholder) {
      // not loaded yet, or across the wrap point while the latest story is centred: faint CSS skeleton card.
      // The first Newer slot beside the newest story is where the next story will land: it shows the countdown.
      const d = document.createElement('div');
      d.className = 'side side-skel'; d.dataset.i = String(i); d.setAttribute('aria-hidden', 'true');
      if (i === active + 1 && a.seam && centreIsNewest()) { d.classList.add('side-next'); d.innerHTML = NEXT_STORY_HTML; }
      else d.innerHTML = SIDE_SKEL_HTML;
      return d;
    }
    let b = reuse.get(a.id);
    if (b && b._story === a) reuse.delete(a.id);
    else {
      b = document.createElement('button');
      b.type = 'button'; b.className = 'side';
      // the 768 WebP is the same URL the WebGL texture uses (one download); the PNG is the fallback
      b.innerHTML = `<img class="side-img" src="${esc(variantUrl(a.img, TEX_WIDTH))}" data-png="${esc(a.img)}" alt="" decoding="async"><span class="side-txt"><span class="side-t">${esc(a.title)}</span><span class="side-a">${esc(a.agent)}</span></span>`;
      b._storyId = a.id; b._story = a;
    }
    b.dataset.i = String(i);
    return b;
  });
  scene.replaceChildren(...sideBtns);
  nextStoryRefresh();
}
scene.addEventListener('click', e => {
  const b = e.target.closest?.('button.side[data-i]');
  if (b && scene.contains(b)) go(Number(b.dataset.i));
});
scene.addEventListener('focusin', e => { const b = e.target.closest?.('button.side[data-i]'); if (b) gl?.setHighlight(Number(b.dataset.i), 1); });
scene.addEventListener('focusout', e => { const b = e.target.closest?.('button.side[data-i]'); if (b) gl?.setHighlight(Number(b.dataset.i), 0); });

/* ---------------- browse grid (archive) ---------------- */
/* ---------------- skeleton placeholders (pure CSS shimmer; JS only inserts/removes the markup) ---------------- */
function showArticleSkeleton() {
  cardEl.dataset.id = '';
  cardEl.style.minHeight = '';
  cardEl.classList.add('is-skeleton');
  cardEl.setAttribute('aria-busy', 'true');
  cardEl.innerHTML = ARTICLE_SKELETON_HTML;
}
/** Faint side-card placeholders where the wide (>=1600px) carousel puts its side cards, using the same slot maths. */
function showSideSkeletons(withNewer) {
  if (mobileMode || !wide.matches || !scene) return;
  computeGeom();
  const g = geom;
  scene.innerHTML = '';
  scene.style.perspective = PERSP + 'px';
  scene.style.perspectiveOrigin = `${g.cx}px ${g.cy}px`;
  const offs = withNewer ? [-3, -2, -1, 1, 2, 3] : [-3, -2, -1];
  for (const o of offs) {
    const L = slot(o), a = Math.abs(o);
    if (L.alpha <= 0.02) continue;
    const d = document.createElement('div');
    d.className = 'side side-skel';
    d.setAttribute('aria-hidden', 'true');
    d.innerHTML = '<div class="skel side-skel-img"></div><div class="side-skel-txt"><div class="skel skel-line"></div><div class="skel skel-line skel-w60"></div></div>';
    d.style.width = g.sideW + 'px'; d.style.height = g.sideH + 'px';
    d.style.left = g.cx + 'px'; d.style.top = g.cy + 'px';
    d.style.margin = `${-g.sideH / 2}px 0 0 ${-g.sideW / 2}px`;
    d.style.transform = `translate3d(${L.x}px, ${-L.y}px, ${L.z}px) rotateY(${L.rot}deg) scale(${L.S})`;
    d.style.zIndex = String(100 - Math.round(a * 10));
    d.style.opacity = String(L.alpha * 0.55);
    scene.appendChild(d);
  }
}
function clearArticleSkeletonState() {
  cardEl.classList.remove('is-skeleton');
}
const TILE_SKELETON_HTML = gridEl.querySelector('.tile-skel')?.outerHTML || '';
function showTileSkeletons(count) {
  removeTileSkeletons();
  gridEl.insertAdjacentHTML('beforeend', TILE_SKELETON_HTML.repeat(count));
  gridEl.setAttribute('aria-busy', 'true');
}
/** One full row of placeholders (two on small screens) so ultrawide grids are not half empty. */
function tileSkeletonCount() {
  if (mobileMode) return 2;
  const cols = Math.floor(((gridEl.clientWidth || window.innerWidth) + 20) / 320);
  return Math.max(3, Math.min(12, cols));
}
function removeTileSkeletons() {
  gridEl.querySelectorAll('.tile-skel').forEach(n => n.remove());
  gridEl.removeAttribute('aria-busy');
}

const tileIds = new Set();
function appendArchiveTiles(items) {
  // during first load the static skeleton row stays until the top story is known (see revealGrid)
  if (!browseEl?.classList.contains('awaiting-top')) removeTileSkeletons();
  const frag = document.createDocumentFragment();
  items.forEach(editorial => {
    if (!editorial?.cache_key || tileIds.has(editorial.cache_key)) return;
    tileIds.add(editorial.cache_key);
    const a = document.createElement('a');
    a.className = 'tile';
    a.href = `#${editorial.cache_key}`;
    a.dataset.id = editorial.cache_key;
    a.dataset.rawTitle = editorial.title ?? '';
    a.dataset.author = editorial.author || '';
    a.dataset.generatedAt = editorial.generated_at || '';
    a.dataset.publishedAt = editorial.published_at || '';
    const body = tileBodyHTML(a.dataset.rawTitle, { author: a.dataset.author, generatedAt: a.dataset.generatedAt, publishedAt: a.dataset.publishedAt });
    a._bodyHtml = body;
    a.innerHTML = `${pictureHTML(editorial.image_url || '', 'alt="" loading="lazy" decoding="async" width="350" height="400"', imageSizes.tile)}
      <div class="tile-body">${body}</div>`;
    frag.appendChild(a);
  });
  gridEl.appendChild(frag);   // one DOM write per batch
}
gridEl.addEventListener('click', e => {
  const a = e.target.closest?.('a.tile[data-id]');
  if (!a) return;
  e.preventDefault();
  openStory(a.dataset.id, false);
});
async function fetchArchive(page) {
  if (archiveLoading || !archiveHasMore) return;
  showTileSkeletons(tileSkeletonCount());
  try {
    await ensureArchivePageLoaded(page);
  } finally {
    removeTileSkeletons();
  }
}
/* infinite scroll: a sentinel under the grid, watched by an IntersectionObserver (no layout reads on scroll) */
const gridSentinel = document.createElement('div');
gridSentinel.className = 'grid-sentinel';
gridSentinel.setAttribute('aria-hidden', 'true');
gridEl.after(gridSentinel);
let sentinelVisible = false;
const sentinelIO = new IntersectionObserver(entries => {
  sentinelVisible = entries[entries.length - 1].isIntersecting;
  if (sentinelVisible) loadMoreIfNeeded();
}, { rootMargin: '0px 0px 700px 0px' });
sentinelIO.observe(gridSentinel);
async function loadMoreIfNeeded() {
  if (archiveLoading || !archiveHasMore || !sentinelVisible) return;
  await fetchArchive(archivePage + 1);
  // still in view after the batch landed (tall screens): observe again, which reports the current state
  sentinelIO.unobserve(gridSentinel); sentinelIO.observe(gridSentinel);
}
function updateEndMarker() {
  if (!endMarker) return;
  const atNewest = ringPos >= 0 && ringPos === ringLen() - 1 && FEAT[active]?.id === LATEST_SLOT_ID;
  const hasLatestSlot = FEAT.some(a => a.id === LATEST_SLOT_ID);
  endMarker.hidden = !(geom.showSides && atNewest);
  endMarker.classList.toggle('is-separated', geom.showSides && hasLatestSlot);
  endMarker.style.pointerEvents = atNewest ? 'auto' : 'none';
  endMarker.setAttribute('role', atNewest ? 'button' : 'presentation');
  endMarker.tabIndex = atNewest ? 0 : -1;
}
let activeTileEl = null;
function markActiveTile() {
  const cur = FEAT[active];
  const t = cur?.id ? gridEl.querySelector(`.tile[data-id="${CSS.escape(cur.id)}"]`) : null;
  if (t !== activeTileEl) { activeTileEl?.classList.remove('is-active'); t?.classList.add('is-active'); activeTileEl = t; }
  hideRepeatedFirstTile();
}
/** The newest archive tile usually repeats the story shown at the top; hide it while that story is showing. */
function hideRepeatedFirstTile() {
  const cur = FEAT[active];
  if (!cur) return;   // top story not known yet (first load / layout rebuild): keep the previous decision
  const first = gridEl.querySelector('.tile');
  gridEl.querySelectorAll('.tile.is-dup-top').forEach(t => { if (t !== first) t.classList.remove('is-dup-top'); });
  if (!first) return;
  const sameKey = !!cur && first.dataset.id === cur.id;
  const sameLatest = !!cur && cur.id === LATEST_SLOT_ID && !!first.dataset.generatedAt
    && first.dataset.generatedAt === (cur.generatedAt || '');
  // desktop: once hidden, the repeated newest tile stays hidden (the newest story is always one step away in the
  // carousel), so leaving the top story never re-inserts it and shifts the whole grid by a column (layout shift)
  const keep = !mobileMode && first.classList.contains('is-dup-top');
  first.classList.toggle('is-dup-top', sameKey || sameLatest || keep);
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
    if (!b) return;
    const o = offsets[i], L = slot(o), a = Math.abs(o);
    const vis = g.showSides && a > 0.5 && a < 3.5 && L.alpha > 0.02;
    if (b.hidden === vis) b.hidden = !vis;
    if (!vis) return;
    const sig = `${g.sideW}|${g.sideH}|${g.cx}|${g.cy}`;
    if (b._sig !== sig) {   // size/anchor only change on resize: per-frame updates below are transform/opacity only
      b._sig = sig;
      b.style.width = g.sideW + 'px'; b.style.height = g.sideH + 'px';
      b.style.left = g.cx + 'px'; b.style.top = g.cy + 'px';
      b.style.margin = `${-g.sideH / 2}px 0 0 ${-g.sideW / 2}px`;
      b.style.setProperty('--sw', g.sideW + 'px');
      b.style.setProperty('--fs1', (g.sideW * 0.058) + 'px');
      b.style.setProperty('--fs2', (g.sideW * 0.044) + 'px');
    }
    // CSS y is down; rotateY sign matches three.js rotation.y
    b.style.transform = `translate3d(${L.x}px, ${-L.y}px, ${L.z}px) rotateY(${L.rot}deg) scale(${L.S})`;
    b.style.zIndex = String(100 - Math.round(a * 10));
    if (FEAT[i].placeholder) { b.style.opacity = String(L.alpha * 0.55); return; }
    b.style.opacity = gl ? '' : String(L.alpha);
    b.style.filter = gl ? '' : `brightness(${L.dim})`;
    const rel = o < 0 ? 'Older' : 'Newer';
    const label = `${rel} story (${Math.round(a)} ${Math.round(a) === 1 ? 'step' : 'steps'} away): ${FEAT[i].title} — ${FEAT[i].agent}`;
    if (b._label !== label) { b._label = label; b.setAttribute('aria-label', label); }
  });
  updateEndMarker();
  if (!nextTick) nextStoryRefresh();   // the countdown card can become visible on resize
}

/* ---------------- card snapshot -> canvas (texture for the WebGL flip surface) ---------------- */
const snapStats = { count: 0 };
function snapshot(el, i, dpr = 1.5) {
  snapStats.count++;
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
  // skeleton blocks: a flip onto a story that is still loading shows the skeleton, never a blank card
  el.querySelectorAll('.skel').forEach(n => {
    const r = n.getBoundingClientRect();
    if (!r.width || !r.height) return;
    ctx.fillStyle = '#20251f'; rr(ctx, r.left - r0.left, r.top - r0.top, r.width, r.height, 6); ctx.fill();
  });
  // clamped paragraphs (Read more on short viewports) are clipped in the flip texture just like on the card
  const parasEl = el.classList.contains('has-read-more') && !el.classList.contains('is-expanded') ? el.querySelector('.card-more') : null;
  const pr = parasEl?.getBoundingClientRect();
  el.querySelectorAll('[data-snap]').forEach(n => {
    const r = n.getBoundingClientRect(), x = r.left - r0.left, y = r.top - r0.top, st = getComputedStyle(n);
    const kind = n.dataset.snap;
    if (!r.width || !r.height) return;
    if (pr && parasEl.contains(n)) {
      if (r.top >= pr.bottom) return;
      ctx.save(); ctx.beginPath(); ctx.rect(0, pr.top - r0.top, w, pr.height); ctx.clip();
      const lh = parseFloat(st.lineHeight) || parseFloat(st.fontSize) * 1.4;
      ctx.font = `${st.fontStyle} ${st.fontWeight} ${st.fontSize} ${st.fontFamily}`;
      ctx.fillStyle = st.color; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      wrap(ctx, n.textContent.replace(/\s+/g, ' ').trim(), r.width + 1).forEach((ln, k) => ctx.fillText(ln, x, y + k * lh + lh / 2));
      ctx.restore(); return;
    }
    if (kind === 'img') {
      const im = imgs.peek(a.id); ctx.save(); rr(ctx, x, y, r.width, r.height, 10); ctx.clip();
      ctx.fillStyle = '#1a1d1b'; ctx.fillRect(x, y, r.width, r.height);
      if (im && im.naturalWidth) drawCover(ctx, im, x, y, r.width, r.height); ctx.restore(); return;
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
/** drawImage with CSS object-fit: cover semantics (centred crop, never stretched), like the DOM <img>. */
function drawCover(ctx, im, x, y, w, h) {
  const iw = im.naturalWidth || im.width, ih = im.naturalHeight || im.height;
  const s = Math.max(w / iw, h / ih), sw = w / s, sh = h / s;
  ctx.drawImage(im, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, h);
}
function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }

/** Cache key of a side card's texture: story, whether its image was drawn, and the title. */
function sideTextureKey(i) {
  const a = FEAT[i];
  return a.placeholder ? '' : `${a.id}|${imgs.peek(a.id)?.naturalWidth ? 1 : 0}|${a.title}`;
}
/** Draws a side card (image + title + agent) into a new 512x777 canvas (7:8 image); WebGL caches the uploaded texture by key. */
function sideTexture(i) {
  const a = FEAT[i];
  if (a.placeholder) { const blank = document.createElement('canvas'); blank.width = blank.height = 2; return blank; }
  const W = SIDE_TEX_W, H = SIDE_TEX_H, IH = SIDE_TEX_IMG_H, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.save(); rr(ctx, 0, 0, W, H, 22); ctx.clip();
  ctx.fillStyle = '#101311'; ctx.fillRect(0, 0, W, H);
  const im = imgs.peek(a.id); if (im && im.naturalWidth) drawCover(ctx, im, 0, 0, W, IH);
  const g = ctx.createLinearGradient(0, IH - 60, 0, IH); g.addColorStop(0, 'rgba(16,19,17,0)'); g.addColorStop(1, 'rgba(16,19,17,.9)');
  ctx.fillStyle = g; ctx.fillRect(0, IH - 60, W, 60);
  ctx.fillStyle = '#eef1ee'; ctx.font = 'bold 31px Arial, sans-serif'; ctx.textBaseline = 'top';
  let lines = wrap(ctx, a.title, W - 48);
  if (lines.length > 2) { lines = lines.slice(0, 2); while (ctx.measureText(lines[1] + '…').width > W - 48) lines[1] = lines[1].slice(0, -1); lines[1] += '…'; }
  lines.forEach((l, k) => ctx.fillText(l, 24, IH + 26 + k * 40));
  ctx.fillStyle = '#2fcf37'; ctx.font = 'bold 23px Arial, sans-serif'; ctx.fillText(a.agent, 24, IH + 26 + 2 * 40 + 14);
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = 2; rr(ctx, 1, 1, W - 2, H - 2, 21); ctx.stroke();
  return cv;
}

/* ---------------- WebGL renderer ----------------
 * One renderer for the life of the page (created on first desktop use, kept across story opens and layout changes).
 * GPU resources are bounded: side-card textures are cached by story in a small LRU and disposed on eviction, the
 * side materials are a fixed pool that only swaps textures, and the flip surface owns exactly two textures (front
 * and back) at any time. The render loop only runs while something moves; it stops when idle, when the tab is
 * hidden, or when the stage is scrolled out of view. */
let gl = null;
let glFlight = null;
const glStats = { renderersCreated: 0 };
const edgeStats = { popIns: 0, untextured: 0, placeholders: 0 };
function ensureGL() {
  if (reduced || params.get('mode') === 'css') return Promise.resolve(null);
  if (!glFlight) glFlight = initGL().then(g => { if (!g) glFlight = null; return g; });
  return glFlight;
}
async function initGL() {
  let THREE;
  try { THREE = await import('./vendor/three.module.min.js'); } catch (e) { console.warn('three.js failed', e); return null; }
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, premultipliedAlpha: false });
  } catch (e) { console.warn('WebGL unavailable, CSS fallback', e); return null; }
  glStats.renderersCreated++;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
  renderer.setClearColor(0x000000, 0);
  const s3 = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 10, 20000);
  const sideGroup = new THREE.Group(); s3.add(sideGroup);
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const texStats = { created: 0, disposed: 0, sideHits: 0, sideMisses: 0, frames: 0 };
  const mkTex = cv => { const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.NoColorSpace; t.anisotropy = maxAniso;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; texStats.created++; return t; };
  const disposeTex = t => { if (t && !t.__disposed) { t.__disposed = true; t.dispose(); texStats.disposed++; } };

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
  const blank = mkTex(document.createElement('canvas'));
  // side-card textures by sideTextureKey(); in-use textures are never evicted, evicted ones are disposed
  const SIDE_TEX_MAX = 24;
  const inUse = new Set();
  const sideTex = new Lru(SIDE_TEX_MAX, (k, t) => disposeTex(t));
  const keepSide = k => inUse.has(k);
  function sideTextureFor(i) {
    const k = sideTextureKey(i);
    if (!k) return { k, tex: blank };
    let t = sideTex.get(k);
    if (t) texStats.sideHits++;
    else { t = mkTex(sideTexture(i)); texStats.sideMisses++; sideTex.set(k, t, keepSide); }
    return { k, tex: t };
  }
  const pool = [];   // side mesh pairs, reused across rebuilds (materials are never recreated)
  const sides = [];
  function sideSlot(j) {
    if (!pool[j]) {
      const mk = refl => {
        const m = new THREE.ShaderMaterial({ vertexShader: sideVS, fragmentShader: sideFS, transparent: true, side: THREE.DoubleSide, depthWrite: !refl,
          uniforms: { ...common(), uTex: { value: blank }, uDim: { value: 1 }, uAlpha: { value: 1 }, uBias: { value: 0 }, uHi: { value: 0 } } });
        m.uniforms.uReflect.value = refl ? 1 : 0;
        const mesh = new THREE.Mesh(plane, m); mesh.frustumCulled = false; mesh.visible = false; sideGroup.add(mesh); return mesh;
      };
      pool[j] = { main: mk(false), refl: mk(true), hi: 0, hiT: 0, key: '' };
      const fu = flip.material.uniforms;   // same floor/reflection as the meshes resize() already set up
      [pool[j].main, pool[j].refl].forEach(m => { m.material.uniforms.uFloorY.value = fu.uFloorY.value; m.material.uniforms.uReflLen.value = fu.uReflLen.value; });
    }
    return pool[j];
  }

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
  const mkFlip = refl => {
    const m = new THREE.ShaderMaterial({ vertexShader: flipVS, fragmentShader: flipFS, transparent: true, side: THREE.DoubleSide, depthWrite: !refl,
      uniforms: { ...common(), uFront: { value: blank }, uBack: { value: blank }, uSize: { value: new THREE.Vector2(1, 1) },
        uProg: { value: 0 }, uDir: { value: 1 }, uTopY: { value: 0 }, uBend: { value: 0.12 }, uLift: { value: 80 }, uShowBack: { value: 0 } } });
    m.uniforms.uReflect.value = refl ? 1 : 0;
    const mesh = new THREE.Mesh(flipGeo, m); mesh.frustumCulled = false; mesh.renderOrder = refl ? 1 : 20; s3.add(mesh); return mesh;
  };
  const flip = mkFlip(false), flipRefl = mkFlip(true);
  let flipDrawn = false;
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
  /** The flip surface's front: a new snapshot texture (or the finished flip's back texture); the old front is freed. */
  function setFrontTexture(snap, tex = null) {
    const old = flip.material.uniforms.uFront.value;
    const t = tex || mkTex(snap.canvas);
    [flip, flipRefl].forEach(m => { m.material.uniforms.uFront.value = t; m.material.uniforms.uSize.value.set(snap.w, snap.h); });
    if (old !== blank && old !== t) disposeTex(old);
    frontSnap = snap;
    frontKey = snapKey();
  }
  let frontKey = '';
  const snapKey = () => `${FEAT[active]?.id}|${FEAT[active]?.placeholder ? 1 : 0}|${geom.cardW}|${geom.cardH}`;
  function resize() {
    const g = geom, pr = renderer.getPixelRatio();
    renderer.setSize(g.W, g.H, false);
    const fullW = 2 * Math.max(g.cx, g.W - g.cx), fullH = 2 * Math.max(g.cy, g.H - g.cy);
    camera.fov = 2 * Math.atan(fullH / 2 / PERSP) * 180 / Math.PI;
    camera.aspect = fullW / fullH; camera.position.set(0, 0, PERSP); camera.lookAt(0, 0, 0);
    camera.setViewOffset(fullW, fullH, fullW / 2 - g.cx, fullH / 2 - g.cy, g.W, g.H);
    camera.updateProjectionMatrix();
    floor.scale.set(g.W * 1.6, 2400, 1); floor.position.set(0, g.floorY, -1200 + 1);
    const all = [...pool.flatMap(s => [s.main, s.refl]), flip, flipRefl];
    all.forEach(m => { m.material.uniforms.uFloorY.value = g.floorY; m.material.uniforms.uReflLen.value = Math.min(240, g.H - g.cy - g.cardH / 2 - 20); });
    [flip, flipRefl].forEach(m => { m.material.uniforms.uTopY.value = g.cardH / 2; });
    needs = true;
  }
  function update() {
    const g = geom;
    texStats.frames++;
    const seen = new Map();
    const win = new Set(FEAT.map(a => a?.id));
    queueMicrotask(() => { prevAlpha = seen; prevWindow = win; });
    sides.forEach((s, i) => {
      const L = slot(offsets[i]), vis = g.showSides && !FEAT[i]?.placeholder && L.alpha > 0.004 && Math.abs(offsets[i]) > 0.02;
      // edge pop-in accounting (cheap; read by the frame-sampling checks): a card drawn at a clear alpha that was not
      // drawn in the previous frame, a visible card without its texture, or a loading placeholder in a visible slot
      // (the centre card handing over to/from the flip surface near offset 0 is not an edge)
      if (vis) seen.set(FEAT[i]?.id, L.alpha);
      if (g.showSides && Math.abs(offsets[i]) > 1.5) {
        const id = FEAT[i]?.id;
        if (vis) {
          if (L.alpha > 0.15 && !(prevAlpha.get(id) > 0) && !prevWindow.has(id)) edgeStats.popIns++;   // was not even pre-rendered
          if (s.main.material.uniforms.uTex.value === blank) edgeStats.untextured++;
        } else if (FEAT[i]?.placeholder && !FEAT[i].seam && L.alpha > 0.15) edgeStats.placeholders++;
      }
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
    flipDrawn = flip.visible;   // what the canvas shows until the next render (test hook: stats().flipDrawn)
  }
  // render loop: one frame per kick, more only while something is still easing; never while hidden/off-screen
  let raf = 0, hidden = document.visibilityState === 'hidden', offscreen = false, contextLost = false, suspended = false;
  const loopStats = { starts: 0, stops: 0, running: false };
  function loop() {
    raf = 0;
    if (hidden || offscreen || contextLost || suspended) { loopStats.running = false; loopStats.stops++; return; }
    update();
    const moving = Math.abs(mouse.tx - mouse.x) > 0.001 || Math.abs(mouse.ty - mouse.y) > 0.001 || sides.some(s => Math.abs(s.hiT - s.hi) > 0.01);
    if (moving || needs) { needs = false; raf = requestAnimationFrame(loop); }
    else { loopStats.running = false; loopStats.stops++; }   // idle: no frames until the next kick
  }
  function kick() {
    if (raf) return;
    if (hidden || offscreen || contextLost || suspended) { needs = true; return; }   // drawn once it is visible again
    if (!loopStats.running) { loopStats.running = true; loopStats.starts++; }
    raf = requestAnimationFrame(loop);
  }
  function halt() { if (raf) { cancelAnimationFrame(raf); raf = 0; } if (loopStats.running) { loopStats.running = false; loopStats.stops++; } needs = true; }
  let pmQueued = false, pmX = 0, pmY = 0;
  stage.addEventListener('pointermove', e => {
    pmX = e.clientX; pmY = e.clientY;
    if (pmQueued) return;
    pmQueued = true;
    requestAnimationFrame(() => {   // one stage rect read per frame, not per pointer event
      pmQueued = false;
      const r = stage.getBoundingClientRect();
      mouse.tx = ((pmX - r.left) / r.width - 0.5) * 2; mouse.ty = ((pmY - r.top) / r.height - 0.5) * 2; kick();
    });
  }, { passive: true });
  stage.addEventListener('pointerleave', () => { mouse.tx = 0; mouse.ty = 0; kick(); });
  document.addEventListener('visibilitychange', () => {
    hidden = document.visibilityState === 'hidden';
    if (hidden) halt(); else kick();
  });
  const stageIO = new IntersectionObserver(entries => {
    offscreen = !entries[entries.length - 1].isIntersecting;
    if (offscreen) halt(); else kick();
  });
  stageIO.observe(stage);
  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); contextLost = true; halt(); });
  canvas.addEventListener('webglcontextrestored', () => { contextLost = false; needs = true; kick(); });
  let prevAlpha = new Map(), prevWindow = new Set();
  function bindSides() {
    // point the mesh pool at the current window's textures; textures that dropped out stay cached (LRU)
    sides.length = 0;
    inUse.clear();
    FEAT.forEach((a, i) => {
      const s = sideSlot(i), { k, tex } = sideTextureFor(i);
      if (k) inUse.add(k);
      s.key = k; s.hi = 0; s.hiT = 0;
      [s.main, s.refl].forEach(m => { m.material.uniforms.uTex.value = tex; });
      // upload now, not on the first frame the (still invisible) edge card turns visible mid-animation
      if (tex !== blank && !tex.__uploaded) { renderer.initTexture(tex); tex.__uploaded = true; texStats.preUploads = (texStats.preUploads || 0) + 1; }
      sides.push(s);
    });
    for (let j = FEAT.length; j < pool.length; j++) {
      [pool[j].main, pool[j].refl].forEach(m => { m.visible = false; m.material.uniforms.uTex.value = blank; });
      pool[j].key = '';
    }
    sideTex.trim(keepSide);
  }

  return {
    resize, kick, setFrontTexture,
    /** True when the flip front no longer matches the centred story or the card size. */
    frontStale() { return !frontSnap || frontKey !== snapKey(); },
    setHighlight(i, v) { if (sides[i]) { sides[i].hiT = v; kick(); } },
    rebuildSideMeshes() { bindSides(); needs = true; kick(); },
    /** A story left the carousel buffer: drop its cached side textures (unless on screen). */
    evictStory(id) { for (const k of [...sideTex.keys()]) if (k.startsWith(id + '|') && !inUse.has(k)) sideTex.delete(k); },
    /** Small screens: keep the renderer, free the textures and stop drawing. */
    suspend() {
      suspended = true; halt();
      inUse.clear();
      for (const s of pool) [s.main, s.refl].forEach(m => { m.visible = false; m.material.uniforms.uTex.value = blank; });
      sides.length = 0;
      sideTex.clear();
      const front = flip.material.uniforms.uFront.value, back = flip.material.uniforms.uBack.value;
      [flip, flipRefl].forEach(m => { m.material.uniforms.uFront.value = blank; m.material.uniforms.uBack.value = blank; });
      if (front !== blank) disposeTex(front);
      if (back !== blank && back !== front) disposeTex(back);
      frontSnap = null; frontKey = '';
      renderer.clear();
    },
    resume() { suspended = false; needs = true; },
    stats() {
      const info = renderer.info;
      return { textures: info.memory.textures, geometries: info.memory.geometries, programs: info.programs?.length ?? null,
        edge: { ...edgeStats }, sideTexturesCached: sideTex.size, sideTexturesInUse: inUse.size, sideMeshPool: pool.length, ...texStats,
        loop: { ...loopStats, hidden, offscreen, suspended, contextLost, rafPending: !!raf }, flipDrawn };
    },
    dispose() {
      halt();
      stageIO.disconnect();
      sideTex.clear();
      for (const s of pool) [s.main, s.refl].forEach(m => { m.material.dispose(); sideGroup.remove(m); });
      plane.dispose();
      const front = flip.material.uniforms.uFront.value, back = flip.material.uniforms.uBack.value;
      if (front !== blank) disposeTex(front);
      if (back !== blank && back !== front) disposeTex(back);
      disposeTex(blank);
      [flip, flipRefl].forEach(m => m.material.dispose());
      flipGeo.dispose();
      floor.geometry.dispose(); floor.material.dispose();
      renderer.dispose();
    },
    // flip from current card to card `to`; returns promise resolved at the end
    flipTo(to, dir, backSnap, onProgress) {
      const prevBack = flip.material.uniforms.uBack.value;
      if (prevBack !== blank && prevBack !== flip.material.uniforms.uFront.value) disposeTex(prevBack);   // an interrupted flip's back
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
      const back = flip.material.uniforms.uBack.value;
      [flip, flipRefl].forEach(m => { m.material.uniforms.uProg.value = 0; m.material.uniforms.uBack.value = blank; });
      setFrontTexture(backSnap, back !== blank ? back : null);   // the back texture becomes the front (no re-upload, no leak)
      kick();
    },
    get renderer() { return renderer; }
  };
}

/* ---------------- centred-card image: modal viewer (desktop carousel only; mobile article view unchanged) ---------------- */
const imgModal = $('#img-modal');
const imgModalImg = imgModal?.querySelector('.img-modal-img');
const imgModalClose = imgModal?.querySelector('.img-modal-close');
let imgModalReturn = null, imgModalHideT = 0;
function imageModalOpen() { return !!imgModal && imgModal.classList.contains('is-open'); }
function openImageModal(trigger) {
  const a = FEAT[active];
  if (!imgModal || mobileMode || !a?.img || a.placeholder || busy) return;
  clearTimeout(imgModalHideT);
  imgModalReturn = trigger;
  imgModalImg.style.removeProperty('--ar');
  imgModalImg.onload = () => { if (imgModalImg.naturalWidth) imgModalImg.style.setProperty('--ar', String(imgModalImg.naturalWidth / imgModalImg.naturalHeight)); };
  imgModalImg.src = a.imgFull || a.img;   // full-resolution source when the story has one
  imgModalImg.alt = a.title ? `Image for: ${a.title}` : 'Story image';
  imgModal.setAttribute('aria-label', a.title ? `Image: ${a.title}` : 'Story image');
  navQueue = 0; sw = null;
  imgModal.hidden = false;
  document.documentElement.classList.add('modal-open');   // page scroll lock
  imgModal.offsetWidth;                                    // start the CSS transition from the closed state
  imgModal.classList.add('is-open');
  imgModalClose.focus();
}
function closeImageModal() {
  if (!imageModalOpen()) return;
  imgModal.classList.remove('is-open');
  document.documentElement.classList.remove('modal-open');
  const ms = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 220;
  imgModalHideT = setTimeout(() => { if (!imageModalOpen()) { imgModal.hidden = true; imgModalImg.removeAttribute('src'); } }, ms);
  const back = imgModalReturn?.isConnected ? imgModalReturn : cardEl.querySelector('.card-img-btn');
  imgModalReturn = null;
  back?.focus();
}
cardEl.addEventListener('click', e => {
  const btn = e.target.closest('.card-img-btn');
  if (btn && !mobileMode) { e.preventDefault(); openImageModal(btn); }
});
imgModal?.addEventListener('click', e => {
  if (e.target === imgModal || e.target.closest('.img-modal-close')) closeImageModal();   // backdrop or the x button
});
document.addEventListener('keydown', e => {
  if (!imageModalOpen()) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeImageModal(); return; }
  if (e.key === 'Tab') { e.preventDefault(); imgModalClose.focus(); return; }   // only focusable control: trap focus on it
  if (/^(Arrow|Page|Home|End| $|j$|k$|J$|K$)/.test(e.key)) e.stopPropagation();   // carousel keys are off while open
}, true);
document.addEventListener('focusin', e => { if (imageModalOpen() && !imgModal.contains(e.target)) imgModalClose.focus(); });

/* ---------------- navigation ---------------- */
function indexFromHash() { const id = decodeURIComponent(location.hash.slice(1)); return FEAT.findIndex(a => a.id === id); }
function snapFor(i) { renderCard(measureEl, i); measureEl.style.width = geom.cardW + 'px'; return snapshot(measureEl, i); }

async function navRelative(delta, fromHash = false) {
  if (!delta || mobileMode || imageModalOpen()) return;
  collapseReadMore();
  navQueue = Math.max(-12, Math.min(12, navQueue + delta));   // fast repeated flicks queue up (bounded)
  if (busy) ringSchedule();   // re-aim the prefetch at where the queued flicks will land
  if (busy) return;
  await pumpNavQueue(fromHash);
}

async function pumpNavQueue(fromHash = false) {
  while (!busy && navQueue !== 0) {
    const delta = Math.sign(navQueue);
    navQueue -= delta;
    busy = true;
    try {
      // INP: return to the browser first, so the input's own frame paints before the snapshot/render work, and
      // fast flicks are processed one step per task instead of one long task
      await yieldToMain();
      const instant = navQueue !== 0;
      await ringMove(delta, fromHash, { instant });
    } catch (err) {
      console.error(err);
    } finally {
      busy = false;
    }
  }
  autoplayHistoryReplace = false;
  flushRingArrivals();
}

async function goToIndex(target, fromHash = false, { instant = false, replace = false } = {}) {
  if (mobileMode || target === active || target < 0 || target >= FEAT.length) return;
  const epoch = layoutEpoch;
  const from = active, dir = Math.sign(target - from);
  const start = FEAT.map((_, i) => i - from), end = FEAT.map((_, i) => i - target);
  const setOff = e => { offsets = start.map((s, i) => s + (end[i] - s) * e); layoutButtons(); };
  if (!fromHash && !(FEAT[target].placeholder && !FEAT[target].key)) {
    const id = FEAT[target].key || FEAT[target].id;
    if (id === LATEST_SLOT_ID) history.replaceState(null, '', location.pathname + location.search);
    else history[replace ? 'replaceState' : 'pushState'](null, '', '#' + id);
  }
  const hadFocus = document.activeElement && document.activeElement.closest('.side, .nav-arrow') ? document.activeElement : null;

  if (gl && !instant && !reduced) {
    if (frontStale || gl.frontStale()) { gl.setFrontTexture(snapFor(active)); frontStale = false; }
    const backSnap = snapFor(target);
    // hand-off without a gap: the DOM card hides and shows in single frames (no CSS opacity fade, which left
    // the centre half-transparent once the WebGL card was gone = the focus flash), and it is only shown once
    // its image is decoded, while the finished WebGL flip still covers the centre
    cardEl.style.transition = 'none';
    let hidden = false;   // hide the DOM card in the first flip frame, the same frame the canvas first draws the flip card
    await gl.flipTo(target, dir, backSnap, e => { if (!hidden) { hidden = true; cardEl.style.opacity = '0'; } setOff(e); });
    if (mobileMode || layoutIsStale(epoch)) { cardEl.style.transition = ''; return; }
    active = target; renderCard(cardEl, target);
    await cardImageDecoded(cardEl);
    if (mobileMode || layoutIsStale(epoch)) { cardEl.style.transition = ''; return; }
    cardEl.style.opacity = '1';
    gl.endFlip(backSnap);   // the canvas drops the flip card on its next frame, the same frame the DOM card paints
    requestAnimationFrame(() => requestAnimationFrame(() => { if (cardEl.style.opacity === '1') cardEl.style.transition = ''; }));
  } else if (instant || reduced) {
    if (!instant && reduced) {
      cardEl.classList.add('fade-out'); scene.classList.add('fading');
      await wait(180);
      if (mobileMode || layoutIsStale(epoch)) { cardEl.classList.remove('fade-out'); scene.classList.remove('fading'); return; }
    }
    active = target; renderCard(cardEl, target); setOff(1);
    cardEl.style.opacity = '1';
    cardEl.classList.remove('fade-out'); scene.classList.remove('fading');
  } else {
    cardEl.style.setProperty('--flip-to', dir > 0 ? '90deg' : '-90deg');
    cardEl.classList.add('css-flip-out');
    await animate(FLIP_MS / 2, e => setOff(e * 0.5));
    if (mobileMode || layoutIsStale(epoch)) { cardEl.classList.remove('css-flip-out'); return; }
    active = target; renderCard(cardEl, target);
    cardEl.classList.remove('css-flip-out');
    cardEl.style.transition = 'none'; cardEl.style.transform = `perspective(2000px) rotateY(${dir > 0 ? -90 : 90}deg)`;
    cardEl.offsetWidth; cardEl.style.transition = ''; cardEl.style.transform = '';
    cardEl.classList.add('css-flip-in');
    await animate(FLIP_MS / 2, e => setOff(0.5 + e * 0.5));
    cardEl.classList.remove('css-flip-in');
  }
  if (mobileMode || layoutIsStale(epoch)) return;
  offsets = end; layoutButtons(); markActiveTile();
  const activeId = FEAT[active]?.key || FEAT[active]?.id;
  document.title = activeId && activeId !== LATEST_SLOT_ID && !activeId.startsWith('__pending__')
    ? `botz.ai - GenAI News - ${activeId}`
    : 'botz.ai - GenAI News';
  if (storyAnnouncer) storyAnnouncer.textContent = FEAT[active].title || 'Loading story';
  trackPageView();
  logCenteredKey();
  if (hadFocus && hadFocus.classList.contains('side')) { const nb = sideBtns[Number(hadFocus.dataset.i)]; (nb?.hidden ? cardEl.querySelector('.card-title') : nb)?.focus?.(); }
  else if (hadFocus?.disabled) arrowsEl?.querySelector(`[data-nav="${-dir}"]`)?.focus();   // a focused arrow otherwise keeps focus
}

/** The centre card's image decoded (or failed), bounded so a slow image never holds up navigation. */
function cardImageDecoded(el, maxMs = 300) {
  const im = el.querySelector('img.card-img');
  if (!im || !im.getAttribute('src')) return Promise.resolve();
  let ready;
  try {
    // decode() where it exists (a rejection still counts as done); otherwise complete, or the load/error event
    ready = typeof im.decode === 'function' ? Promise.resolve(im.decode()).catch(() => {})
      : im.complete ? Promise.resolve()
      : new Promise(res => { im.addEventListener('load', res, { once: true }); im.addEventListener('error', res, { once: true }); });
  } catch { ready = Promise.resolve(); }   // a decode() that throws synchronously
  return Promise.race([ready, wait(maxMs)]);   // capped: the caller always shows the card afterwards
}

async function go(target, fromHash = false) {
  if (target === active) return;
  if (target < 0 || target >= FEAT.length) return;
  if (busy || imageModalOpen()) return;
  busy = true;
  try {
    await ringMove(target - active, fromHash, { instant: false });
  } finally {
    busy = false;
  }
  flushRingArrivals();
  await pumpNavQueue();
}
const wait = ms => new Promise(r => setTimeout(r, ms));
function animate(ms, fn) {
  return new Promise(res => { const t0 = performance.now(); const f = now => { const t = Math.min(1, (now - t0) / ms); fn(t); t < 1 ? requestAnimationFrame(f) : res(); }; requestAnimationFrame(f); });
}

/** Left/Right (and J/K) step Older/Newer on the desktop carousel, same direction as swipes and side cards. */
function carouselKeysBlocked(e) {
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.defaultPrevented || e.isComposing) return true;
  if (mobileMode || imageModalOpen()) return true;
  const t = e.target;
  if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''))) return true;
  const sel = window.getSelection?.();
  return !!(sel && !sel.isCollapsed && String(sel).trim());
}
window.addEventListener('keydown', e => {
  const dir = e.key === 'ArrowRight' || e.key === 'k' || e.key === 'K' ? 1
    : e.key === 'ArrowLeft' || e.key === 'j' || e.key === 'J' ? -1 : 0;
  if (!dir || carouselKeysBlocked(e)) return;   // Up/Down/Space/PageUp/PageDown keep scrolling the page
  e.preventDefault();
  navRelative(dir);
});
window.addEventListener('hashchange', () => {
  const id = decodeURIComponent(location.hash.slice(1));
  if (!id) { openStoryFromLatest(false); return; }
  openStory(id, true);
});
window.addEventListener('popstate', () => {
  const id = decodeURIComponent(location.hash.slice(1));
  if (!id) { openStoryFromLatest(true); return; }
  const i = FEAT.findIndex(a => (a.key || a.id) === id);
  if (i >= 0 && i !== active) go(i, true);
  else if (i < 0) openStory(id, true);
});
// swipe (touch/pen anywhere on the stage; mouse drags only outside the text card so text stays selectable)
let sw = null;
// Touch and pen swipe anywhere on the stage, including the article card; mouse drags only outside the card so
// text stays selectable. Right-to-left = Newer, left-to-right = Older (newer cards sit on the right).
let swipedAt = 0;
stage.addEventListener('pointerdown', e => {
  if (mobileMode || imageModalOpen() || !e.isPrimary || (e.pointerType === 'mouse' && e.target.closest('.card'))) return;
  sw = { x: e.clientX, y: e.clientY, id: e.pointerId };
});
stage.addEventListener('pointercancel', () => { sw = null; });
stage.addEventListener('pointerup', e => {
  if (!sw || sw.id !== e.pointerId || imageModalOpen()) { sw = null; return; }
  const dx = e.clientX - sw.x, dy = e.clientY - sw.y; sw = null;
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.3) {
    swipedAt = performance.now();
    navRelative(dx < 0 ? 1 : -1);
  }
});
// a swipe that ends on a link, button or the image must not also activate it
stage.addEventListener('click', e => { if (performance.now() - swipedAt < 400) { e.preventDefault(); e.stopPropagation(); } }, true);
// dice tumble overlay: its own lazily imported module (with the vendored cannon-es), started on the click and
// never awaited, so the random story loads exactly as before while the dice roll over the page
function rollDiceOverlay() {
  if (reduced || matchMedia('(prefers-reduced-motion: reduce)').matches) return;   // no animation, nothing loaded
  import('./dice-roll.js?v=20261019k').then(m => m.rollDice()).catch(err => console.warn('dice roll', err));
}
$('.random-link')?.addEventListener('click', async e => {
  e.preventDefault();
  rollDiceOverlay();
  const rnd = await randomStoryKey().catch(err => { console.warn(err); return null; });
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

async function applyFeaturedState(feat, activeIndex, fromHash, opts = {}) {
  applyingWindow = true;
  try {
    return await applyFeaturedStateInner(feat, activeIndex, fromHash, opts);
  } finally {
    applyingWindow = false;
    flushRingArrivals();
  }
}
async function applyFeaturedStateInner(feat, activeIndex, fromHash, { omitHash = false, epoch = layoutEpoch } = {}) {
  if (mobileMode || layoutIsStale(epoch)) return false;
  document.documentElement.classList.remove('mode-mobile');
  FEAT = feat;
  active = activeIndex;
  offsets = FEAT.map((_, i) => i - active);
  // centre card first: it paints from the story text alone (its <img> streams in); images and WebGL follow
  renderCard(cardEl, active);
  fixCardHeight(); updateReadMoreState();
  markActiveTile();
  paintStats.centreAt = paintStats.centreAt || Math.round(performance.now());
  // the story is painted: end the loading state now, not when the archive page or three.js finish later
  stage.classList.remove('is-loading'); cardEl.classList.remove('card-loading');
  preloadImages();
  const glReady = ensureGL();
  await yieldToMain();
  const nextGl = await glReady;
  if (mobileMode || layoutIsStale(epoch)) return false;
  gl = nextGl;
  gl?.resume();
  document.documentElement.classList.toggle('mode-gl', !!gl);
  document.documentElement.classList.toggle('mode-css', !gl && !reduced);
  document.documentElement.classList.toggle('mode-reduced', reduced);
  rebuildSideButtons();
  gl?.rebuildSideMeshes();
  paintStats.sidesAt = paintStats.sidesAt || Math.round(performance.now());
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
  if (mobileMode) return openStoryMobile(null, fromHash);
  window.scrollTo(0, 0);
  stage.classList.add('is-loading');
  try {
    await ringOpen(null, fromHash, { omitHash: true });
  } catch (err) {
    console.error(err);
    toast('Failed to load GenAI News.');
  } finally {
    stage.classList.remove('is-loading');
  }
}

async function openStory(cacheKey, fromHash = false) {
  if (mobileMode) return openStoryMobile(cacheKey, fromHash);
  const epoch = layoutEpoch;
  window.scrollTo(0, 0);
  if (!cacheKey || isFutureCacheKey(cacheKey)) {
    await openLatestView(fromHash);
    return;
  }
  // already on the carousel: animate there (wrapping if that is shorter is not needed; the window is contiguous)
  const existing = FEAT.findIndex(a => (a.key || a.id) === cacheKey);
  if (existing >= 0 && ringPos >= 0) {
    if (existing !== active) {
      if (busy) { navQueue += existing - active; return; }
      busy = true;
      try { await ringMove(existing - active, fromHash, { instant: navQueue !== 0 }); } finally { busy = false; }
      flushRingArrivals();
    }
    return;
  }
  pendingDesktopKey = cacheKey;
  stage.classList.add('is-loading');
  cardEl.classList.add('card-loading');
  cardEl.setAttribute('aria-busy', 'true');
  const ownedBusy = !busy;
  if (ownedBusy) busy = true;
  try {
    await ringOpen(cacheKey, fromHash);
  } catch (err) {
    console.error(err);
    toast('Could not load that story.');
  } finally {
    stage.classList.remove('is-loading');
    cardEl.classList.remove('card-loading');
    if (!FEAT[active]?.placeholder) cardEl.removeAttribute('aria-busy');
    if (ownedBusy) busy = false;
    if (!layoutIsStale(epoch) && pendingDesktopKey === cacheKey) pendingDesktopKey = null;
    flushRingArrivals();
    await pumpNavQueue(fromHash);
  }
}

async function openStoryFromLatest(fromHash) {
  await openLatestView(fromHash);
  if (!fromHash && !location.hash) history.replaceState(null, '', location.pathname + location.search);
}

/* ---------------- small screens: earlier inline single-story flow (pre-carousel, eded488) ---------------- */
let mobileLoadSeq = 0;
let mobileLoadingId = null;

function enterMobileLayout() {
  collapseReadMore();
  gl?.suspend();   // the renderer is kept for a return to desktop; its textures are freed and nothing draws
  scene.innerHTML = '';
  sideBtns = [];
  const root = document.documentElement;
  root.classList.add('mode-mobile');
  root.classList.remove('mode-gl', 'mode-css', 'mode-reduced');
  cardEl.style.minHeight = '';
  cardEl.style.opacity = '1';
  cardEl.style.transform = '';
  cardEl.classList.remove('has-read-more', 'is-expanded', 'card-loading', 'css-flip-out', 'css-flip-in', 'fade-out', 'fade-in');
  if (endMarker) endMarker.hidden = true;
}

async function fetchStoryForMobile(cacheKey) {
  return fetchStoryPayload(cacheKey || null);
}

async function openStoryMobile(cacheKey, fromHash = false) {
  const key = cacheKey || null;
  const id = key || LATEST_SLOT_ID;
  const root = document.documentElement;
  if (mobileLoadingId === id) return;
  if (!mobileLoadingId && root.classList.contains('mode-mobile') && FEAT.length === 1 && FEAT[0].id === id) {
    window.scrollTo(0, 0);
    return;
  }
  enterMobileLayout();
  window.scrollTo(0, 0);
  const seq = ++mobileLoadSeq;
  mobileLoadingId = id;
  if (!fromHash) {
    if (key) history.pushState(null, '', '#' + key);
    else history.replaceState(null, '', location.pathname + location.search);
  }
  showArticleSkeleton();
  try {
    let payload = await fetchStoryForMobile(key);
    if (seq !== mobileLoadSeq || !mobileMode) return;
    let shownId = id;
    if (!payload?.[0] && key) {
      toast('Could not load that story.');
      payload = await fetchLatestEditorial();
      if (seq !== mobileLoadSeq || !mobileMode) return;
      shownId = LATEST_SLOT_ID;
      history.replaceState(null, '', location.pathname + location.search);
    }
    if (!payload?.[0]) throw new Error('No editorial returned');
    const art = normalizeArticle(payload[0], shownId);
    if (shownId === LATEST_SLOT_ID) art.isLatestSlot = true;
    FEAT = [art];
    active = 0;
    offsets = [0];
    clearArticleSkeletonState();
    cardEl.innerHTML = mobileArticleHTML(art);
    cardEl.dataset.id = art.id;
    wireByline(cardEl);
    markActiveTile();
    document.title = shownId !== LATEST_SLOT_ID ? `botz.ai - GenAI News - ${shownId}` : 'botz.ai - GenAI News';
    if (storyAnnouncer) storyAnnouncer.textContent = art.title;
    trackPageView();
    logCenteredKey();
    refreshArchiveTileTitles();
  } catch (err) {
    console.error(err);
    if (seq === mobileLoadSeq && mobileMode) { clearArticleSkeletonState(); cardEl.innerHTML = '<p class="mobile-error">Failed to load articles</p>'; }
  } finally {
    if (seq === mobileLoadSeq) {
      mobileLoadingId = null;
      cardEl.removeAttribute('aria-busy');
    }
  }
}

/* ---------------- boot ---------------- */
/** First load: archive tiles stay hidden behind the skeleton row until the top story is on screen, so the
 *  newest tile can be dropped before anyone sees it twice. */
function revealGrid() {
  hideRepeatedFirstTile();
  removeTileSkeletons();
  browseEl?.classList.remove('awaiting-top');
  gridEl.removeAttribute('aria-busy');
}
let stickyCardH = 0;
/** Measured card heights by story and width: a flick only measures the story that just entered the window. */
const cardHeightCache = new Lru(64);
const measureStats = { measured: 0, cached: 0 };
function fixCardHeight({ sticky = false } = {}) {
  // equalise card height across the visible stories so the floor/reflections do not jump between stories;
  // while flicking (sticky) it only grows, so the grid below never shifts per step
  cardEl.style.minHeight = '';
  const width = cardEl.getBoundingClientRect().width;   // the one read before the batch of writes below
  let maxH = sticky ? stickyCardH : 0;
  const todo = [];
  FEAT.forEach((a, i) => {
    if (a.placeholder) return;
    const h = cardHeightCache.get(`${a.id}|${a.title}|${width}`);
    if (h != null) { maxH = Math.max(maxH, h); measureStats.cached++; } else todo.push(i);
  });
  if (todo.length) {
    // write every unmeasured card into its own measuring clone, then read all heights: one layout, not one per card
    const clones = todo.map(i => {
      const el = measureEl.cloneNode(false);
      el.removeAttribute('id');
      el.style.width = width + 'px';
      renderCard(el, i);
      return el;
    });
    measureEl.after(...clones);
    clones.forEach((el, k) => {
      const a = FEAT[todo[k]], h = el.getBoundingClientRect().height;
      cardHeightCache.set(`${a.id}|${a.title}|${width}`, h);
      maxH = Math.max(maxH, h);
      measureStats.measured++;
    });
    clones.forEach(el => el.remove());
  }
  measureEl.style.width = width + 'px';
  stickyCardH = maxH;
  if (maxH) cardEl.style.minHeight = maxH + 'px';   // exact (the card has one fixed height now; rounding up would nudge the grid)
}
const paintStats = { centreAt: 0, sidesAt: 0 };
async function relayout() {
  if (mobileMode) return;
  fixCardHeight(); computeGeom(); layoutButtons();
  updateReadMoreState();
  if (gl) { gl.resize(); gl.setFrontTexture(snapFor(active)); frontStale = false; gl.kick(); }
}
async function boot() {
  editorialRequestCount = 0;
  seedStaticAuthors();
  stage.classList.add('is-loading');
  const hashKey = decodeURIComponent(location.hash.slice(1));
  showSideSkeletons(true);   // the ring has neighbours both ways (right-hand ones stay skeletons on the latest story)
  // deep link: start the linked story's request alongside the story list instead of after it (memoised, so reused)
  if (hashKey) fetchValidatedEditorial(hashKey).catch(() => {});
  if (!mobileMode) ensureGL();   // three.js loads alongside the story data; never awaited before the centre paints
  try {
    await Promise.all([
      ensureArchivePageLoaded(1),
      hashKey ? openStory(hashKey, true) : openStoryFromLatest(true),
    ]);
  } catch (e) {
    console.error(e);
    toast('Failed to load GenAI News.');
  } finally {
    stage.classList.remove('is-loading');
    revealGrid();
    if (!FEAT.length) scene.querySelectorAll('.side-skel').forEach(n => n.remove());
    if (cardEl.classList.contains('is-skeleton')) {
      clearArticleSkeletonState();
      cardEl.removeAttribute('aria-busy');
      cardEl.innerHTML = '<p class="mobile-error">Failed to load articles</p>';
    }
  }
}
await boot();
endMarker?.addEventListener('click', () => {
  const idx = FEAT.findIndex(a => a.id === LATEST_SLOT_ID);
  if (idx >= 0 && active !== idx) go(idx);
  else if (idx < 0 && ringPos !== ringLen() - 1) openLatestView(false);
});
endMarker?.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); endMarker?.click(); }
});
window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(relayout, 120); });
wide.addEventListener('change', relayout);
small.addEventListener('change', async () => {
  if (mobileMode === small.matches) return;
  mobileMode = small.matches;
  // invalidate whatever the previous layout still has in flight (desktop window build, flip, or mobile fetch)
  layoutEpoch++;
  mobileLoadSeq++;
  mobileLoadingId = null;
  navQueue = 0;
  const id = decodeURIComponent(location.hash.slice(1)) || null;
  if (mobileMode) {
    // a desktop story load that was cut off by the switch: open that story instead of the old hash
    const pending = pendingDesktopKey;
    pendingDesktopKey = null;
    if (pending && pending !== id) await openStoryMobile(pending, false);
    else await openStoryMobile(id, true);
    return;
  }
  // back to the desktop/tablet carousel: rebuild the featured window around the current story
  document.documentElement.classList.remove('mode-mobile');
  FEAT = [];
  active = 0;
  if (id) await openStory(id, true);
  else await openLatestView(true);
});
/* idle autoplay (desktop only; ./autoplay.js, loaded on the desktop layout unless reduced motion or ?autoplay=0):
   after AUTOPLAY_IDLE_MS without input, one step towards older stories every AUTOPLAY_STEP_MS through navRelative(-1),
   the same path as ArrowLeft, so wrap-around, prefetch and the day JSON behave as usual */
function autoplayBlocked() {
  if (mobileMode) return 'mobile';
  if (readMoreExpanded()) return 'read-more';
  if (imageModalOpen()) return 'modal';
  if (window.__botzDice && window.__botzDice.phase !== 'idle') return 'dice';
  if (busy || navQueue || applyingWindow) return 'busy';
  if (ringPos < 0 || ringLen() <= 1) return 'not-ready';
  return '';
}
function maybeStartAutoplay() {
  if (autoplayLoad || reduced || params.get('autoplay') === '0' || small.matches) return;
  autoplayLoad = import('./autoplay.js?v=20261019p').then(m => m.startAutoplay({
    params, stage, small, blocked: autoplayBlocked,
    step: () => { autoplayHistoryReplace = true; navRelative(-1); },
  })).catch(err => { console.warn('autoplay', err); });
}
small.addEventListener('change', maybeStartAutoplay);
maybeStartAutoplay();
window.__botzCarousel = { go, navRelative, openStory, get active() { return active; }, get busy() { return busy; }, get navQueue() { return navQueue; }, get navLog() { return window.__navLog; }, get centerKey() { return FEAT[active]?.id; }, get featIds() { return FEAT.map(a => a.id); }, get feat() { return FEAT.map((a, i) => ({ id: a.key || a.id, offset: i - active, placeholder: !!a.placeholder, seam: !!a.seam, ring: a.ringIndex })); }, get ring() { return { pos: ringPos, len: ringLen(), total: ringTotal, days: archiveIndex?.days.length || 0, wrapCrossed, pages: [...dayData.keys()].sort(), loaded: [...ringStories.values()].filter(x => x.article).length, cached: ringStories.size, keyAt: r => ringKeyAt(r), ...ringStats }; }, get modalOpen() { return imageModalOpen(); }, get readMore() { return { expanded: readMoreExpanded(), ...readMoreStats }; }, get showLatestSlot() { return showLatestSlot; }, get latestIsArchiveTop() { return latestIsArchiveTop; }, get newestArchiveKey() { return newestArchiveKey; }, get mode() { return gl ? 'webgl' : (reduced ? 'reduced' : 'css'); }, get editorialRequestCount() { return editorialRequestCount; }, get store() { return { days: dayData.size, stories: storyEntries.size, urls: [...archiveUrlsSeen], storyCount: dayStoreStories, max: DAY_STORE_MAX_STORIES, inFlight: jsonFlight.size, ...dayStoreStats }; }, get perf() { return { gl: gl?.stats() || null, renderersCreated: glStats.renderersCreated, imgs: imgs.size, imgMax: IMG_CACHE_MAX, ringStories: ringStories.size, cardHeights: cardHeightCache.size, measure: { ...measureStats }, snapshots: snapStats.count, images: { ...imageStats, variantMisses: variantMisses.size }, paint: { ...paintStats }, navLog: window.__navLog.length, tiles: tileIds.size }; }, get latestSlotId() { return LATEST_SLOT_ID; }, get mobileMode() { return mobileMode; }, get next() { return { ...nextStats, due: nextStoryDue(), centreIsNewest: centreIsNewest(), sr: nextSr.textContent }; }, ready: true };
