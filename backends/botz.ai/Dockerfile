FROM node:18-alpine
WORKDIR /home/root
COPY backends/botz.ai/index.js backends/botz.ai/openaiImages.js backends/botz.ai/cloudflarePurge.js backends/botz.ai/backfillDates.js backends/botz.ai/cacheListing.js backends/botz.ai/newsApi.js backends/botz.ai/newsApiErrors.js backends/botz.ai/newsFetchPlan.js backends/botz.ai/newsEditorialFetch.js backends/botz.ai/thenewsapiEditorialFetch.js backends/botz.ai/hnEditorialFetch.js backends/botz.ai/hnAlgolia.js backends/botz.ai/articleEnrichment.js backends/botz.ai/newsSourceConfig.js backends/botz.ai/openaiUsageLog.js backends/botz.ai/storySelection.js backends/botz.ai/editorialUsageStore.js backends/botz.ai/editorialReplace.js ./
COPY backends/botz.ai/node_modules ./node_modules
COPY backends/botz.ai/package.json backends/botz.ai/yarn.lock ./
COPY scripts/backfill-editorials.mjs ./scripts/backfill-editorials.mjs
ENV BOTZ_PACKAGE_ROOT=/home/root
ENTRYPOINT ["node", "/home/root/index.js"]
