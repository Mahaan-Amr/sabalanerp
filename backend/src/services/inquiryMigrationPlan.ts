import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import type { PrismaClient } from '@prisma/client';
import { readDeploymentMaintenance } from './deploymentMaintenance';
import baseline from './inquiryBaseline.json';
import { assertRuntimeControlOwnership } from './runtimeControlOwnership';
import bcrypt from 'bcryptjs';
import { sha256File } from './recoveryCrypto';

const fail = (code: string): never => { throw Object.assign(new Error(code), { code }); };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

const normalizeSql = (value: string) => value.replace(/\s+/g, ' ').trim().replace(/;$/, '').replace(/\s*([(),])\s*/g, '$1');
const canonicalObjects = (objects: typeof baseline.objects) => objects.map(row => ({...row,sql:normalizeSql(row.sql)}))
  .sort((a,b) => `${a.type}:${a.name}` < `${b.type}:${b.name}` ? -1 : `${a.type}:${a.name}` > `${b.type}:${b.name}` ? 1 : 0);
export const inquiryBaselineCreateSql = baseline.objects.map(row => row.sql+';').join('\n');
export const inquiryBaselineSchemaSha256 = hash(JSON.stringify(canonicalObjects(baseline.objects)));
export const inquiryBaselineSqlSha256 = hash(baseline.ledgerSql);
const baselineId = baseline.id;
const ledgerSql = baseline.ledgerSql;
const literal = (value: string) => `'${value.replace(/'/g, "''")}'`;

/** One bounded SQLite connection retains BEGIN IMMEDIATE across inspection,
 * identity validation and commit. Errors never print SQL or database content. */
class SqliteControl {
  private readonly child;
  private readonly lines;
  private readonly deadline;
  private waiting?: { marker: string; output: string[]; digest?: {hash: ReturnType<typeof createHash>;rows:number}; resolve: (rows: any[]) => void; reject: (error: Error) => void };
  private failure?: Error;
  private closed: Promise<void>;
  constructor(file: string, readOnly = false) {
    this.child = spawn('sqlite3', ['-batch', '-bail', '-noheader', ...(readOnly ? ['-readonly'] : []), file], { stdio: ['pipe','pipe','pipe'], windowsHide: true });
    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on('line', line => {
      const pending = this.waiting;
      if (!pending) return;
      if (line === pending.marker) {
        this.waiting = undefined;
        try { pending.resolve(pending.digest ? [{rows:pending.digest.rows,sha256:pending.digest.hash.digest('hex')}] : pending.output.map(value => JSON.parse(value))); }
        catch { pending.reject(new Error('INQUIRY_SQLITE_OUTPUT_INVALID')); }
      } else {
        if(pending.digest){pending.digest.hash.update(line+'\n');pending.digest.rows+=1;}
        else pending.output.push(line);
        if (line.length>1_000_000 || pending.output.join('').length > 1_000_000) this.abort('INQUIRY_SQLITE_OUTPUT_LIMIT');
      }
    });
    this.child.stderr.on('data', () => { /* Never expose SQL, credentials or row content. */ });
    this.child.on('error', () => this.abort('INQUIRY_SQLITE_UNAVAILABLE'));
    this.closed = new Promise(resolve => this.child.on('close', () => {
      this.abort('INQUIRY_SQLITE_CONNECTION_CLOSED'); resolve();
    }));
    this.deadline = setTimeout(() => this.abort('INQUIRY_SQLITE_DEADLINE'), 12_000);
    this.child.stdin.on('error', () => this.abort('INQUIRY_SQLITE_CONNECTION_CLOSED'));
  }
  private abort(code: string) {
    this.failure ||= new Error(code);
    this.waiting?.reject(this.failure); this.waiting = undefined;
    this.child.kill('SIGKILL');
  }
  async run(sql: string): Promise<any[]> {
    return this.command(sql,false);
  }
  async digest(sql:string):Promise<{rows:number;sha256:string}>{return (await this.command(sql,true))[0];}
  private async command(sql: string, digest: boolean): Promise<any[]> {
    if (this.failure) throw this.failure;
    if (this.waiting) fail('INQUIRY_SQLITE_CONCURRENT_COMMAND');
    const marker = `SABALAN_SQLITE_${randomUUID()}`;
    return new Promise((resolve, reject) => {
      this.waiting = { marker, output: [], ...(digest?{digest:{hash:createHash('sha256'),rows:0}}:{}), resolve, reject };
      this.child.stdin.write(`${sql}\nSELECT ${literal(marker)};\n`);
    });
  }
  async close() {
    clearTimeout(this.deadline);
    this.child.stdin.end(); await this.closed; this.lines.close();
  }
}

async function assertSchema(sqlite: SqliteControl, adopted: boolean) {
  const objects = await sqlite.run(`SELECT json_object('type',type,'name',name,'table',tbl_name,'sql',sql)
    FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name;`);
  const expected = [...baseline.objects, ...(adopted ? baseline.ledgerObjects : [])];
  if (JSON.stringify(canonicalObjects(objects)) !== JSON.stringify(canonicalObjects(expected))) fail('INQUIRY_SCHEMA_UNPROVEN');
}

async function assertHistory(sqlite: SqliteControl) {
  const rows = await sqlite.run(`SELECT json_object('id',id,'sql',sqlSha256,'schema',schemaSha256) FROM "_sabalan_inquiry_migrations";`);
  if (rows.length !== 1 || rows[0].id !== baselineId || rows[0].sql !== inquiryBaselineSqlSha256
    || rows[0].schema !== inquiryBaselineSchemaSha256) fail('INQUIRY_MIGRATION_HISTORY_UNPROVEN');
}

export type InquiryBusinessProof = Array<{table:string;rows:number;sha256:string}>;
const businessEncoding='sqlite-types-hex-bytes-ieee754-v1';
async function captureOwnedBusiness(sqlite:SqliteControl):Promise<InquiryBusinessProof>{
  const proof:InquiryBusinessProof=[];
  for(const table of baseline.objects.filter(row=>row.type==='table').map(row=>row.name).sort()){
    const columns=(await sqlite.run(`SELECT json_object('name',name) FROM pragma_table_info(${literal(table)}) ORDER BY cid;`)).map(row=>`"${row.name.replace(/"/g,'""')}"`);
    const sizes=await sqlite.run(`SELECT json_object('max',coalesce(max(${columns.map(column=>`coalesce(length(CAST(${column} AS BLOB)),0)`).join('+')}),0)) FROM "${table}";`);
    if(sizes[0].max>100000)fail('INQUIRY_BUSINESS_ROW_UNPROVEN');
    const digest=await sqlite.digest(`SELECT json_array(${columns.flatMap(column=>[`typeof(${column})`,
      `CASE typeof(${column}) WHEN 'text' THEN hex(CAST(${column} AS BLOB)) WHEN 'blob' THEN hex(${column})
       WHEN 'real' THEN hex(ieee754_to_blob(${column})) WHEN 'integer' THEN CAST(${column} AS TEXT) ELSE NULL END`]).join(',')}) FROM "${table}" ORDER BY "id" COLLATE BINARY;`);
    proof.push({table,...digest});
  }
  return proof;
}

export async function captureInquiryBusinessProof(databaseFile:string){
  if(!path.isAbsolute(databaseFile)||await fs.realpath(databaseFile)!==databaseFile)fail('INQUIRY_DATABASE_PATH_UNSAFE');
  const sqlite=new SqliteControl(databaseFile,true);
  try{
    await sqlite.run('.timeout 1000\nPRAGMA query_only=ON;\nBEGIN;');
    const history=await sqlite.run(`SELECT json_object('name',name) FROM sqlite_schema WHERE name='_sabalan_inquiry_migrations';`);
    await assertSchema(sqlite,history.length===1);if(history.length)await assertHistory(sqlite);
    const proof=await captureOwnedBusiness(sqlite);await sqlite.run('COMMIT;');return proof;
  }finally{await sqlite.close();}
}

export async function inspectInquiryBaseline(databaseFile: string) {
  const file = path.resolve(databaseFile);
  if (!path.isAbsolute(databaseFile) || await fs.realpath(file) !== file) fail('INQUIRY_DATABASE_PATH_UNSAFE');
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.nlink !== 1 || stat.size === 0) fail('INQUIRY_DATABASE_PATH_UNSAFE');
  const sqlite = new SqliteControl(file,true);
  try {
    await sqlite.run('.timeout 1000\nPRAGMA query_only=ON;\nBEGIN;');
    const existing = await sqlite.run(`SELECT json_object('name',name) FROM sqlite_schema WHERE name='_sabalan_inquiry_migrations';`);
    await assertSchema(sqlite,existing.length===1); if(existing.length)await assertHistory(sqlite);
    const integrity = await sqlite.run(`SELECT json_object('integrity',integrity_check) FROM pragma_integrity_check;`);
    if (integrity.length !== 1 || integrity[0].integrity !== 'ok') fail('INQUIRY_SQLITE_INTEGRITY_FAILED');
    const administrators = await sqlite.run(`SELECT json_object('count',count(*)) FROM "Admin";`);
    if (!administrators[0]?.count) fail('INQUIRY_BOOTSTRAP_REQUIRED');
    await sqlite.run('COMMIT;');
    return {adopted:existing.length===1,migration:baselineId,schemaSha256:inquiryBaselineSchemaSha256};
  } finally {await sqlite.close();}
}

export async function verifyInquiryBaseline(databaseFile: string) {
  const result=await inspectInquiryBaseline(databaseFile);
  if(!result.adopted)fail('INQUIRY_OWNED_MIGRATION_REQUIRED');
  return result;
}

async function applyOwnedBaseline(file: string, assertOwner: () => Promise<void>, bootstrap?: {password: string}) {
  const sqlite = new SqliteControl(file);
  try {
    await sqlite.run('.timeout 1000\nPRAGMA foreign_keys=ON;\nBEGIN IMMEDIATE;');
    const existing = await sqlite.run(`SELECT json_object('name',name) FROM sqlite_schema WHERE name='_sabalan_inquiry_migrations';`);
    await assertSchema(sqlite, existing.length === 1);
    const businessBefore=await captureOwnedBusiness(sqlite);
    if (existing.length) await assertHistory(sqlite);
    else {
      await sqlite.run(`${ledgerSql}\nINSERT INTO "_sabalan_inquiry_migrations" VALUES (${literal(baselineId)},
        ${literal(inquiryBaselineSqlSha256)},${literal(inquiryBaselineSchemaSha256)},${literal(new Date().toISOString())});`);
      await assertSchema(sqlite, true);
    }
    if(bootstrap) {
      const administrators=await sqlite.run(`SELECT json_object('count',count(*)) FROM "Admin";`);
      if(administrators[0]?.count!==0)fail('INQUIRY_SANITIZED_ADMIN_NOT_EMPTY');
      const passwordHash=await bcrypt.hash(bootstrap.password,12);
      const now=new Date().toISOString();
      await sqlite.run(`INSERT INTO "Admin" (id,email,passwordHash,createdAt,updatedAt) VALUES (
        ${literal(randomUUID())},'local-recovery-admin@example.invalid',${literal(passwordHash)},${literal(now)},${literal(now)});`);
    }
    const businessAfter=await captureOwnedBusiness(sqlite);
    if(!bootstrap && JSON.stringify(businessBefore)!==JSON.stringify(businessAfter))fail('INQUIRY_BUSINESS_DATA_CHANGED');
    if(bootstrap && (businessBefore.find(row=>row.table==='Admin')?.rows!==0 || businessBefore.find(row=>row.table==='User')?.rows!==0
      || businessAfter.find(row=>row.table==='Admin')?.rows!==1
      || JSON.stringify(businessBefore.filter(row=>row.table!=='Admin'))!==JSON.stringify(businessAfter.filter(row=>row.table!=='Admin'))))fail('INQUIRY_SANITIZED_BUSINESS_CHANGED');
    const integrity = await sqlite.run(`SELECT json_object('integrity',integrity_check) FROM pragma_integrity_check;`);
    if (integrity.length !== 1 || integrity[0].integrity !== 'ok') fail('INQUIRY_SQLITE_INTEGRITY_FAILED');
    await assertOwner();await sqlite.run('COMMIT;');
    return { adopted: !existing.length, migration: baselineId, schemaSha256: inquiryBaselineSchemaSha256,businessBefore,businessAfter };
  } finally { await sqlite.close(); }
}

/** Only the fenced recovery owner may adopt its private, validated staged copy.
 * The live database and the encrypted package are never edited here. */
export async function adoptRecoveryStagedInquiry(input: {
  databaseFile: string; operationId: string; checksum: string; bootstrapPassword?: string;
}) {
  assertRuntimeControlOwnership();
  const recoveryRoot=path.resolve(process.env.RECOVERY_STORAGE_DIR || path.join(process.cwd(),'storage','recovery'));
  const coordination=process.env.RECOVERY_COORDINATION_DIR || path.join(recoveryRoot,'coordination');
  const file=path.resolve(input.databaseFile);
  const relative=path.relative(path.join(recoveryRoot,'work'),file).split(path.sep);
  if(!/^[A-Za-z0-9_-]{1,160}$/.test(input.operationId)||!/^[a-f0-9]{64}$/.test(input.checksum)
    || relative.length!==4||!relative[0].startsWith(`restore-${input.operationId}-`)
    || relative.slice(1).join('/')!=='payload/inquiry/inquiry.db'||await fs.realpath(file)!==file)fail('INQUIRY_RECOVERY_STAGE_UNSAFE');
  const initial=await fs.lstat(file);
  if(!initial.isFile()||initial.nlink!==1||initial.size===0)fail('INQUIRY_RECOVERY_STAGE_UNSAFE');
  let sanitized=false;
  const assertOwner=async()=>{
    assertRuntimeControlOwnership();
    const journal=JSON.parse(await fs.readFile(path.join(coordination,'pending-restore.json'),'utf8'));
    if(journal.operationId!==input.operationId||journal.checksum!==input.checksum||journal.phase!=='STAGED'
      ||!['COMPLETE','SANITIZED_TEST'].includes(journal.packageType))fail('INQUIRY_RECOVERY_STAGE_NOT_OWNED');
    sanitized=journal.packageType==='SANITIZED_TEST';
    if(sanitized&&(process.env.NODE_ENV==='production'||process.env.ALLOW_SANITIZED_RECOVERY!=='true'||!input.bootstrapPassword))fail('INQUIRY_SANITIZED_BOOTSTRAP_FORBIDDEN');
    const current=await fs.lstat(file);
    if(current.dev!==initial.dev||current.ino!==initial.ino||current.nlink!==1)fail('INQUIRY_DATABASE_REPLACED');
  };
  await assertOwner();
  const source={size:initial.size,sha256:await sha256File(file)};
  const result=await applyOwnedBaseline(file,assertOwner,sanitized?{password:input.bootstrapPassword!}:undefined);
  await verifyInquiryBaseline(file);
  const target={size:(await fs.stat(file)).size,sha256:await sha256File(file)};
  return {...result,transformation:{format:'sabalan-inquiry-adoption/v1' as const,operationId:input.operationId,archiveSha256:input.checksum,
    migration:baselineId,sqlSha256:inquiryBaselineSqlSha256,schemaSha256:inquiryBaselineSchemaSha256,businessEncoding,sanitized,
    source,target,businessBefore:result.businessBefore,businessAfter:result.businessAfter}};
}

export type InquiryTransformation=Awaited<ReturnType<typeof adoptRecoveryStagedInquiry>>['transformation'];
function validBusinessProof(proof:InquiryBusinessProof){
  return Array.isArray(proof)&&JSON.stringify(proof.map(row=>row?.table))===JSON.stringify(['Admin','Product','User'])
    &&proof.every(row=>Object.keys(row).length===3&&Number.isSafeInteger(row.rows)&&row.rows>=0&&/^[a-f0-9]{64}$/.test(row.sha256));
}
export async function verifyInquiryTransformation(file:string,proof:InquiryTransformation,original?:{size:number;sha256:string},independentBusiness?:InquiryBusinessProof){
  if(proof.format!=='sabalan-inquiry-adoption/v1'||proof.migration!==baselineId||proof.sqlSha256!==inquiryBaselineSqlSha256
    ||proof.schemaSha256!==inquiryBaselineSchemaSha256||!/^\w[\w-]{0,159}$/.test(proof.operationId)||!/^[a-f0-9]{64}$/.test(proof.archiveSha256)
    ||proof.businessEncoding!==businessEncoding||typeof proof.sanitized!=='boolean'||!validBusinessProof(proof.businessBefore)||!validBusinessProof(proof.businessAfter)
    ||!proof.source||!proof.target||![proof.source,proof.target].every(value=>Number.isSafeInteger(value.size)&&value.size>0&&/^[a-f0-9]{64}$/.test(value.sha256))
    ||(original&&(original.size!==proof.source.size||original.sha256!==proof.source.sha256))
    ||(independentBusiness&&JSON.stringify(independentBusiness)!==JSON.stringify(proof.businessBefore)))fail('INQUIRY_TRANSFORMATION_UNPROVEN');
  if(!proof.sanitized&&JSON.stringify(proof.businessBefore)!==JSON.stringify(proof.businessAfter))fail('INQUIRY_TRANSFORMATION_UNPROVEN');
  if(proof.sanitized&&(process.env.NODE_ENV==='production'||process.env.ALLOW_SANITIZED_RECOVERY!=='true'
    ||proof.businessBefore.find(row=>row.table==='Admin')?.rows!==0||proof.businessBefore.find(row=>row.table==='User')?.rows!==0
    ||proof.businessAfter.find(row=>row.table==='Admin')?.rows!==1
    ||JSON.stringify(proof.businessBefore.filter(row=>row.table!=='Admin'))!==JSON.stringify(proof.businessAfter.filter(row=>row.table!=='Admin'))))fail('INQUIRY_TRANSFORMATION_UNPROVEN');
  await verifyInquiryBaseline(file);
  if((await fs.stat(file)).size!==proof.target.size||await sha256File(file)!==proof.target.sha256
    ||JSON.stringify(await captureInquiryBusinessProof(file))!==JSON.stringify(proof.businessAfter))fail('INQUIRY_TRANSFORMATION_TARGET_CHANGED');
}

export type InquiryMigrationOwner = { deploymentId: string; releaseId: string; leaseToken: string };

/** Protected-lane admission only. Online Inquiry changes need a separately
 * proven compatible manifest. The SQL ledger and its schema adopt atomically. */
export async function adoptInquiryBaseline(database: PrismaClient, owner: InquiryMigrationOwner,
  options: { databaseFile: string; coordinationDirectory: string }) {
  const file = path.resolve(options.databaseFile);
  if (!path.isAbsolute(options.databaseFile) || await fs.realpath(file) !== file) fail('INQUIRY_DATABASE_PATH_UNSAFE');
  const initial = await fs.lstat(file);
  if (!initial.isFile() || initial.nlink !== 1 || initial.size === 0) fail('INQUIRY_DATABASE_PATH_UNSAFE');
  return database.$transaction(async tx => {
    await tx.$queryRaw`SELECT set_config('lock_timeout','1000ms',true),set_config('statement_timeout','15000ms',true)`;
    const assertOwner = async () => {
      const owned = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "deployment_operations"
        WHERE "id"=${owner.deploymentId} AND "releaseId"=${owner.releaseId} AND "leaseToken"=${owner.leaseToken}
          AND "activeKey"='production' AND "phase"='MIGRATIONS_APPLIED'
          AND "leaseExpiresAt">clock_timestamp()+interval '20 seconds' FOR SHARE`;
      const maintenance = await readDeploymentMaintenance(options.coordinationDirectory);
      if (owned.length !== 1 || maintenance?.deploymentId !== owner.deploymentId || maintenance.releaseId !== owner.releaseId) fail('INQUIRY_MIGRATION_NOT_OWNED');
      const current = await fs.lstat(file);
      if (current.dev !== initial.dev || current.ino !== initial.ino || current.nlink !== 1 || current.isSymbolicLink()) fail('INQUIRY_DATABASE_REPLACED');
    };
    await assertOwner();
    return applyOwnedBaseline(file,assertOwner);
  }, { timeout: 15_000, maxWait: 1000 });
}
