CREATE TABLE "sales_contract_draft_audits" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_contract_draft_audits_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sales_contract_draft_audits_draftId_createdAt_idx"
ON "sales_contract_draft_audits"("draftId", "createdAt");

CREATE INDEX "sales_contract_draft_audits_ownerUserId_createdAt_idx"
ON "sales_contract_draft_audits"("ownerUserId", "createdAt");

-- Pre-lifecycle sessions were never renewable and must not continue claiming
-- ownership after this migration. Meaningful recovery remains discoverable
-- through its envelope timestamp and is cleaned by the seven-day policy.
UPDATE "sales_contract_edit_sessions"
SET "updatedAt" = LEAST("updatedAt", CURRENT_TIMESTAMP - INTERVAL '76 seconds');
