FROM node:22-alpine AS build

WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/domain/package.json packages/domain/package.json
RUN npm ci

COPY apps/web apps/web
COPY packages/domain packages/domain
ARG VITE_API_URL=http://localhost:3001
ARG VITE_TELEGRAM_BOT_USERNAME=
ARG VITE_TELEGRAM_APP_SHORT_NAME=
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_TELEGRAM_BOT_USERNAME=${VITE_TELEGRAM_BOT_USERNAME}
ENV VITE_TELEGRAM_APP_SHORT_NAME=${VITE_TELEGRAM_APP_SHORT_NAME}
RUN npm run build -w @imperium/domain
RUN npm run build -w @imperium/web

FROM nginx:1.29-alpine
ENV PORT=8080
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
