ALTER TABLE "partner_inquiries"
  ADD COLUMN "caseId" TEXT;

CREATE INDEX "partner_inquiries_caseId_createdAt_idx"
  ON "partner_inquiries"("caseId", "createdAt");

ALTER TABLE "partner_inquiries"
  ADD CONSTRAINT "partner_inquiries_caseId_fkey"
  FOREIGN KEY ("caseId") REFERENCES "partner_sale_cases"("id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;
