CREATE TABLE "security_personnel_report_export_audits" (
  "id" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "actorNameSnapshot" TEXT NOT NULL,
  "personnelId" TEXT NOT NULL,
  "personnelNameSnapshot" TEXT NOT NULL,
  "filters" JSONB NOT NULL,
  "includeImages" BOOLEAN NOT NULL DEFAULT true,
  "reportCount" INTEGER NOT NULL,
  "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "security_personnel_report_export_audits_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "security_personnel_report_export_audits_actorId_generatedAt_idx"
  ON "security_personnel_report_export_audits"("actorId", "generatedAt");

CREATE INDEX "security_personnel_report_export_audits_personnelId_generatedAt_idx"
  ON "security_personnel_report_export_audits"("personnelId", "generatedAt");
