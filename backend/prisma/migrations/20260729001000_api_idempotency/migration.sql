CREATE TABLE "api_idempotency_records" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "responseStatus" INTEGER,
    "responseBody" JSONB,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_idempotency_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "api_idempotency_records_userId_key_scope_key"
ON "api_idempotency_records"("userId", "key", "scope");

CREATE INDEX "api_idempotency_records_expiresAt_idx"
ON "api_idempotency_records"("expiresAt");

ALTER TABLE "api_idempotency_records"
ADD CONSTRAINT "api_idempotency_records_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
