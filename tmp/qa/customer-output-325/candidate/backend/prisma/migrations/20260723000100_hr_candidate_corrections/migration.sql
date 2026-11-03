ALTER TABLE "hr_application_form_revisions"
  ADD COLUMN "correctionDetailsJson" JSONB,
  ADD COLUMN "correctionNotificationStatus" TEXT,
  ADD COLUMN "correctionNotificationError" TEXT,
  ADD COLUMN "correctionNotifiedAt" TIMESTAMP(3),
  ADD COLUMN "correctionInvitationId" TEXT;
