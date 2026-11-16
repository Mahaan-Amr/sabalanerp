const BUSINESS_TABLES = ['users', 'sales_contracts', 'accounting_financial_records',
  'dispatch_document_artifacts', 'performance_encrypted_payloads', 'performance_erasure_operations'] as const;

const fail = (code: string): never => { throw Object.assign(new Error(code), { code }); };

/** Admit only a freshly migrated, empty-data QA target as the safety database. */
export const assertQaRestoreBootstrap = (
  expectedMigrations: string[], appliedMigrations: string[], businessCounts: Record<string, number>,
) => {
  if (!expectedMigrations.includes('20260909100000_performance_retention_erasure')
    || expectedMigrations.length === 0
    || new Set(expectedMigrations).size !== expectedMigrations.length
    || expectedMigrations.length !== appliedMigrations.length
    || expectedMigrations.some((name, index) => name !== appliedMigrations[index])) {
    fail('QA_RESTORE_BOOTSTRAP_SCHEMA_INCOMPLETE');
  }
  if (Object.keys(businessCounts).sort().join(',') !== [...BUSINESS_TABLES].sort().join(',')
    || BUSINESS_TABLES.some(table => !Number.isSafeInteger(businessCounts[table]) || businessCounts[table] !== 0)) {
    fail('QA_RESTORE_TARGET_NOT_EMPTY');
  }
  return { migrations: expectedMigrations.length, erasureOperations: businessCounts.performance_erasure_operations };
};

export { BUSINESS_TABLES };
