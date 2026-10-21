// Static guards for the botz.ai review fixes (TDZ, decode guard, text-first centre, arch-agnostic sharp check,
// expanded Read more stacking, grid heading contrast, scrollbar gutter) and the next-story countdown.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const app = read('www/botz.ai/carousel-app.js');
const css = read('www/botz.ai/style.css');
const html = read('www/botz.ai/index.html');
const dockerfile = read('backends/botz.ai/Dockerfile');
const verify = read('scripts/verify-botz-docker-image.sh');
const backend = read('backends/botz.ai/index.js');

test('no top-level let/const/class after the top-level await boot() (input listeners run during boot: TDZ)', () => {
  const m = /^await boot\(\);/m.exec(app);
  assert.ok(m, 'top-level await boot()');
  const after = app.slice(m.index);
  const late = [...after.matchAll(/^(?:let|const|class)\s+([A-Za-z_$][\w$]*)/gm)].map(x => x[1]);
  assert.deepEqual(late, [], `declared after boot: ${late.join(', ')}`);
  for (const name of ['autoplayHistoryReplace', 'autoplayLoad', 'rz']) {
    const decl = new RegExp(`^let ${name}\\b`, 'm').exec(app);
    assert.ok(decl && decl.index < m.index, `${name} declared before boot`);
  }
});

test('cardImageDecoded: decode() optional, rejection/throw tolerated, load/error fallback, capped wait', () => {
  const fn = /function cardImageDecoded\([\s\S]*?\n}/.exec(app)?.[0] || '';
  assert.match(fn, /typeof im\.decode === 'function'/);
  assert.match(fn, /\.catch\(\(\) => \{\}\)/);
  assert.match(fn, /addEventListener\('load'/);
  assert.match(fn, /addEventListener\('error'/);
  assert.match(fn, /catch \{/);
  assert.match(fn, /Promise\.race\(\[ready, wait\(maxMs\)\]\)/);
  assert.match(fn, /maxMs = \d+\)/);   // capped (main shortened it from 300 to 120 ms)
  assert.doesNotMatch(fn, /return Promise\.race\(\[im\.decode\(\)/);
});

test('an unbuffered centre paints as soon as its text arrives (image fills in later)', () => {
  const block = /st\.textPromise = loadRingText\(key\)\.then\([\s\S]*?\n {2}\}\);/.exec(app)?.[0] || '';
  assert.match(block, /FEAT\[active\]\?\.placeholder && FEAT\[active\]\.key === key\) ringStoryArrived\(key\)/);
  assert.match(app, /const ready = st\?\.article \|\| \(o === 0 \? st\?\.text : null\)/);
});

test('Docker sharp check works on any architecture', () => {
  assert.doesNotMatch(dockerfile, /test -d node_modules\/@img\/sharp-linuxmusl-x64/);
  assert.match(dockerfile, /node -e "require\('sharp'\)"/);
  assert.match(dockerfile, /node_modules\/@img\/sharp-linuxmusl-\*/);
  assert.doesNotMatch(verify, /sharp-linuxmusl-x64/);
  assert.match(verify, /sharp-linuxmusl-\$arch/);
});

test('expanded Read more: only the card rises above the grid; heading readable; stable gutter', () => {
  assert.match(css, /\.stage\.has-expanded-card\{isolation:auto; z-index:auto\}/);
  assert.doesNotMatch(css, /\.stage\.has-expanded-card\{z-index:6\}/);
  assert.match(css, /\.card\.is-expanded\{[^}]*z-index:30/);
  const h2 = /\.browse h2\{[^}]*\}/.exec(css)?.[0] || '';
  assert.doesNotMatch(h2, /var\(--muted\)/);
  assert.match(h2, /color:#e3e8e3/);
  assert.match(css, /html\.modal-open\{overflow:hidden; scrollbar-gutter:stable\}/);
  assert.match(app, /const y = Math\.round\(ref\.offsetTop \+ h \/ 2\);/);
});

test('next-story countdown: backend schedule, pale side card, a11y, paused when hidden, picks up the story', () => {
  assert.match(app, /noteGeneration\(d\?\.generation\)/);
  assert.match(app, /noteGeneration\(raw\?\.generation\)/);
  assert.doesNotMatch(app, /'1 \* \* \* \*'|20:00/, 'no schedule hard-coded in the client');
  assert.match(app, /i === active \+ 1 && a\.seam && centreIsNewest\(\)/);
  assert.match(app, /setAttribute\('aria-hidden', 'true'\)/);
  assert.match(app, /nextSr\.setAttribute\('aria-live', 'polite'\)/);
  assert.match(app, /if \(mins !== nextSrMinute\)/, 'screen reader text changes at most once a minute');
  assert.match(app, /'any moment now'/);
  assert.match(app, /visibilityState === 'hidden'\) \{ clearTimeout\(nextTick\)/);
  assert.match(app, /fetch\('\/archive\/latest', \{ cache: 'no-cache' \}\)/);
  assert.match(app, /function pickUpNewStory\(day\)/);
  assert.match(css, /\.scene \.side-next \.side-next-t\{[^}]*font-variant-numeric:tabular-nums/);
  assert.match(backend, /import \{ generationConfigFromEnv, generationInfo \} from '\.\/generationSchedule\.js';/);
  assert.match(backend, /const withGeneration = body =>/);
  assert.equal((backend.match(/withGeneration\(/g) || []).length, 2, '/archive/index + /archive/latest');
  assert.match(dockerfile, /backends\/botz\.ai\/generationSchedule\.js/);
});

test('edge cards are pre-rendered: wider window than visible, buffer past it, textures uploaded at bind', () => {
  const n = name => Number(new RegExp(`^const ${name} = (\\d+);`, 'm').exec(app)?.[1]);
  assert.equal(n('RING_VISIBLE'), 3);
  assert.ok(n('RING_PRERENDER') >= 2, 'at least two hidden cards each way');
  assert.match(app, /^const RING_RADIUS = RING_VISIBLE \+ RING_PRERENDER;/m);
  assert.match(app, /^const RING_BUFFER = RING_RADIUS \+ 1;/m);
  assert.ok(n('RING_KEEP') >= n('RING_VISIBLE') + n('RING_PRERENDER') + 1, 'keep covers the buffer');
  assert.match(app, /Math\.min\(RING_RADIUS, Math\.floor\(\(n - 1\) \/ 2\)\)/);
  assert.match(app, /renderer\.initTexture\(tex\)/);
  assert.match(app, /const SIDE_TEX_MAX = 24;/, 'texture LRU bound unchanged');
  assert.match(app, /edgeStats\.popIns\+\+/);
});

test('countdown review: overrun runs still awaited, same-key rewrites picked up, stamps use the backend offset', async () => {
  const { generationConfigFromEnv, generationInfo } = await import('../backends/botz.ai/generationSchedule.js');
  const g = generationInfo(generationConfigFromEnv({}), new Date('2026-10-20T20:05:00Z'), 0);
  assert.equal(g.upcoming[0], '2026-10-20T20:01:00.000Z', 'the 20:01 run is still listed 4 min later');
  assert.equal(g.grace_s, 600);
  assert.match(app, /top\.cache_key !== cur\?\.cache_key \|\| \(top\.generated_at \|\| ''\) !== \(cur\?\.generated_at \|\| ''\)/);
  assert.match(app, /ringStories\.delete\(replaced\); imgs\.delete\(replaced\); gl\?\.evictStory\(replaced\);/);
  assert.match(app, /- \(generation\?\.stampOffsetMs \|\| 0\)/);
  assert.match(app, /due \+ generation\.graceMs > now/);
  assert.doesNotMatch(app, /if \(top && archiveIndex && !storyEntries\.has\(top\)\)/);
});

test('countdown: large time centred over the 7:8 image box, small label in the text band', () => {
  assert.match(app, /<div class="side-next-img"><span class="side-next-t">--:--<\/span><\/div><div class="side-next-txt"><span class="side-next-l">next story in<\/span><\/div>/);
  const box = /\.scene \.side-next \.side-next-img\{[^}]*\}/.exec(css)?.[0] || '';
  assert.match(box, /aspect-ratio:var\(--img-ar\)/); assert.match(box, /place-items:center/);
  const t = /\.scene \.side-next \.side-next-t\{[^}]*\}/.exec(css)?.[0] || '';
  assert.match(t, /calc\(var\(--sw, 300px\) \* \.2\)/); assert.match(t, /tabular-nums/); assert.match(t, /rgba\(236,241,236,\.82\)/);
  assert.match(css, /\.mode-gl \.scene \.side-next > \*\{visibility:visible\}/);
});
