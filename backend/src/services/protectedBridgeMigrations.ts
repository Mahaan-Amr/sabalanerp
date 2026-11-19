import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { assertRuntimeControlOwnership } from './runtimeControlOwnership';

const known = {
  '20261014120000_hr_vehicle_assignment_plans': {
    sha256: 'c0dea142d206b5538fd81c98961aaf86926c999cdd8fb722e0aab3d72ab23289', statements: 4,
    tables: ['driver_vehicle_assignment_plans'], functions: [] as string[],
  },
} as const;
export const protectedBridgeMigrationNames: readonly string[] = Object.freeze(Object.keys(known));
const pickupSourceName = '20261116100000_customer_pickup_driver_source';
const pickupDispatchName = '20261116100100_customer_pickup_dispatch';
const personalPickupSourceName = '20261118120000_personal_pickup_source';
const personalPickupDispatchName = '20261118120100_personal_pickup_dispatch';
const customerCardInsertName = '20261120120000_grant_runtime_customer_card_insert';
const retireAttachmentScanStatusName = '20261117120000_retire_attachment_scan_status';
const partnerReadinessProjectionName = '20261117160000_partner_release_readiness_completed_projection';
const allocationControllerTransitionName = '20261116133000_customer_allocation_controller_transition';
const protectPartnerNumberReservationName = '20261120121000_protect_partner_number_reservation';
const runtimeDisclosureRevisionName = '20261120122000_protect_runtime_disclosure_revision';
const runtimeReferenceRowLocksName = '20261120123000_protect_runtime_reference_row_locks';
const nextReleaseCatalog = {
  '20261116120000_customer_allocation_intents': {
    tables: ['accounting_customer_allocation_intents'],
    functions: ['protect_allocation_intent_evidence'],
  },
  '20261116121000_bind_allocation_intent_result': {
    tables: ['accounting_customer_commands', 'accounting_customer_allocation_intents'],
    functions: ['bind_customer_allocation_intent_result', 'verify_customer_allocation_intent_result'],
  },
  '20261116122000_serialize_customer_allocation_reservations': {
    tables: ['accounting_customer_allocation_fences'], functions: [],
  },
  '20261116123000_cancel_unreceived_allocation_intents': {
    tables: ['accounting_customer_commands'], functions: ['serialize_customer_allocation_parent'],
  },
  '20261116124000_serialize_allocation_command_keys': {
    tables: ['accounting_customer_command_key_fences', 'accounting_customer_allocation_intents'],
    functions: ['serialize_customer_command_key_within', 'serialize_customer_allocation_intent_insert'],
  },
  '20261116130000_grouped_allocation_child_lineage': {
    tables: ['accounting_settlement_allocations'], functions: ['verify_grouped_allocation_child'],
  },
  '20261116131000_customer_allocation_closed_control': {
    tables: ['customer_allocation_release_control'], functions: ['keep_customer_allocation_control_closed'],
  },
  '20261116132000_close_grouped_allocation_child_backstop': {
    tables: ['accounting_settlement_allocations'], functions: ['require_active_grouped_allocation_child'],
  },
  [allocationControllerTransitionName]: {
    tables: ['customer_allocation_release_control', 'customer_allocation_release_audit'],
    functions: ['guard_customer_allocation_control', 'guard_customer_allocation_audit',
      'customer_allocation_controller_lock', 'customer_allocation_controller_activate'],
  },
  [retireAttachmentScanStatusName]: {
    tables: ['support_ticket_attachments', 'accounting_archive_evidence', 'hr_employment_contract_documents', 'purchasing_attachments'],
    functions: [],
  },
  '20261117130000_store_dispatch_exit_otp_code': {
    tables: ['dispatch_otp_challenges'], functions: [],
  },
  '20261117140000_customer_allocation_controller_closure': {
    tables: ['customer_allocation_release_control', 'customer_allocation_release_audit'],
    functions: ['customer_allocation_controller_close'],
  },
  '20261117150000_customer_allocation_runtime_admission': {
    tables: ['customer_allocation_release_control', 'accounting_settlement_allocations'],
    functions: ['customer_allocation_runtime_admitted'],
  },
  [partnerReadinessProjectionName]: { tables: [], functions: [] },
  [protectPartnerNumberReservationName]: { tables: ['partner_commercial_numbers'], functions: ['partner_reserve_number'] },
  [customerCardInsertName]: { tables: ['crm_customer_cards'], functions: [] },
  [runtimeDisclosureRevisionName]: {
    tables: ['performance_disclosure_revision'],
    functions: ['performance_guard_canonical_write', 'performance_preserve_first_write'],
  },
  [runtimeReferenceRowLocksName]: {
    tables: ['external_driver_documents', 'external_vehicle_documents', 'partner_commercial_accounts', 'partner_commercial_numbers', 'partner_duplicate_customer_matches', 'partner_identity_evidence', 'partner_terms_policies', 'simple_performance_profiles'],
    functions: ['protect_runtime_reference_row'],
  },
};
// This is the exact source delta from the retained 2026-11-12 production
// release. It is intentionally separate from the frozen historical bootstrap.
const currentRelease = {
  '20261021120000_attendance_effective_rest_windows': ['5f01ad2761a2464e85ad1f4827e7613dda22db8a8f3d9112492aea4914fb4700', 4],
  '20261025120000_preserve_exact_fulfillment_quantities': ['07086e6738ba752d96358e8491b00528827cb5c8af1544f4fc34fe7828974955', 34],
  '20261028090000_sales_dispatch_invoices': ['7ae25295e7ad168a8481dc350a8bd6cc677fc2a869ad4c934503fc7b41821c66', 8],
  '20261028093000_sales_invoice_evidence_constraints': ['7f02ab81a3c9aeee1f04455ff7a8e7d223f3de9fb4dd472036871e121685a719', 1],
  '20261028100000_sales_invoice_correction_evidence': ['351034a7c0584e26ee149567f57f9e86bdaeeeba0325ff870a2ffaacf46dfbec', 3],
  '20261031130000_purchasing_operational_workspace': ['16f16342572d47dee3627a27609666008619e9b748843b63d8bfb14a7e2689c5', 30],
  '20261101160000_supply_chain_exact_purchase_quantities': ['3060d9534e03fbfa4191fe7755bc4121c207b0f43cae051e942414d945dc1dad', 8],
  '20261101170000_purchasing_private_attachments': ['6c564dffad127a402ca6bbec87e57695d501b4f2b7b87427d6fd16e3e7ee84a9', 4],
  '20261102120000_accounting_financial_approval_receipts': ['d8ee324f20554891f7b276725326f07ac22658cf8180af0d70baf95f9e54f378', 1],
  '20261104150000_purchasing_duty_optional_deadline': ['54fd7acd7a0cd15dc15a77a1f03a6c25534eefc2202ff6d59d1d9769320e1646', 2],
  '20261107000100_restart_dispatch_waybill_sequence_at_zero': ['0e50811c771006cb5142c9f5430942d0e360f2d976232925bbf2ff1600802541', 4],
  '20261107120000_legacy_waybill_reconstructions': ['4bd5fa92a5693fc8690ee99e490db239792377ebdb9e84eb7f7a7b5f31496972', 2],
  '20261108000100_start_new_waybill_numbers_at_one': ['0919aa0d52d804324e5754d2f4b31291567778bb35aa77e6b50ca0fb7281e637', 2],
  '20261115120000_accounting_dashboard_change_versions': ['ac3aa99a189dc8f3b0d7d60875c4417c9b4aa0492985de56087fa0ab2b6bb1af', 17],
  '20261115121000_accounting_dashboard_partner_sources': ['fa27471c48917f3a5284810f239e36c20e1139b200fd80062a92205ad949c1ad', 4],
  '20261115122000_accounting_dashboard_partner_revision_key': ['d6b7bdf78d40fb3184c84770c0b89f8c055e908f20e7a8427aff792c4188e66c', 1],
  '20261115123000_accounting_dashboard_presentation_sources': ['80da646e392176c2a03511155481bd9f72f56cb080297ecbd79fa2b0e43b06cf', 6],
  '20261115124000_accounting_dashboard_private_owner_scope': ['7be715e823f3cb4f8732b4abc5ad9f35d5f898dd4b66782302f886f629bf3169', 3],
  '20261115125000_accounting_dashboard_mixed_financial_owner': ['3bd0372a0b6991016767d740571486a85584821f21941c777a0d44c4bd1ceeee', 4],
  '20261115130000_accounting_dashboard_user_name_scope': ['a5cbaa020f79977ed303de19641d65a011eef69e7f3e7cf96cde9f4beadaf374', 3],
  '20261115130000_loading_cancellation_duty': ['d65885e6ab6881153b1547d0ba6c9cadc06db67e82afa8b01f8362bd871a6ecc', 3],
  '20261115131000_accounting_private_marker_index': ['31ab2f1cd447819b9f1863337c230fe1c23959eb01e260232f54e044d0bdba30', 1],
  [pickupSourceName]: ['37ebbfab7f1c7dde67450e9117bcc54ea186835e9cc1b448f0e8c97a3229122a', 1],
  [pickupDispatchName]: ['1ae2687716e07ecdc08b4c89aa2dd21c3399ed3853d4e7a1124b4932131268a9', 6],
  [retireAttachmentScanStatusName]: ['9fad9a9544c0c5da8fe58b4f636c2b35ad420fd871c3a7392e12911c5fd4ab91', 5],
  '20261116120000_customer_allocation_intents': ['b6213e3838399149f6c61da9ae079abb0a6eb1afcbba7bd46e247a9bd0d225ea', 6],
  '20261116121000_bind_allocation_intent_result': ['04c84e72ee82adc229bc1c5c2fe131998058d5357f0efaa17f958afcb77dac08', 4],
  '20261116122000_serialize_customer_allocation_reservations': ['a21cc1a12f8bfae622302c39d258ca881c0be2847e1329cae70f9baa5d272670', 1],
  '20261116123000_cancel_unreceived_allocation_intents': ['f46bae03614df7d3dfca3e611bedc91f597f87571bc94142e251a7763340ff12', 3],
  '20261116124000_serialize_allocation_command_keys': ['2f2f1742ea48a8e11bb8b9db4829532278af27356af4308df03264b9248d6e99', 5],
  '20261116130000_grouped_allocation_child_lineage': ['64b0e0bae723c37775e9d67b36dc607c156fa9d02476d132f925e1011fb64135', 5],
  '20261116131000_customer_allocation_closed_control': ['a2d5edfe312f2e85d2a17e0deb26c6d7838534cf40713a741349b1e65bf2131c', 4],
  '20261116132000_close_grouped_allocation_child_backstop': ['bc83e4c5dbf13051374ebaaab5bb1a5b75682b6044eb179ac03e94a971c18c90', 2],
  [allocationControllerTransitionName]: ['8f8389793094eb9ea72abb292a419e0ac547412c44559c6a2c03e00b06bc5cdc', 18],
  '20261117130000_store_dispatch_exit_otp_code': ['375715f6a9930906e9cfae9b5bfbd59c4e4371d5d70587ec651de81afb7e2353', 1],
  '20261117140000_customer_allocation_controller_closure': ['3f063d8699ce903cecab90eb22dc1fa9f4bf3aeda8bd37176f9e2ea602efcb72', 6],
  '20261117150000_customer_allocation_runtime_admission': ['bf469b3fa2d29be6f5bc3cfa5a34c0851a6f14ec546d9560039aa52cc682e0b4', 6],
  [partnerReadinessProjectionName]: ['76c5f34dc094e9c15b879cb6eda417e347fd1118864c5c6207070cc78c190fe0', 3],
  '20261118100000_sepidar_loading_reference': ['a117dd1bbb05c3d4ad96edc5204864f36b4617328ff68d671b9a4b0d7360e757', 2],
  [personalPickupSourceName]: ['02d234097b5a2d70cbfeebbf36a9bc0dedbfe3a316ef936c38d0160eca15286f', 1],
  [personalPickupDispatchName]: ['acbf6c974b30a77cfb0131d30fd3d960e0523053ee21a7d777ca759ea7539a3d', 5],
  [customerCardInsertName]: ['2123e56ded01fbe3f01e046e3425dcba4f4cc96d1a01fcfcb78070d944f97baa', 1],
  [protectPartnerNumberReservationName]: ['3719c6d5f57a69ade6fa88310068943bc945e075a504463eecef08a81c82b02d', 3],
  [runtimeDisclosureRevisionName]: ['79e5cd2c01edbfd88c56d671e73cd7eec80961b38f9ccb343c38f61451eacfc2', 4],

  [runtimeReferenceRowLocksName]: ['85364edd5944addeb6606ba5ad6209e0f0d4bd5bcd71a492715469b91c1d1688', 2],

} as const;
export const protectedCurrentReleaseNames: readonly string[] = Object.freeze(Object.keys(currentRelease));
// Each release extends the ledger while preserving the prior release-set hashes.
const protectedReleaseEpochEnds = Object.freeze([12, 22, 24, 25, 35, 36, 37, 38, 41, 42, 43, 44, 45]);
const releaseSetSha256 = (files: CurrentFile[], index: number) => sha(files.slice(0,
  protectedReleaseEpochEnds.find(end => index < end)!).map(file => file.sha256).join('\n'));

/** Split only byte-pinned PostgreSQL source, respecting quoted bodies. */
function splitCurrentReleaseSql(sql: string) {
  const statements: string[] = [];
  let start = 0, mode: 'plain' | 'single' | 'double' | 'line' | 'block' | 'dollar' = 'plain', tag = '';
  for (let i = 0; i < sql.length; i++) {
    const here = sql[i], next = sql[i + 1];
    if (mode === 'line') { if (here === '\n') mode = 'plain'; continue; }
    if (mode === 'block') { if (here === '*' && next === '/') { mode = 'plain'; i++; } continue; }
    if (mode === 'single') { if (here === "'" && next === "'") i++; else if (here === "'") mode = 'plain'; continue; }
    if (mode === 'double') { if (here === '"' && next === '"') i++; else if (here === '"') mode = 'plain'; continue; }
    if (mode === 'dollar') { if (sql.startsWith(tag, i)) { i += tag.length - 1; mode = 'plain'; } continue; }
    if (here === '-' && next === '-') { mode = 'line'; i++; continue; }
    if (here === '/' && next === '*') { mode = 'block'; i++; continue; }
    if (here === "'") { mode = 'single'; continue; }
    if (here === '"') { mode = 'double'; continue; }
    if (here === '$') {
      const match = /^\$[A-Za-z_][A-Za-z_0-9]*\$|^\$\$/.exec(sql.slice(i));
      if (match) { tag = match[0]; mode = 'dollar'; i += tag.length - 1; continue; }
    }
    if (here === ';') { const statement = sql.slice(start, i + 1).trim(); if (statement) statements.push(statement); start = i + 1; }
  }
  if (mode !== 'plain' && mode !== 'line') failure('PROTECTED_CURRENT_RELEASE_SQL_UNPARSEABLE');
  if (sql.slice(start).replace(/(?:--[^\r\n]*[\r\n]?|\s)+/g, '') !== '') failure('PROTECTED_CURRENT_RELEASE_SQL_UNTERMINATED');
  return statements;
}

export function compileProtectedCurrentRelease(files: ReadonlyArray<readonly [string, Buffer]>) {
  const names = protectedCurrentReleaseNames;
  if (names.length !== protectedReleaseEpochEnds.at(-1)) failure('PROTECTED_CURRENT_RELEASE_EPOCH_UNPROVEN');
  if (files.length !== names.length || files.some(([name], index) => name !== names[index])) failure('PROTECTED_CURRENT_RELEASE_SET_UNPROVEN');
  return files.map(([name, bytes]) => {
    const [sha256, expectedCount] = currentRelease[name as keyof typeof currentRelease];
    if (!Buffer.isBuffer(bytes) || sha(bytes) !== sha256) failure('PROTECTED_CURRENT_RELEASE_SQL_IDENTITY_MISMATCH');
    const sql = bytes.toString('utf8');
    let statements = splitCurrentReleaseSql(sql);
    if (name === '20261108000100_start_new_waybill_numbers_at_one'
      || name === retireAttachmentScanStatusName || name === protectPartnerNumberReservationName) {
      const opening = statements[0]?.replace(/^(?:--[^\r\n]*\r?\n\s*)+/, '');
      if (statements.length !== expectedCount + 2 || opening !== 'BEGIN;' || statements.at(-1) !== 'COMMIT;') {
        failure('PROTECTED_CURRENT_RELEASE_TRANSACTION_WRAPPER_UNPROVEN');
      }
      // The byte-pinned source wraps its statements in a transaction;
      // this runner supplies that transaction together with its history receipt.
      statements = statements.slice(1, -1);
    }
    if (statements.length !== expectedCount || statements.some(statement => /^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/i.test(statement))) {
      failure('PROTECTED_CURRENT_RELEASE_STATEMENTS_UNPROVEN');
    }
    const reviewedScope = nextReleaseCatalog[name as keyof typeof nextReleaseCatalog];
    if (reviewedScope) return { name, sha256, statements, ...reviewedScope };
    const tables = [...new Set([
      ...[...sql.matchAll(/\b(?:CREATE|ALTER)\s+TABLE\s+"?([A-Za-z_][A-Za-z_0-9]*)"?/gi)].map(match => match[1]),
      ...(names.indexOf(name) >= protectedReleaseEpochEnds[0]
        ? [...sql.matchAll(/\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+"?[A-Za-z_][A-Za-z_0-9]*"?\s+ON\s+"?([A-Za-z_][A-Za-z_0-9]*)"?/gi)].map(match => match[1])
        : []),
    ])];
    const functions = [...new Set([...sql.matchAll(/\bCREATE\s+FUNCTION\s+"?([A-Za-z_][A-Za-z_0-9]*)"?/gi)].map(match => match[1]))];
    return { name, sha256, statements, tables, functions };
  });
}
function failure(code: string): never { throw Object.assign(new Error(code), { code }); }
const sha = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
type Owner = { deploymentId: string; leaseToken: string; releaseId: string };

export function assertBootstrapNativeCompletion(directory: string) {
  const file = path.join(directory, 'deployment-bootstrap-native.json');
  let fd: number;
  try { fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); }
  catch (error: any) { if (error?.code === 'ENOENT') return null; throw error; }
  try {
    const before = fs.fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.uid !== BigInt(process.getuid!()) || (before.mode & 0o022n) !== 0n
      || before.size < 1n || before.size > 16384n || fs.realpathSync(file) !== file) failure('BOOTSTRAP_NATIVE_COMPLETION_UNPROVEN');
    const state = JSON.parse(fs.readFileSync(fd, 'utf8'));
    const after = fs.fstatSync(fd, { bigint: true }), named = fs.lstatSync(file, { bigint: true });
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeNs !== after.mtimeNs
      || before.ctimeNs !== after.ctimeNs || named.dev !== before.dev || named.ino !== before.ino || after.nlink !== 1n
      || state.format !== 'sabalan-bootstrap-native/v1' || state.phase !== 'QUIESCENT'
      || state.nativeReaped !== true || state.databaseQuiet !== true) failure('BOOTSTRAP_NATIVE_COMPLETION_UNPROVEN');
    return state;
  } finally { fs.closeSync(fd); }
}

/** Only this byte-exact, reviewed additive bootstrap file. The splitter
 * is deliberately NOT an arbitrary SQL parser: the complete SHA is checked
 * first, and its exact statement count is frozen. Dollar-quoted function
 * bodies in these files contain no CREATE/ALTER statement boundary.
 */
export function compileProtectedBridgeMigration(name: string, bytes: Buffer) {
  if (!Object.prototype.hasOwnProperty.call(known, name)) failure('PROTECTED_BRIDGE_MIGRATION_UNSUPPORTED');
  const definition = known[name as keyof typeof known];
  if (!Buffer.isBuffer(bytes) || sha(bytes) !== definition.sha256) failure('PROTECTED_BRIDGE_SQL_IDENTITY_MISMATCH');
  const statements = bytes.toString('utf8').split(/;\s*(?=(?:--[^\r\n]*[\r\n]\s*)*(?:CREATE|ALTER)\s)/);
  if (statements.length !== definition.statements) failure('PROTECTED_BRIDGE_STATEMENTS_UNPROVEN');
  return { name, sha256: definition.sha256, statements, tables: [...definition.tables], functions: [...definition.functions] };
}

export function protectedBoundary(owner: Owner) {
  const environment = { ...process.env };
  const directory = environment.RECOVERY_COORDINATION_DIR || '/app/recovery-coordination';
  const file = path.join(directory, 'deployment-maintenance.json');
  if (!path.isAbsolute(directory) || [owner.deploymentId, owner.leaseToken, owner.releaseId].some(value =>
    typeof value !== 'string' || !value || value.length > 256)) failure('PROTECTED_BRIDGE_OWNER_INVALID');
  return () => {
    assertRuntimeControlOwnership(environment);
    assertBootstrapNativeCompletion(directory);
    const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    try {
      const before = fs.fstatSync(descriptor, { bigint: true });
      if (!before.isFile() || before.nlink !== 1n || before.size < 1n || before.size > 8192n
        || before.uid !== BigInt(process.getuid!()) || (before.mode & 0o022n) !== 0n
        || fs.realpathSync(file) !== file) failure('PROTECTED_BRIDGE_MAINTENANCE_UNPROVEN');
      const state = JSON.parse(fs.readFileSync(descriptor, 'utf8'));
      const after = fs.fstatSync(descriptor, { bigint: true }), named = fs.lstatSync(file, { bigint: true });
      if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
        || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs
        || named.dev !== before.dev || named.ino !== before.ino || after.nlink !== 1n
        || state.deploymentId !== owner.deploymentId || state.releaseId !== owner.releaseId) {
        failure('PROTECTED_BRIDGE_MAINTENANCE_UNPROVEN');
      }
    } finally { fs.closeSync(descriptor); }
  };
}

async function assertLease(tx: Prisma.TransactionClient, owner: Owner, shareLock = true) {
  const rows = await tx.$queryRaw<Array<{ id: string; checkpoint: unknown }>>`SELECT id, "checkpointJson" AS checkpoint
    FROM deployment_operations WHERE id=${owner.deploymentId} AND "leaseToken"=${owner.leaseToken}
      AND "releaseId"=${owner.releaseId} AND "activeKey"='production' AND phase='MUTATION_STARTED'
      AND "leaseExpiresAt">clock_timestamp()+interval '20 seconds' ${shareLock ? Prisma.sql`FOR SHARE` : Prisma.empty}`;
  const checkpoint = rows[0]?.checkpoint as Record<string, unknown> | undefined;
  if (rows.length !== 1 || !checkpoint || checkpoint.deploymentId !== owner.deploymentId || checkpoint.releaseId !== owner.releaseId
    || checkpoint.localVerified !== true || checkpoint.remoteVerified !== true || checkpoint.restoreVerified !== true
    || checkpoint.manifestReadable !== true || typeof checkpoint.checksum !== 'string' || !/^[a-f0-9]{64}$/.test(checkpoint.checksum)) {
    failure('PROTECTED_BRIDGE_CHECKPOINT_LEASE_UNPROVEN');
  }
}

async function catalog(tx: Prisma.TransactionClient, input: {
  tables: string[]; functions: string[]; pickupSource?: boolean; personalPickupSource?: boolean; partnerReadinessProjection?: boolean;
}) {
  const tables = await tx.$queryRaw<Array<{ name: string; details: unknown }>>(Prisma.sql`
    SELECT c.relname AS name, jsonb_build_object('kind',c.relkind,'persistence',c.relpersistence,'owner',pg_get_userbyid(c.relowner),
      'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'replicaIdentity',c.relreplident,
      'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'number',a.attnum,'type',format_type(a.atttypid,a.atttypmod),
        'notNull',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,'collation',a.attcollation::regcollation::text,
        'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum)
        FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
        WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
      'constraints',(SELECT jsonb_agg(jsonb_build_object('name',k.conname,'definition',pg_get_constraintdef(k.oid),
        'validated',k.convalidated) ORDER BY k.conname) FROM pg_constraint k WHERE k.conrelid=c.oid),
      'indexes',(SELECT jsonb_agg(jsonb_build_object('definition',pg_get_indexdef(i.indexrelid),'valid',i.indisvalid,
        'ready',i.indisready) ORDER BY pg_get_indexdef(i.indexrelid)) FROM pg_index i WHERE i.indrelid=c.oid),
      'triggers',(SELECT jsonb_agg(jsonb_build_object('name',t.tgname,'definition',pg_get_triggerdef(t.oid),'enabled',t.tgenabled)
        ORDER BY t.tgname) FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal),
      -- Internal RI trigger names embed OIDs and change on logical restore.
      -- Preserve each enforcement trigger's complete stable semantics instead.
      'foreignKeyEnforcement',(SELECT jsonb_agg(e.details ORDER BY e.details::text) FROM (
        SELECT jsonb_build_object('constraint',k.conname,'table',r.relname,'schema',s.nspname,
          'function',p.proname,'functionSchema',pn.nspname,'functionArguments',pg_get_function_identity_arguments(p.oid),
          'type',t.tgtype,'arguments',encode(t.tgargs,'hex'),'columns',t.tgattr::text,'when',pg_get_expr(t.tgqual,t.tgrelid),
          'internal',t.tgisinternal,'enabled',t.tgenabled,'deferrable',t.tgdeferrable,'initiallyDeferred',t.tginitdeferred,
          'oldTransition',t.tgoldtable,'newTransition',t.tgnewtable) AS details
        FROM pg_constraint k JOIN pg_trigger t ON t.tgconstraint=k.oid JOIN pg_class r ON r.oid=t.tgrelid
          JOIN pg_namespace s ON s.oid=r.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace pn ON pn.oid=p.pronamespace
        WHERE k.conrelid=c.oid AND k.contype='f') e),
      'policies',(SELECT jsonb_agg(p.polname ORDER BY p.polname) FROM pg_policy p WHERE p.polrelid=c.oid),
      'inheritance',(SELECT count(*) FROM pg_inherits i WHERE i.inhrelid=c.oid OR i.inhparent=c.oid)) AS details
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
      AND c.relname IN (${Prisma.join(input.tables)}) ORDER BY c.relname`);
  const functions = input.functions.length ? await tx.$queryRaw<Array<{ name: string; definition: string; owner: string }>>(Prisma.sql`
    SELECT p.proname AS name, pg_get_functiondef(p.oid) AS definition, pg_get_userbyid(p.proowner) AS owner
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
      AND p.proname IN (${Prisma.join(input.functions)}) ORDER BY p.proname`) : [];
  if (tables.length !== input.tables.length || functions.length !== input.functions.length) failure('PROTECTED_BRIDGE_SCHEMA_UNPROVEN');
  const pickupSource = input.pickupSource
    ? { pickupSource: await pickupSourceProof(tx, input.personalPickupSource ? 'PERSONAL_PICKUP' : 'CUSTOMER_PICKUP') } : {};
  const partnerReadinessProjection = input.partnerReadinessProjection
    ? { partnerReadinessProjection: await partnerReadinessProjectionProof(tx) } : {};
  return sha(JSON.stringify(canonical({ tables, functions, ...pickupSource, ...partnerReadinessProjection })));
}

/** Also required when discovery finds no pending work. A successful no-op
 * cannot stand in for ownership of the protected deployment operation. */
export async function assertProtectedBridgeMigrationAuthority(database: PrismaClient, inputOwner: Owner) {
  const owner = Object.freeze({ ...inputOwner }), assertBoundary = protectedBoundary(owner);
  assertBoundary();
  await database.$transaction(async tx => { await assertLease(tx, owner); assertBoundary(); }, { maxWait: 1000, timeout: 5000 });
}

/** Protected bridge only; no online/public entry point. The existing
 * coordinated checkpoint flow must first own the native control lock and have
 * advanced its exact lease through remote verification to MUTATION_STARTED.
 * This checks that authority again inside the atomic DDL/native-history TX.
 * A checkpoint flag supplied by a caller is never an admission argument.
 */
export async function applyProtectedBridgeMigration(database: PrismaClient, inputOwner: Owner, name: string, bytes: Buffer) {
  const owner = Object.freeze({ ...inputOwner });
  const input = compileProtectedBridgeMigration(name, bytes), assertBoundary = protectedBoundary(owner);
  assertBoundary();
  return database.$transaction(async tx => {
    await tx.$queryRaw`SELECT set_config('lock_timeout','250ms',true), set_config('statement_timeout','10000ms',true),
      set_config('search_path','public',true)`;
    const [lock] = await tx.$queryRaw<Array<{ owned: boolean }>>`SELECT pg_try_advisory_xact_lock(741936426::bigint) AS owned`;
    if (!lock?.owned) failure('PROTECTED_BRIDGE_ALREADY_RUNNING');
    await assertLease(tx, owner); assertBoundary();
    const history = await tx.$queryRaw<Array<{ checksum: string; finished: Date | null; logs: string | null }>>`
      SELECT checksum, finished_at AS finished, logs FROM public._prisma_migrations
      WHERE migration_name=${input.name} AND rolled_back_at IS NULL`;
    if (history.length) {
      const logs = history[0].logs;
      if (history.length !== 1 || !history[0].finished || history[0].checksum !== input.sha256 || !logs) {
        failure('PROTECTED_BRIDGE_HISTORY_REQUIRES_INSPECTION');
      }
      let receipt: any;
      try { receipt = JSON.parse(logs); } catch { failure('PROTECTED_BRIDGE_HISTORY_REQUIRES_INSPECTION'); }
      if (receipt?.format !== 'sabalan-protected-bridge/v1' || receipt.sqlSha256 !== input.sha256
        || receipt.catalogSha256 !== await catalog(tx, input)) failure('PROTECTED_BRIDGE_SCHEMA_DRIFT');
      await assertLease(tx, owner); assertBoundary();
      return { applied: false, checksum: input.sha256 };
    }
    for (const statement of input.statements) { assertBoundary(); await tx.$executeRawUnsafe(statement); }
    const catalogSha256 = await catalog(tx, input);
    await assertLease(tx, owner); assertBoundary();
    const receipt = JSON.stringify({ format: 'sabalan-protected-bridge/v1', sqlSha256: input.sha256, catalogSha256 });
    await tx.$executeRaw`INSERT INTO public._prisma_migrations (id,checksum,finished_at,migration_name,logs,started_at,applied_steps_count)
      VALUES (${randomUUID()},${input.sha256},clock_timestamp(),${input.name},${receipt},clock_timestamp(),1)`;
    assertBoundary();
    return { applied: true, checksum: input.sha256 };
  }, { maxWait: 1000, timeout: 15000 });
}

type CurrentFile = ReturnType<typeof compileProtectedCurrentRelease>[number];
const quantityNames = new Set([protectedCurrentReleaseNames[1], protectedCurrentReleaseNames[6]]);
const dutyName = protectedCurrentReleaseNames[9], waybillName = protectedCurrentReleaseNames[10];
function currentCatalogScope(files: CurrentFile[], through: number) {
  const applied = files.slice(0, through + 1);
  const functions = new Set(applied.flatMap(file => file.functions));
  if (applied.some(file => file.name === allocationControllerTransitionName)) {
    functions.delete('keep_customer_allocation_control_closed');
  }
  return { tables: [...new Set(applied.flatMap(file => file.tables))].sort(),
    functions: [...functions].sort(),
    pickupSource: applied.some(file => file.name === pickupSourceName),
    personalPickupSource: applied.some(file => file.name === personalPickupSourceName),
    partnerReadinessProjection: applied.some(file => file.name === partnerReadinessProjectionName) };
}

async function partnerReadinessProjectionProof(tx: Prisma.TransactionClient) {
  const [view] = await tx.$queryRaw<Array<{ definition: string; owner: string; options: string[] }>>`
    SELECT pg_get_viewdef(relation.oid, false) AS definition, pg_get_userbyid(relation.relowner) AS owner,
      relation.reloptions AS options
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public' AND relation.relname = 'partner_release_readiness_completed'
      AND relation.relkind = 'v' AND relation.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
      AND relation.reloptions = ARRAY['security_barrier=true']
  `;
  if (!view?.definition) failure('PROTECTED_CURRENT_RELEASE_PARTNER_READINESS_VIEW_UNPROVEN');
  return view;
}

async function pickupSourceProof(tx: Prisma.TransactionClient, lastLabel: 'EXTERNAL' | 'CUSTOMER_PICKUP' | 'PERSONAL_PICKUP') {
  const rows = await tx.$queryRaw<Array<{ label: string }>>`
    SELECT e.enumlabel::text AS label FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
    JOIN pg_namespace n ON n.oid=t.typnamespace
    WHERE n.nspname='public' AND t.typname='GuardDriverSource' ORDER BY e.enumsortorder`;
  const labels = rows.map(row => row.label);
  const orderedLabels = ['INTERNAL', 'EXTERNAL', 'CUSTOMER_PICKUP', 'PERSONAL_PICKUP'];
  const expected = orderedLabels.slice(0, orderedLabels.indexOf(lastLabel) + 1);
  if (labels.length !== expected.length || labels.some((label, index) => label !== expected[index])) {
    failure('PROTECTED_CURRENT_RELEASE_PICKUP_SOURCE_UNPROVEN');
  }
  return labels;
}

async function pickupDispatchRows(tx: Prisma.TransactionClient) {
  const [rows] = await tx.$queryRaw<Array<{ turns: string; sessions: string }>>`
    SELECT (SELECT COUNT(*)::text FROM public.guard_driver_queue_turns) AS turns,
      (SELECT COUNT(*)::text FROM public.dispatch_confirmation_sessions) AS sessions`;
  return [rows.turns, rows.sessions].join(':');
}

async function assertPickupDispatchSchema(tx: Prisma.TransactionClient) {
  const [proof] = await tx.$queryRaw<Array<{ checks: bigint; plateIndex: boolean; verificationEmpty: boolean }>>`
    SELECT (SELECT COUNT(*) FROM pg_constraint
      WHERE contype='c' AND convalidated AND (
        (conrelid='public.guard_driver_queue_turns'::regclass AND conname='guard_driver_queue_source_shape'
          AND strpos(pg_get_constraintdef(oid), '''CUSTOMER_PICKUP''') > 0)
        OR (conrelid='public.dispatch_confirmation_sessions'::regclass AND conname='dispatch_confirmation_sessions_method_check'
          AND strpos(pg_get_constraintdef(oid), '''CUSTOMER_PICKUP_OTP''') > 0))) AS checks,
      EXISTS (SELECT FROM pg_index
        WHERE indexrelid='public.guard_driver_queue_one_open_customer_pickup_plate'::regclass
          AND indrelid='public.guard_driver_queue_turns'::regclass AND indisunique AND indisready AND indisvalid
          AND indexprs IS NOT NULL AND indpred IS NOT NULL) AS "plateIndex",
      NOT EXISTS (SELECT FROM public.dispatch_pickup_verifications) AS "verificationEmpty"`;
  if (proof?.checks !== 2n || !proof.plateIndex || !proof.verificationEmpty) {
    failure('PROTECTED_CURRENT_RELEASE_PICKUP_DISPATCH_UNPROVEN');
  }
}
function quantityColumns(file: CurrentFile) {
  return file.statements.map(statement => {
    const match = /^\s*(?:--[^\n]*\n\s*)*ALTER TABLE\s+"([a-z_]+)"\s+ALTER COLUMN\s+"([A-Za-z]+)"\s+TYPE DECIMAL\(65,30\);\s*$/i.exec(statement);
    if (!match) failure('PROTECTED_CURRENT_RELEASE_QUANTITY_SQL_UNPROVEN');
    return { table: match[1], column: match[2] };
  });
}
async function quantityProof(tx: Prisma.TransactionClient, file: CurrentFile, before: boolean) {
  const columns = quantityColumns(file), records: unknown[] = [];
  for (const { table, column } of columns) {
    const catalogRows = await tx.$queryRawUnsafe<Array<{ type: string }>>(`SELECT format_type(a.atttypid,a.atttypmod) AS type
      FROM pg_attribute a WHERE a.attrelid='public."${table}"'::regclass AND a.attname='${column}' AND NOT a.attisdropped`);
    if (catalogRows.length !== 1 || !/^numeric(?:\(\d+,\d+\))?$/.test(catalogRows[0].type)
      || (!before && catalogRows[0].type !== 'numeric(65,30)')) failure('PROTECTED_CURRENT_RELEASE_QUANTITY_TYPE_UNPROVEN');
    const rows = await tx.$queryRawUnsafe<Array<{ total: string; nonnull: string; digest: string }>>(`SELECT COUNT(*)::text AS total,
      COUNT("${column}")::text AS nonnull,
      md5(COALESCE(string_agg(trim_scale("${column}")::text, '|' ORDER BY trim_scale("${column}")::text),'')) AS digest
      FROM public."${table}"`);
    if (rows.length !== 1) failure('PROTECTED_CURRENT_RELEASE_QUANTITY_PROOF_UNPROVEN');
    records.push({ table, column, ...rows[0] });
  }
  return sha(JSON.stringify(records));
}
async function dutyProof(tx: Prisma.TransactionClient, after: boolean) {
  const rows = await tx.$queryRaw<Array<{ definition: string; validated: boolean; count: string }>>`
    SELECT pg_get_constraintdef(c.oid) AS definition,c.convalidated AS validated,
      (SELECT COUNT(*)::text FROM public.hr_duties) AS count
    FROM pg_constraint c WHERE c.conrelid='public.hr_duties'::regclass
      AND c.conname='duty_deadline_required_for_other_sources'`;
  const row = rows[0];
  if (rows.length !== 1 || !row.validated || !row.definition.includes('CONTRACT_DISPATCH')
    || row.definition.includes('PURCHASING_INQUIRY') !== after) failure('PROTECTED_CURRENT_RELEASE_DUTY_CONSTRAINT_UNPROVEN');
  return row.count;
}
async function sequenceProof(tx: Prisma.TransactionClient, after: boolean) {
  const rows = await tx.$queryRaw<Array<{ minimum: bigint; start: bigint }>>`
    SELECT min_value AS minimum,start_value AS start FROM pg_sequences
    WHERE schemaname='public' AND sequencename='accounting_dispatch_waybill_number_seq'`;
  if (rows.length !== 1 || rows[0].minimum !== BigInt(after ? 0 : 1)
    || rows[0].start !== 1000000001n) failure('PROTECTED_CURRENT_RELEASE_SEQUENCE_UNPROVEN');
  let stateProof: string | null = null;
  if (after) {
    const state = await tx.$queryRaw<Array<{ last_value: bigint; is_called: boolean }>>`
      SELECT last_value,is_called FROM public.accounting_dispatch_waybill_number_seq`;
    if (state.length !== 1 || state[0].last_value !== 0n || state[0].is_called) failure('PROTECTED_CURRENT_RELEASE_SEQUENCE_UNPROVEN');
    stateProof = sha(JSON.stringify({ minimum: rows[0].minimum.toString(), start: rows[0].start.toString(),
      last: state[0].last_value.toString(), called: state[0].is_called }));
  }
  return stateProof;
}

type RetryProof = { quantityProofSha256: string | null; dutyRows: string | null; sequenceProofSha256: string | null;
  pickupDispatchRows?: string; personalPickupDispatchRows?: string };
export function assertProtectedCurrentReleaseRetryEvidence(receipt: any, owner: Owner, observed: RetryProof) {
  if (typeof receipt?.deploymentId !== 'string' || !receipt.deploymentId
    || typeof receipt.releaseId !== 'string' || !receipt.releaseId) failure('PROTECTED_CURRENT_RELEASE_HISTORY_UNPROVEN');
  if (receipt.deploymentId !== owner.deploymentId || receipt.releaseId !== owner.releaseId) return;
  for (const key of ['quantityProofSha256', 'dutyRows', 'sequenceProofSha256', 'pickupDispatchRows', 'personalPickupDispatchRows'] as const) {
    if (receipt[key] !== observed[key]) failure('PROTECTED_CURRENT_RELEASE_RETRY_DATA_DRIFT');
  }
}

/** Each file's DDL and native history commit together. The last committed
 * receipt covers the complete cumulative catalog, including later changes to
 * an earlier table, so an interrupted retry cannot adopt partial schema. */
export async function applyProtectedCurrentRelease(database: PrismaClient, inputOwner: Owner, files: CurrentFile[], applied: Set<string>) {
  if (files.length !== protectedCurrentReleaseNames.length || files.some((file, index) => file.name !== protectedCurrentReleaseNames[index])) {
    failure('PROTECTED_CURRENT_RELEASE_SET_UNPROVEN');
  }
  const owner = Object.freeze({ ...inputOwner }), assertBoundary = protectedBoundary(owner);
  const firstPending = files.findIndex(file => !applied.has(file.name));
  const completed = firstPending < 0 ? files.length : firstPending;
  if (files.slice(completed).some(file => applied.has(file.name))) failure('PROTECTED_CURRENT_RELEASE_PARTIAL_HISTORY');
  assertBoundary();
  // A retry must prove every owned receipt, and the latest receipt's complete
  // schema. Earlier snapshots are superseded by later reviewed DDL.
  if (completed) await database.$transaction(async tx => {
    await assertLease(tx, owner, false); assertBoundary();
    for (const file of files.slice(0, completed)) {
      const history = await tx.$queryRaw<Array<{ checksum: string; finished: Date | null; logs: string | null }>>`
        SELECT checksum,finished_at AS finished,logs FROM public._prisma_migrations
        WHERE migration_name=${file.name} AND rolled_back_at IS NULL`;
      if (history.length !== 1 || !history[0].finished || history[0].checksum !== file.sha256 || !history[0].logs) {
        failure('PROTECTED_CURRENT_RELEASE_HISTORY_UNPROVEN');
      }
      let receipt: any; try { receipt = JSON.parse(history[0].logs!); } catch { failure('PROTECTED_CURRENT_RELEASE_HISTORY_UNPROVEN'); }
      if (receipt?.format !== 'sabalan-protected-current-release/v1' || receipt.sqlSha256 !== file.sha256
        || receipt.order !== files.indexOf(file) || receipt.releaseSetSha256 !== releaseSetSha256(files, files.indexOf(file))
        || (file.name === pickupDispatchName && (typeof receipt.pickupDispatchRows !== 'string'
          || !/^\d+:\d+$/.test(receipt.pickupDispatchRows)))
        || (file.name === personalPickupDispatchName && (typeof receipt.personalPickupDispatchRows !== 'string'
          || !/^\d+:\d+$/.test(receipt.personalPickupDispatchRows)))) {
        failure('PROTECTED_CURRENT_RELEASE_HISTORY_UNPROVEN');
      }
      const sameOperation = receipt.deploymentId === owner.deploymentId && receipt.releaseId === owner.releaseId;
      const observed: RetryProof = {
        quantityProofSha256: sameOperation && quantityNames.has(file.name) ? await quantityProof(tx, file, false) : null,
        dutyRows: sameOperation && file.name === dutyName ? await dutyProof(tx, true) : null,
        sequenceProofSha256: sameOperation && file.name === waybillName ? await sequenceProof(tx, true) : null,
      };
      if (sameOperation && file.name === pickupDispatchName) {
        observed.pickupDispatchRows = await pickupDispatchRows(tx);
        await assertPickupDispatchSchema(tx);
      }
      if (sameOperation && file.name === personalPickupDispatchName) {
        observed.personalPickupDispatchRows = await pickupDispatchRows(tx);
      }
      assertProtectedCurrentReleaseRetryEvidence(receipt, owner, observed);
      if (file === files[completed - 1] && receipt.catalogSha256 !== await catalog(tx, currentCatalogScope(files, completed - 1))) {
        failure('PROTECTED_CURRENT_RELEASE_SCHEMA_DRIFT');
      }
    }
    await assertLease(tx, owner, false); assertBoundary();
  }, { maxWait: 1000, timeout: 30000 });
  for (let index = completed; index < files.length; index++) {
    const file = files[index];
    assertBoundary();
    await database.$transaction(async tx => {
      await tx.$queryRaw`SELECT set_config('lock_timeout','1000ms',true), set_config('statement_timeout','90000ms',true),
        set_config('search_path','public',true)`;
      const [lock] = await tx.$queryRaw<Array<{ owned: boolean }>>`SELECT pg_try_advisory_xact_lock(741936426::bigint) AS owned`;
      if (!lock?.owned) failure('PROTECTED_CURRENT_RELEASE_ALREADY_RUNNING');
      await assertLease(tx, owner, false); assertBoundary();
      const existing = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM public._prisma_migrations
        WHERE migration_name=${file.name} AND rolled_back_at IS NULL`;
      if (existing.length) failure('PROTECTED_CURRENT_RELEASE_CONCURRENT_HISTORY');
      const beforeQuantity = quantityNames.has(file.name) ? await quantityProof(tx, file, true) : null;
      const beforeDuty = file.name === dutyName ? await dutyProof(tx, false) : null;
      if (file.name === waybillName) await sequenceProof(tx, false);
      // PostgreSQL permits use of an added enum label only after its DDL has
      // committed. Each pinned pickup pair uses the ordinary per-file commits.
      if (file.name === pickupSourceName) await pickupSourceProof(tx, 'EXTERNAL');
      if (file.name === personalPickupSourceName) await pickupSourceProof(tx, 'CUSTOMER_PICKUP');
      const pickupDispatch = file.name === pickupDispatchName;
      const personalPickupDispatch = file.name === personalPickupDispatchName;
      const beforePickup = pickupDispatch || personalPickupDispatch ? await pickupDispatchRows(tx) : null;
      for (const statement of file.statements) { assertBoundary(); await tx.$executeRawUnsafe(statement); }
      if (beforeQuantity && beforeQuantity !== await quantityProof(tx, file, false)) failure('PROTECTED_CURRENT_RELEASE_QUANTITY_CHANGED');
      if (beforeDuty !== null && beforeDuty !== await dutyProof(tx, true)) failure('PROTECTED_CURRENT_RELEASE_DUTY_ROWS_CHANGED');
      if (beforePickup !== null) {
        if (beforePickup !== await pickupDispatchRows(tx)) failure('PROTECTED_CURRENT_RELEASE_PICKUP_ROWS_CHANGED');
        if (pickupDispatch) await assertPickupDispatchSchema(tx);
      }
      const sequenceProofSha256 = file.name === waybillName ? await sequenceProof(tx, true) : null;
      const catalogSha256 = await catalog(tx, currentCatalogScope(files, index));
      await assertLease(tx, owner, false); assertBoundary();
      const receipt = JSON.stringify({ format: 'sabalan-protected-current-release/v1', sqlSha256: file.sha256,
        releaseSetSha256: releaseSetSha256(files, index), order: index, catalogSha256,
        deploymentId: owner.deploymentId, releaseId: owner.releaseId,
        quantityProofSha256: beforeQuantity, dutyRows: beforeDuty, sequenceProofSha256,
        ...(pickupDispatch && { pickupDispatchRows: beforePickup }),
        ...(personalPickupDispatch && { personalPickupDispatchRows: beforePickup }) });
      await tx.$executeRaw`INSERT INTO public._prisma_migrations (id,checksum,finished_at,migration_name,logs,started_at,applied_steps_count)
        VALUES (${randomUUID()},${file.sha256},clock_timestamp(),${file.name},${receipt},clock_timestamp(),1)`;
      assertBoundary();
    }, { maxWait: 1000, timeout: 180000 });
  }
  return { appliedCount: files.length - completed, totalCount: files.length };
}
