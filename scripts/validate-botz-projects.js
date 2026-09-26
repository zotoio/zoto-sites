#!/usr/bin/env node
/**
 * CI: schema-check botz.ai subdomain manifests (names, types, reserved labels).
 */
const { discoverBotzProjects } = require('./lib/botz-projects');

try {
  const projects = discoverBotzProjects();
  const enabled = projects.filter((p) => p.enabled);
  console.log(
    `Validated ${projects.length} botz.ai project manifest(s) (${enabled.length} enabled).`
  );
} catch (err) {
  console.error(err.message || err);
  process.exit(1);
}
