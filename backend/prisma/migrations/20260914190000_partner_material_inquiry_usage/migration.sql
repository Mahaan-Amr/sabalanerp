CREATE TABLE "partner_material_inquiry_usages" (
  "id" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "caseRevision" INTEGER NOT NULL,
  "pricingSubjectId" TEXT NOT NULL,
  "approvalId" TEXT NOT NULL,
  "approvalSnapshot" JSONB NOT NULL,
  "evidenceHash" TEXT NOT NULL,
  "usedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "partner_material_inquiry_usages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "partner_material_inquiry_usages_caseId_caseRevision_pricingSubjectId_key"
  ON "partner_material_inquiry_usages"("caseId", "caseRevision", "pricingSubjectId");

ALTER TABLE "partner_material_inquiry_usages"
  ADD CONSTRAINT "partner_material_inquiry_usages_case_revision_fkey"
  FOREIGN KEY ("caseId", "caseRevision") REFERENCES "partner_case_revisions"("caseId", "revision")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "partner_material_inquiry_usages"
  ADD CONSTRAINT "partner_material_inquiry_usages_approvalId_fkey"
  FOREIGN KEY ("approvalId") REFERENCES "partner_inquiry_approvals"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
