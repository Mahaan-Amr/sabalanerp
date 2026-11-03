ALTER TABLE "manual_outage_exits"
  ADD CONSTRAINT "manual_outage_approved_requires_distinct_actors"
  CHECK (
    "status" NOT IN ('APPROVED', 'REGISTERED')
    OR (
      "accountingApprovedAt" IS NOT NULL
      AND "accountingApprovedBy" IS NOT NULL
      AND "guardApprovedAt" IS NOT NULL
      AND "guardApprovedBy" IS NOT NULL
      AND "accountingApprovedBy" <> "guardApprovedBy"
    )
  );

ALTER TABLE "manual_outage_exits"
  ADD CONSTRAINT "manual_outage_registered_requires_complete_record"
  CHECK (
    "status" <> 'REGISTERED'
    OR (
      "recordedAt" IS NOT NULL
      AND "recordedBy" IS NOT NULL
      AND "snapshot" IS NOT NULL
      AND "integrityHash" IS NOT NULL
    )
  );
