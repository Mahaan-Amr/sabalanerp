ARG RECOVERY_POSTGRES_IMAGE=postgres:15-alpine
FROM node:22-bookworm-slim AS builder

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
COPY packages/partner-sales-contracts/package*.json /packages/partner-sales-contracts/
COPY packages/partner-sales-contracts/tsconfig*.json /packages/partner-sales-contracts/
COPY packages/partner-sales-contracts/src /packages/partner-sales-contracts/src
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN --mount=type=cache,target=/root/.npm \
  npm config set fetch-retries 5 \
  && npm config set fetch-retry-factor 2 \
  && npm config set fetch-retry-mintimeout 20000 \
  && npm config set fetch-retry-maxtimeout 120000 \
  && cd /packages/contract-product-graph \
  && npm ci --prefer-offline --no-audit --fund=false \
  && npm run build \
  && cd /packages/partner-sales-contracts \
  && npm ci --include=dev --prefer-offline --no-audit --fund=false \
  && npm run build \
  && npm prune --omit=dev \
  && cd /packages/contract-product-graph \
  && npm prune --omit=dev \
  && cd /app \
  && PRISMA_SKIP_POSTINSTALL_GENERATE=true npm ci --prefer-offline --no-audit --fund=false

COPY backend/prisma ./prisma
COPY backend/tsconfig.json ./
COPY backend/tsconfig.cutover.json ./
COPY backend/scripts/shipment-statement-cutover.ts ./scripts/shipment-statement-cutover.ts
COPY backend/scripts/clamav-checkpoint.mjs backend/scripts/clamav-checkpoint.d.mts backend/scripts/clamav-incident-policy.mjs backend/scripts/preserved-clamav-policy.mjs backend/scripts/preserved-clamav-policy.d.mts ./scripts/
COPY backend/scripts/maintenance-image-binding.mjs backend/scripts/maintenance-image-binding.d.mts ./scripts/
COPY backend/src ./src

# Generate once the real schema is present, rather than during dependency install.
RUN npx prisma generate
# Bound compiler memory independently of the production runtime's default heap.
RUN NODE_OPTIONS=--max-old-space-size=3072 npm run build
RUN npm prune --omit=dev --no-audit --fund=false

FROM node:22-bookworm-slim AS recovery-postgres-launcher

ARG DEBIAN_MIRROR=http://deb.debian.org/debian
ARG DEBIAN_SECURITY_MIRROR=http://security.debian.org/debian-security
RUN printf 'Types: deb\nURIs: %s\nSuites: bookworm\nComponents: main\nSigned-By: /usr/share/keyrings/debian-archive-keyring.gpg\n\nTypes: deb\nURIs: %s\nSuites: bookworm-security\nComponents: main\nSigned-By: /usr/share/keyrings/debian-archive-keyring.gpg\n' "$DEBIAN_MIRROR" "$DEBIAN_SECURITY_MIRROR" > /etc/apt/sources.list.d/debian.sources \
  && HTTP_PROXY= HTTPS_PROXY= http_proxy= https_proxy= apt-get -o Acquire::ForceIPv4=true update \
  && HTTP_PROXY= HTTPS_PROXY= http_proxy= https_proxy= apt-get -o Acquire::ForceIPv4=true install -y --no-install-recommends \
    gcc libc6-dev \
  && rm -rf /var/lib/apt/lists/*
COPY backend/scripts/recovery-postgres-sandbox.c /tmp/recovery-postgres-sandbox.c
RUN mkdir -p /usr/local/libexec \
  && gcc -O2 -Wall -Wextra -Werror -o /usr/local/libexec/recovery-postgres-sandbox /tmp/recovery-postgres-sandbox.c

# Preserve the running database image's PostgreSQL, libc and locale semantics.
FROM ${RECOVERY_POSTGRES_IMAGE} AS recovery-postgres
ARG RECOVERY_POSTGRES_IMAGE_ID=unattested
COPY backend/scripts/build-recovery-postgres-root.sh /tmp/build-recovery-postgres-root.sh
RUN RECOVERY_POSTGRES_IMAGE_ID="$RECOVERY_POSTGRES_IMAGE_ID" sh /tmp/build-recovery-postgres-root.sh

FROM node:22-bookworm-slim AS runner

WORKDIR /app

ARG DEBIAN_MIRROR=http://deb.debian.org/debian
ARG DEBIAN_SECURITY_MIRROR=http://security.debian.org/debian-security

RUN printf 'Types: deb\nURIs: %s\nSuites: bookworm\nComponents: main\nSigned-By: /usr/share/keyrings/debian-archive-keyring.gpg\n\nTypes: deb\nURIs: %s\nSuites: bookworm-security\nComponents: main\nSigned-By: /usr/share/keyrings/debian-archive-keyring.gpg\n' "$DEBIAN_MIRROR" "$DEBIAN_SECURITY_MIRROR" > /etc/apt/sources.list.d/debian.sources \
  && HTTP_PROXY= HTTPS_PROXY= http_proxy= https_proxy= \
  apt-get -o Acquire::ForceIPv4=true update \
  && HTTP_PROXY= HTTPS_PROXY= http_proxy= https_proxy= \
  apt-get -o Acquire::ForceIPv4=true install -y --no-install-recommends \
  openssl \
  ffmpeg \
  postgresql-client \
  util-linux \
  sqlite3 \
  tar \
  ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# The preceding layer installs CA certificates. Use verified HTTPS for the
# official archives before downloading large application packages; keep any
# explicitly configured private mirror unchanged.
RUN sed -i \
  -e 's|http://deb.debian.org/|https://deb.debian.org/|g' \
  -e 's|http://security.debian.org/|https://security.debian.org/|g' \
  /etc/apt/sources.list.d/debian.sources \
  && HTTP_PROXY= HTTPS_PROXY= http_proxy= https_proxy= \
  apt-get -o Acquire::ForceIPv4=true update \
  && HTTP_PROXY= HTTPS_PROXY= http_proxy= https_proxy= \
  apt-get -o Acquire::ForceIPv4=true install -y --no-install-recommends \
  chromium \
  poppler-utils \
  python3 \
  python3-pil \
  python3-pypdf2 \
  ca-certificates \
  fonts-dejavu-core \
  fonts-liberation \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=5000
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

COPY --from=recovery-postgres-launcher /usr/local/libexec/recovery-postgres-sandbox /usr/local/libexec/recovery-postgres-sandbox
COPY --from=recovery-postgres /opt/recovery-postgres-root /opt/recovery-postgres-root

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /packages/contract-product-graph /packages/contract-product-graph
COPY --from=builder /packages/partner-sales-contracts /packages/partner-sales-contracts
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist-cutover ./dist-cutover
COPY backend/public ./public
COPY backend/scripts ./scripts
COPY deploy/scripts/customer-allocation-release.mjs ./operations/deploy/scripts/
COPY deploy/scripts/lib/customer-allocation-controller.mjs deploy/scripts/lib/customer-allocation-go-manifest.mjs ./operations/deploy/scripts/lib/
COPY scripts/production-database-role-boundary.mjs ./operations/scripts/
COPY deploy/scripts/with-backend-control-ownership.sh ./scripts/with-backend-control-ownership.sh
COPY deploy/scripts/protected-bootstrap-owner.py deploy/scripts/protected-bootstrap-state.py ./scripts/
COPY deploy/scripts/protected-file-adoption-owner.py deploy/scripts/protected-file-adoption-state.py ./scripts/
COPY deploy/scripts/backend-runtime-owner.py deploy/scripts/local-native-reboot.py deploy/scripts/local-native-reboot-440.py deploy/scripts/local-native-reboot-20261117.py deploy/scripts/local-native-reboot-macos-20261118.py deploy/scripts/online-runtime-scope.py deploy/scripts/online-runtime-owner.py ./scripts/
COPY deploy/scripts/online-capture-admission.py ./scripts/online-capture-admission.py
COPY deploy/scripts/online-release-runtime.mjs deploy/scripts/online-release-inner-controller.py ./scripts/
COPY deploy/scripts/online-common-release-edge.mjs deploy/scripts/common-release-edge.mjs deploy/scripts/api-release-routing.mjs deploy/scripts/browser-operation-journal.mjs deploy/scripts/browser-release-proxy.mjs deploy/scripts/browser-release-routing.mjs deploy/scripts/browser-routing-store.mjs deploy/scripts/release-endpoint-catalog.mjs deploy/scripts/release-forwarding.mjs deploy/scripts/socket-release-proxy.mjs ./scripts/
COPY deploy/scripts/online-backend-boundary.py deploy/scripts/online-inquiry-boundary.py deploy/scripts/recovery-database-freeze.py deploy/scripts/recovery-file-generations.py deploy/scripts/capture-coherent-components.py ./scripts/
COPY deploy/scripts/coherent-versioned-file-cuts.py deploy/scripts/native-versioned-file-sealer.py deploy/scripts/recovery-versioned-files.py ./scripts/
COPY deploy/scripts/receive-postgres-wal.py deploy/scripts/seal-online-checkpoint.cjs ./scripts/
COPY deploy/scripts/online-checkpoint-inventory.py ./scripts/online-checkpoint-inventory.py
COPY deploy/scripts/capture-coordination-history.py ./scripts/capture-coordination-history.py
COPY deploy/scripts/retire-protected-online-legacy-records.py ./scripts/retire-protected-online-legacy-records.py
COPY deploy/scripts/continuous-online-wal-state.py ./scripts/continuous-online-wal-state.py
COPY deploy/scripts/online-runtime-scope.py ./dist/services/online-runtime-scope.py
COPY docs/qa/partner-sales/release/release-package.mjs ./partner-release-verifier/release-package.mjs
COPY backend/src/documents/dispatch/__fixtures__/baselines ./dispatch-document-baselines
COPY backend/excel ./excel

RUN mkdir -p /app/storage/contracts /app/storage/hr-hiring /app/storage/accounting-contracts /app/storage/recovery /app/uploads /app/recovery-sources/inquiry /app/recovery-coordination

ARG PERFORMANCE_SOURCE_COMMIT=unattested
ARG PERFORMANCE_SOURCE_HASH=unattested
LABEL io.sabalan.release.upload-policy=no-malware-scan
LABEL io.sabalan.performance.source-commit=$PERFORMANCE_SOURCE_COMMIT \
  io.sabalan.performance.source-hash=$PERFORMANCE_SOURCE_HASH
RUN printf '%s\n' "$PERFORMANCE_SOURCE_COMMIT" > /app/.allocation-build-commit \
  && chown root:root /app/.allocation-build-commit \
  && chmod 0444 /app/.allocation-build-commit

EXPOSE 5000

CMD ["sh", "scripts/with-backend-control-ownership.sh", "sh", "scripts/start-backend.sh"]
