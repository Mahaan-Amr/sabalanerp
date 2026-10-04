-- Successor rows retain their unique predecessor constraint. Case commands
-- serialize on the Case lock and reject duplicate initial pricing packages.
DROP INDEX "partner_inquiries_case_revision_key";
