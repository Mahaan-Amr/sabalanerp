ALTER TABLE "sales_contracts"
  ADD COLUMN "isInactive" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "inactiveAt" TIMESTAMP(3),
  ADD COLUMN "inactiveBy" TEXT,
  ADD COLUMN "inactiveReason" TEXT;

CREATE TYPE "ContractLifecycleRequestKind" AS ENUM ('DELETE', 'DEACTIVATE', 'REACTIVATE');
CREATE TYPE "ContractLifecycleRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXECUTED', 'BLOCKED');

CREATE TABLE "contract_lifecycle_requests" (
  "id" TEXT NOT NULL,
  "contractId" TEXT NOT NULL,
  "contractNumberSnapshot" TEXT NOT NULL,
  "kind" "ContractLifecycleRequestKind" NOT NULL,
  "status" "ContractLifecycleRequestStatus" NOT NULL DEFAULT 'PENDING',
  "reason" TEXT NOT NULL,
  "requestedBy" TEXT NOT NULL,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decidedBy" TEXT,
  "decidedAt" TIMESTAMP(3),
  "decisionNote" TEXT,
  "executedAt" TIMESTAMP(3),
  "blockers" JSONB,
  "contractSnapshot" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "contract_lifecycle_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "contract_lifecycle_requests_contractId_createdAt_idx"
  ON "contract_lifecycle_requests"("contractId", "createdAt");
CREATE INDEX "contract_lifecycle_requests_status_requestedAt_idx"
  ON "contract_lifecycle_requests"("status", "requestedAt");
CREATE INDEX "contract_lifecycle_requests_kind_status_idx"
  ON "contract_lifecycle_requests"("kind", "status");
CREATE INDEX "sales_contracts_isInactive_createdAt_idx"
  ON "sales_contracts"("isInactive", "createdAt");
