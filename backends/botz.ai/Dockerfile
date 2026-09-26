FROM node:18-alpine
WORKDIR /home/root
COPY backends/botz.ai/index.js backends/botz.ai/openaiImages.js backends/botz.ai/backfillDates.js backends/botz.ai/newsApi.js backends/botz.ai/cloudflarePurge.js ./
COPY backends/botz.ai/node_modules ./node_modules
COPY backends/botz.ai/package.json backends/botz.ai/yarn.lock ./
COPY scripts/backfill-editorials.mjs ./scripts/backfill-editorials.mjs
ENV BOTZ_PACKAGE_ROOT=/home/root
ENTRYPOINT ["node", "/home/root/index.js"]
