#!/usr/bin/env node
/**
 * CI guard: docker-compose bind mounts and botz CACHE_DIR must match deploy/persistent-data.txt.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const manifestPath = path.join(root, 'deploy', 'persistent-data.txt');
const { listComposeFiles, dockerComposeConfigJson } = require('./lib/compose-stack');

function readManifest() {
  const text = fs.readFileSync(manifestPath, 'utf8');
  const allowedBinds = [];
  let inBinds = false;
  for (const line of text.split('\n')) {
    if (line.includes('ALLOWED_COMPOSE_BIND_SOURCES')) {
      inBinds = true;
      continue;
    }
    const trimmed = line.replace(/#.*$/, '').trim();
    if (!trimmed) continue;
    if (inBinds) {
      allowedBinds.push(trimmed);
    }
  }
  return { allowedBinds };
}

function ensureDummyEnvFiles() {
  const specs = [
    ['backends/botz.ai/.env', 'OPENAI_API_KEY=x\nNEWS_API_KEY=x\nSHARED_SECRET=x\n'],
    ['backends/discord/.env', 'DISCORD_TOKEN=x\nDISCORD_APPLICATION_ID=x\n'],
    ['backends/today.zoto.io/.env', 'PORT=3001\n'],
  ];
  for (const [rel, content] of specs) {
    const p = path.join(root, rel);
    if (!fs.existsSync(p)) {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, content);
    }
  }
}

function parseComposeFallbackServiceBlock(body) {
  const svc = { volumes: [], environment: {} };
  const volSection = body.match(/volumes:\s*\n((?:\s+- .+\n)+)/);
  if (volSection) {
    for (const line of volSection[1].match(/^\s+- .+$/gm) || []) {
      const v = line.replace(/^\s+-\s+/, '').trim();
      svc.volumes.push(v);
    }
  }
  const envBlock = body.match(/environment:\s*\n((?:\s+.+\n)+)/);
  if (envBlock) {
    for (const line of envBlock[1].match(/^\s+[^:]+:\s*.+$/gm) || []) {
      const [k, ...rest] = line.trim().split(':');
      svc.environment[k.trim()] = rest.join(':').trim();
    }
  }
  return svc;
}

function parseComposeFallback(yaml) {
  const services = {};
  const blocks = yaml.split(/^  ([a-z0-9_-]+):\s*$/m);
  for (let i = 1; i < blocks.length; i += 2) {
    const name = blocks[i];
    const body = blocks[i + 1] || '';
    services[name] = parseComposeFallbackServiceBlock(body);
  }
  return { services };
}

function parseComposeFallbackMerged() {
  const services = {};
  for (const file of listComposeFiles(root)) {
    const yaml = fs.readFileSync(file, 'utf8');
    const parsed = parseComposeFallback(yaml);
    Object.assign(services, parsed.services);
  }
  return { services };
}

function normalizeBindSource(source) {
  if (source.startsWith('./')) {
    return path.resolve(root, source.slice(2));
  }
  if (source === '${SSL_CERT_DIR:-./ssl}') {
    return path.resolve(root, 'ssl');
  }
  return source;
}

function main() {
  const { allowedBinds } = readManifest();
  const allowedResolved = new Set(
    allowedBinds.map((s) => {
      if (s.includes('SSL_CERT_DIR')) {
        return path.resolve(root, 'ssl');
      }
      return normalizeBindSource(s);
    })
  );

  ensureDummyEnvFiles();

  let configJson;
  try {
    execSync('docker compose version', { cwd: root, stdio: 'ignore' });
    configJson = dockerComposeConfigJson(root);
  } catch (e) {
    console.warn('docker compose unavailable; using merged compose file fallback parser');
    configJson = parseComposeFallbackMerged();
  }

  for (const [name, svc] of Object.entries(configJson.services || {})) {
    for (const vol of svc.volumes || []) {
      if (typeof vol === 'object' && vol.type === 'volume') {
        console.error(`named volume on service ${name} is not allowed`);
        process.exit(1);
      }
      if (typeof vol === 'string' && !vol.includes(':')) {
        console.error(`unexpected volume on ${name}: ${vol}`);
        process.exit(1);
      }
    }
  }

  const bindSources = [];
  for (const [name, svc] of Object.entries(configJson.services || {})) {
    for (const vol of svc.volumes || []) {
      let source;
      let target;
      if (typeof vol === 'string') {
        const parts = vol.split(':');
        source = parts[0];
        target = parts[1];
      } else if (vol?.type === 'bind') {
        source = vol.source;
        target = vol.target;
      } else if (vol?.type === 'volume') {
        console.error(`named volume on service ${name}`);
        process.exit(1);
      } else {
        continue;
      }
      if (!source || source.startsWith('/var/')) continue;
      const resolved = path.resolve(root, source.replace(/^\.\//, ''));
      bindSources.push({ service: name, source, resolved, target });
    }
  }

  for (const b of bindSources) {
    const ok = [...allowedResolved].some((a) => b.resolved === a || b.resolved.startsWith(a + path.sep));
    if (!ok) {
      console.error(
        `bind mount source not in manifest allowed list: ${b.service} ${b.source} -> ${b.target} (resolved ${b.resolved})`
      );
      process.exit(1);
    }
  }

  const botz = configJson.services?.botz;
  if (!botz) {
    console.error('missing botz service');
    process.exit(1);
  }

  let cacheDir;
  const env = botz.environment;
  if (Array.isArray(env)) {
    const entry = env.find((e) => String(e).startsWith('CACHE_DIR='));
    cacheDir = entry ? entry.split('=').slice(1).join('=') : undefined;
  } else if (env && typeof env === 'object') {
    cacheDir = env.CACHE_DIR;
  }

  if (cacheDir !== '/home/root/cache') {
    console.error(`botz must set CACHE_DIR=/home/root/cache in compose environment (got ${cacheDir})`);
    process.exit(1);
  }

  const targets = (botz.volumes || []).map((v) => {
    if (typeof v === 'string') return v.split(':')[1];
    return v?.target;
  }).filter(Boolean);

  const mounted = targets.some((t) => cacheDir === t || cacheDir.startsWith(`${t}/`));
  if (!mounted) {
    console.error(`CACHE_DIR ${cacheDir} is not a compose mount target (mounts: ${targets.join(', ')})`);
    process.exit(1);
  }

  console.log('check-persistent-mounts: ok');
}

main();
