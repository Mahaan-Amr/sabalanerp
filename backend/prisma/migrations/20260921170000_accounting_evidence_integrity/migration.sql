ALTER TABLE "accounting_destination_acceptance_evidence"
ADD COLUMN "pricingVersionId" TEXT;

UPDATE "accounting_destination_acceptance_evidence" AS evidence
SET "pricingVersionId" = head."currentVersionId"
FROM "contract_approved_pricing_heads" AS head
WHERE head."contractId" = evidence."contractId" AND evidence."pricingVersionId" IS NULL;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "accounting_destination_acceptance_evidence" WHERE "pricingVersionId" IS NULL) THEN
    RAISE EXCEPTION 'DESTINATION_ACCEPTANCE_PRICING_VERSION_REQUIRED';
  END IF;
END $$;

ALTER TABLE "accounting_destination_acceptance_evidence"
ALTER COLUMN "pricingVersionId" SET NOT NULL;
ALTER TABLE "accounting_destination_acceptance_evidence"
ADD CONSTRAINT "accounting_destination_acceptance_pricing_version_fkey" FOREIGN KEY ("pricingVersionId")
REFERENCES "contract_approved_pricing_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "accounting_return_evidence_consumptions"
ADD CONSTRAINT "accounting_return_consumption_evidence_fkey" FOREIGN KEY ("evidenceId")
REFERENCES "shipment_quantity_evidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accounting_return_evidence_consumptions"
ADD CONSTRAINT "accounting_return_consumption_credit_invoice_fkey" FOREIGN KEY ("creditInvoiceId")
REFERENCES "accounting_commercial_customer_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accounting_return_evidence_consumptions"
ADD CONSTRAINT "accounting_return_consumption_original_invoice_fkey" FOREIGN KEY ("originalInvoiceId")
REFERENCES "accounting_commercial_customer_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TRIGGER "accounting_destination_acceptance_immutable" BEFORE UPDATE OR DELETE
ON "accounting_destination_acceptance_evidence" FOR EACH ROW EXECUTE FUNCTION "accounting_reject_immutable_change"();
CREATE TRIGGER "accounting_return_evidence_consumption_immutable" BEFORE UPDATE OR DELETE
ON "accounting_return_evidence_consumptions" FOR EACH ROW EXECUTE FUNCTION "accounting_reject_immutable_change"();
CREATE TRIGGER "accounting_customer_statement_export_immutable" BEFORE UPDATE OR DELETE
ON "accounting_customer_statement_exports" FOR EACH ROW EXECUTE FUNCTION "accounting_reject_immutable_change"();
CREATE TRIGGER "accounting_vat_input_evidence_immutable" BEFORE UPDATE OR DELETE
ON "accounting_vat_input_evidence" FOR EACH ROW EXECUTE FUNCTION "accounting_reject_immutable_change"();
