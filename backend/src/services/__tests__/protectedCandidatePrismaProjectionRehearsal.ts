import path from 'node:path';
import {createRequire} from 'node:module';
import {compileExactCandidatePending,exactCandidateMigrationNames} from '../protectedCandidateMigrationInventory';
import {readProtectedMigrationSources} from '../protectedMigrationHistory';
import {compareCandidateStage} from '../protectedCandidateStageComparison';
import {observeCandidateExplicitDimensions} from '../protectedCandidateExplicitDimensions';
import {observeCandidateRelationSecurity} from '../protectedCandidateRelationSecurity';
import {runProtectedTemporaryDatabase,type ChildRunner,type Result} from './protectedTemporaryDatabase';
import {makeProtectedTemporaryRunner} from './protectedTemporaryPostgresRunner';

/** NOT RUN: source for a schema-only Prisma query/rollback rehearsal in one
 * fresh UUID DB. It deliberately does not claim native FD9, lease, checkpoint,
 * per-migration atomicity, release authority or production-data coverage. */
export async function runPrismaProjectionRehearsal(raw:string,requestedName:string):Promise<{state:'MEASURED_ROLLED_BACK'|'UNKNOWN';database:string;phase:string;prefix:number;identity?:string;baselineCount?:number}>{
 const root=path.resolve(__dirname,'../../../..'),files=readProtectedMigrationSources(path.join(root,'backend/prisma/migrations'));
 const plan=compileExactCandidatePending(exactCandidateMigrationNames.map(name=>({name,bytes:files.get(name)!})));
 const base=makeProtectedTemporaryRunner(raw);let reachedRetention=false;
 const runner:ChildRunner={...base,drop:async()=>{reachedRetention=true;return {state:'UNKNOWN'};}};
 let phase='CREATE_OR_BOOTSTRAP',prefix=0,verified=false,observedIdentity:string|undefined,baselineCount:number|undefined;
 const result=await runProtectedTemporaryDatabase(runner,async(name,identity):Promise<Result<void>>=>{
  let client:any,ok=false;
  try{
   const url=new URL(raw);
   if(!/^sabalanerp_protected_[a-f0-9]{32}$/.test(name)||!/^\d+:\d+$/.test(identity)||url.protocol!=='postgresql:'||!['localhost:55432','127.0.0.1:55432'].includes(url.host)||url.pathname!=='/sabalanerp'||url.search||url.hash)return {state:'UNKNOWN'};
   url.pathname='/'+name;url.searchParams.set('connection_limit','2');url.searchParams.set('pool_timeout','10');url.searchParams.set('application_name','sabalan-prisma-projection-'+name.slice(-12));
   const requireLocal=createRequire(path.join(root,'backend/package.json'));const {PrismaClient}=requireLocal('@prisma/client');
   client=new PrismaClient({datasources:{db:{url:url.toString()}}});
   phase='IDENTITY';
   const witness=await client.$queryRaw`SELECT current_database() AS name,c.system_identifier::text AS system_id,d.oid::text AS oid FROM pg_catalog.pg_database d CROSS JOIN pg_catalog.pg_control_system() c WHERE d.datname=current_database()`;
   if(!Array.isArray(witness)||witness.length!==1||witness[0].name!==name||`${witness[0].system_id}:${witness[0].oid}`!==identity)return {state:'UNKNOWN'};
   observedIdentity=identity;
   const baseline=await client.$queryRaw`SELECT count(*)::integer AS total,count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::integer AS finished FROM public._prisma_migrations`;
   if(!Array.isArray(baseline)||baseline.length!==1||baseline[0].total!==439||baseline[0].finished!==439)throw Error('SYNTHETIC_BASELINE_UNPROVEN');
   baselineCount=439;
   const rollback=Object.assign(new Error('SYNTHETIC_ROLLBACK'),{code:'SYNTHETIC_ROLLBACK'});
   try{
    await client.$transaction(async(tx:any)=>{
     await tx.$queryRaw`SELECT set_config('lock_timeout','250ms',true),set_config('statement_timeout','30000ms',true),set_config('search_path','public',true)`;
     const inside=await tx.$queryRaw`SELECT current_database() AS name,c.system_identifier::text AS system_id,d.oid::text AS oid FROM pg_catalog.pg_database d CROSS JOIN pg_catalog.pg_control_system() c WHERE d.datname=current_database()`;
     if(!Array.isArray(inside)||inside.length!==1||inside[0].name!==name||`${inside[0].system_id}:${inside[0].oid}`!==identity)throw Error('SYNTHETIC_TRANSACTION_IDENTITY_UNPROVEN');
     for(prefix=0;prefix<=plan.length;prefix++){
      phase='CATALOG_COMPARE';
      const catalog=await compareCandidateStage(tx,prefix);
      if(catalog.state!=='SCOPED_MATCH')throw Error('SYNTHETIC_CATALOG_UNPROVEN');
      const explicit=await observeCandidateExplicitDimensions(tx,prefix),security=await observeCandidateRelationSecurity(tx,prefix);
      if(explicit.state!=='SCOPED_MATCH'||security.state!=='SCOPED_MATCH')throw Error('SYNTHETIC_DIMENSION_UNPROVEN');
      if(prefix===plan.length)break;
      phase='SQL';for(const sql of plan[prefix].statements)await tx.$executeRawUnsafe(sql);
     }
     phase='ROLLBACK';throw rollback;
    },{maxWait:5000,timeout:15*60*1000});
   }catch(error){if(error!==rollback)throw error;}
   phase='POST_ROLLBACK';
   const after=await client.$transaction(async(tx:any)=>compareCandidateStage(tx,0));
   if(after.state!=='SCOPED_MATCH')throw Error('SYNTHETIC_ROLLBACK_UNPROVEN');
   ok=true;
  }catch{ok=false;}
  finally{if(client)try{await client.$disconnect();}catch{ok=false;phase='CLIENT_CLOSE';}}
  if(!ok)return {state:'UNKNOWN'};verified=true;phase='CENSUS_AND_RETENTION';return {state:'SUCCESS',value:undefined};
 },requestedName);
 return {state:verified&&reachedRetention?'MEASURED_ROLLED_BACK':'UNKNOWN',database:result.name,phase:verified&&reachedRetention?'ROLLED_BACK_RETAINED':phase,prefix,...(observedIdentity?{identity:observedIdentity}:{}),...(baselineCount===439?{baselineCount}: {})};
}
