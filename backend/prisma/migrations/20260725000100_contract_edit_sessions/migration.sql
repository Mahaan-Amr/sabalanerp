CREATE TABLE "sales_contract_edit_sessions" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "contractId" TEXT,
    "ownerUserId" TEXT NOT NULL,
    "browserSessionId" TEXT NOT NULL,
    "leaseToken" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "baseRevision" INTEGER NOT NULL,
    "recovery" JSONB,
    "takenOverAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_contract_edit_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sales_contract_edit_sessions_draftId_key"
ON "sales_contract_edit_sessions"("draftId");

CREATE UNIQUE INDEX "sales_contract_edit_sessions_leaseToken_key"
ON "sales_contract_edit_sessions"("leaseToken");

CREATE INDEX "sales_contract_edit_sessions_contractId_idx"
ON "sales_contract_edit_sessions"("contractId");

CREATE INDEX "sales_contract_edit_sessions_ownerUserId_updatedAt_idx"
ON "sales_contract_edit_sessions"("ownerUserId", "updatedAt");
