FROM node:20-alpine AS deps
WORKDIR /home/root
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production

FROM node:20-alpine
WORKDIR /home/root
COPY package.json yarn.lock index.js ./
COPY lib ./lib
COPY --from=deps /home/root/node_modules ./node_modules
ENV PORT=3001
EXPOSE 3001
ENTRYPOINT ["node", "index.js"]
