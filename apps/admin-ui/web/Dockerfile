# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json .npmrc ./
# GitHub Packages auth via BuildKit secret (provided by deploy.sh / CI).
RUN --mount=type=secret,id=github_packages_token,required=false \
    if [ -f /run/secrets/github_packages_token ]; then \
        export GITHUB_PACKAGES_TOKEN="$(cat /run/secrets/github_packages_token)"; \
    fi && \
    npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
RUN apk upgrade --no-cache
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
