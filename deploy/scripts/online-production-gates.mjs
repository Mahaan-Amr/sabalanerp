/** Exact online release gates shared by the original server and its bounded
 * client. This list describes required observations; it grants no authority. */
export const ORIGINAL_ONLINE_PRODUCTION_GATE_NAMES=Object.freeze([
 'postgres-query-and-isolated-write','migration-history','shipment-statement-runtime-state',
 'contract-financial-evidence','inquiry-sqlite-integrity','backend-readiness','frontend-health',
 'inquiry-health','nginx-health','contracts-storage','hr-storage','accounting-storage',
 'support-storage','performance-export-storage','uploads-storage','database-file-references',
 'checkpoint-manifest','database-connection-capacity',
]);
