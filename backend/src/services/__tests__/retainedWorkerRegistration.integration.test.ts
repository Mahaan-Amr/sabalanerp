import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {createTemporaryConcurrencyDatabase,assertSabalanerpLocalPostgresTarget} from './shipmentStatementConcurrency/database';

test('real local PostgreSQL retained-worker race and Linux file custody preserve old slots and native migration history',
 {skip:!process.env.ONLINE_DEPLOYMENT_TEST_DATABASE_URL,timeout:300000},async()=>{
  const repositoryRoot=path.resolve(process.cwd(),'..'),canonical=process.env.SABALAN_LOCAL_REPOSITORY_ROOT||repositoryRoot;
  const ps=()=>{
   const output=execFileSync('docker',['compose','-f',path.join(canonical,'docker-compose.local.yml'),'ps','--format','json'],{cwd:canonical,encoding:'utf8'});
   assertSabalanerpLocalPostgresTarget(output);const rows=output.trim().split(/\r?\n/).flatMap(line=>{const value=JSON.parse(line);return Array.isArray(value)?value:[value];});
   assert.ok(rows.some(row=>row.Project==='sabalanerp-local'&&row.Service==='backend-candidate'&&row.State==='running'&&row.Health==='healthy'));
  };
  ps();
  const temporary=await createTemporaryConcurrencyDatabase({repositoryRoot,sourceDatabaseUrl:process.env.ONLINE_DEPLOYMENT_TEST_DATABASE_URL!,migrateEmptySchema:true});
  try{
   const esbuild=createRequire(path.join(repositoryRoot,'backend/package.json'))('esbuild');
   const build=await esbuild.build({entryPoints:[path.join(repositoryRoot,'backend/src/services/__tests__/retainedWorkerRegistration.native.fixture.ts')],bundle:true,write:false,platform:'node',format:'cjs',target:'node18',external:['@prisma/client'],plugins:[{name:'explicit-local-fixture-evidence',setup(builder:any){builder.onResolve({filter:/onlineReleaseEvidence$/},()=>({path:'fixture-evidence',namespace:'local-fixture'}));builder.onLoad({filter:/.*/,namespace:'local-fixture'},()=>({contents:'export function readOnlineReleaseEvidence(){return {...globalThis.__retainedWorkerFixtureEvidence,revalidate(){if(!globalThis.__retainedWorkerFixtureEvidence)throw Error("FIXTURE_NOT_ENROLLED")}}}',loader:'js'}));}}]});
   const url=new URL(temporary.databaseUrl);url.hostname='postgres';url.port='5432';url.searchParams.set('connection_limit','2');url.searchParams.set('pool_timeout','10');
   const bootstrap="const fs=require('node:fs'),Module=require('node:module');const p=JSON.parse(fs.readFileSync(0,'utf8'));const coordination=fs.mkdtempSync('/tmp/retained-worker-coordination-');process.env.RECOVERY_COORDINATION_DIR=coordination;const m=new Module('/app/isolated-retained-worker-fixture.cjs');m.filename='/app/isolated-retained-worker-fixture.cjs';m.paths=Module._nodeModulePaths('/app');m._compile(p.bundle,m.filename);m.exports.run(p).then(v=>process.stdout.write(JSON.stringify(v)),e=>{process.stderr.write(JSON.stringify({fixtureFailed:true,name:e.name,code:e.code??null,stage:e.fixtureStage??null,nativeStatus:e.nativeStatus??null}));process.exitCode=1}).finally(()=>fs.rmSync(coordination,{recursive:true,force:true}));";
   const migrations=path.join(repositoryRoot,'backend/prisma/migrations'),catalog=fs.readdirSync(migrations,{withFileTypes:true}).filter(row=>row.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name)).map(row=>{assert.match(row.name,/^[0-9]{14}_[A-Za-z0-9_]+$/);const file=path.join(migrations,row.name,'migration.sql');assert.equal(fs.lstatSync(file).isFile(),true);assert.ok(fs.statSync(file).size<=1024*1024);return {name:row.name,sql:fs.readFileSync(file,'utf8')};});
   const payload={bundle:build.outputFiles[0].text,databaseUrl:url.toString(),schema:fs.readFileSync(path.join(repositoryRoot,'backend/prisma/schema.prisma'),'utf8'),catalog,migrationLock:fs.readFileSync(path.join(migrations,'migration_lock.toml'),'utf8')};assert.ok(Buffer.byteLength(JSON.stringify(payload))<=32*1024*1024);
   ps();
   const output=execFileSync('docker',['compose','-f',path.join(canonical,'docker-compose.local.yml'),'exec','-T','--user','0','backend-candidate','node','-e',bootstrap],{cwd:canonical,input:JSON.stringify(payload),encoding:'utf8',maxBuffer:2*1024*1024});
   const result=JSON.parse(output.trim());assert.equal(result.passed,true);assert.equal(result.productionAdmission,false);assert.equal(result.concurrentWinners,1);assert.equal(result.realLinuxWorkerPins,true);assert.equal(result.migrationHistoryUnchanged,true);assert.equal(result.oldCatalogIdentityDiffers,true);assert.equal(typeof result.oldPrismaAcceptedDatabaseAhead,'boolean');assert.equal(result.currentCatalogPassed,true);assert.equal(result.statusDidNotRewriteMigrationHistory,true);
   console.log(JSON.stringify(result));ps();
  }finally{await temporary.cleanup();}
 });
