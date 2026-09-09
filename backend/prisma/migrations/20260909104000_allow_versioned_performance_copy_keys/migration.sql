DROP INDEX "performance_recoverable_copy_scope_key";
CREATE INDEX "performance_recoverable_copy_scope_idx"
  ON "performance_recoverable_copies"("operationId", "location", "copyKeyHash");
