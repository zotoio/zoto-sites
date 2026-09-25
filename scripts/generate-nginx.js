#!/usr/bin/env node
/**
 * Generate nginx virtual host configs from sites/*.json manifests.
 *
 * Usage: node scripts/generate-nginx.js [--check]
 *   --check  Exit 1 if nginx-conf/ would change (for CI).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SITES_DIR = path.join(ROOT, 'sites');
const OUTPUT_DIR = path.join(ROOT, 'nginx-conf');

const ERROR_PAGE_CODES =
  '400 401 402 403 404 405 406 407 408 409 410 411 412 413 414 415 416 417 418 421 422 423 424 425';

function loadSites() {
  const files = fs
    .readdirSync(SITES_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();

  return files.map((file) => {
    const site = JSON.parse(fs.readFileSync(path.join(SITES_DIR, file), 'utf8'));
    if (!site.id || !Array.isArray(site.domains) || site.domains.length === 0) {
      throw new Error(`${file}: each site needs "id" and a non-empty "domains" array`);
    }
    return site;
  });
}

function renderProxyBlock(proxy) {
  const { path: locationPath, upstream } = proxy;
  return `    location ${locationPath} {
        proxy_set_header Host $host;
        proxy_read_timeout 900s;
        proxy_connect_timeout 75s;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_pass ${upstream};
    }`;
}

function renderSite(site) {
  const serverNames = site.domains.join(' ');
  const proxyBlocks = (site.proxies || []).map(renderProxyBlock).join('\n\n');
  const proxySection = proxyBlocks ? `\n\n${proxyBlocks}` : '';

  return `server {
    listen 443 ssl;
    http2 on;
    server_name  ${serverNames};

    location / {
        root   /usr/share/nginx/html/${site.id};
        index  index.html index.htm;
    }${proxySection}

    error_page ${ERROR_PAGE_CODES} /error.html;

    location /error.html {
      ssi on;
      internal;
      auth_basic off;
      root /usr/share/nginx/html;
    }
}
`;
}

function generate() {
  const sites = loadSites();
  const output = {};

  for (const site of sites) {
    output[`${site.id}.conf`] = renderSite(site);
  }

  return output;
}

function writeOutput(files) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(OUTPUT_DIR, name), content);
  }

  const stale = fs
    .readdirSync(OUTPUT_DIR)
    .filter((f) => f.endsWith('.conf') && !files[f]);

  for (const name of stale) {
    fs.unlinkSync(path.join(OUTPUT_DIR, name));
  }
}

function checkOutput(files) {
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(OUTPUT_DIR, name);
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== content) {
      console.error(`nginx-conf/${name} is out of date. Run: node scripts/generate-nginx.js`);
      process.exit(1);
    }
  }

  const stale = fs
    .readdirSync(OUTPUT_DIR)
    .filter((f) => f.endsWith('.conf') && !files[f]);

  if (stale.length > 0) {
    console.error(`Stale nginx configs: ${stale.join(', ')}. Run: node scripts/generate-nginx.js`);
    process.exit(1);
  }

  console.log('nginx-conf/ is up to date.');
}

const checkOnly = process.argv.includes('--check');
const files = generate();

if (checkOnly) {
  checkOutput(files);
} else {
  writeOutput(files);
  console.log(`Generated ${Object.keys(files).length} nginx config(s) in nginx-conf/`);
}
