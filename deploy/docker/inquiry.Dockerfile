FROM node:20-bookworm-slim AS runner

WORKDIR /app

ARG DEBIAN_MIRROR=http://mirror.iranserver.com/debian
ARG DEBIAN_SECURITY_MIRROR=http://mirror.iranserver.com/debian-security
ARG NPM_CONFIG_REGISTRY

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
  && npm ci --prefer-offline --no-audit --fund=false

COPY apps/sabalan-inquiry ./
COPY deploy/scripts/run-inquiry-with-recovery.sh /app/run-inquiry-with-recovery.sh

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3001

RUN npx prisma generate
RUN DATABASE_URL=file:/tmp/inquiry-build.db npx prisma db push
RUN DATABASE_URL=file:/tmp/inquiry-build.db SESSION_SECRET=build-only-session-secret-minimum-32-chars npm run build

RUN mkdir -p /data /app/recovery-coordination \
  && chmod +x /app/run-inquiry-with-recovery.sh

EXPOSE 3001

CMD ["/app/run-inquiry-with-recovery.sh"]
