/**
 * Discover and validate botz.ai subdomain projects under projects/botz.ai/<name>/.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const PROJECTS_ROOT = path.join(ROOT, 'projects', 'botz.ai');

/** Subdomains that must not be used as project names (also blocked at scaffold time). */
const RESERVED_SUBDOMAINS = new Set(
  [
    'www',
    'api',
    'mail',
    'email',
    'mx',
    'ftp',
    'sftp',
    'admin',
    'root',
    'botz',
    'discord',
    'nginx',
    'localhost',
    'staging',
    'prod',
    'production',
    'test',
    'dev',
    'cdn',
    'static',
    'assets',
    'ns',
    'ns1',
    'ns2',
    '_dmarc',
  ].map((s) => s.toLowerCase())
);

const DNS_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** RFC 7230 field-name (token). */
const HTTP_FIELD_NAME_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

function parseSimpleYaml(text) {
  const out = {};
  let section = null;
  let sectionObj = null;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const sectionMatch = trimmed.match(/^([a-z_]+):\s*$/);
    if (sectionMatch && !line.startsWith(' ')) {
      section = sectionMatch[1];
      if (section === 'proxy' || section === 'headers') {
        sectionObj = {};
        out[section] = sectionObj;
      } else {
        sectionObj = null;
      }
      continue;
    }

    const keyPattern =
      section === 'headers' ? /^([^:]+):\s*(.*)$/ : /^([a-z_]+):\s*(.*)$/;
    const kv = trimmed.match(keyPattern);
    if (!kv) {
      if (section === 'headers') {
        throw new Error(`invalid headers line (expected Field-Name: value): ${trimmed}`);
      }
      continue;
    }

    const key = kv[1].trim();
    let value = kv[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (value === 'true') value = true;
    else if (value === 'false') value = false;

    if (section === 'proxy' && sectionObj) {
      sectionObj[key] = value;
    } else if (section === 'headers' && sectionObj) {
      sectionObj[key] = value;
    } else {
      out[key] = value;
      section = null;
      sectionObj = null;
    }
  }

  return out;
}

function loadManifest(projectDir) {
  const ymlPath = path.join(projectDir, 'project.yml');
  const jsonPath = path.join(projectDir, 'project.json');

  if (fs.existsSync(ymlPath)) {
    return parseSimpleYaml(fs.readFileSync(ymlPath, 'utf8'));
  }
  if (fs.existsSync(jsonPath)) {
    return JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  }
  throw new Error(`missing project.yml or project.json in ${projectDir}`);
}

function validateDnsLabel(name) {
  if (!name || typeof name !== 'string') {
    return 'name must be a non-empty string';
  }
  const lower = name.toLowerCase();
  if (name !== lower) {
    return 'name must be lowercase';
  }
  if (name.length > 63) {
    return 'name exceeds 63 characters';
  }
  if (!DNS_LABEL_RE.test(name)) {
    return 'name must match DNS label rules (lowercase alphanumeric and hyphens)';
  }
  if (RESERVED_SUBDOMAINS.has(name)) {
    return `name "${name}" is reserved`;
  }
  return null;
}

function validateProject(name, manifest) {
  const errors = [];

  const labelErr = validateDnsLabel(name);
  if (labelErr) errors.push(labelErr);

  if (manifest.enabled === false) {
    return errors;
  }

  const enabled = manifest.enabled !== false;
  if (!enabled) {
    return errors;
  }

  const type = manifest.type;
  if (type !== 'static' && type !== 'proxy') {
    errors.push('type must be "static" or "proxy"');
  }

  if (type === 'proxy') {
    const upstream = manifest.proxy?.upstream;
    if (!upstream || typeof upstream !== 'string') {
      errors.push('proxy projects require proxy.upstream (e.g. http://myservice:8080)');
    } else if (!/^https?:\/\//.test(upstream)) {
      errors.push('proxy.upstream must start with http:// or https://');
    }
  }

  if (type === 'static') {
    const publicDir = path.join(PROJECTS_ROOT, name, 'public');
    if (!fs.existsSync(publicDir)) {
      errors.push('static projects require a public/ directory');
    }
  }

  if (manifest.headers != null) {
    if (typeof manifest.headers !== 'object' || Array.isArray(manifest.headers)) {
      errors.push('headers must be a map of field-name: value');
    } else {
      for (const fieldName of Object.keys(manifest.headers)) {
        if (!HTTP_FIELD_NAME_RE.test(fieldName)) {
          errors.push(`invalid HTTP header field name: ${fieldName}`);
        }
      }
    }
  }

  return errors;
}

function discoverSiteProxyUpstreamHosts() {
  const sitesDir = path.join(ROOT, 'sites');
  const hosts = new Set();
  if (!fs.existsSync(sitesDir)) {
    return hosts;
  }
  for (const file of fs.readdirSync(sitesDir).filter((f) => f.endsWith('.json'))) {
    const site = JSON.parse(fs.readFileSync(path.join(sitesDir, file), 'utf8'));
    for (const proxy of site.proxies || []) {
      const upstream = proxy?.upstream;
      if (!upstream || typeof upstream !== 'string') continue;
      try {
        hosts.add(new URL(upstream).hostname);
      } catch {
        throw new Error(`${file}: invalid proxy.upstream URL: ${upstream}`);
      }
    }
  }
  return hosts;
}

function discoverProxyUpstreamHosts() {
  const hosts = new Set(['botz']);
  for (const h of discoverSiteProxyUpstreamHosts()) {
    hosts.add(h);
  }
  for (const project of discoverBotzProjects()) {
    if (!project.enabled || project.manifest.type !== 'proxy') {
      continue;
    }
    const upstream = project.manifest.proxy?.upstream;
    if (!upstream || typeof upstream !== 'string') {
      continue;
    }
    let hostname;
    try {
      hostname = new URL(upstream).hostname;
    } catch {
      throw new Error(`projects/botz.ai/${project.name}: invalid proxy.upstream URL: ${upstream}`);
    }
    if (hostname) {
      hosts.add(hostname);
    }
  }
  return [...hosts].sort();
}

function discoverBotzProjects() {
  if (!fs.existsSync(PROJECTS_ROOT)) {
    return [];
  }

  const entries = fs
    .readdirSync(PROJECTS_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  const seen = new Set();
  const projects = [];

  for (const name of entries) {
    if (seen.has(name)) {
      throw new Error(`duplicate project name: ${name}`);
    }
    seen.add(name);

    const projectDir = path.join(PROJECTS_ROOT, name);
    const manifest = loadManifest(projectDir);
    const errors = validateProject(name, manifest);
    if (errors.length > 0) {
      throw new Error(`projects/botz.ai/${name}: ${errors.join('; ')}`);
    }

    projects.push({
      name,
      hostname: `${name}.botz.ai`,
      manifest,
      enabled: manifest.enabled !== false,
      projectDir,
    });
  }

  return projects;
}

module.exports = {
  ROOT,
  PROJECTS_ROOT,
  RESERVED_SUBDOMAINS,
  DNS_LABEL_RE,
  HTTP_FIELD_NAME_RE,
  validateDnsLabel,
  discoverBotzProjects,
  discoverSiteProxyUpstreamHosts,
  discoverProxyUpstreamHosts,
  loadManifest,
  validateProject,
  parseSimpleYaml,
};
