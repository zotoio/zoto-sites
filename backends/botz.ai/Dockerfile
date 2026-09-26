FROM node:18-alpine
COPY index.js openaiImages.js /home/root/
COPY node_modules /home/root/node_modules
COPY package.json /home/root/package.json
COPY yarn.lock /home/root/yarn.lock
ENTRYPOINT ["node", "/home/root/index.js"]