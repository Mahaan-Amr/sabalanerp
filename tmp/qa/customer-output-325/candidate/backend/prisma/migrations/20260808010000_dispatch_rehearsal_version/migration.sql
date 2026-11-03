ALTER TABLE "dispatch_cutover_rehearsals" ADD COLUMN "cutoverVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "dispatch_cutover_rehearsals" ALTER COLUMN "cutoverVersion" DROP DEFAULT;
CREATE INDEX "dispatch_cutover_rehearsals_cutoverVersion_performedAt_idx" ON "dispatch_cutover_rehearsals"("cutoverVersion", "performedAt");
