ALTER TABLE "partner_inquiries"
  ADD COLUMN "caseRevision" INTEGER;

CREATE INDEX "partner_inquiries_caseId_caseRevision_createdAt_idx"
  ON "partner_inquiries"("caseId", "caseRevision", "createdAt");

ALTER TABLE "partner_inquiries"
  ADD CONSTRAINT "partner_inquiries_case_revision_fkey"
  FOREIGN KEY ("caseId", "caseRevision")
  REFERENCES "partner_case_revisions"("caseId", "revision")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "partner_inquiries"
  ADD CONSTRAINT "partner_inquiries_case_revision_scope_check"
  CHECK (
    ("caseId" IS NULL AND "caseRevision" IS NULL)
    OR
    ("caseId" IS NOT NULL AND "caseRevision" IS NOT NULL)
  );
