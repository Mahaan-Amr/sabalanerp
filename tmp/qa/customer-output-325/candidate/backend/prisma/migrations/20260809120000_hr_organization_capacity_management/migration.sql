CREATE TYPE "HrRecruitmentRequestStatus" AS ENUM ('DRAFT', 'APPROVED', 'CLOSED', 'CANCELLED');

CREATE TABLE "hr_recruitment_requests" (
    "id" TEXT NOT NULL,
    "stableKey" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "status" "HrRecruitmentRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedHeadcount" INTEGER NOT NULL,
    "convertedHires" INTEGER NOT NULL DEFAULT 0,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "hr_recruitment_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hr_foundation_reserved_codes" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "deletedEntityId" TEXT NOT NULL,
    "deletedByUserId" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT NOT NULL,
    CONSTRAINT "hr_foundation_reserved_codes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "hr_recruitment_requests_stableKey_key" ON "hr_recruitment_requests"("stableKey");
CREATE INDEX "hr_recruitment_requests_positionId_status_effectiveFrom_effectiveTo_idx" ON "hr_recruitment_requests"("positionId", "status", "effectiveFrom", "effectiveTo");
CREATE UNIQUE INDEX "hr_foundation_reserved_codes_entityType_code_key" ON "hr_foundation_reserved_codes"("entityType", "code");
CREATE UNIQUE INDEX "hr_foundation_reserved_codes_entityType_deletedEntityId_key" ON "hr_foundation_reserved_codes"("entityType", "deletedEntityId");

ALTER TABLE "hr_recruitment_requests" ADD CONSTRAINT "hr_recruitment_requests_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "hr_positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hr_recruitment_requests" ADD CONSTRAINT "hr_recruitment_requests_headcount_check" CHECK ("approvedHeadcount" > 0 AND "convertedHires" >= 0 AND "convertedHires" <= "approvedHeadcount");
ALTER TABLE "hr_recruitment_requests" ADD CONSTRAINT "hr_recruitment_requests_dates_check" CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom");
ALTER TABLE "hr_foundation_reserved_codes" ADD CONSTRAINT "hr_foundation_reserved_codes_reason_check" CHECK (length(trim("reason")) > 0);
