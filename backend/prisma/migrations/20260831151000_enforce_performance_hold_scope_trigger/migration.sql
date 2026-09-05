DROP TRIGGER IF EXISTS performance_holds_scope_guard ON "performance_legal_holds";
CREATE TRIGGER performance_holds_scope_guard
BEFORE UPDATE OF "aggregateType", "aggregateId", "aggregateIdHash", "version", "reason", "placedByUserId", "placedAt"
ON "performance_legal_holds"
FOR EACH ROW EXECUTE FUNCTION performance_guard_operational_lifecycle();
