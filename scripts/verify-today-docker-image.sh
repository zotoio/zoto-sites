#!/usr/bin/env bash
# Build today API image (prod deps installed in Docker, not from host) and smoke-test startup.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="${TODAY_DOCKER_VERIFY_IMAGE:-zoto-today-ci-verify:ci}"
CONTEXT="$ROOT/backends/today.zoto.io"
PORT="${TODAY_SMOKE_PORT:-13001}"

docker build -t "$IMAGE" -f "$CONTEXT/Dockerfile" "$CONTEXT"

docker run --rm -i --entrypoint node "$IMAGE" --input-type=module <<'NODE'
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const root = '/home/root';
const demoPath = path.join(root, 'lib/demo.js');
if (!fs.existsSync(demoPath)) {
  console.error(`Missing lib/demo.js in image (expected ${demoPath})`);
  process.exit(1);
}
await import(pathToFileURL(demoPath).href);
console.log('today Docker image: lib/demo.js resolves under lib/');
NODE

cid=""
cleanup() {
  if [ -n "$cid" ]; then
    docker rm -f "$cid" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

cid="$(docker run -d --name "today-smoke-$$" -p "127.0.0.1:${PORT}:3001" "$IMAGE")"

for _ in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:${PORT}/api/health" | grep -q '"ok":true'; then
    echo "today Docker smoke test: GET /api/health OK"
    exit 0
  fi
  sleep 0.5
done

echo "today Docker smoke test: /api/health did not return 200 in time" >&2
docker logs "$cid" 2>&1 | tail -20 >&2
exit 1
