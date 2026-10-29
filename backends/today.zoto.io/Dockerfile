FROM node:25-alpine AS deps
WORKDIR /home/root
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production

FROM node:25-alpine
WORKDIR /home/root
COPY package.json yarn.lock index.js ./
COPY lib ./lib
COPY --from=deps /home/root/node_modules ./node_modules
ENV PORT=3001
EXPOSE 3001
ENTRYPOINT ["node", "--network-family-autoselection-attempt-timeout=2000", "index.js"]
