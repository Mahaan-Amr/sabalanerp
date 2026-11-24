CREATE TABLE "stone_return_allocation_drafts" (
  "id" TEXT NOT NULL,
  "receiptId" TEXT NOT NULL,
  "version" INTEGER NOT NULL CHECK ("version" > 0),
  "attributionReason" TEXT,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stone_return_allocation_drafts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stone_return_allocation_drafts_receiptId_fkey"
    FOREIGN KEY ("receiptId") REFERENCES "stone_return_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "stone_return_allocation_drafts_receiptId_version_key"
  ON "stone_return_allocation_drafts"("receiptId", "version");

CREATE TABLE "stone_return_allocation_draft_rows" (
  "id" TEXT NOT NULL,
  "draftId" TEXT NOT NULL,
  "originalInvoiceId" TEXT NOT NULL,
  "originalInvoiceNumber" TEXT NOT NULL,
  "originalLineId" TEXT NOT NULL,
  "originalTaxInvoiceId" TEXT NOT NULL,
  "originalTaxLineId" TEXT NOT NULL,
  "dispatchEvidenceId" TEXT NOT NULL,
  "contractId" TEXT NOT NULL,
  "contractNumber" TEXT NOT NULL,
  "contractItemId" TEXT NOT NULL,
  "productRowId" TEXT NOT NULL,
  "quantity" DECIMAL(65, 30) NOT NULL CHECK ("quantity" > 0),
  CONSTRAINT "stone_return_allocation_draft_rows_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stone_return_allocation_draft_rows_draftId_fkey"
    FOREIGN KEY ("draftId") REFERENCES "stone_return_allocation_drafts"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "stone_return_allocation_draft_source_key"
  ON "stone_return_allocation_draft_rows"("draftId", "originalInvoiceId", "originalLineId", "dispatchEvidenceId");

ALTER TABLE "stone_return_allocation_drafts" ADD CONSTRAINT "stone_return_allocation_attribution_reason_check"
  CHECK ("attributionReason" IS NULL OR length(btrim("attributionReason")) BETWEEN 1 AND 2000);

CREATE TRIGGER "stone_return_allocation_drafts_immutability" BEFORE UPDATE OR DELETE ON "stone_return_allocation_drafts"
  FOR EACH ROW EXECUTE FUNCTION accounting_guard_supply_chain_append_only();
CREATE TRIGGER "stone_return_allocation_draft_rows_immutability" BEFORE UPDATE OR DELETE ON "stone_return_allocation_draft_rows"
  FOR EACH ROW EXECUTE FUNCTION accounting_guard_supply_chain_append_only();

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'sabalan_application_runtime') THEN
    REVOKE ALL ON TABLE public.stone_return_allocation_drafts, public.stone_return_allocation_draft_rows FROM sabalan_application_runtime;
    GRANT SELECT, INSERT ON TABLE public.stone_return_allocation_drafts, public.stone_return_allocation_draft_rows TO sabalan_application_runtime;
  END IF;
END $$;
