-- DropIndex
DROP INDEX IF EXISTS "contract_verification_codes_contractId_phoneNumber_key";

-- CreateIndex
CREATE INDEX IF NOT EXISTS "contract_verification_codes_contractId_phoneNumber_idx" ON "contract_verification_codes"("contractId", "phoneNumber");

-- CreateTable
CREATE TABLE IF NOT EXISTS "contract_public_confirmations" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "otpCodeHash" TEXT NOT NULL,
    "otpExpiresAt" TIMESTAMP(3) NOT NULL,
    "linkExpiresAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "attemptsUsed" INTEGER NOT NULL DEFAULT 0,
    "lastSentAt" TIMESTAMP(3),
    "resendCount" INTEGER NOT NULL DEFAULT 0,
    "verifiedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "contract_public_confirmations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "contract_confirmation_audit_logs" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "sessionId" TEXT,
    "eventType" TEXT NOT NULL,
    "eventAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "acceptLanguage" TEXT,
    "deviceFingerprint" TEXT,
    "referrer" TEXT,
    "provider" TEXT,
    "providerMessageId" TEXT,
    "providerRawResponse" JSONB,
    "eventPayloadJson" JSONB,
    "eventHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_confirmation_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "contract_public_confirmations_tokenHash_key" ON "contract_public_confirmations"("tokenHash");
CREATE INDEX IF NOT EXISTS "contract_public_confirmations_contractId_status_idx" ON "contract_public_confirmations"("contractId", "status");
CREATE INDEX IF NOT EXISTS "contract_public_confirmations_phoneNumber_idx" ON "contract_public_confirmations"("phoneNumber");
CREATE INDEX IF NOT EXISTS "contract_confirmation_audit_logs_contractId_eventAt_idx" ON "contract_confirmation_audit_logs"("contractId", "eventAt");
CREATE INDEX IF NOT EXISTS "contract_confirmation_audit_logs_sessionId_idx" ON "contract_confirmation_audit_logs"("sessionId");

-- AddForeignKey
ALTER TABLE "contract_public_confirmations"
ADD CONSTRAINT "contract_public_confirmations_contractId_fkey"
FOREIGN KEY ("contractId") REFERENCES "sales_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "contract_confirmation_audit_logs"
ADD CONSTRAINT "contract_confirmation_audit_logs_contractId_fkey"
FOREIGN KEY ("contractId") REFERENCES "sales_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

