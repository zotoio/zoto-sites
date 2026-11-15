# Dependencies are installed in the build stage from the frozen yarn.lock (host node_modules and .env are not copied).
FROM node:26-alpine AS deps
WORKDIR /deps
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production --non-interactive && yarn cache clean

FROM node:26-alpine
# Runtime: no package managers (npm/npx/corepack/yarn); start with node directly.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-v*
WORKDIR /home/root
COPY package.json index.js ./
COPY --from=deps /deps/node_modules ./node_modules
ENTRYPOINT ["node", "/home/root/index.js"]
