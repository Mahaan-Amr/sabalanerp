/** Test-only, unexecuted native stage driver. Requires a separately reviewed
 * private fixture, Linux FD9 wrapper, real scoped projection and UUID DB.
 * Synthetic checkpoint data is never evidence of a production checkpoint. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
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
 const lockUrl=new URL(source);lockUrl.searchParams.set('application_name','sabalan-native-stage-lock');lockUrl.searchParams.set('connection_limit','1');
 const monitorUrl=new URL(source);monitorUrl.searchParams.set('application_name','sabalan-native-stage-monitor');monitorUrl.searchParams.set('connection_limit','1');
 const lock=new PrismaClient({datasources:{db:{url:lockUrl.toString()}}});
 const monitorClient=new PrismaClient({datasources:{db:{url:monitorUrl.toString()}}});
 let closed=false,report:unknown;
 try{
  const target=await prisma.$queryRaw<Array<{name:string;system_id:string;oid:string}>>`SELECT current_database() AS name,c.system_identifier::text AS system_id,d.oid::text AS oid FROM pg_catalog.pg_database d CROSS JOIN pg_catalog.pg_control_system() c WHERE d.datname=current_database()`;
  if(target.length!==1||target[0].name!==config.databaseName||`${target[0].system_id}:${target[0].oid}`!==config.identity)fail();
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
  let observedWait=false,waiterIdentity:string|undefined,holderPid=0;
  if(phase==='complete'){
   const result=await applyProtectedCandidatePlan(prisma,config.owner);
   if(result.applied!==13)fail();
  }else await lock.$transaction(async tx=>{
   const check=await tx.$queryRaw<Array<{name:string;system_id:string;oid:string}>>`SELECT current_database() AS name,c.system_identifier::text AS system_id,d.oid::text AS oid FROM pg_catalog.pg_database d CROSS JOIN pg_catalog.pg_control_system() c WHERE d.datname=current_database()`;
   if(check.length!==1||check[0].name!==config.databaseName||`${check[0].system_id}:${check[0].oid}`!==config.identity)fail();
   const holder=await tx.$queryRaw<Array<{pid:number;role:string}>>`SELECT pg_backend_pid()::integer AS pid,current_user AS role`;
   holderPid=holder[0]?.pid;const holderRole=holder[0]?.role;if(holder.length!==1||!Number.isSafeInteger(holderPid)||holderPid<1||typeof holderRole!=='string')fail();
   await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '2s'");
   await tx.$executeRawUnsafe(phase==='rollback'?'LOCK TABLE public._prisma_migrations IN SHARE MODE':'LOCK TABLE public.accounting_check_instrument_events IN ROW EXCLUSIVE MODE');
   let failure:any,result:any,running=true,monitorError=false;
   const monitor=(async()=>{
    while(running){
     try{
      const sample=await monitorClient.$transaction(async sampleTx=>{
       await sampleTx.$executeRawUnsafe("SET LOCAL statement_timeout = '1s'");
       return sampleTx.$queryRaw<Array<{pid:number;backend_start:string;datid:string;usename:string;query:string}>>`SELECT pid::integer,backend_start::text,datid::text,usename,query FROM pg_catalog.pg_stat_activity WHERE datname=current_database() AND application_name=${applicationName} AND wait_event_type='Lock' AND ${holderPid}::integer=ANY(pg_catalog.pg_blocking_pids(pid))`;
      },{maxWait:1000,timeout:2500});
      if(sample.length>1){monitorError=true;return;}
      if(sample.length===1){
       const row=sample[0],expectedOid=config.identity.split(':')[1];
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
   // An expired/closed holder transaction is UNKNOWN even if the applier
   // returned a plausible result. This check does not extend its deadline.
   const stillHeld=await tx.$queryRaw<Array<{pid:number}>>`SELECT pg_backend_pid()::integer AS pid`;
   if(stillHeld.length!==1||stillHeld[0].pid!==holderPid)fail();
   if(!failure||failure.code!=='P2010'||failure.meta?.code!=='55P03'||!observedWait||monitorError)fail();
  },{maxWait:5000,timeout:120000});
  closed=true;
  const after=await observe(),expectedAfter=phase==='rollback'?0:phase==='resume-fault'?1:14;
  if(after.prefixLength!==expectedAfter||after.stageComparison.state!=='SCOPED_MATCH'||after.unresolvedCatalog.length)fail();
  if(await priorHistory()!==originalHistory)fail();
  if(phase==='rollback'&&JSON.stringify(before)!==JSON.stringify(after))fail();
  const rows=await prisma.$queryRaw<Array<{total:number}>>`SELECT count(*)::integer AS total FROM public._prisma_migrations`;
  if(rows.length!==1||rows[0].total!==439+expectedAfter)fail();
  boundary();
  report={state:'OBSERVED',phase,prefix:expectedAfter,lockerClosed:closed,observedWait,waiterIdentity,holderPid,priorHistorySha256:originalHistory,database:config.databaseName,identity:config.identity,productionAdmission:false};
 }finally{
  const disconnected=await Promise.allSettled([lock.$disconnect(),monitorClient.$disconnect(),prisma.$disconnect()]);
  if(disconnected.some(result=>result.status==='rejected'))process.exitCode=1;
 }
 if(process.exitCode)fail();
 process.stdout.write(JSON.stringify(report)+'\n');
}
main().catch(()=>{process.stderr.write('NATIVE_STAGE_TEST_UNKNOWN\n');process.exitCode=1;});
