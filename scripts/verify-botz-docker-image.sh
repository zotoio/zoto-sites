#!/usr/bin/env bash
# Build botz image and verify every relative import in index.js resolves in the image.
# Does not require API keys; does not start the HTTP server (index.js is not imported).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="${BOTZ_DOCKER_VERIFY_IMAGE:-zoto-botz-ci-verify:ci}"

# Dockerfile COPYs host node_modules (same as production deploy on the droplet).
yarn --cwd "$ROOT/backends/botz.ai" install --frozen-lockfile --production

docker build -t "$IMAGE" "$ROOT/backends/botz.ai"

docker run --rm -i --entrypoint node "$IMAGE" --input-type=module <<'NODE'
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const root = '/home/root';
const indexPath = path.join(root, 'index.js');
const index = fs.readFileSync(indexPath, 'utf8');
const relImports = [
  ...index.matchAll(/\bfrom\s+['"]\.(\/[^'"]+)['"]/g),
  ...index.matchAll(/\bimport\s+['"]\.(\/[^'"]+)['"]/g),
].map((m) => m[1]);

if (relImports.length === 0) {
  console.error('verify-botz-docker-image: no relative imports found in index.js');
  process.exit(1);
}

for (const rel of relImports) {
  const filePath = path.join(root, rel);
  if (!fs.existsSync(filePath)) {
    console.error(`Missing module file in image: ${rel} (expected ${filePath})`);
    process.exit(1);
  }
  try {
    await import(pathToFileURL(filePath).href);
  } catch (e) {
    if (e && e.code === 'ERR_MODULE_NOT_FOUND') {
      console.error(e);
      process.exit(1);
    }
    throw e;
  }
}

console.log(`Verified ${relImports.length} relative module(s) in botz Docker image.`);
NODE
