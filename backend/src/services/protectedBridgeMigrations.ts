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
} as const;
export const protectedCurrentReleaseNames: readonly string[] = Object.freeze(Object.keys(currentRelease));

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
  if (files.length !== names.length || files.some(([name], index) => name !== names[index])) failure('PROTECTED_CURRENT_RELEASE_SET_UNPROVEN');
  return files.map(([name, bytes]) => {
    const [sha256, expectedCount] = currentRelease[name as keyof typeof currentRelease];
    if (!Buffer.isBuffer(bytes) || sha(bytes) !== sha256) failure('PROTECTED_CURRENT_RELEASE_SQL_IDENTITY_MISMATCH');
    const sql = bytes.toString('utf8'), statements = splitCurrentReleaseSql(sql);
    if (statements.length !== expectedCount || statements.some(statement => /^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/i.test(statement))) {
      failure('PROTECTED_CURRENT_RELEASE_STATEMENTS_UNPROVEN');
    }
    const tables = [...new Set([...sql.matchAll(/\b(?:CREATE|ALTER)\s+TABLE\s+"?([A-Za-z_][A-Za-z_0-9]*)"?/gi)].map(match => match[1]))];
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

async function catalog(tx: Prisma.TransactionClient, input: { tables: string[]; functions: string[] }) {
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
  return sha(JSON.stringify(canonical({ tables, functions })));
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
  return { tables: [...new Set(files.slice(0, through + 1).flatMap(file => file.tables))].sort(),
    functions: [...new Set(files.slice(0, through + 1).flatMap(file => file.functions))].sort() };
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

type RetryProof = { quantityProofSha256: string | null; dutyRows: string | null; sequenceProofSha256: string | null };
export function assertProtectedCurrentReleaseRetryEvidence(receipt: any, owner: Owner, observed: RetryProof) {
  if (typeof receipt?.deploymentId !== 'string' || !receipt.deploymentId
    || typeof receipt.releaseId !== 'string' || !receipt.releaseId) failure('PROTECTED_CURRENT_RELEASE_HISTORY_UNPROVEN');
  if (receipt.deploymentId !== owner.deploymentId || receipt.releaseId !== owner.releaseId) return;
  for (const key of ['quantityProofSha256', 'dutyRows', 'sequenceProofSha256'] as const) {
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
        || receipt.order !== files.indexOf(file) || receipt.releaseSetSha256 !== sha(files.map(row => row.sha256).join('\n'))) {
        failure('PROTECTED_CURRENT_RELEASE_HISTORY_UNPROVEN');
      }
      const sameOperation = receipt.deploymentId === owner.deploymentId && receipt.releaseId === owner.releaseId;
      const observed: RetryProof = {
        quantityProofSha256: sameOperation && quantityNames.has(file.name) ? await quantityProof(tx, file, false) : null,
        dutyRows: sameOperation && file.name === dutyName ? await dutyProof(tx, true) : null,
        sequenceProofSha256: sameOperation && file.name === waybillName ? await sequenceProof(tx, true) : null,
      };
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
      for (const statement of file.statements) { assertBoundary(); await tx.$executeRawUnsafe(statement); }
      if (beforeQuantity && beforeQuantity !== await quantityProof(tx, file, false)) failure('PROTECTED_CURRENT_RELEASE_QUANTITY_CHANGED');
      if (beforeDuty !== null && beforeDuty !== await dutyProof(tx, true)) failure('PROTECTED_CURRENT_RELEASE_DUTY_ROWS_CHANGED');
      const sequenceProofSha256 = file.name === waybillName ? await sequenceProof(tx, true) : null;
      const catalogSha256 = await catalog(tx, currentCatalogScope(files, index));
      await assertLease(tx, owner, false); assertBoundary();
      const receipt = JSON.stringify({ format: 'sabalan-protected-current-release/v1', sqlSha256: file.sha256,
        releaseSetSha256: sha(files.map(row => row.sha256).join('\n')), order: index, catalogSha256,
        deploymentId: owner.deploymentId, releaseId: owner.releaseId,
        quantityProofSha256: beforeQuantity, dutyRows: beforeDuty, sequenceProofSha256 });
      await tx.$executeRaw`INSERT INTO public._prisma_migrations (id,checksum,finished_at,migration_name,logs,started_at,applied_steps_count)
        VALUES (${randomUUID()},${file.sha256},clock_timestamp(),${file.name},${receipt},clock_timestamp(),1)`;
      assertBoundary();
    }, { maxWait: 1000, timeout: 180000 });
  }
  return { appliedCount: files.length - completed, totalCount: files.length };
}
