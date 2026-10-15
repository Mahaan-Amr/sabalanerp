const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {execFileSync,spawn,spawnSync}=require('node:child_process');
const {once}=require('node:events');
const {createInterface}=require('node:readline');
const test=require('node:test');
const {PrismaClient}=require('@prisma/client');
const {adoptInquiryBaseline,verifyInquiryBaseline,inspectInquiryBaseline,adoptRecoveryStagedInquiry,captureInquiryBusinessProof,
  verifyInquiryTransformation,inquiryBaselineCreateSql}=require('./services/inquiryMigrationPlan.js');
const {sha256File}=require('./services/recoveryCrypto.js');
const {verifyRestoredFiles}=require('./services/deploymentRestoreEvidence.js');
const {verifyInquiryDatabase}=require('./verify-inquiry-database.cjs');

const url=new URL(process.env.INQUIRY_MIGRATION_TEST_DATABASE_URL);
assert.equal(url.hostname,'postgres');assert.match(url.pathname,/^\/sabalanerp_concurrency_[a-f0-9]{16}$/);
assert.equal(url.searchParams.get('connection_limit'),'2');
const database=new PrismaClient({datasources:{db:{url:url.toString()}}});
const owner={deploymentId:'inquiry-owned-migration-qa',releaseId:'inquiry-release-qa',leaseToken:'qa-owned-lease'};
const sql=(file,query)=>execFileSync('sqlite3',['-batch','-bail','-json',file],{input:query,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
const rows=(file,query)=>JSON.parse(sql(file,query)||'[]');
const business=file=>sql(file,`SELECT * FROM Admin ORDER BY id; SELECT * FROM Product ORDER BY id; SELECT * FROM User ORDER BY id;`);
async function fixture(work){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'sabalan-inquiry-owned-'));
  const file=path.join(root,'inquiry.db');
  const options={databaseFile:file,coordinationDirectory:root};
  try{
    sql(file,inquiryBaselineCreateSql+`\nINSERT INTO Admin VALUES('admin-qa','owner@example.invalid','PASSWORD_HASH_MUST_REMAIN',123,123);
      INSERT INTO Product VALUES('product-qa','101','سنگ سبلان','توضیح',125001,120001,'available',4.0,123,123);
      INSERT INTO User VALUES('user-qa','existing-user','USER_PASSWORD_HASH_MUST_REMAIN',123,123);`);
    await fs.writeFile(path.join(root,'deployment-maintenance.json'),JSON.stringify({...owner,activatedAt:new Date().toISOString()}));
    await database.deploymentOperation.upsert({where:{id:owner.deploymentId},create:{id:owner.deploymentId,releaseId:owner.releaseId,
      activeKey:'production',leaseToken:owner.leaseToken,targetCommit:'a'.repeat(40),owner:'inquiry-owned-qa',phase:'MIGRATIONS_APPLIED',
      leaseExpiresAt:new Date(Date.now()+600000),heartbeatAt:new Date(),startedAt:new Date()},update:{phase:'MIGRATIONS_APPLIED',leaseExpiresAt:new Date(Date.now()+600000)}});
    await work({file,root,options});
  }finally{
    assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('sabalan-inquiry-owned-'));
    await fs.rm(root,{recursive:true,force:true});
  }
}
test('actual PostgreSQL ownership and SQLite adoption preserve existing prices, identities and password hashes',{timeout:60000},async()=>fixture(async({file,root,options})=>{
  const before=business(file);
  assert.equal((await inspectInquiryBaseline(file)).adopted,false,'unchanged legacy configuration is inspected without mutation');
  await assert.rejects(()=>verifyInquiryBaseline(file),/OWNED_MIGRATION_REQUIRED/);
  await assert.rejects(()=>adoptInquiryBaseline(database,{...owner,leaseToken:'foreign'},options),/NOT_OWNED/);
  assert.equal(rows(file,"SELECT name FROM sqlite_schema WHERE name='_sabalan_inquiry_migrations'").length,0);
  await fs.rename(path.join(root,'deployment-maintenance.json'),path.join(root,'hidden-maintenance.json'));
  await assert.rejects(()=>adoptInquiryBaseline(database,owner,options),/NOT_OWNED/);
  await fs.rename(path.join(root,'hidden-maintenance.json'),path.join(root,'deployment-maintenance.json'));
  await database.deploymentOperation.update({where:{id:owner.deploymentId},data:{phase:'LEASE_ACQUIRED'}});
  await assert.rejects(()=>adoptInquiryBaseline(database,owner,options),/NOT_OWNED/);
  await database.deploymentOperation.update({where:{id:owner.deploymentId},data:{phase:'MIGRATIONS_APPLIED'}});
  assert.throws(()=>verifyInquiryDatabase(file),/SCHEMA_UNPROVEN|SNAPSHOT_UNPROVEN/);
  assert.equal((await adoptInquiryBaseline(database,owner,options)).adopted,true);
  assert.equal((await adoptInquiryBaseline(database,owner,options)).adopted,false);
  assert.equal(business(file),before);
  verifyInquiryDatabase(file);
  await verifyInquiryBaseline(file);
  assert.throws(()=>sql(file,'UPDATE _sabalan_inquiry_migrations SET sqlSha256=\'tampered\';'));
  assert.throws(()=>sql(file,'DELETE FROM _sabalan_inquiry_migrations;'));
  sql(file,'DROP INDEX Product_name_idx;');
  await assert.rejects(()=>adoptInquiryBaseline(database,owner,options),/SCHEMA_UNPROVEN/);
  assert.throws(()=>verifyInquiryDatabase(file),/SCHEMA_UNPROVEN|SNAPSHOT_UNPROVEN/);
  await assert.rejects(()=>verifyInquiryBaseline(file),/SCHEMA_UNPROVEN/);
  assert.equal(business(file),before);
}));

test('SQLite contention, unknown schema and missing/replaced files fail without schema repair or account bootstrap',{timeout:60000},async()=>{
  await fixture(async({file,options})=>{
    const before=business(file);
    const blocker=spawn('sqlite3',['-batch',file],{stdio:['pipe','pipe','pipe']});
    const lines=createInterface({input:blocker.stdout});
    try{
      const ready=once(lines,'line');blocker.stdin.write("BEGIN IMMEDIATE;SELECT 'OWNED';\n");await ready;
      const start=Date.now();await assert.rejects(()=>adoptInquiryBaseline(database,owner,options),/CONNECTION_CLOSED/);
      assert.ok(Date.now()-start<5000,'a writer lock must not create an unbounded deployment pause');
    }finally{lines.close();const exited=once(blocker,'exit');blocker.stdin.end('ROLLBACK;\n');await exited;}
    assert.equal(rows(file,"SELECT name FROM sqlite_schema WHERE name='_sabalan_inquiry_migrations'").length,0);
    assert.equal(business(file),before);
    sql(file,'CREATE TABLE unproven_data(id TEXT);');
    await assert.rejects(()=>adoptInquiryBaseline(database,owner,options),/SCHEMA_UNPROVEN/);
    assert.equal(rows(file,"SELECT name FROM sqlite_schema WHERE name='_sabalan_inquiry_migrations'").length,0);
    await assert.rejects(()=>adoptInquiryBaseline(database,owner,{...options,databaseFile:file+'.missing'}),{code:'ENOENT'});
    assert.throws(()=>verifyInquiryDatabase(file+'.missing'),{code:'ENOENT'});
    await assert.rejects(()=>fs.stat(file+'.missing'),{code:'ENOENT'});
  });
  await fixture(async({file,options})=>{
    await adoptInquiryBaseline(database,owner,options);
    sql(file,'DELETE FROM Admin;');assert.throws(()=>verifyInquiryDatabase(file),/BOOTSTRAP_REQUIRED/);
    assert.equal(rows(file,'SELECT * FROM Admin').length,0);
  });
});
test('complete typed business hashes distinguish text after NUL and close floating-point values',{timeout:30000},async()=>fixture(async({file})=>{
  sql(file,"UPDATE Product SET description=CAST(X'73616d65006669727374' AS TEXT),lastDiscountPercent=1.0000000000000002;");
  const first=await captureInquiryBusinessProof(file);
  sql(file,"UPDATE Product SET description=CAST(X'73616d65007365636f6e64' AS TEXT);");
  const second=await captureInquiryBusinessProof(file);
  assert.notEqual(first.find(row=>row.table==='Product').sha256,second.find(row=>row.table==='Product').sha256);
  sql(file,'UPDATE Product SET lastDiscountPercent=1.0000000000000004;');
  const third=await captureInquiryBusinessProof(file);
  assert.notEqual(second.find(row=>row.table==='Product').sha256,third.find(row=>row.table==='Product').sha256);
  assert.equal(first.find(row=>row.table==='Admin').sha256,third.find(row=>row.table==='Admin').sha256);
}));
test('a fenced restore owner adopts its private pre-adoption stage before the new read-only startup, leaving source data intact',{timeout:60000},async()=>fixture(async({file,root})=>{
  const recovery=path.join(root,'recovery'),coordination=path.join(root,'coordination');
  const operationId='qa-old-checkpoint',checksum='d'.repeat(64);
  const stage=path.join(recovery,'work','restore-'+operationId+'-owned','payload','inquiry','inquiry.db');
  await fs.mkdir(path.dirname(stage),{recursive:true});await fs.mkdir(coordination);
  sql(file,`.backup '${stage}'`);
  const original=business(file);
  const originalComponent={size:(await fs.stat(stage)).size,sha256:await sha256File(stage)};
  const originalProof=await captureInquiryBusinessProof(file);
  const input={databaseFile:stage,operationId,checksum};
  await assert.rejects(()=>adoptRecoveryStagedInquiry(input),/OWNERSHIP_REQUIRED/);
  const source=`require(${JSON.stringify(path.join(__dirname,'services/inquiryMigrationPlan.js'))}).adoptRecoveryStagedInquiry(${JSON.stringify(input)})
    .then(result=>console.log(JSON.stringify(result))).catch(()=>{console.error('STAGED_ADOPTION_FAILED');process.exitCode=1;});`;
  const env={...process.env,NODE_ENV:'test',BACKEND_RUNTIME_ROLE:'control',RECOVERY_STORAGE_DIR:recovery,RECOVERY_COORDINATION_DIR:coordination};
  delete env.BACKEND_CONTROL_LOCK_FD;delete env.BACKEND_CONTROL_LOCK_FILE;
  const launch=()=>spawnSync('sh',[path.join(__dirname,'with-backend-control-ownership.sh'),process.execPath,'-e',source],{env,encoding:'utf8',timeout:15000});
  await fs.writeFile(path.join(coordination,'pending-restore.json'),JSON.stringify({operationId,checksum:'e'.repeat(64),phase:'STAGED',packageType:'COMPLETE'}));
  assert.equal(launch().status,1,'a held kernel lock cannot adopt another restore journal');
  assert.equal(rows(stage,"SELECT name FROM sqlite_schema WHERE name='_sabalan_inquiry_migrations'").length,0);
  await fs.writeFile(path.join(coordination,'pending-restore.json'),JSON.stringify({operationId,checksum,phase:'STAGED',packageType:'COMPLETE'}));
  const adopted=launch();assert.equal(adopted.status,0,adopted.stderr);assert.equal(JSON.parse(adopted.stdout).adopted,true);
  const transformation=JSON.parse(adopted.stdout).transformation;
  await verifyInquiryTransformation(stage,transformation,originalComponent,originalProof);
  const mappings=[{payloadPath:'inquiry',livePath:path.dirname(stage)}];
  await assert.rejects(()=>verifyRestoredFiles([{path:'inquiry/inquiry.db',...originalComponent}],mappings),/FILE_MISMATCH/);
  assert.equal((await verifyRestoredFiles([{path:'inquiry/inquiry.db',...transformation.target}],mappings)).files,1);
  await assert.rejects(()=>verifyInquiryTransformation(stage,transformation,{...originalComponent,sha256:'0'.repeat(64)},originalProof),/TRANSFORMATION_UNPROVEN/);
  assert.equal(JSON.parse(launch().stdout).adopted,false);
  assert.equal(business(stage),original);assert.equal(business(file),original);
  assert.equal(rows(file,"SELECT name FROM sqlite_schema WHERE name='_sabalan_inquiry_migrations'").length,0);
  const start=spawnSync(process.execPath,['verify-inquiry-database.cjs'],{cwd:__dirname,env:{...process.env,DATABASE_URL:'file:'+stage},encoding:'utf8'});
  assert.equal(start.status,0,start.stderr);assert.match(start.stdout,/DATABASE_VERIFIED/);
  const missing=stage+'.missing';
  const absent=spawnSync(process.execPath,['verify-inquiry-database.cjs'],{cwd:__dirname,env:{...process.env,DATABASE_URL:'file:'+missing},encoding:'utf8'});
  assert.equal(absent.status,1);await assert.rejects(()=>fs.stat(missing),{code:'ENOENT'});
  sql(stage,"UPDATE Product SET finalPrice=120002 WHERE id='product-qa';");
  await assert.rejects(()=>verifyInquiryTransformation(stage,transformation,originalComponent,originalProof),/TARGET_CHANGED/);
  const sanitizedFile=path.join(recovery,'work','restore-'+operationId+'-sanitized','payload','inquiry','inquiry.db');
  await fs.mkdir(path.dirname(sanitizedFile),{recursive:true});sql(file,`.backup '${sanitizedFile}'`);
  sql(sanitizedFile,'DELETE FROM Admin;DELETE FROM User;');
  await fs.writeFile(path.join(coordination,'pending-restore.json'),JSON.stringify({operationId,checksum,phase:'STAGED',packageType:'SANITIZED_TEST'}));
  const temporaryPassword='local-only-qa-temporary-password';
  const sanitizedSource=`require(${JSON.stringify(path.join(__dirname,'services/inquiryMigrationPlan.js'))}).adoptRecoveryStagedInquiry(${JSON.stringify({...input,databaseFile:sanitizedFile,bootstrapPassword:temporaryPassword})})
    .then(result=>console.log(JSON.stringify(result))).catch(()=>{console.error('STAGED_ADOPTION_FAILED');process.exitCode=1;});`;
  const sanitizedLaunch=nodeEnv=>spawnSync('sh',[path.join(__dirname,'with-backend-control-ownership.sh'),process.execPath,'-e',sanitizedSource],
    {env:{...env,NODE_ENV:nodeEnv,ALLOW_SANITIZED_RECOVERY:'true'},encoding:'utf8',timeout:15000});
  assert.equal(sanitizedLaunch('production').status,1,'sanitized bootstrap remains forbidden in production');
  assert.equal(rows(sanitizedFile,'SELECT * FROM Admin').length,0);
  const sanitizedResult=sanitizedLaunch('test');assert.equal(sanitizedResult.status,0,sanitizedResult.stderr);
  const administrators=rows(sanitizedFile,'SELECT * FROM Admin');assert.equal(administrators.length,1);
  assert.equal(administrators[0].email,'local-recovery-admin@example.invalid');
  assert.equal(await require('bcryptjs').compare(temporaryPassword,administrators[0].passwordHash),true);
  verifyInquiryDatabase(sanitizedFile);
  assert.equal(business(file),original);
}));
test.after(async()=>{await database.$disconnect();});
