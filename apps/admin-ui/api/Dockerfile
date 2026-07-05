FROM node:22-alpine
RUN apk upgrade --no-cache
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 8080
CMD ["node", "src/index.js"]
