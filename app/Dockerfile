FROM node:20-bookworm-slim
WORKDIR /srv/app
COPY package.json ./
RUN npm install --omit=dev
COPY . .
EXPOSE 8080
CMD ["node", "server.js"]
