CREATE UNIQUE INDEX "simple_performance_one_open_correction_idx"
ON "simple_performance_evaluations" ("correctionOfId")
WHERE "correctionOfId" IS NOT NULL AND "status" = 'DRAFT';
