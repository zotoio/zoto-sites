FROM node:18-alpine AS nginx-config
WORKDIR /build
COPY scripts/generate-nginx.js scripts/
COPY scripts/lib/ scripts/lib/
COPY sites/ sites/
COPY projects/botz.ai/ projects/botz.ai/
RUN node scripts/generate-nginx.js

FROM krewh/hardened-nginx
COPY www /usr/share/nginx/html
COPY projects/botz.ai /usr/share/nginx/html/projects/botz.ai
COPY --from=nginx-config /build/nginx-conf /etc/nginx/conf.d/sites
