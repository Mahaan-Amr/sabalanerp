ALTER TABLE "hr_hiring_authorities"
  ADD COLUMN "revokedAt" TIMESTAMP(3),
  ADD COLUMN "revokedBy" TEXT,
  ADD COLUMN "revocationReason" TEXT;
