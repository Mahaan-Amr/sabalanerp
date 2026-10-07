-- NULL preserves the recorded interpretation of existing approvals.
ALTER TABLE "partner_inquiry_approvals" ADD COLUMN "wholesaleMandatory" JSONB;
