CREATE TABLE "accounting_control_transfer_policies" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "carriage" TEXT NOT NULL,
    "recognitionPoint" TEXT NOT NULL,
    "exceptionReason" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "evidenceHash" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "accounting_control_transfer_policies_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "accounting_control_transfer_policies_contractId_effectiveFr_idx"
  ON "accounting_control_transfer_policies"("contractId", "effectiveFrom", "effectiveTo");
CREATE UNIQUE INDEX "accounting_control_transfer_policies_contractId_version_key"
  ON "accounting_control_transfer_policies"("contractId", "version");

CREATE TRIGGER "accounting_control_transfer_policy_immutable"
BEFORE UPDATE OR DELETE ON "accounting_control_transfer_policies"
FOR EACH ROW EXECUTE FUNCTION "accounting_reject_immutable_change"();
