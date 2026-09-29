BEGIN;
-- Confirmation sessions and private PDF artifacts freeze different output purposes.
-- Existing evidence remains immutable and retains its confirmation binding.
CREATE TYPE "PartnerOutputSnapshotPurpose" AS ENUM ('CUSTOMER_CONFIRMATION', 'PDF_PREVIEW', 'PDF_FINAL');
ALTER TABLE "partner_customer_output_snapshots" ADD COLUMN "purpose" "PartnerOutputSnapshotPurpose" NOT NULL DEFAULT 'CUSTOMER_CONFIRMATION';
DROP INDEX "partner_customer_output_snapshots_caseId_caseRevision_recip_key";
CREATE UNIQUE INDEX "partner_output_snapshot_purpose_key"
ON "partner_customer_output_snapshots"("caseId", "caseRevision", "recipient", "purpose");
COMMIT;
