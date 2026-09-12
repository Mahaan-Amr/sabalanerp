CREATE TABLE "partner_release_readiness_publications" (
  "id" TEXT NOT NULL,
  "deploymentId" TEXT NOT NULL,
  "releaseId" TEXT NOT NULL,
  "targetCommit" TEXT NOT NULL,
  "schemaId" TEXT NOT NULL,
  "checkedAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "packageSha256" TEXT NOT NULL,
  "trustEnvelopeSha256" TEXT NOT NULL,
  "trustKeyId" TEXT NOT NULL,
  "evidenceJson" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "partner_release_readiness_publications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "partner_release_readiness_publications_deploymentId_fkey"
    FOREIGN KEY ("deploymentId") REFERENCES "deployment_operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "partner_release_readiness_publications_time_check" CHECK ("checkedAt" < "expiresAt"),
  CONSTRAINT "partner_release_readiness_publications_hashes_check" CHECK (
    "packageSha256" ~ '^[a-f0-9]{64}$' AND "trustEnvelopeSha256" ~ '^[a-f0-9]{64}$'
  )
);

CREATE UNIQUE INDEX "partner_release_readiness_publications_deploymentId_key"
  ON "partner_release_readiness_publications"("deploymentId");
CREATE INDEX "partner_release_readiness_publications_releaseId_expiresAt_idx"
  ON "partner_release_readiness_publications"("releaseId", "expiresAt");

CREATE FUNCTION partner_reject_release_readiness_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Partner release readiness evidence is immutable and append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER partner_release_readiness_immutable
  BEFORE UPDATE OR DELETE ON "partner_release_readiness_publications"
  FOR EACH ROW EXECUTE FUNCTION partner_reject_release_readiness_mutation();
