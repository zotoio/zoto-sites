// Static guards for the botz.ai Older/Newer arrow buttons (browser position checks live with the Playwright checks).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const www = new URL('../www/botz.ai/', import.meta.url);
const css = fs.readFileSync(new URL('style.css', www), 'utf8');
const js = fs.readFileSync(new URL('carousel-app.js', www), 'utf8');
const html = fs.readFileSync(new URL('index.html', www), 'utf8');

test('arrows are real buttons outside the card, Older on the left (data-nav -1) and Newer on the right (+1)', () => {
  const at = html.indexOf('id="stage-arrows"');
  assert.ok(at > html.indexOf('id="card"'), 'after the card, outside it');
  const block = html.slice(at, html.indexOf('</div>', at));
  const older = block.indexOf('data-nav="-1"'), newer = block.indexOf('data-nav="1"');
  assert.ok(older > 0 && newer > older, 'Older first (left), Newer second (right)');
  assert.match(block, /class="nav-arrow nav-arrow-older" data-nav="-1" aria-label="Older story"/);
  assert.match(block, /class="nav-arrow nav-arrow-newer" data-nav="1" aria-label="Newer story"/);
  assert.match(block, /<svg[^>]*aria-hidden="true"/);
  assert.doesNotMatch(html, /skel-foot/);
  assert.doesNotMatch(js, /card-foot/);
});

test('circles centred on the card edges, collapsed-card centre, hidden on mobile', () => {
  assert.match(css, /\.nav-arrow\{[^}]*border-radius:50%/);
  assert.match(css, /\.nav-arrow-older\{left:var\(--arrow-x\); transform:translateX\(-50%\)\}/);
  assert.match(css, /\.nav-arrow-newer\{right:var\(--arrow-x\); transform:translateX\(50%\)\}/);
  assert.match(css, /--arrow-x:max\(calc\(var\(--arrow-d\) \/ 2 - var\(--wrap-pad\)\), calc\(50% - min\(var\(--card-w\), 100%\) \/ 2\)\)/);
  assert.match(css, /\.nav-arrow:focus-visible\{outline:3px solid/);
  assert.match(css, /@media \(max-width:760px\)\{ \.stage-arrows\{display:none\} \}/);
});

test('Read more never moves them: expanded uses the spacer that holds the collapsed slot', () => {
  const fn = js.slice(js.indexOf('function positionArrows'), js.indexOf('if (arrowsEl) {'));
  assert.match(fn, /readMoreExpanded\(\) \? cardSpacer : cardEl/);
  assert.match(js, /arrowsEl\?\.addEventListener\('click'[\s\S]{0,120}navRelative\(Number\(b\.dataset\.nav\)\)/);
});
