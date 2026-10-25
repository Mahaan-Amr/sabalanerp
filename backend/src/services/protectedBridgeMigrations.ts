import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { assertRuntimeControlOwnership } from './runtimeControlOwnership';
import { assertHistoricalHrRestoreAnchor, verifyCurrentHistoricalHrCheckpoint, type HistoricalHrRestoreAnchor } from './protectedHistoricalHrAnchor';
import { verifyHistoricalHrCatalog } from './protectedHistoricalHrCatalog';
import type { RestoredQaHistoricalAnchor } from './protectedRestoredQaHrAnchor';

import {compileProtectedBridgeMigration,protectedBridgeMigrationNames,protectedOwnedMigrationStrategyNames,protectedOwnedMigrationDefinition} from './protectedBridgeMigrationCompiler';
export {compileProtectedBridgeMigration,protectedBridgeMigrationNames,protectedOwnedMigrationStrategyNames} from './protectedBridgeMigrationCompiler';
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

/** Only these byte-exact, reviewed protected strategies. The splitter
 * is deliberately NOT an arbitrary SQL parser: the complete SHA is checked
 * first, and exact statement counts are frozen. The customer barrier's entire
 * DO body is one statement; splitting its dynamic CREATE text is forbidden.
 */

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
  return checkpoint;
}

async function catalogSnapshot(tx: Prisma.TransactionClient, input: ReturnType<typeof compileProtectedBridgeMigration>) {
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
  return { tables, functions };
}
async function catalog(tx: Prisma.TransactionClient, input: ReturnType<typeof compileProtectedBridgeMigration>) {
  return sha(JSON.stringify(canonical(await catalogSnapshot(tx, input))));
}

/** Historical inspection is separate evidence, not an executor receipt. The
 * original native row (including NULL logs, ID and timestamps) is never
 * updated. The normal apply function below still refuses NULL logs.
 *
 * The restore producer must capture history with the exact PostgreSQL
 * json_agg(t ORDER BY migration_name,id)::text projection used here, and the
 * original HR row with row_to_json(t)::text. JavaScript reserialization is not
 * a substitute for those native bytes.
 */
export async function inspectHistoricalProtectedBridgeMigration(database: PrismaClient, inputOwner: Owner,
  name: string, bytes: Buffer, anchor: HistoricalHrRestoreAnchor) {
  return inspectBoundHistoricalHr(database, inputOwner, name, bytes, () => {
    const accepted = assertHistoricalHrRestoreAnchor(anchor, inputOwner);
    return { targetDatabase: accepted.decision.sourceDatabase, hr: accepted.hr, hrRowSha256: accepted.decision.hrRowSha256,
      historySha256: accepted.decision.nativeHistorySha256, historyRows: accepted.decision.nativeHistoryRows,
      restoreOriginalSha256: accepted.restoreOriginalSha256,
      baselineCheckpoint: { deploymentId: accepted.checkpoint.deploymentId, releaseId: accepted.checkpoint.releaseId,
        checksum: accepted.decision.checkpointChecksum, metadataSha256: accepted.decision.checkpointMetadataSha256,
        databaseDumpSha256: accepted.decision.databaseDumpSha256, independentlyRestored: true } };
  });
}

/** Rehearsal-only target: the production SOURCE token cannot be substituted,
 * and the engine's exact original callback must remain ACTIVE throughout.
 * No independent point is healthy until the outer restore actually cleans up
 * and its original Node owner closes; that later finalizer is not this API.
 */
export async function inspectRestoredQaProtectedBridgeMigration(database: PrismaClient, inputOwner: Owner,
  name: string, bytes: Buffer, anchor: RestoredQaHistoricalAnchor,
  baseline?: import('./restoredQaMigrationBaseline').RestoredQaMigrationBaseline) {
  const { assertRestoredQaHistoricalAnchor } = await import('./protectedRestoredQaHrAnchor');
  return inspectBoundHistoricalHr(database, inputOwner, name, bytes, () => {
    const accepted = assertRestoredQaHistoricalAnchor(anchor, {deploymentId:inputOwner.deploymentId,releaseId:inputOwner.releaseId});
    return { targetDatabase: accepted.decision.targetDatabase, hr: accepted.hr, hrRowSha256: accepted.hrBridgeRowSha256,
      historySha256: accepted.rawHistorySha256, historyRows: 440,
      restoreOriginalSha256: sha(JSON.stringify(canonical(accepted.context.proof.originalRestore))),
      baselineCheckpoint: { ...accepted.decision.sourceCheckpoint, independentlyRestored: false },
      qa: { sourceDatabase: accepted.decision.sourceDatabase, sourceReceiptSha256: accepted.decision.sourceReceiptSha256,
        nativeProofSha256: accepted.decision.nativeProofSha256 } };
  },baseline);
}

type BoundHistoricalHr = { targetDatabase: any; hr: any; hrRowSha256: string; historySha256: string; historyRows: number;
  restoreOriginalSha256: string; baselineCheckpoint: { deploymentId: string; releaseId: string; checksum: string;
    metadataSha256: string; databaseDumpSha256: string; independentlyRestored: boolean };
  qa?: { sourceDatabase: any; sourceReceiptSha256: string; nativeProofSha256: string } };

// The resolver is private: public callers cannot replace SOURCE authority with
// a target override, plain hashes, a fake PID, or a caller-supplied boolean.
async function inspectBoundHistoricalHr(database: PrismaClient, inputOwner: Owner, name: string, bytes: Buffer,
  resolve: () => BoundHistoricalHr,baseline?: import('./restoredQaMigrationBaseline').RestoredQaMigrationBaseline) {
  const owner = Object.freeze({ ...inputOwner }), input = compileProtectedBridgeMigration(name, bytes);
  if (name !== '20261014120000_hr_vehicle_assignment_plans') failure('PROTECTED_HR_INSPECTION_MIGRATION_UNSUPPORTED');
  const accepted = resolve(), assertBoundary = protectedBoundary(owner);
  assertBoundary();
  return database.$transaction(async tx => {
    await tx.$queryRaw`SELECT set_config('lock_timeout','250ms',true), set_config('statement_timeout','10000ms',true),
      set_config('search_path','public',true)`;
    const [lock] = await tx.$queryRaw<Array<{ owned: boolean }>>`SELECT pg_try_advisory_xact_lock(741936426::bigint) AS owned`;
    if (!lock?.owned) failure('PROTECTED_BRIDGE_ALREADY_RUNNING');
    let currentCheckpoint: ReturnType<typeof verifyCurrentHistoricalHrCheckpoint> | import('./restoredQaMigrationBaseline').RestoredQaMigrationBaselineDescriptor | undefined;
    const checkContext = async () => {
      assertBoundary(); const current = resolve();
      const identities = await tx.$queryRaw<Array<{ name: string; oid: string; systemIdentifier: string; owner: string }>>`
        SELECT current_database() AS name, (SELECT oid::text FROM pg_database WHERE datname=current_database()) AS oid,
          (SELECT system_identifier::text FROM pg_control_system()) AS "systemIdentifier",current_user AS owner`;
      const identity = identities[0];
      if (identities.length !== 1 || JSON.stringify(canonical({ name: identity.name, oid: identity.oid, systemIdentifier: identity.systemIdentifier }))
          !== JSON.stringify(canonical(current.targetDatabase))) failure('PROTECTED_HR_CHECKPOINT_DATABASE_CHANGED');
      const actual = baseline
        ? await (await import('./restoredQaMigrationBaseline')).assertRestoredQaMigrationLease(tx,baseline,owner)
        : verifyCurrentHistoricalHrCheckpoint(await assertLease(tx,owner),owner,current.targetDatabase);
      if (currentCheckpoint && JSON.stringify(canonical(currentCheckpoint)) !== JSON.stringify(canonical(actual))) {
        failure('PROTECTED_HR_CURRENT_CHECKPOINT_CHANGED');
      }
      currentCheckpoint = actual;
      return identity;
    };
    const identity = await checkContext();
    // Maintenance has drained writers. Keep this table and both sides of all
    // foreign keys stable while inspecting their enforcement triggers.
    await tx.$executeRawUnsafe('LOCK TABLE public._prisma_migrations,public.driver_vehicle_assignment_plans,public.internal_driver_profiles,public.company_vehicles,public.driver_vehicle_assignments IN SHARE MODE');
    const inspectRow = async () => {
      const rows = await tx.$queryRaw<Array<{ value: string }>>`SELECT row_to_json(t)::text AS value
        FROM public._prisma_migrations t WHERE migration_name=${input.name} AND rolled_back_at IS NULL FOR SHARE`;
      if (rows.length !== 1 || sha(rows[0].value) !== accepted.hrRowSha256
        || JSON.stringify(canonical(JSON.parse(rows[0].value))) !== JSON.stringify(canonical(accepted.hr))) {
        failure('PROTECTED_HR_ORIGINAL_NATIVE_ROW_CHANGED');
      }
      return sha(rows[0].value);
    };
    const rowSha256 = await inspectRow();
    const extensions = protectedOwnedMigrationStrategyNames.filter(value => value !== input.name);
    const rows = await tx.$queryRaw<Array<{ migration_name: string; checksum: string; logs: string | null; finished_at: Date | null; rolled_back_at: Date | null }>>`
      SELECT migration_name,checksum,logs,finished_at,rolled_back_at FROM public._prisma_migrations
      WHERE migration_name=ANY(string_to_array(${extensions.join(',')},',')) FOR SHARE`;
    const seen = new Set<string>(), ownedExtensions: string[] = [];
    for (const row of rows) {
      const definition = protectedOwnedMigrationDefinition(row.migration_name);
      let receipt: any; try { receipt = JSON.parse(row.logs!); } catch { failure('PROTECTED_HR_OWNED_EXTENSION_UNPROVEN'); }
      if (!definition || seen.has(row.migration_name) || !row.finished_at || row.rolled_back_at !== null
        || row.checksum !== definition.sha256 || receipt?.format !== 'sabalan-protected-bridge/v1'
        || receipt.sqlSha256 !== definition.sha256 || receipt.catalogSha256 !== await catalog(tx, {
          name: row.migration_name, sha256: definition.sha256, statements: [], tables: [...definition.tables], functions: [...definition.functions],
        })) failure('PROTECTED_HR_OWNED_EXTENSION_UNPROVEN');
      seen.add(row.migration_name); ownedExtensions.push(row.migration_name);
    }
    const inspectHistory = async () => {
      const history = await tx.$queryRaw<Array<{ value: string }>>`SELECT coalesce(json_agg(t ORDER BY migration_name,id),'[]'::json)::text AS value
        FROM public._prisma_migrations t WHERE NOT(migration_name=ANY(string_to_array(${ownedExtensions.join(',')},',')))`;
      if (history.length !== 1 || sha(history[0].value) !== accepted.historySha256
        || JSON.parse(history[0].value).length !== accepted.historyRows) failure('PROTECTED_HR_PRIOR_NATIVE_HISTORY_CHANGED');
      return sha(history[0].value);
    };
    const historySha256 = await inspectHistory(), snapshot = await catalogSnapshot(tx, input);
    const shape = await tx.$queryRaw<Array<{ columns: number; internalTriggers: number }>>`
      SELECT c.relnatts AS columns,(SELECT count(*)::integer FROM pg_trigger t WHERE t.tgrelid=c.oid AND t.tgisinternal) AS "internalTriggers"
      FROM pg_class c WHERE c.oid='public.driver_vehicle_assignment_plans'::regclass`;
    if (shape.length !== 1 || shape[0].columns !== 13 || shape[0].internalTriggers !== 6) failure('PROTECTED_HR_HISTORICAL_CATALOG_UNPROVEN');
    // Preserve the old v1 executor's catalog digest semantics. This stronger
    // historical predicate additionally checks constraint flags and uses the
    // fixed pretty form for source-owned finite constraint expressions.
    const constraints = await tx.$queryRaw<Array<{ name: string; definition: string; validated: boolean; deferrable: boolean; initiallyDeferred: boolean }>>`
      SELECT k.conname AS name,pg_get_constraintdef(k.oid,true) AS definition,k.convalidated AS validated,
        k.condeferrable AS deferrable,k.condeferred AS "initiallyDeferred" FROM pg_constraint k
      WHERE k.conrelid='public.driver_vehicle_assignment_plans'::regclass ORDER BY k.conname`;
    (snapshot.tables[0].details as any).constraints = constraints;
    const catalogSha256 = verifyHistoricalHrCatalog(snapshot.tables[0], identity.owner);
    await checkContext(); await inspectRow(); await inspectHistory(); assertBoundary();
    return Object.freeze({ format: 'sabalan-verified-historical-inspection/v1',
      classification: accepted.qa ? 'VERIFIED_RESTORED_QA_HISTORICAL_INSPECTION' : 'VERIFIED_HISTORICAL_INSPECTION',
      deploymentId: owner.deploymentId, releaseId: owner.releaseId, checkpointChecksum: currentCheckpoint!.checksum,
      currentCheckpoint: Object.freeze(currentCheckpoint!),
      baselineCheckpoint: Object.freeze(accepted.baselineCheckpoint),
      database: accepted.targetDatabase, migrationName: input.name, sqlSha256: input.sha256,
      originalRowSha256: rowSha256, originalLogsIsNull: true, nativeExecutionClaimed: false,
      priorHistorySha256: historySha256, priorHistoryRows: accepted.historyRows,
      ownedExtensions: ownedExtensions.sort(), catalogSha256, restoreOriginalSha256: accepted.restoreOriginalSha256,
      ...(accepted.qa ? { inspectionTarget: 'RESTORED_QA', sourceDatabase: accepted.qa.sourceDatabase,
        sourceReceiptSha256: accepted.qa.sourceReceiptSha256, nativeProofSha256: accepted.qa.nativeProofSha256,
        productionAdmission: false, independentPointHealthy: false, cleanupPending: true,
        outerOwnerPhase: 'CALLBACK_ACTIVE', restoreOriginalKind: 'PG_RESTORE_CHILD' } : {}) });
  }, { maxWait: 1000, timeout: 15000 });
}

/** Also required when discovery finds no pending work. A successful no-op
 * cannot stand in for ownership of the protected deployment operation. */
export async function assertProtectedBridgeMigrationAuthority(database: PrismaClient, inputOwner: Owner) {
  const owner = Object.freeze({ ...inputOwner }), assertBoundary = protectedBoundary(owner);
  assertBoundary();
  await database.$transaction(async tx => { await assertLease(tx, owner); assertBoundary(); }, { maxWait: 1000, timeout: 5000 });
}

/** The typed alternate baseline grants no ordinary production checkpoint. */
export async function assertRestoredQaProtectedMigrationAuthority(database:PrismaClient,inputOwner:Owner,
 baseline:import('./restoredQaMigrationBaseline').RestoredQaMigrationBaseline){
 const owner=Object.freeze({...inputOwner}),boundary=protectedBoundary(owner);boundary();
 const {assertRestoredQaMigrationLease}=await import('./restoredQaMigrationBaseline');
 await database.$transaction(async tx=>{await assertRestoredQaMigrationLease(tx,baseline,owner);boundary();},{maxWait:1000,timeout:5000});
}

/** Protected bridge only; no online/public entry point. The existing
 * coordinated checkpoint flow must first own the native control lock and have
 * advanced its exact lease through remote verification to MUTATION_STARTED.
 * This checks that authority again inside the atomic DDL/native-history TX.
 * A checkpoint flag supplied by a caller is never an admission argument.
 */
export async function applyProtectedBridgeMigration(database:PrismaClient,inputOwner:Owner,name:string,bytes:Buffer){
 return applyBoundProtectedBridgeMigration(database,inputOwner,name,bytes);
}
export async function applyRestoredQaProtectedBridgeMigration(database:PrismaClient,inputOwner:Owner,name:string,bytes:Buffer,
 baseline:import('./restoredQaMigrationBaseline').RestoredQaMigrationBaseline){
 return applyBoundProtectedBridgeMigration(database,inputOwner,name,bytes,baseline);
}
export async function verifyExistingRestoredQaProtectedBridgeMigration(database:PrismaClient,inputOwner:Owner,name:string,bytes:Buffer,
 baseline:import('./restoredQaMigrationBaseline').RestoredQaMigrationBaseline){
 return applyBoundProtectedBridgeMigration(database,inputOwner,name,bytes,baseline,true);
}
/** Read-only post-HTTP evidence for this exact live private B. No lease, DDL,
 * publication or financial grant is issued by a catalog digest. */
export async function observeRestoredQaPrivateNormalCatalog(normal:import('./restoredQaMigrationBaseline').RestoredQaPrivateNormal,
 material:import('./restoredQaWorkingMaterial').RestoredQaWorkingMaterial,inputOwner:Readonly<{deploymentId:string;releaseId:string}>){
 const {assertRestoredQaPrivateNormal}=await import('./restoredQaMigrationBaseline');
 const {withSystemRecoveryDatabaseClient}=await import('./systemRecoveryEngine');
 const view=assertRestoredQaPrivateNormal(normal,material,inputOwner),steps=view.migrationEvidence.run.steps;
 const names=['20261014140000_online_deployment_control','20261019010000_customer_semantic_barrier','20261019020000_hr_versioned_file_cleanup','20261020010000_online_realtime_completion','20261020093000_online_serving_epochs'];
 if(JSON.stringify(steps.map(s=>s.migrationName))!==JSON.stringify(names))failure('RESTORED_QA_PRIVATE_CATALOG_STEPS_UNPROVEN');
 const inputs=steps.map(step=>{
  const file=path.join('/app/prisma/migrations',step.migrationName,'migration.sql');if(fs.realpathSync(file)!==file)failure('RESTORED_QA_PRIVATE_SQL_ALIAS');
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  try{const st=fs.fstatSync(fd,{bigint:true});if(!st.isFile()||st.uid!==0n||st.nlink!==1n||(st.mode&0o022n)||st.size<1n||st.size>2n*1024n**2n)failure('RESTORED_QA_PRIVATE_SQL_UNSAFE');
   const bytes=fs.readFileSync(fd),pin=(v:fs.BigIntStats)=>[v.dev,v.ino,v.uid,v.mode,v.nlink,v.size,v.mtimeNs,v.ctimeNs].join(':');
   if(pin(st)!==pin(fs.fstatSync(fd,{bigint:true}))||pin(st)!==pin(fs.lstatSync(file,{bigint:true}))||sha(bytes)!==step.sqlSha256)failure('RESTORED_QA_PRIVATE_SQL_CHANGED');
   return compileProtectedBridgeMigration(step.migrationName,bytes);
  }finally{fs.closeSync(fd);}
 });
 const result=await withSystemRecoveryDatabaseClient(view.database.name,db=>db.$transaction(async tx=>{
  await tx.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await tx.$queryRaw`SELECT set_config('lock_timeout','250ms',true),set_config('statement_timeout','10000ms',true),set_config('search_path','public',true)`;
  const identities=await tx.$queryRaw<Array<{name:string;oid:string;systemIdentifier:string}>>`SELECT current_database() AS name,
   (SELECT oid::text FROM pg_database WHERE datname=current_database()) AS oid,(SELECT system_identifier::text FROM pg_control_system()) AS "systemIdentifier"`;
  if(JSON.stringify(identities)!==JSON.stringify([view.database]))failure('RESTORED_QA_PRIVATE_CATALOG_DATABASE_CHANGED');
  const rows=await tx.$queryRaw<Array<{value:string}>>`SELECT coalesce(json_agg(t ORDER BY migration_name,id),'[]'::json)::text AS value FROM public._prisma_migrations t`;
  if(rows.length!==1||rows[0].value!==view.migrationEvidence.historyRaw.after)failure('RESTORED_QA_PRIVATE_NATIVE_HISTORY_CHANGED');
  const catalogs:Array<Readonly<{migrationName:string;sqlSha256:string;catalogSha256:string}>>=[];for(let i=0;i<inputs.length;i++){
   assertRestoredQaPrivateNormal(normal,material,inputOwner);const actual=await catalog(tx,inputs[i]);
   if(actual!==steps[i].ownedReceipt.catalogSha256)failure('RESTORED_QA_PRIVATE_CATALOG_CHANGED');
   catalogs.push(Object.freeze({migrationName:inputs[i].name,sqlSha256:inputs[i].sha256,catalogSha256:actual}));
  }
  assertRestoredQaPrivateNormal(normal,material,inputOwner);
  return Object.freeze({format:'sabalan-restored-qa-private-normal-catalog/v1',database:view.database,catalogs:Object.freeze(catalogs),
   nativeHistorySha256:sha(rows[0].value),readOnly:true,productionAdmission:false,financialSchemaQualified:false});
 },{maxWait:1000,timeout:15000}));
 assertRestoredQaPrivateNormal(normal,material,inputOwner);return result;
}
async function applyBoundProtectedBridgeMigration(database: PrismaClient, inputOwner: Owner, name: string, bytes: Buffer,
 baseline?:import('./restoredQaMigrationBaseline').RestoredQaMigrationBaseline,mustAlreadyExist=false) {
  const owner = Object.freeze({ ...inputOwner });
  const input = compileProtectedBridgeMigration(name, bytes), assertBoundary = protectedBoundary(owner);
  assertBoundary();
  return database.$transaction(async tx => {
    const lease=()=>baseline
      ? import('./restoredQaMigrationBaseline').then(m=>m.assertRestoredQaMigrationLease(tx,baseline,owner))
      : assertLease(tx,owner);
    await tx.$queryRaw`SELECT set_config('lock_timeout','250ms',true), set_config('statement_timeout','10000ms',true),
      set_config('search_path','public',true)`;
    const [lock] = await tx.$queryRaw<Array<{ owned: boolean }>>`SELECT pg_try_advisory_xact_lock(741936426::bigint) AS owned`;
    if (!lock?.owned) failure('PROTECTED_BRIDGE_ALREADY_RUNNING');
    await lease(); assertBoundary();
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
      await lease(); assertBoundary();
      return { applied: false, checksum: input.sha256 };
    }
    if(mustAlreadyExist)failure('RESTORED_QA_COMPLETED_MIGRATION_MISSING');
    for (const statement of input.statements) { assertBoundary(); await tx.$executeRawUnsafe(statement); }
    const catalogSha256 = await catalog(tx, input);
    await lease(); assertBoundary();
    const receipt = JSON.stringify({ format: 'sabalan-protected-bridge/v1', sqlSha256: input.sha256, catalogSha256 });
    await tx.$executeRaw`INSERT INTO public._prisma_migrations (id,checksum,finished_at,migration_name,logs,started_at,applied_steps_count)
      VALUES (${randomUUID()},${input.sha256},clock_timestamp(),${input.name},${receipt},clock_timestamp(),1)`;
    assertBoundary();
    return { applied: true, checksum: input.sha256 };
  }, { maxWait: 1000, timeout: 15000 });
}
