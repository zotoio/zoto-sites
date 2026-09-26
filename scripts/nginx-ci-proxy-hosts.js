#!/usr/bin/env node
/** Print one hostname per line for nginx -t --add-host stubs (includes botz). */
const { discoverProxyUpstreamHosts } = require('./lib/botz-projects');

for (const host of discoverProxyUpstreamHosts()) {
  console.log(host);
}
