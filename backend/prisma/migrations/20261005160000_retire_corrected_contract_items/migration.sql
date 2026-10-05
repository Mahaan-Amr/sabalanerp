ALTER TABLE "contract_items"
  ADD COLUMN "retiredAt" TIMESTAMP(3),
  ADD COLUMN "retiredByCorrectionId" TEXT,
  ADD COLUMN "retirementEvidence" JSONB;
ALTER TABLE "contract_items" ADD CONSTRAINT "contract_items_retirement_pair"
  CHECK (("retiredAt" IS NULL) = ("retiredByCorrectionId" IS NULL)
    AND ("retiredAt" IS NULL) = ("retirementEvidence" IS NULL));
ALTER TABLE "contract_items" ADD CONSTRAINT "contract_items_retirement_correction_fk"
  FOREIGN KEY ("retiredByCorrectionId") REFERENCES "accounting_correction_requests"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "contract_items_contractId_retiredAt_idx" ON "contract_items"("contractId", "retiredAt");
