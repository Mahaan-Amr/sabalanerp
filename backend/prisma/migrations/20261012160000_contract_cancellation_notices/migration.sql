CREATE TABLE "contract_cancellation_notices" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "eventKey" TEXT NOT NULL,
  "contractId" TEXT,
  "sourceContractId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "contractNumber" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "selectedPhone" TEXT,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastAttemptAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "contract_cancellation_notices_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "sales_contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "contract_cancellation_notice_status" CHECK ("status" IN ('PENDING','SENDING','RETRY','SENT','UNKNOWN','NEEDS_PHONE','NEEDS_SELECTION','FAILED','SUPPRESSED'))
);
CREATE UNIQUE INDEX "contract_cancellation_notices_eventKey_key" ON "contract_cancellation_notices"("eventKey");
CREATE INDEX "contract_cancellation_notices_contractId_createdAt_idx" ON "contract_cancellation_notices"("contractId", "createdAt");
CREATE INDEX "contract_cancellation_notices_status_availableAt_idx" ON "contract_cancellation_notices"("status", "availableAt");
CREATE TABLE "contract_cancellation_notice_attempts" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "noticeId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "phoneNumber" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "providerMessageId" TEXT,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "contract_cancellation_notice_attempts_noticeId_fkey" FOREIGN KEY ("noticeId") REFERENCES "contract_cancellation_notices"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "contract_cancellation_notice_attempt_status" CHECK ("status" IN ('SENDING','SENT','FAILED','UNKNOWN','SUPPRESSED'))
);
CREATE UNIQUE INDEX "contract_cancellation_notice_attempts_noticeId_sequence_key" ON "contract_cancellation_notice_attempts"("noticeId", "sequence");
