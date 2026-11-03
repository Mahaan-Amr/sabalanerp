ALTER TABLE "hr_compensation_snapshots"
  ADD COLUMN "preparedAt" TIMESTAMP(3),
  ADD COLUMN "candidateDecision" TEXT,
  ADD COLUMN "candidateDecisionAt" TIMESTAMP(3),
  ADD COLUMN "candidateDecisionSource" TEXT,
  ADD COLUMN "candidateDeclineCategory" TEXT,
  ADD COLUMN "candidateDecisionNote" TEXT,
  ADD COLUMN "candidateDecisionBy" TEXT,
  ADD COLUMN "offlineCommunicationMethod" TEXT,
  ADD COLUMN "offlineCommunicatedAt" TIMESTAMP(3),
  ADD COLUMN "offlineReason" TEXT,
  ADD COLUMN "offlineConfirmedInformation" TEXT,
  ADD COLUMN "candidateNotificationStatus" TEXT,
  ADD COLUMN "candidateNotificationError" TEXT,
  ADD COLUMN "candidateNotificationClaimedAt" TIMESTAMP(3),
  ADD COLUMN "candidateNotificationClaimToken" TEXT,
  ADD COLUMN "candidateNotifiedAt" TIMESTAMP(3),
  ADD COLUMN "candidateNotificationAttempts" INTEGER NOT NULL DEFAULT 0;

UPDATE "hr_compensation_snapshots"
SET "preparedAt" = COALESCE("hrApprovedAt", "financeApprovedAt", CURRENT_TIMESTAMP)
WHERE "preparedBy" IS NOT NULL
  AND "preparedAt" IS NULL;
