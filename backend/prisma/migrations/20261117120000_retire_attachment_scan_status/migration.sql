-- Retain historical values for rollback and stop requiring scan metadata on new uploads.
BEGIN;

ALTER TABLE "support_ticket_attachments" ALTER COLUMN "malwareScanStatus" DROP NOT NULL;
ALTER TABLE "support_ticket_attachments" ALTER COLUMN "malwareScanStatus" DROP DEFAULT;
ALTER TABLE "accounting_archive_evidence" ALTER COLUMN "malwareScanStatus" DROP NOT NULL;
ALTER TABLE "hr_employment_contract_documents" ALTER COLUMN "malwareScanStatus" DROP NOT NULL;
ALTER TABLE "purchasing_attachments" ALTER COLUMN "scanStatus" DROP NOT NULL;

COMMIT;
