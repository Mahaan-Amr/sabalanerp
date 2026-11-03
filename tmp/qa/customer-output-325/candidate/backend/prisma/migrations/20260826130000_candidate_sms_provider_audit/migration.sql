ALTER TABLE "hr_candidate_sms_attempts"
  ADD COLUMN "providerDeliveryCode" INTEGER,
  ADD COLUMN "providerFailureKind" TEXT,
  ADD COLUMN "providerHttpStatus" INTEGER,
  ADD COLUMN "providerResultJson" JSONB;
