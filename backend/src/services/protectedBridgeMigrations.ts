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
  '20261014140000_online_deployment_control': {
    sha256: '872f0f0858473546cee56b836fa64c95d668997304ae462ac2c18428e69f4cb2', statements: 29,
    tables: ['online_releases', 'online_runtime_slots', 'online_migration_steps'],
    functions: ['sabalan_protect_online_release_identity', 'sabalan_protect_online_runtime_identity',
      'sabalan_protect_online_migration_identity', 'sabalan_prevent_online_registry_delete'],
  },
} as const;
function failure(code: string): never { throw Object.assign(new Error(code), { code }); }
const sha = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
type Owner = { deploymentId: string; leaseToken: string; releaseId: string };

/** Only these two byte-exact, reviewed additive bootstrap files. The splitter
 * is deliberately NOT an arbitrary SQL parser: the complete SHA is checked
 * first, and both exact statement counts are frozen. Dollar-quoted function
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

function protectedBoundary(owner: Owner) {
  const environment = { ...process.env };
  const directory = environment.RECOVERY_COORDINATION_DIR || '/app/recovery-coordination';
  const file = path.join(directory, 'deployment-maintenance.json');
  if (!path.isAbsolute(directory) || [owner.deploymentId, owner.leaseToken, owner.releaseId].some(value =>
    typeof value !== 'string' || !value || value.length > 256)) failure('PROTECTED_BRIDGE_OWNER_INVALID');
  return () => {
    assertRuntimeControlOwnership(environment);
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

async function assertLease(tx: Prisma.TransactionClient, owner: Owner) {
  const rows = await tx.$queryRaw<Array<{ id: string; checkpoint: unknown }>>`SELECT id, "checkpointJson" AS checkpoint
    FROM deployment_operations WHERE id=${owner.deploymentId} AND "leaseToken"=${owner.leaseToken}
      AND "releaseId"=${owner.releaseId} AND "activeKey"='production' AND phase='MUTATION_STARTED'
      AND "leaseExpiresAt">clock_timestamp()+interval '20 seconds' FOR SHARE`;
  const checkpoint = rows[0]?.checkpoint as Record<string, unknown> | undefined;
  if (rows.length !== 1 || !checkpoint || checkpoint.deploymentId !== owner.deploymentId || checkpoint.releaseId !== owner.releaseId
    || checkpoint.localVerified !== true || checkpoint.remoteVerified !== true || checkpoint.restoreVerified !== true
    || checkpoint.manifestReadable !== true || typeof checkpoint.checksum !== 'string' || !/^[a-f0-9]{64}$/.test(checkpoint.checksum)) {
    failure('PROTECTED_BRIDGE_CHECKPOINT_LEASE_UNPROVEN');
  }
}

async function catalog(tx: Prisma.TransactionClient, input: ReturnType<typeof compileProtectedBridgeMigration>) {
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

/** Protected bridge only; no online/public/CLI entry point. The existing
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
