/**
 * docker compose -f docker-compose.yml plus compose/projects/*.yml fragments (sorted).
 * No extra files when compose/projects has no .yml fragments.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const COMPOSE_PROJECT_NAME = 'zoto-sites';

function listComposeFiles(root) {
  const base = path.join(root, 'docker-compose.yml');
  if (!fs.existsSync(base)) {
    throw new Error(`missing ${base}`);
  }
  const files = [base];
  const fragDir = path.join(root, 'compose', 'projects');
  if (fs.existsSync(fragDir)) {
    const fragments = fs
      .readdirSync(fragDir)
      .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
      .sort();
    for (const name of fragments) {
      files.push(path.join(fragDir, name));
    }
  }
  return files;
}

function dockerComposeBaseArgs(root) {
  const files = listComposeFiles(root);
  const args = ['compose', '-p', COMPOSE_PROJECT_NAME];
  for (const file of files) {
    args.push('-f', file);
  }
  return args;
}

function dockerComposeConfigJson(root) {
  const args = [...dockerComposeBaseArgs(root), 'config', '--format', 'json'];
  const out = execFileSync('docker', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(out);
}

module.exports = {
  COMPOSE_PROJECT_NAME,
  listComposeFiles,
  dockerComposeBaseArgs,
  dockerComposeConfigJson,
};
