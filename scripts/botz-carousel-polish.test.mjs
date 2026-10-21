// Static guards for the botz.ai carousel polish (image shape, Read more overlay, loading FOUC).
// Browser checks (CLS, frame sampling, GL-vs-DOM pixels) live with the other Playwright checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const www = new URL('../www/botz.ai/', import.meta.url);
const css = fs.readFileSync(new URL('style.css', www), 'utf8');
const js = fs.readFileSync(new URL('carousel-app.js', www), 'utf8');
const html = fs.readFileSync(new URL('index.html', www), 'utf8');
const rule = sel => { const i = css.indexOf(sel + '{'); assert.ok(i >= 0, `rule ${sel}`); return css.slice(i, css.indexOf('}', i)); };

test('one image shape: --img-ar and --img-hw agree with each other and with IMG_HW in the JS', () => {
  const [, a, b] = /--img-ar:\s*(\d+)\s*\/\s*(\d+)/.exec(css);
  const hw = +/--img-hw:\s*([\d.]+)/.exec(css)[1];
  const [, n, d] = /const IMG_HW = (\d+) \/ (\d+);/.exec(js);
  assert.ok(Math.abs(hw - b / a) < 1e-5, `--img-hw ${hw} vs ${b}/${a}`);
  assert.ok(Math.abs(n / d - b / a) < 1e-9, `IMG_HW ${n}/${d} vs ${b}/${a}`);
  assert.ok(+a < +b, 'taller than wide');
});

test('tiles, centre card, side cards and every skeleton use the shared shape (no square leftovers)', () => {
  assert.doesNotMatch(css, /aspect-ratio:\s*1\s*\/\s*1/);
  for (const sel of ['.tile img', '.skel-tile-img', '.side-skel-img', '.side .side-img']) assert.match(rule(sel), /aspect-ratio:var\(--img-ar\)/, sel);
  assert.match(rule('.tile img'), /height:auto/, 'tile height is not the 400px attribute');
  assert.match(rule('.card-img'), /height:calc\(var\(--img-w\) \* var\(--img-hw\)\)/);
  assert.match(rule('.skel-img'), /height:calc\(var\(--img-w\) \* var\(--img-hw\)\)/);
  assert.match(css, /--text-h:calc\(var\(--img-w\) \* var\(--img-hw\)\)/);
  assert.match(rule('.card-img'), /object-fit:cover/);
  assert.doesNotMatch(js, /width="340" height="340"|width="400" height="400"/);
});

test('WebGL textures draw images cover-cropped, never stretched', () => {
  assert.match(js, /function drawCover\(ctx, im, x, y, w, h\)/);
  assert.doesNotMatch(js, /ctx\.drawImage\(im, x, y, r\.width, r\.height\)|ctx\.drawImage\(im, 0, 0, W, W\)/);
  assert.match(js, /SIDE_ASPECT = SIDE_TEX_H \/ SIDE_TEX_W/);
});

test('expanded Read more grows to fit: no inner scrolling, no max-height', () => {
  const i = css.indexOf('.card.is-expanded{'); const block = css.slice(i, css.indexOf('}', i));
  assert.doesNotMatch(block, /overflow-y:\s*auto|overflow-y:\s*scroll|scrollbar-gutter|max-height/);
  assert.match(block, /overflow:visible/);
  const fn = js.slice(js.indexOf('function sizeExpandedCard'), js.indexOf('function expandReadMore'));
  assert.doesNotMatch(fn, /maxHeight\s*=\s*[^'"]/);
});

test('loading never dims a freshly painted story; dark first paint', () => {
  assert.doesNotMatch(css, /\.stage\.is-loading \.card\{opacity/);
  assert.match(css, /\.stage\.is-loading \.card\.card-loading\{opacity:\.55\}/);
  const at = js.indexOf('paintStats.centreAt = paintStats.centreAt');
  assert.match(js.slice(at, at + 300), /stage\.classList\.remove\('is-loading'\)/);
  assert.match(html, /<meta name="color-scheme" content="dark">/);
  assert.ok(html.indexOf('<style>html{background:') < html.indexOf('href="style.css'), 'inline dark background before the stylesheet');
});

test('flip snapshot fades clamped .card-more text like the CSS mask and the decode wait is short', () => {
  const snap = js.slice(js.indexOf('function snapshot('), js.indexOf('function wrap('));
  assert.match(snap, /\.card-more/);
  assert.match(snap, /destination-out/, 'fade erases the bottom of the paragraph layer');
  assert.match(snap, /addColorStop\(0\.7,/, 'fade starts at 70% like the mask');
  assert.match(snap, /min-width:761px/, 'fade only on desktop, like the CSS');
  assert.match(rule('.card.has-read-more:not(.is-expanded) .card-more').replace(/\s/g, ''), /#00070%/, 'CSS mask still 70%');
  const m = /function cardImageDecoded\(el, maxMs = (\d+)\)/.exec(js);
  assert.ok(m && +m[1] <= 120, 'decode wait <= 120ms');
});
