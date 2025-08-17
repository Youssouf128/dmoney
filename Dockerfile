# See https://docs.docker.com/engine/reference/builder
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
COPY private_key_pkcs8.pem ./private_key_pkcs8.pem
EXPOSE 80
CMD ["node", "server.js"]
