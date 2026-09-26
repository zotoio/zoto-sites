FROM node:18-alpine
WORKDIR /home/root
COPY package.json yarn.lock index.js lib/ ./
COPY node_modules ./node_modules
ENV PORT=3001
EXPOSE 3001
ENTRYPOINT ["node", "index.js"]
