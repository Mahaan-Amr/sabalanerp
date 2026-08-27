FROM node:20-alpine AS builder

WORKDIR /app

ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG http_proxy
ARG https_proxy
ARG ALL_PROXY
ARG all_proxy
ARG NPM_CONFIG_REGISTRY

COPY packages/contract-product-graph/package*.json /packages/contract-product-graph/
COPY packages/contract-product-graph/tsconfig*.json /packages/contract-product-graph/
COPY packages/contract-product-graph/src /packages/contract-product-graph/src
COPY packages/partner-sales-contracts/package*.json /packages/partner-sales-contracts/
COPY packages/partner-sales-contracts/tsconfig*.json /packages/partner-sales-contracts/
COPY packages/partner-sales-contracts/src /packages/partner-sales-contracts/src
COPY frontend/package*.json ./
RUN --mount=type=cache,target=/root/.npm \
  npm config set fetch-retries 5 \
  && npm config set fetch-retry-factor 2 \
  && npm config set fetch-retry-mintimeout 20000 \
  && npm config set fetch-retry-maxtimeout 120000 \
  && if [ -n "$HTTP_PROXY" ]; then npm config set proxy "$HTTP_PROXY"; fi \
  && if [ -n "$HTTPS_PROXY" ]; then npm config set https-proxy "$HTTPS_PROXY"; fi \
  && cd /packages/contract-product-graph \
  && npm ci --include=dev --prefer-offline --no-audit --fund=false \
  && npm run build \
  && cd /packages/partner-sales-contracts \
  && npm ci --include=dev --prefer-offline --no-audit --fund=false \
  && npm run build \
  && npm prune --omit=dev \
  && cd /packages/contract-product-graph \
  && npm prune --omit=dev \
  && cd /app \
  && npm ci --include=dev --prefer-offline --no-audit --fund=false \
  && test -x ./node_modules/.bin/next

COPY frontend .

ARG NEXT_PUBLIC_API_URL=/api
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ARG NEXT_PUBLIC_SOCKET_URL
ENV NEXT_PUBLIC_SOCKET_URL=${NEXT_PUBLIC_SOCKET_URL}
ARG BACKEND_API_ORIGIN
ENV BACKEND_API_ORIGIN=${BACKEND_API_ORIGIN}
ARG NEXT_PUBLIC_ENABLE_PROTOTYPES=0
ENV NEXT_PUBLIC_ENABLE_PROTOTYPES=${NEXT_PUBLIC_ENABLE_PROTOTYPES}
ENV NEXT_TELEMETRY_DISABLED=1

FROM builder AS local-dev

ENV NODE_ENV=development
ENV NEXT_DIST_DIR=.next-local
ENV PORT=3000

EXPOSE 3000

CMD ["npm", "run", "dev", "--", "-p", "3000"]

FROM builder AS production-builder

RUN ./node_modules/.bin/next build
RUN npm prune --omit=dev

FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

COPY --from=production-builder /app/package*.json ./
COPY --from=production-builder /app/node_modules ./node_modules
COPY --from=production-builder /packages/contract-product-graph /packages/contract-product-graph
COPY --from=production-builder /packages/partner-sales-contracts /packages/partner-sales-contracts
COPY --from=production-builder /app/.next-build ./.next-build
COPY --from=production-builder /app/public ./public
COPY --from=production-builder /app/next.config.js ./next.config.js

EXPOSE 3000

CMD ["npm", "run", "start", "--", "-p", "3000"]
