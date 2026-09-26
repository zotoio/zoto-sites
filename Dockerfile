FROM node:18-alpine AS nginx-config
WORKDIR /build
COPY scripts/generate-nginx.js scripts/
COPY sites/ sites/
RUN node scripts/generate-nginx.js

FROM krewh/hardened-nginx
COPY www /usr/share/nginx/html
COPY --from=nginx-config /build/nginx-conf /etc/nginx/conf.d/sites
COPY docker/nginx-entrypoint.sh /usr/local/bin/zoto-nginx-entrypoint.sh
RUN chmod +x /usr/local/bin/zoto-nginx-entrypoint.sh
ENTRYPOINT ["/usr/local/bin/zoto-nginx-entrypoint.sh"]
