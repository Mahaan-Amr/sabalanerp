CREATE TYPE "HrWorkItemStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETE', 'WAIVED');
CREATE TYPE "HrWorkItemSourceType" AS ENUM ('MANUAL', 'HIRING_ACTION', 'QUALITY_FINDING');

CREATE TABLE "hr_hiring_authority_default_owners" (
  "authority" "HrHiringAuthorityType" NOT NULL,
  "userId" TEXT NOT NULL,
  "configuredBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hr_hiring_authority_default_owners_pkey" PRIMARY KEY ("authority")
);

CREATE TABLE "hr_work_items" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "status" "HrWorkItemStatus" NOT NULL DEFAULT 'PENDING',
  "sourceType" "HrWorkItemSourceType" NOT NULL,
  "sourceKey" TEXT,
  "destinationHref" TEXT NOT NULL,
  "dueDate" TIMESTAMP(3) NOT NULL,
  "assignedToUserId" TEXT,
  "createdByUserId" TEXT,
  "completedByUserId" TEXT,
  "completedAt" TIMESTAMP(3),
  "waivedByUserId" TEXT,
  "waivedAt" TIMESTAMP(3),
  "waiverReason" TEXT,
  "assignmentReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hr_work_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hr_work_item_audits" (
  "id" TEXT NOT NULL,
  "workItemId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "eventType" TEXT NOT NULL,
  "beforeJson" JSONB,
  "afterJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hr_work_item_audits_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "hr_work_items_sourceKey_key" ON "hr_work_items"("sourceKey");
CREATE INDEX "hr_hiring_authority_default_owners_userId_idx" ON "hr_hiring_authority_default_owners"("userId");
CREATE INDEX "hr_work_items_assignedToUserId_status_dueDate_idx" ON "hr_work_items"("assignedToUserId", "status", "dueDate");
CREATE INDEX "hr_work_items_sourceType_status_idx" ON "hr_work_items"("sourceType", "status");
CREATE INDEX "hr_work_items_status_dueDate_idx" ON "hr_work_items"("status", "dueDate");
CREATE INDEX "hr_work_item_audits_workItemId_createdAt_idx" ON "hr_work_item_audits"("workItemId", "createdAt");

ALTER TABLE "hr_hiring_authority_default_owners" ADD CONSTRAINT "hr_hiring_authority_default_owners_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hr_hiring_authority_default_owners" ADD CONSTRAINT "hr_hiring_authority_default_owners_configuredBy_fkey" FOREIGN KEY ("configuredBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hr_work_items" ADD CONSTRAINT "hr_work_items_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hr_work_items" ADD CONSTRAINT "hr_work_items_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hr_work_items" ADD CONSTRAINT "hr_work_items_completedByUserId_fkey" FOREIGN KEY ("completedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hr_work_items" ADD CONSTRAINT "hr_work_items_waivedByUserId_fkey" FOREIGN KEY ("waivedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hr_work_item_audits" ADD CONSTRAINT "hr_work_item_audits_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "hr_work_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hr_work_item_audits" ADD CONSTRAINT "hr_work_item_audits_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
