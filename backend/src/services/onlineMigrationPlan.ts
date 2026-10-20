import { createHash, randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { deploymentMaintenanceActive } from './deploymentMaintenance';
import { RECOVERY_COORDINATION_DIR } from './recoveryRuntime';

type ColumnType = 'text' | 'integer' | 'bigint' | 'boolean' | 'jsonb' | 'timestamp with time zone' | `numeric(${number},${number})`;
type ColumnExpansion = { kind: 'add-nullable-column'; table: string; column: string; type: ColumnType };
export type MirroredColumnExpansion = { kind: 'mirror-column'; table: string; column: string; sourceColumn: string; type: ColumnType };
export type OnlineExpansionPlan = { format: 'sabalan-online-expansion/v1'; migrationName: string;
  operations: Array<ColumnExpansion | MirroredColumnExpansion> };
export type OnlineMigrationOwner = { deploymentId: string; leaseToken: string; releaseId: string };
export type MirroredBackfillPlan = { format: 'sabalan-mirror-backfill/v1'; expansionMigrationName: string;
  operation: MirroredColumnExpansion };

function fail(code: string): never { throw Object.assign(new Error(code), { code }); }
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const mirrorName = (migration: string, table: string, column: string) => `online_mirror_${hash(`${migration}:${table}:${column}`).slice(0, 24)}`;
function identifier(value: string) {
  if (typeof value !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(value)) fail('ONLINE_MIGRATION_IDENTIFIER_INVALID');
  return `"${value}"`;
}
function columnType(value: string): ColumnType {
  const numeric = /^numeric\((\d+),(\d+)\)$/.exec(value);
  if (numeric) {
    const [, precision, scale] = numeric.map(Number);
    if (precision >= 1 && precision <= 1000 && scale >= 0 && scale <= precision) return value as ColumnType;
  }
  if (['text', 'integer', 'bigint', 'boolean', 'jsonb', 'timestamp with time zone'].includes(value)) return value as ColumnType;
  return fail('ONLINE_MIGRATION_COLUMN_TYPE_UNSUPPORTED');
}
function exactKeys(value: object, allowed: string[]) {
  if (!value || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))
    || allowed.some(key => !(key in value))) fail('ONLINE_MIGRATION_PLAN_INVALID');
}

/** Generate a deliberately limited online expansion. Arbitrary SQL, defaults,
 * rewrites, constraints, drops and blocking index builds require another proven
 * migration strategy; a declaration of compatibility does not make them safe. */
export function compileOnlineExpansion(input: OnlineExpansionPlan) {
  exactKeys(input, ['format', 'migrationName', 'operations']);
  if (input.format !== 'sabalan-online-expansion/v1' || !/^\d{14}_[a-z0-9_]{1,100}$/.test(input.migrationName)
    || !Array.isArray(input.operations) || !input.operations.length || input.operations.length > 100) fail('ONLINE_MIGRATION_PLAN_INVALID');
  const names = new Set<string>();
  const statements: string[] = [];
  const operations = input.operations.map(operation => {
    if (!operation || !['add-nullable-column', 'mirror-column'].includes(operation.kind)) fail('ONLINE_MIGRATION_OPERATION_UNSUPPORTED');
    exactKeys(operation, operation.kind === 'mirror-column'
      ? ['kind', 'table', 'column', 'sourceColumn', 'type'] : ['kind', 'table', 'column', 'type']);
    const table = identifier(operation.table), column = identifier(operation.column), type = columnType(operation.type);
    if (names.has(`${operation.table}.${operation.column}`)) fail('ONLINE_MIGRATION_DUPLICATE_COLUMN');
    names.add(`${operation.table}.${operation.column}`);
    statements.push(`ALTER TABLE "public".${table} ADD COLUMN ${column} ${type}`);
    if (operation.kind === 'mirror-column') {
      const source = identifier(operation.sourceColumn);
      if (source === column) fail('ONLINE_MIGRATION_DUPLICATE_COLUMN');
      const name = identifier(mirrorName(input.migrationName, operation.table, operation.column));
      statements.push(`CREATE FUNCTION "public".${name}() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.${source} IS NULL THEN NEW.${source} := NEW.${column};
    ELSIF NEW.${column} IS NULL THEN NEW.${column} := NEW.${source};
    ELSIF NEW.${column} IS DISTINCT FROM NEW.${source} THEN RAISE EXCEPTION 'ONLINE_MIRROR_CONFLICT'; END IF;
  ELSE
    IF NEW.${source} IS DISTINCT FROM OLD.${source} AND NEW.${column} IS DISTINCT FROM OLD.${column}
      AND NEW.${source} IS DISTINCT FROM NEW.${column} THEN RAISE EXCEPTION 'ONLINE_MIRROR_CONFLICT';
    ELSIF NEW.${column} IS DISTINCT FROM OLD.${column} THEN NEW.${source} := NEW.${column};
    ELSIF NEW.${source} IS DISTINCT FROM OLD.${source} OR NEW.${column} IS NULL THEN NEW.${column} := NEW.${source}; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public`);
      statements.push(`CREATE TRIGGER ${name} BEFORE INSERT OR UPDATE ON "public".${table} FOR EACH ROW EXECUTE FUNCTION "public".${name}()`);
      // UPDATE OF records explicit SQL writer intent even when NULL equals
      // the historical unfilled value. The admitted source is NOT NULL.
      const nonnull = identifier(mirrorName(input.migrationName, operation.table, operation.column).replace('online_mirror_', 'online_guard_'));
      statements.push(`CREATE FUNCTION "public".${nonnull}() RETURNS trigger AS $$
BEGIN
  IF NEW.${column} IS NULL THEN RAISE EXCEPTION 'ONLINE_MIRROR_NULL_UNSUPPORTED'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public`);
      statements.push(`CREATE TRIGGER ${nonnull} BEFORE UPDATE OF ${column} ON "public".${table} FOR EACH ROW EXECUTE FUNCTION "public".${nonnull}()`);
      return { kind: operation.kind, table: operation.table, column: operation.column, sourceColumn: operation.sourceColumn, type };
    }
    return { kind: operation.kind, table: operation.table, column: operation.column, type };
  });
  const plan = { format: input.format, migrationName: input.migrationName, operations };
  // Trigger ordering must never decide which legacy/new value wins. Each
  // mirror owns two otherwise disjoint columns for this expansion.
  const mirrorColumns = new Set<string>();
  for (const operation of operations) {
    if (operation.kind !== 'mirror-column') continue;
    for (const name of [operation.column, operation.sourceColumn]) {
      const key = `${operation.table}.${name}`;
      if (mirrorColumns.has(key) || (name === operation.sourceColumn && names.has(key))) fail('ONLINE_MIGRATION_MIRROR_OVERLAP');
      mirrorColumns.add(key);
    }
  }
  const sql = `-- Generated bounded online expansion: ${input.migrationName}\n${statements.join(';\n\n')};\n`;
  return { plan, operationSha256: hash(JSON.stringify(plan)), sql, sqlSha256: hash(sql), statements };
}

async function assertOwner(tx: Prisma.TransactionClient, owner: OnlineMigrationOwner, phase: 'EXPANDING' | 'BACKFILLING') {
  if (deploymentMaintenanceActive(RECOVERY_COORDINATION_DIR)) fail('ONLINE_MIGRATION_PROTECTED_BOUNDARY');
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "deployment_operations"
    WHERE "id" = ${owner.deploymentId} AND "leaseToken" = ${owner.leaseToken} AND "activeKey" = 'production'
      AND "leaseExpiresAt" > clock_timestamp() + interval '20 seconds' FOR SHARE`;
  if (rows.length !== 1) fail('ONLINE_MIGRATION_LEASE_LOST');
  const releases = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "online_releases"
    WHERE "id"=${owner.releaseId} AND "deploymentId"=${owner.deploymentId} AND "phase"=${phase} FOR SHARE`;
  if (releases.length !== 1) {
    fail('ONLINE_MIGRATION_RELEASE_NOT_OWNED');
  }
}

/** Lower-level owned transaction primitive, used only after the release
 * controller proves coherent recovery and old/new domain compatibility.
 * There is deliberately no public CLI/HTTP promotion entry point here. */
export async function applyOnlineExpansion(database: PrismaClient, owner: OnlineMigrationOwner,
  input: OnlineExpansionPlan, actualSqlBytes: Buffer) {
  return database.$transaction(tx => applyOwnedExpansion(tx, owner, input, actualSqlBytes), { timeout: 15_000, maxWait: 1000 });
}

async function applyOwnedExpansion(tx: Prisma.TransactionClient, owner: OnlineMigrationOwner,
  input: OnlineExpansionPlan, actualSqlBytes: Buffer) {
  const compiled = compileOnlineExpansion(input);
  if (!actualSqlBytes.equals(Buffer.from(compiled.sql))) fail('ONLINE_MIGRATION_SQL_IDENTITY_MISMATCH');
  await tx.$queryRaw`SELECT set_config('lock_timeout', '1000ms', true), set_config('statement_timeout', '10000ms', true)`;
  const locks = await tx.$queryRaw<Array<{ owned: boolean }>>`SELECT pg_try_advisory_xact_lock(741936426::bigint) AS owned`;
  if (!locks[0]?.owned) fail('ONLINE_MIGRATION_ALREADY_RUNNING');
  await assertOwner(tx, owner, 'EXPANDING');
  const step = await tx.onlineMigrationStep.findUnique({ where: { releaseId_stepId: { releaseId: owner.releaseId, stepId: input.migrationName } } });
  if (!step || step.phase !== 'expand' || step.operationSha256 !== compiled.operationSha256
    || step.sourceMigrationName !== input.migrationName
    || compileOnlineExpansion(step.operationJson as unknown as OnlineExpansionPlan).operationSha256 !== compiled.operationSha256) {
    fail('ONLINE_MIGRATION_STEP_IDENTITY_MISMATCH');
  }
  const history = await tx.$queryRaw<Array<{ checksum: string; finished_at: Date | null }>>`SELECT checksum, finished_at FROM "_prisma_migrations"
    WHERE migration_name = ${input.migrationName} AND rolled_back_at IS NULL`;
  if (history.length) {
    if (history.length !== 1 || !history[0].finished_at || history[0].checksum !== compiled.sqlSha256 || step.state !== 'COMPLETE') {
      fail('ONLINE_MIGRATION_LEDGER_REQUIRES_RECOVERY');
    }
    await assertExpansionSchema(tx, compiled);
    return { applied: false, checksum: compiled.sqlSha256 };
  }
  if (step.state !== 'PENDING') fail('ONLINE_MIGRATION_LEDGER_REQUIRES_RECOVERY');
  for (const operation of input.operations) {
    const tables = await tx.$queryRaw<Array<{ supported: boolean }>>`SELECT
      c.relkind = 'r' AND c.relpersistence = 'p' AND NOT EXISTS(
        SELECT 1 FROM pg_inherits i WHERE i.inhparent = c.oid OR i.inhrelid = c.oid) AS supported
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = ${operation.table}`;
    if (tables.length !== 1 || !tables[0].supported) fail('ONLINE_MIGRATION_TABLE_UNSUPPORTED');
    const triggers = await tx.$queryRaw<Array<{ name: string }>>`SELECT t.tgname AS name FROM pg_trigger t
      JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=${operation.table} AND NOT t.tgisinternal`;
    if (triggers.length) fail('ONLINE_MIGRATION_EXISTING_TRIGGER_UNPROVEN');
    if (operation.kind !== 'mirror-column') continue;
    const columns = await tx.$queryRaw<Array<{ type: string; generated: string; identity: string; hasdefault: boolean; notnull: boolean }>>`
      SELECT format_type(a.atttypid, a.atttypmod) AS type, a.attgenerated::text AS generated, a.attidentity::text AS identity, a.atthasdef AS hasdefault, a.attnotnull AS notnull
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = ${operation.table} AND a.attname = ${operation.sourceColumn} AND NOT a.attisdropped`;
    if (columns.length !== 1 || columns[0].generated !== '' || columns[0].identity !== '' || columns[0].hasdefault
      || !columns[0].notnull || columns[0].type !== operation.type) fail('ONLINE_MIGRATION_SOURCE_TYPE_MISMATCH');
  }
  // Keep PostgreSQL's full timestamp precision; a JavaScript Date would round
  // the actual first-DDL boundary down to milliseconds.
  const [started] = await tx.$queryRaw<Array<{ value: string }>>`SELECT clock_timestamp()::text AS value`;
  for (const statement of compiled.statements) await tx.$executeRawUnsafe(statement);
  await assertExpansionSchema(tx, compiled);
  await assertOwner(tx, owner, 'EXPANDING');
  const appended = await tx.$executeRaw`WITH finished AS MATERIALIZED (SELECT clock_timestamp() AS value)
    INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, started_at, applied_steps_count)
    SELECT ${randomUUID()}, ${compiled.sqlSha256}, finished.value, ${input.migrationName}, ${started.value}::timestamptz, 1
    FROM finished WHERE finished.value >= ${started.value}::timestamptz`;
  if (appended !== 1) fail('ONLINE_MIGRATION_CLOCK_REQUIRES_RECOVERY');
  await tx.onlineMigrationStep.update({ where: { id: step.id }, data: { state: 'COMPLETE', completedAt: new Date(),
    progressJson: { sqlSha256: compiled.sqlSha256 } } });
  return { applied: true, checksum: compiled.sqlSha256 };
}

export async function backfillMirroredColumn(database: PrismaClient, owner: OnlineMigrationOwner,
  stepId: string, plan: MirroredBackfillPlan, batchSize = 200) {
  return database.$transaction(tx => backfillOwnedMirror(tx, owner, stepId, plan, batchSize), { timeout: 5000, maxWait: 1000 });
}

/** Read-only verification after expansion and on every backfill resume. It
 * cannot replay DDL or turn an unfinished/unknown ledger into completed work. */
export async function verifyAppliedOnlineExpansion(database:PrismaClient,owner:OnlineMigrationOwner,input:OnlineExpansionPlan){
 const compiled=compileOnlineExpansion(input);
 return database.$transaction(async tx=>{
  await tx.$queryRaw`SELECT set_config('lock_timeout','1000ms',true),set_config('statement_timeout','2000ms',true)`;
  await assertOwner(tx,owner,'BACKFILLING');
  const step=await tx.onlineMigrationStep.findUnique({where:{releaseId_stepId:{releaseId:owner.releaseId,stepId:input.migrationName}}});
  if(!step||step.phase!=='expand'||step.state!=='COMPLETE'||step.sourceMigrationName!==input.migrationName
   ||step.operationSha256!==compiled.operationSha256
   ||compileOnlineExpansion(step.operationJson as unknown as OnlineExpansionPlan).operationSha256!==compiled.operationSha256){
   fail('ONLINE_MIGRATION_STEP_IDENTITY_MISMATCH');
  }
  const history=await tx.$queryRaw<Array<{checksum:string}>>`SELECT checksum FROM "_prisma_migrations"
   WHERE migration_name=${input.migrationName} AND finished_at IS NOT NULL AND rolled_back_at IS NULL`;
  if(history.length!==1||history[0].checksum!==compiled.sqlSha256)fail('ONLINE_MIGRATION_LEDGER_REQUIRES_RECOVERY');
  await assertExpansionSchema(tx,compiled);await assertOwner(tx,owner,'BACKFILLING');
  return{migrationName:input.migrationName,checksum:compiled.sqlSha256,readOnlyVerification:true};
 },{timeout:5000,maxWait:1000});
}

async function backfillOwnedMirror(tx: Prisma.TransactionClient, owner: OnlineMigrationOwner,
  stepId: string, plan: MirroredBackfillPlan, batchSize = 200) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) fail('ONLINE_BACKFILL_BATCH_INVALID');
  const operation = plan.operation;
  const table = identifier(operation.table), column = identifier(operation.column), source = identifier(operation.sourceColumn);
  const operationSha256 = mirroredBackfillOperationSha256(plan);
  await tx.$queryRaw`SELECT set_config('lock_timeout', '1000ms', true), set_config('statement_timeout', '2000ms', true)`;
  const locks = await tx.$queryRaw<Array<{ owned: boolean }>>`SELECT pg_try_advisory_xact_lock(741936426::bigint) AS owned`;
  if (!locks[0]?.owned) fail('ONLINE_MIGRATION_ALREADY_RUNNING');
  await assertOwner(tx, owner, 'BACKFILLING');
  const step = await tx.onlineMigrationStep.findUnique({ where: { releaseId_stepId: { releaseId: owner.releaseId, stepId } } });
  if (!step || step.phase !== 'backfill' || step.operationSha256 !== operationSha256
    || mirroredBackfillOperationSha256(step.operationJson as unknown as MirroredBackfillPlan) !== operationSha256) fail('ONLINE_MIGRATION_STEP_IDENTITY_MISMATCH');
  if (!['PENDING', 'RUNNING', 'COMPLETE'].includes(step.state)) fail('ONLINE_MIGRATION_LEDGER_REQUIRES_RECOVERY');
  const expansion = await tx.onlineMigrationStep.findUnique({ where: { releaseId_stepId: {
    releaseId: owner.releaseId, stepId: plan.expansionMigrationName } } });
  if (!expansion || expansion.phase !== 'expand' || expansion.state !== 'COMPLETE') fail('ONLINE_BACKFILL_EXPANSION_NOT_PROVEN');
  const compiled = compileOnlineExpansion(expansion.operationJson as unknown as OnlineExpansionPlan);
  if (compiled.plan.migrationName !== plan.expansionMigrationName || expansion.sourceMigrationName !== plan.expansionMigrationName
    || compiled.operationSha256 !== expansion.operationSha256 || !compiled.plan.operations.some(candidate =>
    JSON.stringify(candidate) === JSON.stringify({ kind: operation.kind, table: operation.table, column: operation.column,
      sourceColumn: operation.sourceColumn, type: operation.type }))) fail('ONLINE_BACKFILL_EXPANSION_NOT_PROVEN');
  const history = await tx.$queryRaw<Array<{ checksum: string }>>`SELECT checksum FROM "_prisma_migrations"
    WHERE migration_name = ${plan.expansionMigrationName} AND finished_at IS NOT NULL AND rolled_back_at IS NULL`;
  if (history.length !== 1 || history[0].checksum !== compiled.sqlSha256) fail('ONLINE_MIGRATION_LEDGER_REQUIRES_RECOVERY');
  await assertExpansionSchema(tx, compiled);
  if (step.state === 'COMPLETE') {
    const rows = await tx.$queryRawUnsafe<Array<{ pending: boolean }>>(`SELECT EXISTS(
      SELECT 1 FROM "public".${table} WHERE ${column} IS DISTINCT FROM ${source}) AS pending`);
    if (rows[0].pending) fail('ONLINE_BACKFILL_COMPLETION_DRIFT');
    return { updated: 0, complete: true };
  }
  const updated = await tx.$queryRawUnsafe<Array<{ changed: number }>>(`WITH batch AS (
    SELECT ctid FROM "public".${table} WHERE ${column} IS DISTINCT FROM ${source} ORDER BY ctid
    LIMIT ${batchSize} FOR UPDATE SKIP LOCKED)
    UPDATE "public".${table} AS target SET ${column} = target.${source} FROM batch WHERE target.ctid = batch.ctid RETURNING 1 AS changed`);
  const pending = await tx.$queryRawUnsafe<Array<{ pending: boolean }>>(`SELECT EXISTS(
    SELECT 1 FROM "public".${table} WHERE ${column} IS DISTINCT FROM ${source}) AS pending`);
  const prior = (step.progressJson as { updatedRows?: number } | null)?.updatedRows ?? 0;
  if (!Number.isSafeInteger(prior) || prior < 0 || !Number.isSafeInteger(prior + updated.length)) fail('ONLINE_BACKFILL_PROGRESS_INVALID');
  await assertOwner(tx, owner, 'BACKFILLING');
  await tx.onlineMigrationStep.update({ where: { id: step.id }, data: { state: pending[0].pending ? 'RUNNING' : 'COMPLETE',
    completedAt: pending[0].pending ? null : new Date(), progressJson: { updatedRows: prior + updated.length } } });
  return { updated: updated.length, complete: !pending[0].pending };
}

async function assertExpansionSchema(tx: Prisma.TransactionClient, compiled: ReturnType<typeof compileOnlineExpansion>) {
  for (const operation of compiled.plan.operations) {
    await tx.$executeRawUnsafe(`LOCK TABLE "public".${identifier(operation.table)} IN ROW EXCLUSIVE MODE`);
    const columns = await tx.$queryRaw<Array<{ name: string; type: string; generated: string; identity: string; hasdefault: boolean; notnull: boolean; supported: boolean }>>`
      SELECT a.attname AS name, format_type(a.atttypid,a.atttypmod) AS type, a.attgenerated::text AS generated,
        a.attidentity::text AS identity, a.atthasdef AS hasdefault, a.attnotnull AS notnull,
        c.relkind='r' AND c.relpersistence='p' AND NOT EXISTS(
          SELECT 1 FROM pg_inherits i WHERE i.inhparent=c.oid OR i.inhrelid=c.oid) AS supported
      FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=${operation.table} AND NOT a.attisdropped
        AND (a.attname=${operation.column} OR a.attname=${operation.kind === 'mirror-column' ? operation.sourceColumn : operation.column})`;
    if (columns.length !== (operation.kind === 'mirror-column' ? 2 : 1)
      || columns.some(column => !column.supported || column.type !== operation.type || column.generated !== ''
        || column.identity !== '' || column.hasdefault || (column.name === operation.column && column.notnull)
        || (operation.kind === 'mirror-column' && column.name === operation.sourceColumn && !column.notnull))) {
      fail('ONLINE_MIGRATION_SCHEMA_DRIFT');
    }
    if (operation.kind === 'mirror-column') await assertMirrorTrigger(tx, compiled, operation);
    const triggerNames = await tx.$queryRaw<Array<{ name: string }>>`SELECT t.tgname AS name FROM pg_trigger t
      JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=${operation.table} AND NOT t.tgisinternal`;
    const expectedNames = compiled.plan.operations.filter(candidate => candidate.table === operation.table && candidate.kind === 'mirror-column')
      .flatMap(candidate => { const name=mirrorName(compiled.plan.migrationName,candidate.table,candidate.column); return [name,name.replace('online_mirror_', 'online_guard_')]; }).sort();
    if (JSON.stringify(triggerNames.map(trigger=>trigger.name).sort()) !== JSON.stringify(expectedNames)) fail('ONLINE_MIGRATION_EXISTING_TRIGGER_UNPROVEN');
  }
}

async function assertMirrorTrigger(tx: Prisma.TransactionClient, compiled: ReturnType<typeof compileOnlineExpansion>, operation: MirroredColumnExpansion) {
  await assertGeneratedTrigger(tx, compiled, operation, false);
  await assertGeneratedTrigger(tx, compiled, operation, true);
}

async function assertGeneratedTrigger(tx: Prisma.TransactionClient, compiled: ReturnType<typeof compileOnlineExpansion>, operation: MirroredColumnExpansion, nonnull: boolean) {
  const triggerName = nonnull ? mirrorName(compiled.plan.migrationName, operation.table, operation.column).replace('online_mirror_', 'online_guard_')
    : mirrorName(compiled.plan.migrationName, operation.table, operation.column);
  const trigger = await tx.$queryRaw<Array<{ body: string; enabled: string; type: number; arguments: number; qualified: boolean; expectedFunction: boolean }>>`
    SELECT p.prosrc AS body, t.tgenabled::text AS enabled, t.tgtype::int AS type, t.tgnargs::int AS arguments, t.tgqual IS NULL AS qualified,
      p.proname=${triggerName} AND p.pronamespace=n.oid AND NOT p.prosecdef AND p.provolatile='v'
        AND p.proconfig=ARRAY['search_path=pg_catalog, public']::text[] AND l.lanname='plpgsql'
        AND NOT t.tgisinternal AND t.tgconstraint=0
        AND t.tgattr::text=CASE WHEN ${nonnull} THEN (SELECT a.attnum::text FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname=${operation.column}) ELSE '' END AS "expectedFunction"
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_proc p ON p.oid = t.tgfoid JOIN pg_language l ON l.oid=p.prolang
      WHERE n.nspname = 'public' AND c.relname = ${operation.table} AND t.tgname = ${triggerName}`;
  const functionSql = compiled.statements.find(statement => statement.startsWith(`CREATE FUNCTION "public".${identifier(triggerName)}`));
  const expectedBody = functionSql?.split('$$')[1]?.trim();
  if (trigger.length !== 1 || !expectedBody || trigger[0].body.trim() !== expectedBody || trigger[0].enabled !== 'O'
    || trigger[0].type !== (nonnull ? 19 : 23) || trigger[0].arguments !== 0 || !trigger[0].qualified || !trigger[0].expectedFunction) fail('ONLINE_BACKFILL_MIRROR_DRIFT');
}

export function mirroredBackfillOperationSha256(plan: MirroredBackfillPlan) {
  exactKeys(plan, ['format', 'expansionMigrationName', 'operation']);
  if (plan.format !== 'sabalan-mirror-backfill/v1' || plan.operation?.kind !== 'mirror-column') fail('ONLINE_MIGRATION_PLAN_INVALID');
  const compiled = compileOnlineExpansion({ format: 'sabalan-online-expansion/v1', migrationName: plan.expansionMigrationName,
    operations: [plan.operation] });
  return hash(JSON.stringify({ format: plan.format, expansionMigrationName: plan.expansionMigrationName, operation: compiled.plan.operations[0] }));
}
