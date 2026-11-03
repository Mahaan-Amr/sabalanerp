/** Test-only, unexecuted native stage driver. Requires a separately reviewed
 * private fixture, Linux FD9 wrapper, real scoped projection and UUID DB.
 * Synthetic checkpoint data is never evidence of a production checkpoint. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { Client } from 'pg';
import { applyProtectedCandidatePlan, protectedBoundary } from '../protectedBridgeMigrations';
import { readCandidateTransactionObservation } from '../protectedCandidateTransactionObservation';
import { readProtectedMigrationSources } from '../protectedMigrationHistory';
import { exactCandidateMigrationNames } from '../protectedCandidateMigrationInventory';

type Fixture = { databaseName:string; identity:string; owner:{deploymentId:string;releaseId:string;leaseToken:string} };
const fail=():never=>{throw new Error('NATIVE_STAGE_TEST_UNKNOWN');};
async function main(){
 if(process.platform!=='linux'||process.argv.length!==4)fail();
 const [file,phase]=process.argv.slice(2);
 if(!['rollback','resume-fault','complete'].includes(phase))fail();
 const root=path.dirname(file);
 if(!/^\/app\/online-runtime-acceptance\/protected-bridge-[a-f0-9]{32}$/.test(root)||file!==root+'/configuration.json'||fs.realpathSync(file)!==file)fail();
 const stat=fs.lstatSync(file);if(!stat.isFile()||stat.nlink!==1||stat.uid!==process.getuid?.()||(stat.mode&0o077)!==0)fail();
 const config=JSON.parse(fs.readFileSync(file,'utf8')) as Fixture;
 if(!/^sabalanerp_protected_[a-f0-9]{32}$/.test(config.databaseName)||!/^\d+:\d+$/.test(config.identity))fail();
 if(process.env.RECOVERY_COORDINATION_DIR!==root+'/coordination'||process.env.BACKEND_RUNTIME_ROLE!=='control')fail();
 const source=new URL(process.env.DATABASE_URL||'');
 if(source.protocol!=='postgresql:'||source.hostname!=='postgres'||source.port!=='5432'||source.pathname!=='/sabalanerp')fail();
 const applicationName='sab-stage-'+config.databaseName.slice(-20)+'-'+phase;
 source.pathname='/'+config.databaseName;source.searchParams.set('connection_limit','2');source.searchParams.set('pool_timeout','10');source.searchParams.set('application_name',applicationName);
 const boundary=protectedBoundary(config.owner);boundary();
 const prisma=new PrismaClient({datasources:{db:{url:source.toString()}}});
 const lock=new Client({connectionString:source.toString(),connectionTimeoutMillis:5000,statement_timeout:10000,query_timeout:12000,application_name:'sabalan-native-stage-lock'});
 let connected=false,inTransaction=false,closed=false,report:unknown;
 try{
  await lock.connect();connected=true;
  const check=await lock.query(`SELECT current_database() AS name,c.system_identifier::text AS system_id,d.oid::text AS oid FROM pg_catalog.pg_database d CROSS JOIN pg_catalog.pg_control_system() c WHERE d.datname=current_database()`);
  if(check.rows.length!==1||check.rows[0].name!==config.databaseName||`${check.rows[0].system_id}:${check.rows[0].oid}`!==config.identity)fail();
  const holder=await lock.query('SELECT pg_backend_pid()::integer AS pid,current_user AS role');
  const holderPid=holder.rows[0]?.pid,holderRole=holder.rows[0]?.role;if(!Number.isSafeInteger(holderPid)||holderPid<1||typeof holderRole!=='string')fail();
  const files=readProtectedMigrationSources(path.resolve(__dirname,'../../../prisma/migrations'));
  const observe=()=>prisma.$transaction(async tx=>{boundary();const state=await readCandidateTransactionObservation(tx,config.owner,files);boundary();return state;},{maxWait:1000,timeout:15000});
  const priorHistory=async()=>{
   const rows=await prisma.$queryRaw<any[]>`SELECT id,migration_name,checksum,started_at,finished_at,rolled_back_at,logs,applied_steps_count FROM public._prisma_migrations ORDER BY id`;
   const prior=rows.filter(row=>!exactCandidateMigrationNames.includes(row.migration_name));
   if(prior.length!==439)fail();
   return createHash('sha256').update(JSON.stringify(prior)).digest('hex');
  };
  const originalHistory=await priorHistory();
  const before=await observe();
  const expectedBefore=phase==='complete'?1:0;
  if(before.prefixLength!==expectedBefore||before.stageComparison.state!=='SCOPED_MATCH'||before.unresolvedCatalog.length)fail();
  if(phase!=='complete'){
   await lock.query('BEGIN');inTransaction=true;
   await lock.query("SET LOCAL lock_timeout = '2s'");
   await lock.query(phase==='rollback'?'LOCK TABLE public._prisma_migrations IN SHARE MODE':'LOCK TABLE public.accounting_check_instrument_events IN ROW EXCLUSIVE MODE');
  }
  let failure:any,result:any,running=true,observedWait=false,monitorError=false,waiterIdentity:string|undefined;
  const monitor=phase==='complete'?Promise.resolve(): (async()=>{
   while(running){
    try{
     const sample=await lock.query(`SELECT pid::integer,backend_start::text,datid::text,usename,query FROM pg_catalog.pg_stat_activity WHERE datname=current_database() AND application_name=$1 AND wait_event_type='Lock' AND $2::integer=ANY(pg_catalog.pg_blocking_pids(pid))`,[applicationName,holderPid]);
     if(sample.rows.length>1){monitorError=true;return;}
     if(sample.rows.length===1){
      const row=sample.rows[0], expectedOid=config.identity.split(':')[1];
      if(!Number.isSafeInteger(row.pid)||row.pid===holderPid||row.datid!==expectedOid||row.usename!==holderRole||!row.backend_start){monitorError=true;return;}
      const identity=JSON.stringify([row.pid,row.backend_start,row.datid,row.usename]);
      if(waiterIdentity&&waiterIdentity!==identity){monitorError=true;return;}
      waiterIdentity=identity;
      if(phase==='rollback'?String(row.query).includes('INSERT INTO public._prisma_migrations'):String(row.query).includes('DO $install_customer_barrier$'))observedWait=true;
     }
    }catch{monitorError=true;return;}
    await new Promise(resolve=>setTimeout(resolve,20));
   }
  })();
  try{result=await applyProtectedCandidatePlan(prisma,config.owner);}catch(error){failure=error;}
  finally{running=false;await monitor;}
  // Only the exact PostgreSQL lock timeout is an expected deliberate fault.
  // Any other error, unavailable SQLSTATE, or unexpected success is UNKNOWN.
  if(phase==='complete'){if(failure||result?.applied!==13)fail();}
  else if(!failure||failure.code!=='P2010'||failure.meta?.code!=='55P03'||!observedWait||monitorError)fail();
  if(inTransaction){await lock.query('ROLLBACK');inTransaction=false;}
  await lock.end();connected=false;closed=true;
  const after=await observe(),expectedAfter=phase==='rollback'?0:phase==='resume-fault'?1:14;
  if(after.prefixLength!==expectedAfter||after.stageComparison.state!=='SCOPED_MATCH'||after.unresolvedCatalog.length)fail();
  if(await priorHistory()!==originalHistory)fail();
  if(phase==='rollback'&&JSON.stringify(before)!==JSON.stringify(after))fail();
  const rows=await prisma.$queryRaw<Array<{total:number}>>`SELECT count(*)::integer AS total FROM public._prisma_migrations`;
  if(rows.length!==1||rows[0].total!==439+expectedAfter)fail();
  boundary();
  report={state:'OBSERVED',phase,prefix:expectedAfter,lockerClosed:closed,observedWait,waiterIdentity,holderPid,priorHistorySha256:originalHistory,database:config.databaseName,identity:config.identity,productionAdmission:false};
 }finally{
  if(inTransaction)try{await lock.query('ROLLBACK');}catch{process.exitCode=1;}
  if(connected)try{await lock.end();}catch{process.exitCode=1;}
  await prisma.$disconnect();
 }
 if(process.exitCode)fail();
 process.stdout.write(JSON.stringify(report)+'\n');
}
main().catch(()=>{process.stderr.write('NATIVE_STAGE_TEST_UNKNOWN\n');process.exitCode=1;});
