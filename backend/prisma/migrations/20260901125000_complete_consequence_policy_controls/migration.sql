CREATE TABLE "hr_compensation_agreements" (
  "id" TEXT NOT NULL,
  "employmentRelationshipId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "effectiveTo" TIMESTAMP(3),
  "currency" TEXT NOT NULL DEFAULT 'IRR',
  "componentsJson" JSONB NOT NULL,
  "totalRials" DECIMAL(18,0) NOT NULL,
  "payRangeMinimumRials" DECIMAL(18,0) NOT NULL,
  "payRangeMaximumRials" DECIMAL(18,0) NOT NULL,
  "budgetCode" TEXT NOT NULL,
  "budgetAvailableRials" DECIMAL(18,0) NOT NULL,
  "legalControlStatus" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "approvedByUserId" TEXT,
  "approvedAt" TIMESTAMP(3),
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hr_compensation_agreements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "hr_compensation_agreements_relationship_fkey" FOREIGN KEY ("employmentRelationshipId") REFERENCES "hr_employment_relationships"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "hr_compensation_agreements_approver_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "hr_compensation_agreements_creator_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "hr_compensation_agreements_range_check" CHECK ("payRangeMinimumRials" <= "totalRials" AND "totalRials" <= "payRangeMaximumRials"),
  CONSTRAINT "hr_compensation_agreements_effective_check" CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom")
);

CREATE UNIQUE INDEX "hr_compensation_agreements_relationship_version_key" ON "hr_compensation_agreements"("employmentRelationshipId", "version");
CREATE UNIQUE INDEX "hr_compensation_agreements_one_current" ON "hr_compensation_agreements"("employmentRelationshipId") WHERE "status" = 'ACTIVE' AND "effectiveTo" IS NULL;
CREATE INDEX "hr_compensation_agreements_relationship_status_effective_idx" ON "hr_compensation_agreements"("employmentRelationshipId", "status", "effectiveFrom", "effectiveTo");

CREATE OR REPLACE FUNCTION hr_guard_compensation_agreement()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'compensation agreement evidence is immutable'; END IF;
  IF TG_OP = 'UPDATE' AND OLD."status" <> 'DRAFT' AND to_jsonb(OLD) IS DISTINCT FROM to_jsonb(NEW) THEN
    RAISE EXCEPTION 'published compensation agreement is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "hr_compensation_agreement_guard" BEFORE UPDATE OR DELETE ON "hr_compensation_agreements" FOR EACH ROW EXECUTE FUNCTION hr_guard_compensation_agreement();

UPDATE "performance_consequence_policy_versions" SET "lifecycle" = 'RETIRED', "retiredAt" = CURRENT_TIMESTAMP WHERE "lifecycle" = 'ACTIVE';

INSERT INTO "performance_consequence_policy_versions" ("id", "version", "content", "contentHash", "createdAt") VALUES (
  'performance-consequence-policy-v2', 2,
  '{"schemaVersion":1,"rules":{"COMPENSATION_REVIEW":{"minimumResults":1,"maximumAgeDays":365,"requireMultiplePeriods":false,"requireCompensationContext":true,"allowEndedRelationship":false,"requireLegalControl":true,"destination":{"responsibilityTypeCode":"PERFORMANCE_CONSEQUENCE_DESTINATION_COMPENSATION_REVIEW","workspaceCode":"HR","queueCode":"COMPENSATION_REVIEW"}},"DISCRETIONARY_BONUS_REVIEW":{"minimumResults":1,"maximumAgeDays":365,"requireMultiplePeriods":false,"requireCompensationContext":true,"allowEndedRelationship":true,"requireLegalControl":true,"destination":{"responsibilityTypeCode":"PERFORMANCE_CONSEQUENCE_DESTINATION_DISCRETIONARY_BONUS_REVIEW","workspaceCode":"HR","queueCode":"DISCRETIONARY_BONUS_REVIEW"}},"PROMOTION_REVIEW":{"minimumResults":1,"maximumAgeDays":365,"requireMultiplePeriods":false,"requireCompensationContext":false,"allowEndedRelationship":false,"requireLegalControl":false,"destination":{"responsibilityTypeCode":"PERFORMANCE_CONSEQUENCE_DESTINATION_PROMOTION_REVIEW","workspaceCode":"HR","queueCode":"PROMOTION_REVIEW"}},"PERFORMANCE_IMPROVEMENT_REVIEW":{"minimumResults":2,"maximumAgeDays":180,"requireMultiplePeriods":true,"requireCompensationContext":false,"allowEndedRelationship":false,"requireLegalControl":true,"destination":{"responsibilityTypeCode":"PERFORMANCE_CONSEQUENCE_DESTINATION_PERFORMANCE_IMPROVEMENT_REVIEW","workspaceCode":"HR","queueCode":"PERFORMANCE_IMPROVEMENT_REVIEW"}},"DEMOTION_REVIEW":{"minimumResults":2,"maximumAgeDays":180,"requireMultiplePeriods":true,"requireCompensationContext":false,"allowEndedRelationship":false,"requireLegalControl":true,"destination":{"responsibilityTypeCode":"PERFORMANCE_CONSEQUENCE_DESTINATION_DEMOTION_REVIEW","workspaceCode":"HR","queueCode":"DEMOTION_REVIEW"}}}}'::jsonb,
  encode(digest('{"schemaVersion":1,"rules":{"COMPENSATION_REVIEW":{"minimumResults":1,"maximumAgeDays":365,"requireMultiplePeriods":false,"requireCompensationContext":true,"allowEndedRelationship":false,"requireLegalControl":true,"destination":{"responsibilityTypeCode":"PERFORMANCE_CONSEQUENCE_DESTINATION_COMPENSATION_REVIEW","workspaceCode":"HR","queueCode":"COMPENSATION_REVIEW"}},"DISCRETIONARY_BONUS_REVIEW":{"minimumResults":1,"maximumAgeDays":365,"requireMultiplePeriods":false,"requireCompensationContext":true,"allowEndedRelationship":true,"requireLegalControl":true,"destination":{"responsibilityTypeCode":"PERFORMANCE_CONSEQUENCE_DESTINATION_DISCRETIONARY_BONUS_REVIEW","workspaceCode":"HR","queueCode":"DISCRETIONARY_BONUS_REVIEW"}},"PROMOTION_REVIEW":{"minimumResults":1,"maximumAgeDays":365,"requireMultiplePeriods":false,"requireCompensationContext":false,"allowEndedRelationship":false,"requireLegalControl":false,"destination":{"responsibilityTypeCode":"PERFORMANCE_CONSEQUENCE_DESTINATION_PROMOTION_REVIEW","workspaceCode":"HR","queueCode":"PROMOTION_REVIEW"}},"PERFORMANCE_IMPROVEMENT_REVIEW":{"minimumResults":2,"maximumAgeDays":180,"requireMultiplePeriods":true,"requireCompensationContext":false,"allowEndedRelationship":false,"requireLegalControl":true,"destination":{"responsibilityTypeCode":"PERFORMANCE_CONSEQUENCE_DESTINATION_PERFORMANCE_IMPROVEMENT_REVIEW","workspaceCode":"HR","queueCode":"PERFORMANCE_IMPROVEMENT_REVIEW"}},"DEMOTION_REVIEW":{"minimumResults":2,"maximumAgeDays":180,"requireMultiplePeriods":true,"requireCompensationContext":false,"allowEndedRelationship":false,"requireLegalControl":true,"destination":{"responsibilityTypeCode":"PERFORMANCE_CONSEQUENCE_DESTINATION_DEMOTION_REVIEW","workspaceCode":"HR","queueCode":"DEMOTION_REVIEW"}}}}', 'sha256'), 'hex'), CURRENT_TIMESTAMP
);
UPDATE "performance_consequence_policy_versions" SET "lifecycle" = 'SCHEDULED', "effectiveFrom" = CURRENT_TIMESTAMP, "publicationReason" = 'تکمیل کنترل‌های مقصد و حقوقی پیامد', "publishedAt" = CURRENT_TIMESTAMP WHERE "id" = 'performance-consequence-policy-v2';
UPDATE "performance_consequence_policy_versions" SET "lifecycle" = 'ACTIVE' WHERE "id" = 'performance-consequence-policy-v2';

CREATE OR REPLACE FUNCTION performance_guard_consequence_policy_version()
RETURNS trigger AS $$
DECLARE old_state TEXT; new_state TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'published consequence policy is immutable'; END IF;
  new_state := NEW."lifecycle"::TEXT;
  IF TG_OP = 'INSERT' THEN
    IF new_state <> 'DRAFT' THEN RAISE EXCEPTION 'consequence policy versions must begin as drafts'; END IF;
    RETURN NEW;
  END IF;
  old_state := OLD."lifecycle"::TEXT;
  IF old_state = new_state AND old_state <> 'DRAFT' THEN RAISE EXCEPTION 'published consequence policy is immutable'; END IF;
  IF old_state <> new_state AND NOT ((old_state = 'DRAFT' AND new_state IN ('SCHEDULED', 'CANCELLED')) OR (old_state = 'SCHEDULED' AND new_state IN ('ACTIVE', 'RETIRED')) OR (old_state = 'ACTIVE' AND new_state = 'RETIRED')) THEN
    RAISE EXCEPTION 'invalid consequence policy lifecycle transition';
  END IF;
  IF old_state <> 'DRAFT' AND (to_jsonb(OLD) - 'lifecycle' - 'retiredAt') IS DISTINCT FROM (to_jsonb(NEW) - 'lifecycle' - 'retiredAt') THEN RAISE EXCEPTION 'published consequence policy is immutable'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER "performance_consequence_policy_version_guard" ON "performance_consequence_policy_versions";
CREATE TRIGGER "performance_consequence_policy_version_guard" BEFORE INSERT OR UPDATE OR DELETE ON "performance_consequence_policy_versions" FOR EACH ROW EXECUTE FUNCTION performance_guard_consequence_policy_version();
