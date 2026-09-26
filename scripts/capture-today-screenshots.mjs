/**
 * Headless screenshots for today.zoto.io PR artifacts.
 * Usage: node scripts/capture-today-screenshots.mjs
 * Requires: dev server on :8081, `npx playwright install chromium` once.
 */
import { chromium } from 'playwright';
import { mkdir } from 'fs/promises';

const OUT = '/opt/cursor/artifacts';
const BASE = process.env.TODAY_URL || 'http://localhost:8081';

async function waitForMapTiles(page, selector, minTiles = 4) {
  await page.waitForSelector(selector, { timeout: 20000 });
  const tileHost = selector;
  for (let i = 0; i < 8; i += 1) {
    const seen = await page.evaluate((sel) => {
      const root = document.querySelector(sel);
      if (!root) return 0;
      const loaded = root.querySelectorAll('.leaflet-tile-loaded').length;
      const imgs = root.querySelectorAll('img.leaflet-tile').length;
      return Math.max(loaded, imgs);
    }, tileHost);
    if (seen >= minTiles) break;
    await page.waitForTimeout(750);
  }
  await page.waitForFunction(
    ({ sel, min }) => {
      const root = document.querySelector(sel);
      if (!root) return false;
      const n = root.querySelectorAll('.leaflet-tile-loaded, img.leaflet-tile').length;
      return n >= min;
    },
    { sel: tileHost, min: minTiles },
    { timeout: 60000 }
  );
  await page.waitForTimeout(800);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });

  // --- Demo dashboard at true 1920x1080 ---
  {
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    await page.goto(`${BASE}/?demo=1`, { waitUntil: 'networkidle' });
    await page.evaluate(() => localStorage.removeItem('today.zoto.io.layout.v1'));
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/today-dashboard-1920x1080.png`, fullPage: false });
    await context.close();
  }

  // --- Demo dashboard at 1280x800 ---
  {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    await page.goto(`${BASE}/?demo=1`, { waitUntil: 'networkidle' });
    await page.evaluate(() => localStorage.removeItem('today.zoto.io.layout.v1'));
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/today-dashboard-1280x800.png`, fullPage: false });
    await context.close();
  }

  // --- Transit compact / no stops ---
  {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    await page.route('**/api/transit**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ source: 'overpass', stops: [], radiusM: 900 }),
      });
    });

    const transitOnlyLayout = {
      schema: 1,
      widgets: [
        {
          id: 'location',
          type: 'location',
          x: 0,
          y: 0,
          w: 12,
          h: 2,
          settings: {},
        },
        {
          id: 'transit',
          type: 'transit',
          x: 0,
          y: 2,
          w: 6,
          h: 4,
          settings: {},
        },
      ],
    };

    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.evaluate((layout) => {
      localStorage.setItem('today.zoto.io.layout.v1', JSON.stringify(layout));
    }, transitOnlyLayout);
    await page.goto(`${BASE}/?demo=1`, { waitUntil: 'networkidle' });
    await page.waitForSelector('[gs-id="transit"] .transit-widen-btn', { timeout: 20000 });
    await waitForMapTiles(page, '.transit-map', 3);
    await page.evaluate(() => {
      const el = document.querySelector('.transit-map');
      el?._leaflet?.invalidateSize({ animate: false });
    });
    await page.waitForTimeout(1200);
    const transitCard = page.locator('[gs-id="transit"] .widget');
    await transitCard.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await transitCard.screenshot({ path: `${OUT}/today-transit-empty-compact.png` });
    await context.close();
  }

  await browser.close();
  console.log('Wrote screenshots to', OUT);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
