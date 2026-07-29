CREATE TABLE "support_sla_policy_versions" (
  "id" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "calendar" JSONB NOT NULL,
  "targets" JSONB NOT NULL,
  "createdById" TEXT,
  "changeReason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "support_sla_policy_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "support_sla_policy_versions_version_key" ON "support_sla_policy_versions"("version");
CREATE INDEX "support_sla_policy_versions_createdAt_idx" ON "support_sla_policy_versions"("createdAt");

ALTER TABLE "support_sla_policy_versions"
  ADD CONSTRAINT "support_sla_policy_versions_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
