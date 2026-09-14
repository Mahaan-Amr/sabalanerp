CREATE OR REPLACE FUNCTION performance_guard_cohort_governance()
RETURNS trigger AS $$
DECLARE approved_owner_count INTEGER;
DECLARE approved_actor_count INTEGER;
DECLARE authorized_count INTEGER;
DECLARE member_count INTEGER;
DECLARE current_phase_index INTEGER;
DECLARE target_phase_index INTEGER;
DECLARE predecessor_stage TEXT;
DECLARE predecessor_lifecycle TEXT;
DECLARE evidence_row "performance_promotion_evidence"%ROWTYPE;
BEGIN
  IF NEW."lifecycle" IN ('SCHEDULED','ACTIVE') AND OLD."lifecycle" IN ('DRAFT','SCHEDULED') AND NEW."stage" IS NOT NULL THEN
    IF NEW."promotionEvidenceId" IS NULL OR NEW."targetPhase" IS NULL THEN
      RAISE EXCEPTION 'performance cohort requires verified promotion evidence';
    END IF;
    SELECT * INTO evidence_row FROM "performance_promotion_evidence" WHERE "id" = NEW."promotionEvidenceId" FOR SHARE;
    target_phase_index := CASE NEW."targetPhase"::text
      WHEN 'SCHEMA_PROTECTION' THEN 0 WHEN 'POLICY_DARK_LAUNCH' THEN 1 WHEN 'READINESS' THEN 2
      WHEN 'SUPERVISOR_HR_PILOT' THEN 3 WHEN 'RESULT_LEVEL_BADGE' THEN 4
      WHEN 'ANALYTICS_RANKING_CALIBRATION' THEN 5 WHEN 'PDF_EXCEL_EXPORT' THEN 6
      WHEN 'CONSEQUENCE_HANDOFF' THEN 7 WHEN 'EXPANSION_RETIREMENT' THEN 8 END;
    IF NOT FOUND OR evidence_row."targetCohortVersionId" <> NEW."id"
      OR evidence_row."targetCohortStage" <> NEW."stage" OR evidence_row."targetMembershipHash" <> NEW."membershipHash"
      OR evidence_row."targetPhase" <> NEW."targetPhase" OR evidence_row."targetGate" <> target_phase_index + 1
      OR evidence_row."verifiedAt" > clock_timestamp()
      OR (NEW."lifecycle" = 'SCHEDULED' AND evidence_row."validUntil" <= NEW."effectiveFrom")
      OR (NEW."lifecycle" = 'ACTIVE' AND evidence_row."validUntil" <= clock_timestamp())
      OR EXISTS (SELECT 1 FROM "performance_promotion_evidence_revocations" r WHERE r."promotionEvidenceId" = evidence_row."id") THEN
      RAISE EXCEPTION 'performance cohort promotion evidence is missing, stale, revoked, incomplete or unrelated';
    END IF;
    SELECT count(*) INTO member_count FROM "performance_cohort_members" WHERE "cohortVersionId" = NEW."id";
    IF member_count <> evidence_row."targetMemberCount"
      OR (NEW."stage" = 'PILOT' AND (member_count < LEAST(10, evidence_row."targetReadyPopulation")
        OR member_count > LEAST(25, evidence_row."targetReadyPopulation")))
      OR (NEW."stage" = 'TEN_PERCENT' AND member_count <> CEIL(evidence_row."targetReadyPopulation" * 0.10))
      OR (NEW."stage" = 'TWENTY_FIVE_PERCENT' AND member_count <> CEIL(evidence_row."targetReadyPopulation" * 0.25))
      OR (NEW."stage" = 'FIFTY_PERCENT' AND member_count <> CEIL(evidence_row."targetReadyPopulation" * 0.50))
      OR (NEW."stage" = 'ALL' AND member_count <> evidence_row."targetReadyPopulation") THEN
      RAISE EXCEPTION 'performance cohort promotion population changed or does not match its ordered stage';
    END IF;
    SELECT count(DISTINCT latest."ownerType"), count(DISTINCT latest."actorUserId"),
      count(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM "users" u
        JOIN "hr_feature_access_grants" g ON g."userId" = u."id"
        WHERE u."id" = latest."actorUserId" AND u."isActive" = true
          AND g."featureCode" = CASE latest."ownerType"
            WHEN 'HUMAN_RESOURCES' THEN 'APPROVE_PERFORMANCE_COHORT_HR'
            WHEN 'SECURITY_PRIVACY' THEN 'APPROVE_PERFORMANCE_COHORT_SECURITY'
            WHEN 'SYSTEM_OWNER' THEN 'APPROVE_PERFORMANCE_COHORT_SYSTEM' END
          AND g."status" = 'ACTIVE' AND g."effectiveFrom" <= clock_timestamp()
          AND (g."effectiveTo" IS NULL OR g."effectiveTo" > clock_timestamp())
      ))
    INTO approved_owner_count, approved_actor_count, authorized_count
    FROM "performance_rollout_decisions" latest
    WHERE latest."scopeType" = 'COHORT' AND latest."scopeId" = NEW."id" AND latest."action" = 'APPROVE'
      AND latest."promotionEvidenceId" = evidence_row."id"
      AND NOT EXISTS (SELECT 1 FROM "performance_rollout_decisions" later
        WHERE later."scopeType" = latest."scopeType" AND later."scopeId" = latest."scopeId"
          AND later."ownerType" = latest."ownerType" AND later."version" > latest."version");
    IF approved_owner_count <> 3 OR approved_actor_count <> 3 OR authorized_count <> 3 THEN
      RAISE EXCEPTION 'performance cohort requires three distinct currently authorized owner approvals for exact promotion evidence';
    END IF;
  END IF;

  IF NEW."lifecycle" = 'SCHEDULED' AND OLD."lifecycle" = 'DRAFT' AND NEW."stage" IS NOT NULL THEN
    IF NEW."predecessorId" IS NULL AND NEW."stage" <> 'PILOT' THEN
      RAISE EXCEPTION 'performance cohort stages must start with pilot';
    END IF;
    IF NEW."predecessorId" IS NOT NULL THEN
      SELECT "stage", "lifecycle"::text INTO predecessor_stage, predecessor_lifecycle
      FROM "performance_cohort_versions" WHERE "id" = NEW."predecessorId" FOR SHARE;
      IF predecessor_lifecycle <> 'ACTIVE' OR (CASE predecessor_stage
        WHEN 'PILOT' THEN 'TEN_PERCENT' WHEN 'TEN_PERCENT' THEN 'TWENTY_FIVE_PERCENT'
        WHEN 'TWENTY_FIVE_PERCENT' THEN 'FIFTY_PERCENT' WHEN 'FIFTY_PERCENT' THEN 'ALL'
        ELSE NULL END) IS DISTINCT FROM NEW."stage" THEN
        RAISE EXCEPTION 'performance cohort stages must advance in approved order';
      END IF;
    END IF;
    SELECT CASE "phase"::text
      WHEN 'SCHEMA_PROTECTION' THEN 0 WHEN 'POLICY_DARK_LAUNCH' THEN 1 WHEN 'READINESS' THEN 2
      WHEN 'SUPERVISOR_HR_PILOT' THEN 3 WHEN 'RESULT_LEVEL_BADGE' THEN 4
      WHEN 'ANALYTICS_RANKING_CALIBRATION' THEN 5 WHEN 'PDF_EXCEL_EXPORT' THEN 6
      WHEN 'CONSEQUENCE_HANDOFF' THEN 7 WHEN 'EXPANSION_RETIREMENT' THEN 8 END
    INTO current_phase_index FROM "performance_feature_phase_versions"
    WHERE "effectiveFrom" <= clock_timestamp() ORDER BY "effectiveFrom" DESC, "version" DESC LIMIT 1;
    current_phase_index := COALESCE(current_phase_index, -1);
    IF target_phase_index < current_phase_index OR target_phase_index > current_phase_index + 1 THEN
      RAISE EXCEPTION 'performance phases must advance in approved order';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
