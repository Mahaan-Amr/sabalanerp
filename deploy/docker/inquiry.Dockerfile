FROM node:22-alpine AS runner

WORKDIR /app

RUN apk add --no-cache openssl

COPY apps/sabalan-inquiry/package*.json ./
COPY apps/sabalan-inquiry/prisma ./prisma
RUN --mount=type=cache,target=/root/.npm \
  npm config set fetch-retries 5 \
  && npm config set fetch-retry-factor 2 \
  && npm config set fetch-retry-mintimeout 20000 \
  && npm config set fetch-retry-maxtimeout 120000 \
  && npm ci --prefer-offline --no-audit --fund=false

COPY apps/sabalan-inquiry ./

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3001

RUN npx prisma generate
RUN DATABASE_URL=file:/tmp/inquiry-build.db npx prisma db push
RUN DATABASE_URL=file:/tmp/inquiry-build.db SESSION_SECRET=build-only-session-secret-minimum-32-chars npm run build

RUN mkdir -p /data

EXPOSE 3001

CMD ["sh", "-c", "npx prisma db push && npm run db:seed && npm run start -- -p 3001"]
