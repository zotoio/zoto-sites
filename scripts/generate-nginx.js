#!/usr/bin/env node
/**
 * Generate nginx virtual host configs from sites/*.json manifests
 * and projects/botz.ai/<name>/ subdomain manifests.
 *
 * Usage: node scripts/generate-nginx.js [--check]
 *   --check  Exit 1 if nginx-conf/ would change (for CI).
 */

const fs = require('fs');
const path = require('path');
const { discoverBotzProjects } = require('./lib/botz-projects');

const ROOT = path.resolve(__dirname, '..');
const SITES_DIR = path.join(ROOT, 'sites');
const OUTPUT_DIR = path.join(ROOT, 'nginx-conf');

const ERROR_PAGE_CODES =
  '400 401 402 403 404 405 406 407 408 409 410 411 412 413 414 415 416 417 418 421 422 423 424 425';

const ERROR_PAGE_BLOCK = `
    error_page ${ERROR_PAGE_CODES} /error.html;

    location /error.html {
      ssi on;
      internal;
      auth_basic off;
      root /usr/share/nginx/html;
    }`;

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

function siteApiFallbackName(siteId) {
  return `@${String(siteId).replace(/\./g, '_')}_api_unavailable`;
}

function renderApiUnavailableFallback(fallbackName) {
  return `    location ${fallbackName} {
        internal;
        default_type application/json;
        add_header Cache-Control "no-store" always;
        return 503 '{"ok":false,"error":"API temporarily unavailable. Static pages still load; retry shortly."}';
    }`;
}

function renderProxyBlock(proxy, { apiFallbackName } = {}) {
  const { path: locationPath, upstream, websocket, dynamic_dns: dynamicDns } = proxy;
  const wsHeaders = websocket
    ? `
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";`
    : '';

  if (dynamicDns) {
    const fallback = apiFallbackName || '@api_unavailable';
    return `    location ${locationPath} {
        resolver 127.0.0.11 valid=30s ipv6=off;
        set $dynamic_upstream "${upstream}";
        proxy_set_header Host $host;
        proxy_read_timeout 900s;
        proxy_connect_timeout 75s;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_intercept_errors on;${wsHeaders}
        proxy_pass $dynamic_upstream;
        error_page 502 503 504 = ${fallback};
    }`;
  }

  return `    location ${locationPath} {
        proxy_set_header Host $host;
        proxy_read_timeout 900s;
        proxy_connect_timeout 75s;
        proxy_set_header X-Real-IP $remote_addr;${wsHeaders}
        proxy_pass ${upstream};
    }`;
}

function renderExtraHeaders(headers) {
  if (!headers || typeof headers !== 'object') {
    return '';
  }
  const lines = Object.entries(headers).map(
    ([key, value]) => `        add_header ${key} ${value} always;`
  );
  return lines.length ? `\n${lines.join('\n')}` : '';
}

function renderBotzEditorialCacheBlocks() {
  return `
    # Editorial cache bind-mount: block dot-path archives (e.g. /cache/.replaced/).
    location ~ ^/cache/\\. {
        deny all;
        return 403;
    }

    location /cache/ {
        alias /usr/share/nginx/html/botz.ai/cache/;
    }`;
}

function renderHttpToHttpsRedirect(site) {
  const serverNames = site.domains.join(' ');
  return `server {
    listen 80;
    server_name  ${serverNames};
    return 301 https://$host$request_uri;
}

`;
}

function renderSite(site) {
  const serverNames = site.domains.join(' ');
  const proxies = site.proxies || [];
  const apiFallbackName = proxies.some((p) => p.dynamic_dns)
    ? siteApiFallbackName(site.id)
    : null;
  const proxyBlocks = proxies
    .map((p) => renderProxyBlock(p, { apiFallbackName }))
    .join('\n\n');
  const fallbackBlock = apiFallbackName ? `\n\n${renderApiUnavailableFallback(apiFallbackName)}` : '';
  const proxySection = proxyBlocks ? `\n\n${proxyBlocks}${fallbackBlock}` : '';
  const cacheBlocks = site.id === 'botz.ai' ? renderBotzEditorialCacheBlocks() : '';

  return `${renderHttpToHttpsRedirect(site)}server {
    listen 443 ssl;
    http2 on;
    server_name  ${serverNames};

    location / {
        root   /usr/share/nginx/html/${site.id};
        index  index.html index.htm;
    }${cacheBlocks}${proxySection}
${ERROR_PAGE_BLOCK}
}
`;
}

function renderBotzSubdomainProject(project) {
  const { name, hostname, manifest } = project;
  const extraHeaders = renderExtraHeaders(manifest.headers);
  const titleComment = manifest.title ? ` # ${manifest.title}` : '';

  if (manifest.type === 'proxy') {
    const upstream = manifest.proxy.upstream;
    const websocket = manifest.proxy.websocket === true;
    const proxyBlock = renderProxyBlock({
      path: '/',
      upstream,
      websocket,
    });

    return `server {
    listen 80;
    listen 443 ssl;
    http2 on;
    server_name  ${hostname};${titleComment}
${extraHeaders}

${proxyBlock}
${ERROR_PAGE_BLOCK}
}
`;
  }

  const spaFallback = manifest.spa_fallback === true;
  const staticRoot = `/usr/share/nginx/html/projects/botz.ai/${name}/public`;
  const locationBlock = spaFallback
    ? `    location / {
        root   ${staticRoot};
        index  index.html index.htm;
        try_files $uri $uri/ /index.html;
    }`
    : `    location / {
        root   ${staticRoot};
        index  index.html index.htm;
    }`;

  return `server {
    listen 80;
    listen 443 ssl;
    http2 on;
    server_name  ${hostname};${titleComment}
${extraHeaders}

${locationBlock}
${ERROR_PAGE_BLOCK}
}
`;
}

function renderBotzSubdomainCatchAll() {
  return `server {
    listen 80;
    listen 443 ssl;
    http2 on;
    server_name  *.botz.ai;

    error_page 404 /subdomain-not-found.html;

    location / {
        return 404;
    }

    location = /subdomain-not-found.html {
        root /usr/share/nginx/html/botz.ai;
        internal;
    }
${ERROR_PAGE_BLOCK}
}
`;
}

function generate() {
  const sites = loadSites();
  const output = {};

  for (const site of sites) {
    output[`${site.id}.conf`] = renderSite(site);
  }

  const projects = discoverBotzProjects();
  for (const project of projects) {
    if (!project.enabled) {
      continue;
    }
    output[`botz.ai-sub-${project.name}.conf`] = renderBotzSubdomainProject(project);
  }

  output['botz.ai-subdomain-catchall.conf'] = renderBotzSubdomainCatchAll();

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
  const projectCount = Object.keys(files).filter((k) => k.startsWith('botz.ai-sub-')).length;
  console.log(
    `Generated ${Object.keys(files).length} nginx config(s) in nginx-conf/ (${projectCount} botz.ai subdomain vhost(s))`
  );
}
