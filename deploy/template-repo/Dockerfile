# Modify this Dockerfile for your project
# The deploy pipeline builds this image and runs it on your lemon-stack server
#
# Your app MUST listen on port 8080 (default)
# To change, set container_port in deploy.conf

FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 8080
CMD ["node", "index.js"]
