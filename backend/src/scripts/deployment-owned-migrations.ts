import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { assertProtectedBridgeMigrationAuthority, compileProtectedBridgeMigration, applyProtectedBridgeMigration,
  inspectHistoricalProtectedBridgeMigration, protectedOwnedMigrationStrategyNames } from '../services/protectedBridgeMigrations';
import { openHistoricalHrRestoreAnchor, type HistoricalHrRestoreAnchor } from '../services/protectedHistoricalHrAnchor';
import type {PrismaClient} from '@prisma/client';
import type {RestoredQaHistoricalAnchor} from '../services/protectedRestoredQaHrAnchor';
import type {RestoredQaMigrationBaseline} from '../services/restoredQaMigrationBaseline';

const fail = (code: string): never => { throw Object.assign(new Error(code), { code }); };
const sha = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const hrName = '20261014120000_hr_vehicle_assignment_plans';
type NativeRow = { id: string; migration_name: string; checksum: string; started_at: string; finished_at: string | null;
  rolled_back_at: string | null; logs: string | null; applied_steps_count: number };
type Reference = { file: string; sha256: string };
type Runtime = {
  assertAuthority(): Promise<void>; readHistory(excludeNativeIds: readonly string[]): Promise<string>;
  inspectHistoricalHr(name: string, bytes: Buffer): Promise<unknown>; persistInspection(receipt: unknown): Promise<Reference>;
  assertQualifiedPending?(pending:readonly (readonly [string,Buffer])[],beforeRaw:string):Promise<unknown>;
  apply(name: string, bytes: Buffer): Promise<{ applied: boolean; checksum: string }>;
};
function nativeRows(raw: string, files: ReadonlyMap<string, Buffer>) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > 16 * 1024 * 1024) fail('PROTECTED_MIGRATION_HISTORY_INVALID');
  const rows: NativeRow[] = JSON.parse(raw), applied = new Map<string, NativeRow>(), ids = new Set<string>();
  if (!Array.isArray(rows) || rows.length > 4096) fail('PROTECTED_MIGRATION_HISTORY_INVALID');
  for (const row of rows) {
    if (!row || typeof row.id !== 'string' || !row.id || ids.has(row.id)
      || !(row.logs === null || typeof row.logs === 'string')
      || !(row.rolled_back_at === null || typeof row.rolled_back_at === 'string' && Number.isFinite(Date.parse(row.rolled_back_at)))) {
      fail('PROTECTED_MIGRATION_HISTORY_INVALID');
    }
    ids.add(row.id);
    if (row.rolled_back_at !== null) continue;
    const bytes = files.get(row.migration_name);
    if (typeof row.id !== 'string' || !row.id || !row.finished_at || !Number.isFinite(Date.parse(row.finished_at))
      || !row.started_at || !Number.isFinite(Date.parse(row.started_at)) || applied.has(row.migration_name) || !bytes
      || sha(bytes) !== row.checksum || !Number.isInteger(row.applied_steps_count) || row.applied_steps_count < 1) {
      fail('PROTECTED_MIGRATION_HISTORY_REQUIRES_INSPECTION');
    }
    applied.set(row.migration_name, row);
  }
  return { rows, applied };
}

/** The standalone entry binds the real protected adapter. Tests can exercise
 * the same ordering/refusal interface with in-memory history, without actors.
 * No environment or public endpoint can substitute that production adapter.
 */
export async function runDeploymentOwnedMigrations(files: ReadonlyMap<string, Buffer>, runtime: Runtime) {
  await runtime.assertAuthority();
  const beforeRaw = await runtime.readHistory([]), before = nativeRows(beforeRaw, files);
  const pending = [...files].filter(([name]) => !before.applied.has(name)).sort(([a], [b]) => a.localeCompare(b));
  // Compile EVERY pending file before validation executors or the first DDL.
  for (const [name, bytes] of pending) compileProtectedBridgeMigration(name, bytes);
  const financialPrerequisite=runtime.assertQualifiedPending?await runtime.assertQualifiedPending(pending,beforeRaw):undefined;
  const inspections: Reference[] = [], validated: string[] = [];
  for (const name of protectedOwnedMigrationStrategyNames.filter(value => before.applied.has(value))) {
    const row = before.applied.get(name)!;
    if (name === hrName && row.logs === null) {
      const receipt = await runtime.inspectHistoricalHr(name, files.get(name)!);
      inspections.push(await runtime.persistInspection(receipt));
    } else {
      const result = await runtime.apply(name, files.get(name)!);
      if (result.applied !== false || result.checksum !== row.checksum) fail('PROTECTED_MIGRATION_EXISTING_HISTORY_CHANGED');
    }
    validated.push(name);
  }
  const results: Array<{ migrationName: string; sqlSha256: string }> = [];
  for (const [name, bytes] of pending) {
    const result = await runtime.apply(name, bytes);
    if (result.applied !== true || result.checksum !== sha(bytes)) fail('PROTECTED_MIGRATION_PENDING_HISTORY_CHANGED');
    results.push({ migrationName: name, sqlSha256: result.checksum });
  }
  await runtime.assertAuthority();
  const afterRaw = await runtime.readHistory([]), after = nativeRows(afterRaw, files);
  const originalIds = new Set(before.rows.map(row => row.id));
  const addedRows = after.rows.filter(row => !originalIds.has(row.id));
  if (addedRows.length !== pending.length || addedRows.some(row => row.rolled_back_at !== null
    || !pending.some(([name]) => name === row.migration_name) || row.id.includes(','))) fail('PROTECTED_MIGRATION_NEW_NATIVE_ROWS_UNPROVEN');
  // Exclude only the genuine new native IDs. A prior rolled-back row can
  // legitimately share a pending name and must remain byte-exact evidence.
  const priorProjection = await runtime.readHistory(addedRows.map(row => row.id));
  if (sha(priorProjection) !== sha(beforeRaw) || after.rows.length !== before.rows.length + pending.length
    || after.applied.size !== before.applied.size + pending.length || after.applied.size !== files.size) fail('PROTECTED_MIGRATION_PRIOR_HISTORY_CHANGED');
  const steps = results.map(step => {
    const row = after.applied.get(step.migrationName)!; let receipt: any;
    try { receipt = JSON.parse(row.logs!); } catch { fail('PROTECTED_MIGRATION_COMPLETED_RECEIPT_UNPROVEN'); }
    if (receipt?.format !== 'sabalan-protected-bridge/v1' || receipt.sqlSha256 !== step.sqlSha256
      || typeof receipt.catalogSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(receipt.catalogSha256)) fail('PROTECTED_MIGRATION_COMPLETED_RECEIPT_UNPROVEN');
    return { ...step, applied: true as const, nativeRow: row, ownedReceipt: receipt };
  });
  return { format: 'sabalan-owned-protected-migration-run/v1', protectedMigrationsCompleted: true,
    ...(financialPrerequisite?{financialPrerequisite}:{}),pendingCount: pending.length, validatedAlreadyApplied: validated, historicalInspections: inspections, steps,
    history: { before: { rows: before.rows.length, appliedRows: before.applied.size, sha256: sha(beforeRaw) },
      after: { rows: after.rows.length, appliedRows: after.applied.size, sha256: sha(afterRaw) },
      priorProjectionSha256: sha(priorProjection), priorProjectionUnchanged: true } };
}

/** Fixed private adapter. No alternate authority is added to the ordinary CLI.
 * Raw native history is retained privately for the eventual HTTP proof issuer. */
export async function runRestoredQaDeploymentOwnedMigrations(files:ReadonlyMap<string,Buffer>,database:PrismaClient,
 owner:Readonly<{deploymentId:string;releaseId:string;leaseToken:string}>,anchor:RestoredQaHistoricalAnchor,
 baseline:RestoredQaMigrationBaseline){
 const {assertRestoredQaProtectedMigrationAuthority,applyRestoredQaProtectedBridgeMigration,
  inspectRestoredQaProtectedBridgeMigration}=await import('../services/protectedBridgeMigrations');
 const {compileProtectedFinancialMigrationPlan,verifyProtectedFinancialNativeRun}=await import('../services/protectedFinancialMigrationEvidence');
 const {assertRestoredQaMigrationBaseline}=await import('../services/restoredQaMigrationBaseline');
 assertRestoredQaMigrationBaseline(baseline,owner);
 const names=['20261014140000_online_deployment_control','20261019010000_customer_semantic_barrier',
  '20261019020000_hr_versioned_file_cleanup','20261020010000_online_realtime_completion','20261020093000_online_serving_epochs'];
 const plan=compileProtectedFinancialMigrationPlan(new Map(names.map(name=>{const bytes=files.get(name);if(!bytes)fail('RESTORED_QA_PENDING_SOURCE_MISSING');return[name,bytes!]as const;})));
 const history:string[]=[];
 const result=await runDeploymentOwnedMigrations(files,{
  assertAuthority:()=>assertRestoredQaProtectedMigrationAuthority(database,owner,baseline),
  async readHistory(ids){
   const rows=await database.$queryRaw<Array<{value:string}>>`SELECT coalesce(json_agg(t ORDER BY migration_name,id),'[]'::json)::text AS value
    FROM public._prisma_migrations t WHERE NOT(id=ANY(string_to_array(${ids.join(',')},',')))`;
   if(rows.length!==1)fail('PROTECTED_MIGRATION_HISTORY_INVALID');history.push(rows[0].value);return rows[0].value;
  },
  inspectHistoricalHr:(name,bytes)=>inspectRestoredQaProtectedBridgeMigration(database,owner,name,bytes,anchor,baseline),
  async persistInspection(receipt){return persistHistoricalInspection(receipt,owner);},
  apply:(name,bytes)=>applyRestoredQaProtectedBridgeMigration(database,owner,name,bytes,baseline),
 });
 if(history.length!==3)fail('RESTORED_QA_NATIVE_HISTORY_SEQUENCE_CHANGED');
 const native=verifyProtectedFinancialNativeRun(plan,result,history[0],history[1],history[2]);
 assertRestoredQaMigrationBaseline(baseline,owner);
 return Object.freeze({run:result,native,historyRaw:Object.freeze({before:history[0],after:history[1],prior:history[2]}),
  financialSchemaQualified:false as const,productionAdmission:false as const});
}

const parentPin = (s: fs.BigIntStats) => [s.dev, s.ino, s.uid, s.mode, s.nlink].map(String).join(':');
const filePin = (s: fs.BigIntStats) => [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs, s.uid, s.mode, s.nlink].map(String).join(':');
/** Append-only original evidence: extension phase changes produce new leaves.
 * Existing mutable publication helpers intentionally permit replacement, so
 * they cannot implement this exclusive immutable receipt custody contract.
 */
export function persistHistoricalInspection(receipt: any, owner: { deploymentId: string; releaseId: string },
  directory = process.env.RECOVERY_COORDINATION_DIR || '/app/recovery-coordination'): Reference {
  if (process.platform !== 'linux' || process.getuid?.() !== 0) fail('PROTECTED_MIGRATION_INSPECTION_PUBLICATION_UNPROVEN');
  validateHistoricalInspectionPublication(receipt, owner);
  const bytes = Buffer.from(JSON.stringify(canonical(receipt)) + '\n'), digest = sha(bytes);
  if (bytes.length > 1024 * 1024 || !path.isAbsolute(directory) || fs.realpathSync(directory) !== directory) fail('PROTECTED_MIGRATION_INSPECTION_DIRECTORY_UNPROVEN');
  const parent = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try {
    const initial = fs.fstatSync(parent, { bigint: true });
    if (!initial.isDirectory() || initial.uid !== 0n || (initial.mode & 0o022n) !== 0n) fail('PROTECTED_MIGRATION_INSPECTION_DIRECTORY_UNPROVEN');
    const checkParent = () => {
      if (parentPin(initial) !== parentPin(fs.fstatSync(parent, { bigint: true }))
        || parentPin(initial) !== parentPin(fs.lstatSync(directory, { bigint: true })) || fs.realpathSync(directory) !== directory) {
        fail('PROTECTED_MIGRATION_INSPECTION_DIRECTORY_CHANGED');
      }
    };
    const file = path.join(directory, `${owner.deploymentId}-historical-hr-inspection-${digest}.json`);
    checkParent(); let fd: number | undefined;
    try { fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o400); }
    catch (error: any) { if (error.code !== 'EEXIST') throw error; }
    if (fd !== undefined) { try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
    checkParent(); const reader = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    try {
      const before = fs.fstatSync(reader, { bigint: true });
      if (!before.isFile() || before.uid !== 0n || before.nlink !== 1n || (before.mode & 0o777n) !== 0o400n
        || before.size !== BigInt(bytes.length) || !fs.readFileSync(reader).equals(bytes)
        || filePin(before) !== filePin(fs.fstatSync(reader, { bigint: true }))
        || filePin(before) !== filePin(fs.lstatSync(file, { bigint: true }))) fail('PROTECTED_MIGRATION_INSPECTION_ARTIFACT_CHANGED');
      fs.fsyncSync(reader);
    } finally { fs.closeSync(reader); }
    fs.fsyncSync(parent); checkParent(); return { file, sha256: digest };
  } finally { fs.closeSync(parent); }
}

/** Data classification only, never callback/FD9/lease authority. QA partial
 * evidence cannot acquire the production historical-inspection classification.
 */
export function validateHistoricalInspectionPublication(receipt: any, owner: { deploymentId: string; releaseId: string }) {
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(owner.deploymentId)
    || !receipt || receipt.format !== 'sabalan-verified-historical-inspection/v1' || receipt.deploymentId !== owner.deploymentId
    || receipt.releaseId !== owner.releaseId || receipt.nativeExecutionClaimed !== false || receipt.originalLogsIsNull !== true
    || receipt.currentCheckpoint?.deploymentId !== owner.deploymentId || receipt.currentCheckpoint?.releaseId !== owner.releaseId
    || receipt.currentCheckpoint?.checksum !== receipt.checkpointChecksum || receipt.currentCheckpoint?.independentRestoreClaimed !== false) {
    fail('PROTECTED_MIGRATION_INSPECTION_PUBLICATION_UNPROVEN');
  }
  if (receipt.classification === 'VERIFIED_HISTORICAL_INSPECTION') {
    if (receipt.baselineCheckpoint?.independentlyRestored !== true
      || ['inspectionTarget', 'productionAdmission', 'independentPointHealthy', 'cleanupPending', 'outerOwnerPhase', 'restoreOriginalKind']
        .some(key => Object.prototype.hasOwnProperty.call(receipt, key))) fail('PROTECTED_MIGRATION_INSPECTION_PUBLICATION_UNPROVEN');
  } else if (receipt.classification === 'VERIFIED_RESTORED_QA_HISTORICAL_INSPECTION') {
    if (receipt.inspectionTarget !== 'RESTORED_QA' || receipt.baselineCheckpoint?.independentlyRestored !== false
      || receipt.productionAdmission !== false || receipt.independentPointHealthy !== false || receipt.cleanupPending !== true
      || receipt.outerOwnerPhase !== 'CALLBACK_ACTIVE' || receipt.restoreOriginalKind !== 'PG_RESTORE_CHILD'
      || !receipt.sourceDatabase || !receipt.database || JSON.stringify(canonical(receipt.sourceDatabase)) === JSON.stringify(canonical(receipt.database))
      || !/^[a-f0-9]{64}$/.test(receipt.sourceReceiptSha256) || !/^[a-f0-9]{64}$/.test(receipt.nativeProofSha256)) {
      fail('PROTECTED_MIGRATION_INSPECTION_PUBLICATION_UNPROVEN');
    }
  } else fail('PROTECTED_MIGRATION_INSPECTION_PUBLICATION_UNPROVEN');
}


/** Pure handoff validation; the CLI additionally requires a same-process trusted
 * acceptance and actual protected SQL identity/lease/checkpoint observations. */
export function validateProtectedFinancialDeploymentHandoff(input:{qualification:any;expected:{deploymentId:string;releaseId:string;sourceCommit:string;checkpointSha256:string;targetImage:string};owner:{deploymentId:string;releaseId:string};targetCommit:string;database:unknown;checkpoint:unknown;beforeRaw:string;priorRaw:string;pending:readonly (readonly [string,Buffer])[]}){
 const {expected,owner}=input,point=input.checkpoint as any;
 if(expected?.deploymentId!==owner.deploymentId||expected?.releaseId!==owner.releaseId||expected.sourceCommit!==input.targetCommit
  ||!point||point.deploymentId!==owner.deploymentId||point.releaseId!==owner.releaseId||point.localVerified!==true||point.remoteVerified!==true||point.restoreVerified!==true||point.manifestReadable!==true||point.captureMethod!=='PROTECTED_MAINTENANCE_COMPLETE'||point.compatibility?.local?.compatible!==true||point.compatibility?.remote?.compatible!==true
  ||sha(JSON.stringify(canonical(point)))!==expected.checkpointSha256||!input.qualification)fail('PROTECTED_FINANCIAL_DEPLOYMENT_PREREQUISITE_UNPROVEN');
 const qualification=input.qualification;
 if(JSON.stringify(canonical(point.sourceDatabase))!==JSON.stringify(canonical(input.database)))fail('PROTECTED_FINANCIAL_DEPLOYMENT_BASELINE_CHANGED');
 if(JSON.stringify(canonical(qualification.sourceDatabase))!==JSON.stringify(canonical(input.database))||qualification.sourceCommit!==input.targetCommit||qualification.currentExecutionImage!==expected.targetImage
  ||sha(input.priorRaw)!==sha(qualification.originalHistoryRaw))fail('PROTECTED_FINANCIAL_DEPLOYMENT_BASELINE_CHANGED');
 const before:NativeRow[]=JSON.parse(input.beforeRaw),original:NativeRow[]=JSON.parse(qualification.originalHistoryRaw),ids=new Set(original.map(r=>r.id));
 const extras=before.filter(r=>!ids.has(r.id));
 if(extras.length>5||extras.some(r=>!qualification.steps.some((s:any)=>s.migrationName===r.migration_name&&s.sqlSha256===r.checksum)||r.rolled_back_at!==null||!r.finished_at||r.applied_steps_count!==1)
  ||input.pending.some(([name,bytes])=>!qualification.steps.some((s:any)=>s.migrationName===name&&s.sqlSha256===sha(bytes)))
  ||extras.some(r=>{try{const receipt=JSON.parse(r.logs!);return !qualification.catalogs.some((c:any)=>c.migrationName===r.migration_name&&c.sqlSha256===r.checksum&&c.catalogSha256===receipt.catalogSha256&&receipt.format==='sabalan-protected-bridge/v1'&&receipt.sqlSha256===r.checksum);}catch{return true;}})
  ||qualification.steps.some((s:any)=>!input.pending.some(([name])=>name===s.migrationName)&&!extras.some(r=>r.migration_name===s.migrationName)))fail('PROTECTED_FINANCIAL_DEPLOYMENT_BASELINE_CHANGED');
 return qualification;
}

function readProtectedFinancialPrerequisite(owner:{deploymentId:string;releaseId:string}){
 const root=path.resolve(process.env.RECOVERY_COORDINATION_DIR||'/app/recovery-coordination');
 if(!/^[a-zA-Z0-9_-]{8,128}$/.test(owner.deploymentId)||fs.realpathSync(root)!==root)fail('PROTECTED_FINANCIAL_DESCRIPTOR_UNPROVEN');
 const parent=fs.lstatSync(root,{bigint:true}),file=path.join(root,`${owner.deploymentId}-protected-financial-qualification.json`);
 if(!parent.isDirectory()||parent.isSymbolicLink()||(parent.mode&0o022n)!==0n||parent.uid!==BigInt(process.getuid!()))fail('PROTECTED_FINANCIAL_DESCRIPTOR_UNPROVEN');
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{const before=fs.fstatSync(fd,{bigint:true});
  if(!before.isFile()||before.nlink!==1n||before.uid!==parent.uid||(before.mode&0o777n)!==0o400n||before.size<1n||before.size>8192n)fail('PROTECTED_FINANCIAL_DESCRIPTOR_UNPROVEN');
  const raw=fs.readFileSync(fd),after=fs.fstatSync(fd,{bigint:true}),named=fs.lstatSync(file,{bigint:true});
  for(const k of ['dev','ino','size','mtimeNs','ctimeNs','uid','mode','nlink']as const)if(before[k]!==after[k]||before[k]!==named[k])fail('PROTECTED_FINANCIAL_DESCRIPTOR_UNPROVEN');
  const d=JSON.parse(raw.toString());if(JSON.stringify(Object.keys(d).sort())!==JSON.stringify(['binding','checkpointSha256','evidenceDirectory','format','sourceSha256','targetImage'])||d.format!=='sabalan-protected-financial-migration-prerequisite/v2'||!path.isAbsolute(d.evidenceDirectory)||!['sourceSha256','checkpointSha256'].every(k=>/^[a-f0-9]{64}$/.test(d[k]))||!/^sha256:[a-f0-9]{64}$/.test(d.targetImage))fail('PROTECTED_FINANCIAL_DESCRIPTOR_UNPROVEN');
  return {descriptor:d,revalidate(){const now=readProtectedFinancialPrerequisite(owner);if(JSON.stringify(canonical(now.descriptor))!==JSON.stringify(canonical(d)))fail('PROTECTED_FINANCIAL_DESCRIPTOR_UNPROVEN');const current=fs.lstatSync(root,{bigint:true});for(const k of ['dev','ino','uid','mode']as const)if(current[k]!==parent[k])fail('PROTECTED_FINANCIAL_DESCRIPTOR_UNPROVEN');}};
 }finally{fs.closeSync(fd);}
}

async function main() {
  if (process.argv.length !== 2) fail('PROTECTED_MIGRATION_ARGUMENTS_UNSUPPORTED');
  const required = (key: string) => { const value = process.env[key]; if (!value || value.length > 256) fail('PROTECTED_MIGRATION_OWNER_REQUIRED'); return value!; };
  const owner = Object.freeze({ deploymentId: required('DEPLOYMENT_ID'), releaseId: required('DEPLOYMENT_RELEASE_ID'),
    leaseToken: required('DEPLOYMENT_LEASE_TOKEN') });
  const { prisma, disconnectDatabase } = await import('../lib/prisma');
  try {
  await assertProtectedBridgeMigrationAuthority(prisma, owner);
  const directory = path.resolve(__dirname, '../../prisma/migrations');
  const files = new Map(fs.readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => {
    if (!/^\d{14}_[a-zA-Z0-9_]+$/.test(entry.name)) fail('PROTECTED_MIGRATION_SOURCE_NAME_INVALID');
    return [entry.name, fs.readFileSync(path.join(directory, entry.name, 'migration.sql'))] as const;
  }));
  let anchor: HistoricalHrRestoreAnchor | undefined;
  const result = await runDeploymentOwnedMigrations(files, {
    assertAuthority: () => assertProtectedBridgeMigrationAuthority(prisma, owner),
    async assertQualifiedPending(pending,beforeRaw){
      const {openProtectedFinancialQualificationDirectory}=await import('../services/protectedFinancialQualificationProvenance');
      const assertVerifiedProtectedFinancialQualification:typeof import('../services/protectedFinancialQualificationProvenance').assertVerifiedProtectedFinancialQualification=(await import('../services/protectedFinancialQualificationProvenance')).assertVerifiedProtectedFinancialQualification;
      const input=readProtectedFinancialPrerequisite(owner),d=input.descriptor,trusted=openProtectedFinancialQualificationDirectory(d.evidenceDirectory,d);
      const q=trusted.qualification;assertVerifiedProtectedFinancialQualification(q);
      await assertProtectedBridgeMigrationAuthority(prisma,owner);
      const rows=await prisma.$queryRaw<Array<{checkpoint:unknown;targetCommit:string;name:string;oid:string;systemIdentifier:string}>>`SELECT "checkpointJson" AS checkpoint,"targetCommit",current_database() AS name,(SELECT oid::text FROM pg_database WHERE datname=current_database()) AS oid,(SELECT system_identifier::text FROM pg_control_system()) AS "systemIdentifier" FROM deployment_operations WHERE id=${owner.deploymentId} AND "releaseId"=${owner.releaseId} AND "leaseToken"=${owner.leaseToken} AND "activeKey"='production' AND phase='MUTATION_STARTED' AND "leaseExpiresAt">clock_timestamp()+interval '20 seconds'`;
      if(rows.length!==1)fail('PROTECTED_FINANCIAL_DEPLOYMENT_PREREQUISITE_UNPROVEN');
      const originalIds=new Set((JSON.parse(q.originalHistoryRaw)as NativeRow[]).map(r=>r.id)),extraIds=(JSON.parse(beforeRaw)as NativeRow[]).filter(r=>!originalIds.has(r.id)).map(r=>r.id);
      if(extraIds.some(id=>id.includes(',')))fail('PROTECTED_FINANCIAL_DEPLOYMENT_BASELINE_CHANGED');
      const projection=await prisma.$queryRaw<Array<{value:string}>>`SELECT coalesce(json_agg(t ORDER BY migration_name,id),'[]'::json)::text AS value FROM public._prisma_migrations t WHERE NOT(id=ANY(string_to_array(${extraIds.join(',')},',')))`;
      if(projection.length!==1)fail('PROTECTED_FINANCIAL_DEPLOYMENT_BASELINE_CHANGED');
      validateProtectedFinancialDeploymentHandoff({qualification:q,expected:{...owner,sourceCommit:rows[0].targetCommit,checkpointSha256:d.checkpointSha256,targetImage:d.targetImage},owner,targetCommit:rows[0].targetCommit,database:{name:rows[0].name,oid:rows[0].oid,systemIdentifier:rows[0].systemIdentifier},checkpoint:rows[0].checkpoint,beforeRaw,priorRaw:projection[0].value,pending});
      input.revalidate();trusted.revalidate();await assertProtectedBridgeMigrationAuthority(prisma,owner);
      return Object.freeze({format:'sabalan-current-protected-financial-preflight/v1',deploymentId:owner.deploymentId,releaseId:owner.releaseId,targetCommit:rows[0].targetCommit,
       checkpointSha256:d.checkpointSha256,targetImage:d.targetImage,sourceDatabase:q.sourceDatabase,originalHistorySha256:sha(q.originalHistoryRaw),
       certificateSha256:q.certificateSha256,bindingSha256:q.bindingSha256,evidenceInventory:trusted.evidenceInventory,
       evidenceInventorySha256:sha(JSON.stringify(canonical(trusted.evidenceInventory))),financialSchemaQualified:false,productionAdmission:false,fullOnlineAcceptancePending:true});
    },
    async readHistory(excludeNativeIds) {
      const rows = await prisma.$queryRaw<Array<{ value: string }>>`SELECT coalesce(json_agg(t ORDER BY migration_name,id),'[]'::json)::text AS value
        FROM public._prisma_migrations t WHERE NOT(id=ANY(string_to_array(${excludeNativeIds.join(',')},',')))`;
      if (rows.length !== 1) fail('PROTECTED_MIGRATION_HISTORY_INVALID'); return rows[0].value;
    },
    inspectHistoricalHr(name, bytes) {
      anchor ??= openHistoricalHrRestoreAnchor(owner);
      return inspectHistoricalProtectedBridgeMigration(prisma, owner, name, bytes, anchor);
    },
    async persistInspection(receipt) { return persistHistoricalInspection(receipt, owner); },
    apply: (name, bytes) => applyProtectedBridgeMigration(prisma, owner, name, bytes),
  });
  console.log(JSON.stringify(result));
  } finally { await disconnectDatabase(); }
}

if (require.main === module) main().catch((error: any) => {
  console.error(JSON.stringify({ ok: false, code: error?.code || 'PROTECTED_MIGRATION_FAILED' }));
  process.exitCode = 1;
});
