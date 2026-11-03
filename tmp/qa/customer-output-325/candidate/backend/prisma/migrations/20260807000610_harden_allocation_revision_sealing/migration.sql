ALTER TABLE "logistics_allocation_revisions"
  ADD COLUMN "sealedAt" TIMESTAMP(3),
  ADD COLUMN "predecessorRevisionId" TEXT;

UPDATE "logistics_allocation_revisions" SET "sealedAt" = "finalizedAt";

CREATE UNIQUE INDEX "logistics_allocation_revisions_predecessorRevisionId_key"
  ON "logistics_allocation_revisions"("predecessorRevisionId");
ALTER TABLE "logistics_allocation_revisions"
  ADD CONSTRAINT "logistics_allocation_revisions_predecessorRevisionId_fkey"
  FOREIGN KEY ("predecessorRevisionId") REFERENCES "logistics_allocation_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

DROP TRIGGER logistics_allocation_revision_snapshot_immutable ON "logistics_allocation_revisions";
DROP FUNCTION protect_allocation_revision_snapshot();

CREATE FUNCTION protect_allocation_revision_seal() RETURNS trigger AS $$
BEGIN
  IF OLD."sealedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'sealed allocation revision is immutable';
  END IF;
  IF NEW."sealedAt" IS NULL
     OR NEW."batchId" <> OLD."batchId" OR NEW."loadingId" <> OLD."loadingId" OR NEW."queueTurnId" <> OLD."queueTurnId"
     OR NEW."revisionNumber" <> OLD."revisionNumber" OR NEW."snapshot" <> OLD."snapshot" OR NEW."integrityHash" <> OLD."integrityHash"
     OR NEW."finalizedAt" <> OLD."finalizedAt" OR NEW."finalizedBy" <> OLD."finalizedBy"
     OR NEW."predecessorRevisionId" IS DISTINCT FROM OLD."predecessorRevisionId" THEN
    RAISE EXCEPTION 'allocation revision may only transition once from unsealed to sealed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER logistics_allocation_revision_sealed_immutable
  BEFORE UPDATE ON "logistics_allocation_revisions" FOR EACH ROW EXECUTE FUNCTION protect_allocation_revision_seal();

CREATE FUNCTION prevent_sealed_allocation_line_insert() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "logistics_allocation_revisions" WHERE "id" = NEW."revisionId" AND "sealedAt" IS NOT NULL) THEN
    RAISE EXCEPTION 'sealed allocation revision lines are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER logistics_allocation_revision_line_sealed_insert
  BEFORE INSERT ON "logistics_allocation_revision_lines" FOR EACH ROW EXECUTE FUNCTION prevent_sealed_allocation_line_insert();

ALTER TABLE "logistics_allocation_revisions"
  DROP COLUMN "status", DROP COLUMN "disposedAt", DROP COLUMN "disposedBy", DROP COLUMN "dispositionReason";
DROP TYPE "LogisticsAllocationRevisionStatus";
