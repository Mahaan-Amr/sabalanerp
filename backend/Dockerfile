FROM node:20-bookworm-slim AS builder

WORKDIR /app

ARG DEBIAN_MIRROR=http://deb.debian.org/debian
ARG DEBIAN_SECURITY_MIRROR=http://security.debian.org/debian-security
ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG http_proxy
ARG https_proxy
ARG ALL_PROXY
ARG all_proxy
ARG NPM_CONFIG_REGISTRY

RUN printf 'Types: deb\nURIs: %s\nSuites: bookworm\nComponents: main\nSigned-By: /usr/share/keyrings/debian-archive-keyring.gpg\n\nTypes: deb\nURIs: %s\nSuites: bookworm-security\nComponents: main\nSigned-By: /usr/share/keyrings/debian-archive-keyring.gpg\n' "$DEBIAN_MIRROR" "$DEBIAN_SECURITY_MIRROR" > /etc/apt/sources.list.d/debian.sources \
  && apt-get -o Acquire::ForceIPv4=true update \
  && apt-get -o Acquire::ForceIPv4=true install -y --no-install-recommends \
  openssl \
  ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY backend/package*.json ./
COPY packages/contract-product-graph/package*.json /packages/contract-product-graph/
COPY packages/contract-product-graph/tsconfig*.json /packages/contract-product-graph/
COPY packages/contract-product-graph/src /packages/contract-product-graph/src
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN --mount=type=cache,target=/root/.npm \
  npm config set fetch-retries 5 \
  && npm config set fetch-retry-factor 2 \
  && npm config set fetch-retry-mintimeout 20000 \
  && npm config set fetch-retry-maxtimeout 120000 \
  && cd /packages/contract-product-graph \
  && npm ci --prefer-offline --no-audit --fund=false \
  && npm run build \
  && npm prune --omit=dev \
  && cd /app \
  && npm ci --prefer-offline --no-audit --fund=false

COPY backend/prisma ./prisma
COPY backend/tsconfig.json ./
COPY backend/src ./src

RUN npx prisma generate
RUN npm run build
RUN npm prune --omit=dev

FROM node:20-bookworm-slim AS runner

WORKDIR /app

ARG DEBIAN_MIRROR=http://deb.debian.org/debian
ARG DEBIAN_SECURITY_MIRROR=http://security.debian.org/debian-security

RUN printf 'Types: deb\nURIs: %s\nSuites: bookworm\nComponents: main\nSigned-By: /usr/share/keyrings/debian-archive-keyring.gpg\n\nTypes: deb\nURIs: %s\nSuites: bookworm-security\nComponents: main\nSigned-By: /usr/share/keyrings/debian-archive-keyring.gpg\n' "$DEBIAN_MIRROR" "$DEBIAN_SECURITY_MIRROR" > /etc/apt/sources.list.d/debian.sources \
  && HTTP_PROXY= HTTPS_PROXY= http_proxy= https_proxy= \
  apt-get -o Acquire::ForceIPv4=true update \
  && HTTP_PROXY= HTTPS_PROXY= http_proxy= https_proxy= \
  apt-get -o Acquire::ForceIPv4=true install -y --no-install-recommends \
  openssl \
  clamdscan \
  postgresql-client \
  sqlite3 \
  tar \
  ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN printf 'Types: deb\nURIs: %s\nSuites: bookworm\nComponents: main\nSigned-By: /usr/share/keyrings/debian-archive-keyring.gpg\n\nTypes: deb\nURIs: %s\nSuites: bookworm-security\nComponents: main\nSigned-By: /usr/share/keyrings/debian-archive-keyring.gpg\n' "$DEBIAN_MIRROR" "$DEBIAN_SECURITY_MIRROR" > /etc/apt/sources.list.d/debian.sources \
  && HTTP_PROXY= HTTPS_PROXY= http_proxy= https_proxy= \
  apt-get -o Acquire::ForceIPv4=true update \
  && HTTP_PROXY= HTTPS_PROXY= http_proxy= https_proxy= \
  apt-get -o Acquire::ForceIPv4=true install -y --no-install-recommends \
  chromium \
  ca-certificates \
  fonts-dejavu-core \
  fonts-liberation \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=5000
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /packages/contract-product-graph /packages/contract-product-graph
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/dist ./dist
COPY backend/public ./public
COPY backend/scripts ./scripts
COPY backend/excel ./excel

RUN printf 'TCPSocket 3310\nTCPAddr clamav\n' > /etc/clamav/clamd-remote.conf \
  && chmod +x /app/scripts/hr-clamdscan.sh \
  && mkdir -p /app/storage/contracts /app/storage/hr-hiring /app/storage/accounting-contracts /app/storage/recovery /app/uploads /app/recovery-sources/inquiry /app/recovery-coordination

EXPOSE 5000

CMD ["sh", "-c", "node dist/scripts/recovery-database-preflight.js && node dist/index.js"]
