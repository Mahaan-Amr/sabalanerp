FROM node:20-bookworm-slim AS builder

WORKDIR /app

COPY package*.json ./
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN --mount=type=cache,target=/root/.npm \
  npm config set fetch-retries 5 \
  && npm config set fetch-retry-factor 2 \
  && npm config set fetch-retry-mintimeout 20000 \
  && npm config set fetch-retry-maxtimeout 120000 \
  && npm ci --prefer-offline --no-audit --fund=false

COPY prisma ./prisma
COPY tsconfig.json ./
COPY src ./src

RUN HTTP_PROXY=http://127.0.0.1:2081 HTTPS_PROXY=http://127.0.0.1:2081 http_proxy=http://127.0.0.1:2081 https_proxy=http://127.0.0.1:2081 npx prisma generate
RUN npm run build
RUN npm prune --omit=dev

FROM node:20-bookworm-slim AS runner

WORKDIR /app

RUN printf 'Types: deb\nURIs: http://deb.debian.org/debian\nSuites: bookworm\nComponents: main\nSigned-By: /usr/share/keyrings/debian-archive-keyring.gpg\n\nTypes: deb\nURIs: http://security.debian.org/debian-security\nSuites: bookworm-security\nComponents: main\nSigned-By: /usr/share/keyrings/debian-archive-keyring.gpg\n' > /etc/apt/sources.list.d/debian.sources \
  && HTTP_PROXY=http://127.0.0.1:2081 HTTPS_PROXY=http://127.0.0.1:2081 http_proxy=http://127.0.0.1:2081 https_proxy=http://127.0.0.1:2081 \
  apt-get -o Acquire::ForceIPv4=true update \
  && HTTP_PROXY=http://127.0.0.1:2081 HTTPS_PROXY=http://127.0.0.1:2081 http_proxy=http://127.0.0.1:2081 https_proxy=http://127.0.0.1:2081 \
  apt-get -o Acquire::ForceIPv4=true install -y --no-install-recommends \
  openssl \
  ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN printf 'Types: deb\nURIs: http://deb.debian.org/debian\nSuites: bookworm\nComponents: main\nSigned-By: /usr/share/keyrings/debian-archive-keyring.gpg\n\nTypes: deb\nURIs: http://security.debian.org/debian-security\nSuites: bookworm-security\nComponents: main\nSigned-By: /usr/share/keyrings/debian-archive-keyring.gpg\n' > /etc/apt/sources.list.d/debian.sources \
  && HTTP_PROXY=http://127.0.0.1:2081 HTTPS_PROXY=http://127.0.0.1:2081 http_proxy=http://127.0.0.1:2081 https_proxy=http://127.0.0.1:2081 \
  apt-get -o Acquire::ForceIPv4=true update \
  && HTTP_PROXY=http://127.0.0.1:2081 HTTPS_PROXY=http://127.0.0.1:2081 http_proxy=http://127.0.0.1:2081 https_proxy=http://127.0.0.1:2081 \
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
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/dist ./dist

RUN mkdir -p /app/storage/contracts /app/uploads

EXPOSE 5000

CMD ["node", "dist/index.js"]
