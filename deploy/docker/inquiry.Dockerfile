FROM sabalanerp-backend AS backend-engines

FROM node:20-bookworm-slim AS runner

WORKDIR /app

RUN printf 'Types: deb\nURIs: http://mirror.iranserver.com/debian\nSuites: bookworm\nComponents: main\nSigned-By: /usr/share/keyrings/debian-archive-keyring.gpg\n\nTypes: deb\nURIs: http://mirror.iranserver.com/debian-security\nSuites: bookworm-security\nComponents: main\nSigned-By: /usr/share/keyrings/debian-archive-keyring.gpg\n' > /etc/apt/sources.list.d/debian.sources \
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
  && npm ci --ignore-scripts --prefer-offline --no-audit --fund=false

COPY --from=backend-engines /app/node_modules/@prisma/engines/schema-engine-debian-openssl-1.1.x /tmp/prisma-engines/schema-engine-debian-openssl-3.0.x
COPY --from=backend-engines /app/node_modules/@prisma/engines/libquery_engine-debian-openssl-1.1.x.so.node /tmp/prisma-engines/libquery_engine-debian-openssl-3.0.x.so.node

RUN mkdir -p node_modules/@prisma/engines \
  && cp /tmp/prisma-engines/schema-engine-debian-openssl-3.0.x node_modules/@prisma/engines/schema-engine-debian-openssl-3.0.x \
  && cp /tmp/prisma-engines/libquery_engine-debian-openssl-3.0.x.so.node node_modules/@prisma/engines/libquery_engine-debian-openssl-3.0.x.so.node

COPY apps/sabalan-inquiry ./

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3001
ENV PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1

RUN npx prisma generate
RUN DATABASE_URL=file:/tmp/inquiry-build.db npx prisma db push
RUN DATABASE_URL=file:/tmp/inquiry-build.db SESSION_SECRET=build-only-session-secret-minimum-32-chars npm run build

RUN mkdir -p /data

EXPOSE 3001

CMD ["sh", "-c", "npx prisma db push && npm run db:seed && npm run start -- -p 3001"]
