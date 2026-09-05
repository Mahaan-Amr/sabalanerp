ALTER TABLE "sabalan_to_partner_sale_records"
  ADD CONSTRAINT "sabalan_to_partner_sale_records_id_caseId_key" UNIQUE ("id", "caseId");

ALTER TABLE "partner_fulfillment_lineages"
  DROP CONSTRAINT "partner_fulfillment_internal_record",
  ADD CONSTRAINT "partner_fulfillment_internal_record_owner"
    FOREIGN KEY ("internalRecordId", "caseId")
    REFERENCES "sabalan_to_partner_sale_records"("id", "caseId")
    ON DELETE RESTRICT ON UPDATE NO ACTION;
