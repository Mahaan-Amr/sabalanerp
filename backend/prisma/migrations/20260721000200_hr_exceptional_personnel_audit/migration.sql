CREATE TABLE "hr_personnel_audits" (
  "id" TEXT NOT NULL,
  "personnelId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "sourceCategory" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "payloadJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hr_personnel_audits_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "hr_personnel_audits_personnelId_createdAt_idx"
  ON "hr_personnel_audits"("personnelId", "createdAt");

CREATE INDEX "hr_personnel_audits_eventType_createdAt_idx"
  ON "hr_personnel_audits"("eventType", "createdAt");

ALTER TABLE "hr_personnel_audits"
  ADD CONSTRAINT "hr_personnel_audits_personnelId_fkey"
  FOREIGN KEY ("personnelId") REFERENCES "personnel"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
