ALTER TABLE "performance_recoverable_copies" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
CREATE UNIQUE INDEX "performance_recoverable_copy_version_key" ON "performance_recoverable_copies"("operationId", "location", "version");
ALTER TABLE "performance_recoverable_copies" ADD CONSTRAINT "performance_recoverable_copy_version_check" CHECK ("version" > 0);
