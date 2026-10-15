-- CreateTable
CREATE TABLE "online_releases" (
    "id" TEXT NOT NULL,
    "deploymentId" TEXT NOT NULL,
    "manifestSha256" TEXT NOT NULL,
    "sourceCommit" TEXT NOT NULL,
    "identityJson" JSONB NOT NULL,
    "compatibilityJson" JSONB NOT NULL,
    "recoveryJson" JSONB NOT NULL,
    "acceptanceJson" JSONB,
    "phase" TEXT NOT NULL DEFAULT 'PREPARING',
    "previousReleaseId" TEXT,
    "servedAt" TIMESTAMPTZ(3),
    "retiredAt" TIMESTAMPTZ(3),
    "browserSupportUntil" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "online_releases_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "online_releases"
  ADD CONSTRAINT "online_release_manifest_identity" CHECK ("manifestSha256" ~ '^[a-f0-9]{64}$' AND "sourceCommit" ~ '^[a-f0-9]{40}$'),
  ADD CONSTRAINT "online_release_phase" CHECK ("phase" IN ('PREPARING','EXPANDING','BACKFILLING','ACCEPTING','READY','SERVING','RETAINED','RETIRED','FAILED','RECOVERY_REQUIRED')),
  ADD CONSTRAINT "online_release_browser_window" CHECK ("retiredAt" IS NULL OR
    ("browserSupportUntil" IS NOT NULL AND "browserSupportUntil" >= "retiredAt" + INTERVAL '24 hours'));

CREATE FUNCTION sabalan_protect_online_release_identity() RETURNS trigger AS $$
BEGIN
  IF ROW(OLD."id", OLD."deploymentId", OLD."manifestSha256", OLD."sourceCommit", OLD."identityJson", OLD."compatibilityJson", OLD."previousReleaseId")
    IS DISTINCT FROM ROW(NEW."id", NEW."deploymentId", NEW."manifestSha256", NEW."sourceCommit", NEW."identityJson", NEW."compatibilityJson", NEW."previousReleaseId") THEN
    RAISE EXCEPTION 'ONLINE_RELEASE_IDENTITY_IMMUTABLE';
  END IF;
  IF OLD."retiredAt" IS NOT NULL AND NEW."retiredAt" IS DISTINCT FROM OLD."retiredAt" THEN
    RAISE EXCEPTION 'ONLINE_RELEASE_RETIREMENT_IMMUTABLE';
  END IF;
  IF OLD."browserSupportUntil" IS NOT NULL AND (NEW."browserSupportUntil" IS NULL OR NEW."browserSupportUntil" < OLD."browserSupportUntil") THEN
    RAISE EXCEPTION 'ONLINE_BROWSER_SUPPORT_CANNOT_SHRINK';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER online_release_identity_guard BEFORE UPDATE ON "online_releases"
  FOR EACH ROW EXECUTE FUNCTION sabalan_protect_online_release_identity();

-- CreateTable
CREATE TABLE "online_runtime_slots" (
    "id" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "component" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "phase" TEXT NOT NULL DEFAULT 'PREPARED',
    "nonceSha256" TEXT NOT NULL,
    "imageIdentity" TEXT NOT NULL,
    "reportJson" JSONB,
    "heartbeatAt" TIMESTAMPTZ(3),
    "stoppedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "online_runtime_slots_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "online_runtime_slots"
  ADD CONSTRAINT "online_runtime_component" CHECK ("component" IN ('backend','frontend','inquiry') AND
    ("role" NOT IN ('control','standalone') OR "component" = 'backend')),
  ADD CONSTRAINT "online_runtime_role" CHECK ("role" IN ('candidate','serving','control','standalone')),
  ADD CONSTRAINT "online_runtime_phase" CHECK ("phase" IN ('PREPARED','STARTING','READY','SERVING','DRAINING','STOPPED','FAILED')),
  ADD CONSTRAINT "online_runtime_stopped_evidence" CHECK (("phase" = 'STOPPED') = ("stoppedAt" IS NOT NULL)),
  ADD CONSTRAINT "online_runtime_identity" CHECK ("nonceSha256" ~ '^[a-f0-9]{64}$' AND "imageIdentity" ~ '^sha256:[a-f0-9]{64}$');

CREATE FUNCTION sabalan_protect_online_runtime_identity() RETURNS trigger AS $$
BEGIN
  IF ROW(OLD."id",OLD."releaseId",OLD."component",OLD."role",OLD."nonceSha256",OLD."imageIdentity")
    IS DISTINCT FROM ROW(NEW."id",NEW."releaseId",NEW."component",NEW."role",NEW."nonceSha256",NEW."imageIdentity") THEN
    RAISE EXCEPTION 'ONLINE_RUNTIME_IDENTITY_IMMUTABLE';
  END IF;
  IF OLD."stoppedAt" IS NOT NULL AND (NEW."stoppedAt" IS DISTINCT FROM OLD."stoppedAt" OR NEW."phase" <> 'STOPPED') THEN
    RAISE EXCEPTION 'ONLINE_STOPPED_RUNTIME_CANNOT_RESTART';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER online_runtime_identity_guard BEFORE UPDATE ON "online_runtime_slots"
  FOR EACH ROW EXECUTE FUNCTION sabalan_protect_online_runtime_identity();

-- CreateTable
CREATE TABLE "online_migration_steps" (
    "id" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "operationSha256" TEXT NOT NULL,
    "operationJson" JSONB NOT NULL,
    "sourceMigrationName" TEXT,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "progressJson" JSONB,
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "online_migration_steps_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "online_migration_steps"
  ADD CONSTRAINT "online_migration_operation_identity" CHECK ("operationSha256" ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT "online_migration_phase" CHECK ("phase" IN ('expand','backfill','activate','contract')),
  ADD CONSTRAINT "online_migration_state" CHECK ("state" IN ('PENDING','RUNNING','COMPLETE','DEFERRED','FAILED','RECOVERY_REQUIRED'));

CREATE FUNCTION sabalan_protect_online_migration_identity() RETURNS trigger AS $$
BEGIN
  IF ROW(OLD."id",OLD."releaseId",OLD."stepId",OLD."phase",OLD."operationSha256",OLD."operationJson",OLD."sourceMigrationName")
    IS DISTINCT FROM ROW(NEW."id",NEW."releaseId",NEW."stepId",NEW."phase",NEW."operationSha256",NEW."operationJson",NEW."sourceMigrationName") THEN
    RAISE EXCEPTION 'ONLINE_MIGRATION_IDENTITY_IMMUTABLE';
  END IF;
  IF OLD."state" = 'COMPLETE' AND ROW(NEW."state",NEW."progressJson",NEW."completedAt")
    IS DISTINCT FROM ROW(OLD."state",OLD."progressJson",OLD."completedAt") THEN
    RAISE EXCEPTION 'ONLINE_COMPLETED_MIGRATION_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER online_migration_identity_guard BEFORE UPDATE ON "online_migration_steps"
  FOR EACH ROW EXECUTE FUNCTION sabalan_protect_online_migration_identity();

-- CreateIndex
CREATE UNIQUE INDEX "online_releases_deploymentId_key" ON "online_releases"("deploymentId");

-- CreateIndex
CREATE INDEX "online_releases_phase_browserSupportUntil_idx" ON "online_releases"("phase", "browserSupportUntil");

-- CreateIndex
CREATE UNIQUE INDEX "online_runtime_slots_nonceSha256_key" ON "online_runtime_slots"("nonceSha256");

-- CreateIndex
CREATE INDEX "online_runtime_slots_releaseId_phase_idx" ON "online_runtime_slots"("releaseId", "phase");

-- CreateIndex
CREATE UNIQUE INDEX "online_migration_steps_sourceMigrationName_key" ON "online_migration_steps"("sourceMigrationName");

-- CreateIndex
CREATE INDEX "online_migration_steps_state_releaseId_idx" ON "online_migration_steps"("state", "releaseId");

-- CreateIndex
CREATE UNIQUE INDEX "online_migration_steps_releaseId_stepId_key" ON "online_migration_steps"("releaseId", "stepId");

-- AddForeignKey
ALTER TABLE "online_releases" ADD CONSTRAINT "online_releases_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "deployment_operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "online_runtime_slots" ADD CONSTRAINT "online_runtime_slots_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "online_releases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "online_migration_steps" ADD CONSTRAINT "online_migration_steps_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "online_releases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Identity/history cannot be reset by deleting an unreferenced row. Artifact
-- retention retires bytes; these small durable registry records remain.
CREATE FUNCTION sabalan_prevent_online_registry_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ONLINE_REGISTRY_HISTORY_CANNOT_BE_DELETED';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER online_release_delete_guard BEFORE DELETE ON "online_releases"
  FOR EACH ROW EXECUTE FUNCTION sabalan_prevent_online_registry_delete();
CREATE TRIGGER online_runtime_delete_guard BEFORE DELETE ON "online_runtime_slots"
  FOR EACH ROW EXECUTE FUNCTION sabalan_prevent_online_registry_delete();
CREATE TRIGGER online_migration_delete_guard BEFORE DELETE ON "online_migration_steps"
  FOR EACH ROW EXECUTE FUNCTION sabalan_prevent_online_registry_delete();
CREATE TRIGGER online_release_truncate_guard BEFORE TRUNCATE ON "online_releases"
  FOR EACH STATEMENT EXECUTE FUNCTION sabalan_prevent_online_registry_delete();
CREATE TRIGGER online_runtime_truncate_guard BEFORE TRUNCATE ON "online_runtime_slots"
  FOR EACH STATEMENT EXECUTE FUNCTION sabalan_prevent_online_registry_delete();
CREATE TRIGGER online_migration_truncate_guard BEFORE TRUNCATE ON "online_migration_steps"
  FOR EACH STATEMENT EXECUTE FUNCTION sabalan_prevent_online_registry_delete();

