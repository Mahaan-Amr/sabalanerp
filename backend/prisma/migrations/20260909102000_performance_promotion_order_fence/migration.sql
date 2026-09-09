CREATE OR REPLACE FUNCTION performance_guard_cohort_governance()
RETURNS trigger AS $$
DECLARE approved_count INTEGER;
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
    IF NOT FOUND OR evidence_row."targetCohortVersionId" <> NEW."id"
      OR evidence_row."targetCohortStage" <> NEW."stage" OR evidence_row."targetMembershipHash" <> NEW."membershipHash"
      OR evidence_row."targetPhase" <> NEW."targetPhase"
      OR (NEW."lifecycle" = 'SCHEDULED' AND evidence_row."validUntil" <= NEW."effectiveFrom")
      OR (NEW."lifecycle" = 'ACTIVE' AND evidence_row."validUntil" <= clock_timestamp())
      OR EXISTS (SELECT 1 FROM "performance_promotion_evidence_revocations" r WHERE r."promotionEvidenceId" = evidence_row."id") THEN
      RAISE EXCEPTION 'performance cohort promotion evidence is missing, stale, revoked or unrelated';
    END IF;
    SELECT count(*) INTO member_count FROM "performance_cohort_members" WHERE "cohortVersionId" = NEW."id";
    IF member_count <> evidence_row."targetMemberCount" THEN
      RAISE EXCEPTION 'performance cohort promotion population changed';
    END IF;
    SELECT count(DISTINCT "ownerType") INTO approved_count
    FROM "performance_rollout_decisions" latest
    WHERE latest."scopeType" = 'COHORT' AND latest."scopeId" = NEW."id" AND latest."action" = 'APPROVE'
      AND latest."promotionEvidenceId" = evidence_row."id"
      AND NOT EXISTS (SELECT 1 FROM "performance_rollout_decisions" later
        WHERE later."scopeType" = latest."scopeType" AND later."scopeId" = latest."scopeId"
          AND later."ownerType" = latest."ownerType" AND later."version" > latest."version");
    IF approved_count <> 3 THEN
      RAISE EXCEPTION 'performance cohort requires three current owner approvals for exact promotion evidence';
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
        WHEN 'PILOT' THEN 'TEN_PERCENT'
        WHEN 'TEN_PERCENT' THEN 'TWENTY_FIVE_PERCENT'
        WHEN 'TWENTY_FIVE_PERCENT' THEN 'FIFTY_PERCENT'
        WHEN 'FIFTY_PERCENT' THEN 'ALL'
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
    target_phase_index := CASE NEW."targetPhase"::text
      WHEN 'SCHEMA_PROTECTION' THEN 0 WHEN 'POLICY_DARK_LAUNCH' THEN 1 WHEN 'READINESS' THEN 2
      WHEN 'SUPERVISOR_HR_PILOT' THEN 3 WHEN 'RESULT_LEVEL_BADGE' THEN 4
      WHEN 'ANALYTICS_RANKING_CALIBRATION' THEN 5 WHEN 'PDF_EXCEL_EXPORT' THEN 6
      WHEN 'CONSEQUENCE_HANDOFF' THEN 7 WHEN 'EXPANSION_RETIREMENT' THEN 8 END;
    current_phase_index := COALESCE(current_phase_index, -1);
    IF target_phase_index < current_phase_index OR target_phase_index > current_phase_index + 1 THEN
      RAISE EXCEPTION 'performance phases must advance in approved order';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
