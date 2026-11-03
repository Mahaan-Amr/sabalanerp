/** Single data-only finite compiler shared by runtime and evidence readers. */
import {createHash} from 'node:crypto';
const bootstrap = {
  '20261014120000_hr_vehicle_assignment_plans': {
    sha256: 'c0dea142d206b5538fd81c98961aaf86926c999cdd8fb722e0aab3d72ab23289', statements: 4,
    tables: ['driver_vehicle_assignment_plans'], functions: [] as string[],
  },
  '20261014140000_online_deployment_control': {
    sha256: '872f0f0858473546cee56b836fa64c95d668997304ae462ac2c18428e69f4cb2', statements: 29,
    tables: ['online_releases', 'online_runtime_slots', 'online_migration_steps'],
    functions: ['sabalan_protect_online_release_identity', 'sabalan_protect_online_runtime_identity',
      'sabalan_protect_online_migration_identity', 'sabalan_prevent_online_registry_delete'],
  },
} as const;
// This list is also the frozen 425 + 2 bootstrap catalog. Pending owned
// strategies must not silently expand that historical bootstrap authority.
export const protectedBridgeMigrationNames: readonly string[] = Object.freeze(Object.keys(bootstrap));
const known = {
  ...bootstrap,
  '20261019010000_customer_semantic_barrier': {
    sha256: 'f21138c410c8653d8fcfc46b266c4ae91e82385adb0263fa0696bad9fa36ce55', statements: 1,
    tables: ['online_financial_compatibility_barriers', 'accounting_check_instrument_events', 'accounting_check_instruments',
      'accounting_customer_commands', 'accounting_customer_opening_attributions', 'accounting_customer_opening_reviews',
      'accounting_customer_receipt_adjustments', 'accounting_customer_receipt_resolutions',
      'accounting_settlement_allocation_lines', 'accounting_settlement_allocations', 'accounting_treasury_transactions'],
    functions: ['sabalan_require_customer_source_shares', 'sabalan_protect_customer_barrier',
      'sabalan_guard_customer_credit_source', 'sabalan_reject_customer_semantic_mutation', 'sabalan_guard_customer_semantic_fields'],
  },
  '20261019020000_hr_versioned_file_cleanup': {
    sha256: 'cb25c720d02d37ad036c95583ef9ba1ba7856bcd483a62ef1c8e03930947b9a9', statements: 1,
    tables: ['hr_deletion_file_cleanups'], functions: [] as string[],
  },
  '20261020010000_online_realtime_completion': {
    sha256: 'f92e8c7dca2ef0c1798275c0e3fe3d1735aec67ef52875dd4df3fed4744df181', statements: 10,
    tables: ['online_hr_invalidation_intents', 'online_realtime_batches', 'online_realtime_commands'],
    functions: ['sabalan_guard_realtime_command'],
  },
  '20261020093000_online_serving_epochs': {
    sha256: '7f4b2b3dc5f7084047409e7c59d29b8667d37a85d33920e95bc7a8f37f48eb9c', statements: 5,
    tables: ['online_serving_epochs'], functions: ['sabalan_protect_online_serving_epoch'],
  },
} as const;
export const protectedOwnedMigrationStrategyNames: readonly string[] = Object.freeze(Object.keys(known));
function failure(code:string):never{throw Object.assign(new Error(code),{code});}
const sha=(bytes:string|Buffer)=>createHash('sha256').update(bytes).digest('hex');
export function compileProtectedBridgeMigration(name: string, bytes: Buffer) {
  if (!Object.prototype.hasOwnProperty.call(known, name)) failure('PROTECTED_BRIDGE_MIGRATION_UNSUPPORTED');
  const definition = known[name as keyof typeof known];
  if (!Buffer.isBuffer(bytes) || sha(bytes) !== definition.sha256) failure('PROTECTED_BRIDGE_SQL_IDENTITY_MISMATCH');
  const statements = name === '20261019010000_customer_semantic_barrier' ? [bytes.toString('utf8')]
    : bytes.toString('utf8').split(/;\s*(?=(?:--[^\r\n]*[\r\n]\s*)*(?:CREATE|ALTER)\s)/);
  if (statements.length !== definition.statements) failure('PROTECTED_BRIDGE_STATEMENTS_UNPROVEN');
  return { name, sha256: definition.sha256, statements, tables: [...definition.tables], functions: [...definition.functions] };
}

/** Data-only catalog definition; callers cannot mutate canonical compiler pins. */
export function protectedOwnedMigrationDefinition(name:string){
 if(!Object.prototype.hasOwnProperty.call(known,name))return undefined;
 const d=known[name as keyof typeof known];return Object.freeze({sha256:d.sha256,tables:Object.freeze([...d.tables]),functions:Object.freeze([...d.functions])});
}
