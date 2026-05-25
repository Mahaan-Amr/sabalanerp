FROM node:20-bookworm-slim AS runner

WORKDIR /app

ARG DEBIAN_MIRROR=http://mirror.iranserver.com/debian
ARG DEBIAN_SECURITY_MIRROR=http://mirror.iranserver.com/debian-security

RUN printf 'Types: deb\nURIs: %s\nSuites: bookworm\nComponents: main\nSigned-By: /usr/share/keyrings/debian-archive-keyring.gpg\n\nTypes: deb\nURIs: %s\nSuites: bookworm-security\nComponents: main\nSigned-By: /usr/share/keyrings/debian-archive-keyring.gpg\n' "$DEBIAN_MIRROR" "$DEBIAN_SECURITY_MIRROR" > /etc/apt/sources.list.d/debian.sources \
  && HTTP_PROXY= HTTPS_PROXY= http_proxy= https_proxy= \
  apt-get -o Acquire::ForceIPv4=true update \
  && HTTP_PROXY= HTTPS_PROXY= http_proxy= https_proxy= \
  apt-get -o Acquire::ForceIPv4=true install -y --no-install-recommends \
  openssl \
  ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY apps/sabalan-inquiry/package*.json ./
COPY apps/sabalan-inquiry/prisma ./prisma
RUN --mount=type=cache,target=/root/.npm \
  npm config set fetch-retries 5 \
  && npm config set fetch-retry-factor 2 \
  && npm config set fetch-retry-mintimeout 20000 \
  && npm config set fetch-retry-maxtimeout 120000 \
  && HTTP_PROXY=http://127.0.0.1:2081 HTTPS_PROXY=http://127.0.0.1:2081 http_proxy=http://127.0.0.1:2081 https_proxy=http://127.0.0.1:2081 \
  npm ci --prefer-offline --no-audit --fund=false

COPY apps/sabalan-inquiry ./

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3001

RUN HTTP_PROXY=http://127.0.0.1:2081 HTTPS_PROXY=http://127.0.0.1:2081 http_proxy=http://127.0.0.1:2081 https_proxy=http://127.0.0.1:2081 npx prisma generate
RUN HTTP_PROXY=http://127.0.0.1:2081 HTTPS_PROXY=http://127.0.0.1:2081 http_proxy=http://127.0.0.1:2081 https_proxy=http://127.0.0.1:2081 DATABASE_URL=file:/tmp/inquiry-build.db npx prisma db push
RUN HTTP_PROXY=http://127.0.0.1:2081 HTTPS_PROXY=http://127.0.0.1:2081 http_proxy=http://127.0.0.1:2081 https_proxy=http://127.0.0.1:2081 DATABASE_URL=file:/tmp/inquiry-build.db SESSION_SECRET=build-only-session-secret-minimum-32-chars npm run build

RUN mkdir -p /data

EXPOSE 3001

CMD ["sh", "-c", "npm run db:push && npm run db:seed && npm run start -- -p 3001"]
