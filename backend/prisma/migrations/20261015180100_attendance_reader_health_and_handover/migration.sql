ALTER TABLE attendance_terminals ADD COLUMN "lastReadAt" TIMESTAMP(3);
ALTER TABLE attendance_review_handovers ADD COLUMN "evidenceHash" TEXT NOT NULL DEFAULT '';
ALTER TABLE attendance_review_handovers ALTER COLUMN "evidenceHash" DROP DEFAULT;
