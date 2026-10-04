ALTER TABLE "contract_dispatch_authorities" DROP CONSTRAINT "contract_dispatch_authorities_kind_check";
ALTER TABLE "contract_dispatch_authorities" ADD CONSTRAINT "contract_dispatch_authorities_kind_check"
  CHECK ("kind" IN ('MANAGER', 'CREDIT', 'DATE', 'TRANSFER', 'CUSTOMER_DATE'));
CREATE UNIQUE INDEX "contract_dispatch_authorities_pending_customer_date"
  ON "contract_dispatch_authorities"("contractId") WHERE "kind" = 'CUSTOMER_DATE' AND "status" = 'PENDING';
