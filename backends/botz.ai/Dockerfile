# Dependencies are installed inside node:22-alpine (musl), so native modules such as sharp always get their
# linuxmusl-<arch> binaries here (x64 or arm64), whatever libc the build host has. Versions come from the frozen yarn.lock.
FROM node:22-alpine AS deps
WORKDIR /deps
COPY backends/botz.ai/package.json backends/botz.ai/yarn.lock ./
RUN yarn install --frozen-lockfile --production --non-interactive --network-timeout 600000 \
    && yarn cache clean \
    && node -e "require('sharp')" \
    && ls -d node_modules/@img/sharp-linuxmusl-* >/dev/null

FROM node:22-alpine
# Runtime: no package managers (npm/npx/corepack/yarn); start with node directly.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-v*
WORKDIR /home/root
COPY backends/botz.ai/index.js backends/botz.ai/openaiImages.js backends/botz.ai/cloudflarePurge.js backends/botz.ai/backfillDates.js backends/botz.ai/cacheListing.js backends/botz.ai/newsApi.js backends/botz.ai/newsApiErrors.js backends/botz.ai/newsFetchPlan.js backends/botz.ai/newsEditorialFetch.js backends/botz.ai/thenewsapiEditorialFetch.js backends/botz.ai/hnEditorialFetch.js backends/botz.ai/hnAlgolia.js backends/botz.ai/articleEnrichment.js backends/botz.ai/articleFetchRouteStore.js backends/botz.ai/newsSourceConfig.js backends/botz.ai/liveStoryDedup.js backends/botz.ai/openaiUsageLog.js backends/botz.ai/storySelection.js backends/botz.ai/editorialUsageStore.js backends/botz.ai/editorialReplace.js backends/botz.ai/archiveListing.js backends/botz.ai/archiveDays.js backends/botz.ai/imageVariants.js backends/botz.ai/generationSchedule.js backends/botz.ai/safeHttp.js ./
COPY backends/botz.ai/keywordWeights.js backends/botz.ai/jevClassifier.js backends/botz.ai/jevPrefilter.js backends/botz.ai/multiProviderEditorialFetch.js backends/botz.ai/sourceWeighting.js ./
COPY backends/botz.ai/newsProviders ./newsProviders
COPY --from=deps /deps/node_modules ./node_modules
COPY backends/botz.ai/package.json backends/botz.ai/yarn.lock ./
COPY scripts/backfill-editorials.mjs ./scripts/backfill-editorials.mjs
COPY scripts/backfill-image-variants.mjs ./scripts/backfill-image-variants.mjs
COPY scripts/lib/backfillHttp.mjs ./scripts/lib/backfillHttp.mjs
ENV BOTZ_PACKAGE_ROOT=/home/root
ENTRYPOINT ["node", "/home/root/index.js"]
