CREATE TABLE "performance_erasure_impact_approvals" (
  "id" TEXT NOT NULL,
  "policyVersionId" TEXT NOT NULL,
  "populationHash" TEXT NOT NULL,
  "eligibleScopeCount" INTEGER NOT NULL,
  "erasableRecordCount" INTEGER NOT NULL,
  "approvedByUserId" TEXT,
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "performance_erasure_impact_approvals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "performance_erasure_impact_policy_fkey" FOREIGN KEY ("policyVersionId") REFERENCES "performance_policy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_erasure_impact_approver_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_erasure_impact_counts_check" CHECK ("eligibleScopeCount" >= 0 AND "erasableRecordCount" >= 0),
  CONSTRAINT "performance_erasure_impact_approval_check" CHECK (("approvedByUserId" IS NULL) = ("approvedAt" IS NULL))
);
CREATE UNIQUE INDEX "performance_erasure_impact_policy_key" ON "performance_erasure_impact_approvals"("policyVersionId");
CREATE INDEX "performance_erasure_impact_approved_created_idx" ON "performance_erasure_impact_approvals"("approvedAt", "createdAt");

CREATE TABLE "performance_erasure_operations" (
  "id" TEXT NOT NULL,
  "operationKeyHash" TEXT NOT NULL,
  "retentionStateId" TEXT NOT NULL,
  "aggregateType" TEXT NOT NULL,
  "aggregateIdHash" TEXT NOT NULL,
  "policyVersionId" TEXT NOT NULL,
  "encryptedScopeId" TEXT NOT NULL,
  "scopeHash" TEXT NOT NULL,
  "dependencyHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING_IMPACT_APPROVAL',
  "recordCount" INTEGER NOT NULL,
  "bulkThreshold" INTEGER NOT NULL,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lastFailureCode" TEXT,
  "claimedAt" TIMESTAMP(3),
  "nextRetryAt" TIMESTAMP(3),
  "liveErasedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "performance_erasure_operations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "performance_erasure_operation_state_fkey" FOREIGN KEY ("retentionStateId") REFERENCES "performance_retention_states"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_erasure_operation_policy_fkey" FOREIGN KEY ("policyVersionId") REFERENCES "performance_policy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_erasure_operation_payload_fkey" FOREIGN KEY ("encryptedScopeId") REFERENCES "performance_encrypted_payloads"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_erasure_operation_counts_check" CHECK ("recordCount" > 0 AND "bulkThreshold" > 0 AND "attemptCount" >= 0),
  CONSTRAINT "performance_erasure_operation_status_check" CHECK ("status" IN ('PENDING_IMPACT_APPROVAL','PENDING_BULK_APPROVAL','COPY_REVIEW_REQUIRED','READY','RUNNING','PARTIAL_RESTRICTED','LIVE_ERASED_BACKUP_PENDING','COMPLETED'))
);
CREATE UNIQUE INDEX "performance_erasure_operation_key" ON "performance_erasure_operations"("operationKeyHash");
CREATE UNIQUE INDEX "performance_erasure_operation_state_key" ON "performance_erasure_operations"("retentionStateId");
CREATE UNIQUE INDEX "performance_erasure_operation_payload_key" ON "performance_erasure_operations"("encryptedScopeId");
CREATE INDEX "performance_erasure_operation_retry_idx" ON "performance_erasure_operations"("status", "nextRetryAt", "createdAt");
CREATE INDEX "performance_erasure_operation_policy_status_idx" ON "performance_erasure_operations"("policyVersionId", "status");

CREATE TABLE "performance_erasure_approvals" (
  "id" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "authorityHash" TEXT NOT NULL,
  "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "performance_erasure_approvals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "performance_erasure_approval_operation_fkey" FOREIGN KEY ("operationId") REFERENCES "performance_erasure_operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_erasure_approval_actor_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "performance_erasure_approval_actor_key" ON "performance_erasure_approvals"("operationId", "actorUserId");
CREATE INDEX "performance_erasure_approval_operation_time_idx" ON "performance_erasure_approvals"("operationId", "approvedAt");

CREATE TABLE "performance_recoverable_copies" (
  "id" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "location" TEXT NOT NULL,
  "copyKeyHash" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "recoverableUntil" TIMESTAMP(3),
  "evidenceHash" TEXT NOT NULL,
  "checkedByUserId" TEXT,
  "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "performance_recoverable_copies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "performance_recoverable_copy_operation_fkey" FOREIGN KEY ("operationId") REFERENCES "performance_erasure_operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_recoverable_copy_checker_fkey" FOREIGN KEY ("checkedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_recoverable_copy_location_check" CHECK ("location" IN ('LIVE_DATABASE','SEARCH_INDEX','APPLICATION_CACHE','TEMPORARY_STORAGE','DATABASE_REPLICA','ARTIFACT_STORAGE','INDEPENDENT_BACKUP')),
  CONSTRAINT "performance_recoverable_copy_status_check" CHECK ("status" IN ('PRESENT','RECOVERABLE','VERIFIED_ABSENT','ERASED','UNKNOWN'))
);
CREATE UNIQUE INDEX "performance_recoverable_copy_scope_key" ON "performance_recoverable_copies"("operationId", "location", "copyKeyHash");
CREATE INDEX "performance_recoverable_copy_expiry_idx" ON "performance_recoverable_copies"("status", "recoverableUntil");

CREATE OR REPLACE FUNCTION performance_guard_erasure_approval_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'personnel performance erasure approval is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER performance_erasure_approvals_append_only BEFORE UPDATE OR DELETE ON "performance_erasure_approvals" FOR EACH ROW EXECUTE FUNCTION performance_guard_erasure_approval_mutation();

-- Complete the original evidence guard so every confidential evaluation row can
-- only disappear together with its durable, transaction-bound receipt.
CREATE TRIGGER performance_drafts_delete_guard BEFORE DELETE ON "performance_drafts" FOR EACH ROW EXECUTE FUNCTION performance_guard_evidence_deletion();
CREATE TRIGGER performance_corrections_delete_guard BEFORE DELETE ON "performance_corrections" FOR EACH ROW EXECUTE FUNCTION performance_guard_evidence_deletion();

CREATE OR REPLACE FUNCTION performance_verify_deletion_receipt_completion()
RETURNS trigger AS $$
DECLARE target_exists BOOLEAN;
BEGIN
  IF NEW."deletedTableName" = 'performance_subjects' AND NEW."reasonCode" = 'AUTHORIZED_IDENTITY_ERASURE' THEN
    SELECT EXISTS (SELECT 1 FROM "performance_subjects" WHERE "id" = NEW."deletedRecordId" AND "personnelId" IS NULL AND "employmentRelationshipId" IS NULL) INTO target_exists;
    IF NOT target_exists THEN RAISE EXCEPTION 'identity erasure receipt requires completed identity detachment'; END IF;
    RETURN NEW;
  END IF;
  IF NEW."deletedTableName" NOT IN (
    'performance_encrypted_payloads','performance_snapshots','performance_drafts','performance_submissions',
    'performance_reviews','performance_calculation_traces','performance_accepted_results','performance_corrections','performance_audit_events'
  ) THEN RAISE EXCEPTION 'unsupported personnel performance deletion receipt target'; END IF;
  EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE "id" = $1)', NEW."deletedTableName") INTO target_exists USING NEW."deletedRecordId";
  IF target_exists THEN RAISE EXCEPTION 'deletion receipt cannot commit before deletion completes'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Erasure operations and copy evidence are mutable state machines, but their
-- identity, scope and policy binding cannot be rewritten after creation.
CREATE OR REPLACE FUNCTION performance_guard_erasure_operation_identity() RETURNS trigger AS $$
BEGIN
  IF (OLD."operationKeyHash", OLD."retentionStateId", OLD."aggregateType", OLD."aggregateIdHash", OLD."policyVersionId", OLD."encryptedScopeId", OLD."scopeHash", OLD."dependencyHash", OLD."recordCount", OLD."bulkThreshold")
    IS DISTINCT FROM
    (NEW."operationKeyHash", NEW."retentionStateId", NEW."aggregateType", NEW."aggregateIdHash", NEW."policyVersionId", NEW."encryptedScopeId", NEW."scopeHash", NEW."dependencyHash", NEW."recordCount", NEW."bulkThreshold")
  THEN RAISE EXCEPTION 'personnel performance erasure operation identity is immutable'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER performance_erasure_operation_identity_guard BEFORE UPDATE ON "performance_erasure_operations" FOR EACH ROW EXECUTE FUNCTION performance_guard_erasure_operation_identity();
