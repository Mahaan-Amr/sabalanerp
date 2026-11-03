import {createRequire} from 'node:module';
import type {Result,ChildRunner} from './protectedTemporaryDatabase';
import {readLocalEndpointIdentity,runDockerObservation,verifyLocalClusterIdentity} from './protectedLocalClusterIdentity';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {runProtectedPrismaBootstrap} from './protectedPrismaBootstrap';

type Cluster=Readonly<{containerId:string;systemIdentifier:string}>;
type DatabaseIdentity=Readonly<{systemIdentifier:string;databaseOid:string}>;
type Census=Readonly<{sessions:number;prepared:number}>;
type ClientLike={connect():Promise<void>;query(sql:string,values:readonly string[]):Promise<{rows:any[]}>;end():Promise<void>};
const validName=(name:string)=>/^sabalanerp_protected_[a-f0-9]{32}$/.test(name);
// Process-local only: a process crash loses this evidence and must remain UNKNOWN.
const createAttempts=new Set<string>(),setupAttempts=new Set<string>(),dropAttempts=new Set<string>();
type MutationClient={connect():Promise<void>;query(sql:string,values?:readonly string[]):Promise<{rows:any[]}>;end():Promise<void>};
const checkoutRoot=path.resolve(__dirname,'../../../..');
type TestDependencies=Readonly<{observe:(raw:string)=>Promise<Result<Cluster>>;makeClient:(url:string)=>MutationClient;
 prepare?:()=>Promise<{directory:string}>;bootstrap?:(directory:string,url:string)=>Promise<Result<'SUCCESS'|'FAILURE'>>}>;
function adminUrl(raw:string):string{
 const url=new URL(raw);
 if(url.protocol!=='postgresql:'||!['127.0.0.1:55432','localhost:55432'].includes(url.host)||url.pathname!=='/sabalanerp'||url.search||url.hash)throw Error('TEMPORARY_TARGET_UNPROVEN');
 url.pathname='/postgres';return url.toString();
}
function defaultClient(url:string):MutationClient{
 const requireRoot=createRequire(path.join(checkoutRoot,'backend/package.json'));const {Client}=requireRoot(requireRoot.resolve('pg'));
 return new Client({connectionString:url,connectionTimeoutMillis:5000,statement_timeout:5000,query_timeout:7000,application_name:'sabalan-protected-test-owner'});
}

/** Test-only lifecycle adapter. CREATE/DROP are never run on import; the
 * reviewed coordinated window must prevent another actor replacing this UUID
 * between identity verification and DROP. Unknown responses are never retried.
 * The caller must use the reviewed lifecycle and retain UNKNOWN outcomes. */
export function makeProtectedTemporaryRunner(raw:string,dependencies?:TestDependencies,report?:(code:'BOOTSTRAP_MATERIALIZATION_UNPROVEN')=>void):ChildRunner {
 const deps:TestDependencies=dependencies??{observe:observeProtectedLocalCluster,makeClient:defaultClient};
 const owned=new Map<string,{cluster:Cluster;identity:DatabaseIdentity}>();
 // Only a definitive owned setup outcome may add an entry.
 const cleanupEligible=new Set<string>();
 const same=(a:Cluster,b:Cluster)=>a.containerId===b.containerId&&a.systemIdentifier===b.systemIdentifier;
 async function admin<T>(operation:(client:MutationClient)=>Promise<Result<T>>):Promise<Result<T>>{
  let client:MutationClient|undefined,result:Result<T>={state:'UNKNOWN'};
  try{client=deps.makeClient(adminUrl(raw));await client.connect();result=await operation(client);}catch{result={state:'UNKNOWN'};}
  finally{if(client)try{await client.end();}catch{result={state:'UNKNOWN'};}}
  return result;
 }
 async function witness(name:string):Promise<Result<{cluster:Cluster;identity:DatabaseIdentity}>>{
  const current=owned.get(name);if(!current)return {state:'UNKNOWN'};
  const cluster=await deps.observe(raw);if(cluster.state!=='SUCCESS'||!same(cluster.value,current.cluster))return {state:'UNKNOWN'};
  const observed=await inspectOwnedTemporaryDatabase(raw,name,cluster.value,deps.makeClient);
  if(observed.state!=='SUCCESS'||observed.value.databaseOid!==current.identity.databaseOid||observed.value.systemIdentifier!==current.identity.systemIdentifier)return {state:'UNKNOWN'};
  return {state:'SUCCESS',value:current};
 }
 return {
  async create(name){
   if(!validName(name)||owned.has(name)||createAttempts.has(name))return {state:'UNKNOWN'};
   // Retain the tombstone even if the response or client closure is unknown.
   createAttempts.add(name);
   const before=await deps.observe(raw);if(before.state!=='SUCCESS')return {state:'UNKNOWN'};
   const made=await admin(async client=>{
    const server=await client.query('SELECT system_identifier::text AS id FROM pg_catalog.pg_control_system()');
    if(server.rows.length!==1||server.rows[0]?.id!==before.value.systemIdentifier)return {state:'UNKNOWN'};
    const existing=await client.query('SELECT oid FROM pg_catalog.pg_database WHERE datname=$1',[name]);
    if(existing.rows.length!==0)return {state:'FAILURE'};
    await client.query(`CREATE DATABASE "${name}"`);return {state:'SUCCESS',value:undefined};
   });
   if(made.state==='FAILURE')return {state:'FAILURE'};
   if(made.state!=='SUCCESS')return {state:'UNKNOWN'};
   const after=await deps.observe(raw);if(after.state!=='SUCCESS'||!same(before.value,after.value))return {state:'UNKNOWN'};
   const identity=await inspectOwnedTemporaryDatabase(raw,name,after.value,deps.makeClient);if(identity.state!=='SUCCESS')return {state:'UNKNOWN'};
   owned.set(name,{cluster:after.value,identity:identity.value});return {state:'SUCCESS',value:undefined};
  },
  async identity(name){const observed=await witness(name);return observed.state==='SUCCESS'?{state:'SUCCESS',value:`${observed.value.identity.systemIdentifier}:${observed.value.identity.databaseOid}`}:{state:'UNKNOWN'};},
  async setup(name){
   if(!validName(name)||setupAttempts.has(name)||!owned.has(name))return {state:'UNKNOWN'};
   setupAttempts.add(name);
   try{
    const before=await witness(name);if(before.state!=='SUCCESS')return {state:'UNKNOWN'};
    const root=checkoutRoot;
    const prepared=deps.prepare?await deps.prepare():await import(pathToFileURL(path.join(root,'tests/online-deployment/protected-predecessor-bootstrap.mjs')).href).then(m=>m.materializePredecessorBootstrap(root));
    const beforeSpawn=await witness(name);if(beforeSpawn.state!=='SUCCESS')return {state:'UNKNOWN'};
    const url=new URL(raw);url.pathname=`/${name}`;
    const run=await (deps.bootstrap??runProtectedPrismaBootstrap)(prepared.directory,url.toString());
    if(run.state!=='SUCCESS')return {state:'UNKNOWN'};
    const after=await witness(name);if(after.state!=='SUCCESS')return {state:'UNKNOWN'};
    const census=await inspectTemporaryDatabaseCensus(raw,name,after.value.identity,deps.makeClient);
    if(census.state!=='SUCCESS'||census.value.sessions!==0||census.value.prepared!==0)return {state:'UNKNOWN'};
    cleanupEligible.add(name);return {state:'SUCCESS',value:run.value};
   }catch(error){if((error as {message?:unknown})?.message==='BOOTSTRAP_MATERIALIZATION_UNPROVEN')report?.('BOOTSTRAP_MATERIALIZATION_UNPROVEN');return {state:'UNKNOWN'};}
  },
  async census(name){const observed=await witness(name);return observed.state==='SUCCESS'?inspectTemporaryDatabaseCensus(raw,name,observed.value.identity,deps.makeClient):{state:'UNKNOWN'};},
  async drop(name){
   if(!cleanupEligible.has(name)||dropAttempts.has(name))return {state:'UNKNOWN'};
   // Consume eligibility before any uncertain outcome, including observations.
   dropAttempts.add(name);cleanupEligible.delete(name);
   const observed=await witness(name);if(observed.state!=='SUCCESS')return {state:'UNKNOWN'};
   const census=await inspectTemporaryDatabaseCensus(raw,name,observed.value.identity,deps.makeClient);
   if(census.state!=='SUCCESS'||census.value.sessions!==0||census.value.prepared!==0)return {state:'UNKNOWN'};
   const final=await witness(name);if(final.state!=='SUCCESS')return {state:'UNKNOWN'};
   const result=await admin(async client=>{
    const check=await client.query(`SELECT c.system_identifier::text AS id,d.oid::text AS oid,
     (SELECT count(*)::integer FROM pg_catalog.pg_stat_activity a WHERE a.datid=d.oid) AS sessions,
     (SELECT count(*)::integer FROM pg_catalog.pg_prepared_xacts p WHERE p.database=d.datname) AS prepared
     FROM pg_catalog.pg_database d CROSS JOIN pg_catalog.pg_control_system() c WHERE d.datname=$1`,[name]);
    const row=check.rows[0];if(check.rows.length!==1||row?.id!==final.value.identity.systemIdentifier||row.oid!==final.value.identity.databaseOid||row.sessions!==0||row.prepared!==0)return {state:'UNKNOWN'};
    await client.query(`DROP DATABASE "${name}"`);return {state:'SUCCESS',value:undefined};
   });
   if(result.state!=='SUCCESS')return {state:'UNKNOWN'};owned.delete(name);return result;
  },
 };
}

/** A fresh observation, not a lease, global exclusion, or CREATE permission. */
export async function observeProtectedLocalCluster(raw:string):Promise<Result<Cluster>>{
 return verifyLocalClusterIdentity(path.resolve(process.cwd(),'docker-compose.local.yml'),runDockerObservation,()=>readLocalEndpointIdentity(raw));
}

/** The caller must compare the result against its own original identity and
 * independently hold the coordinated window. This function only reads. */
export async function inspectOwnedTemporaryDatabase(raw:string,name:string,cluster:Cluster,makeClient?:(url:string)=>ClientLike):Promise<Result<DatabaseIdentity>>{
 let client:ClientLike|undefined,outcome:Result<DatabaseIdentity>={state:'UNKNOWN'};
 try{
  if(!validName(name)||!cluster||!/^[a-f0-9]{64}$/.test(cluster.containerId)||!/^\d+$/.test(cluster.systemIdentifier))return outcome;
  const url=new URL(raw);
  if(url.protocol!=='postgresql:'||!['127.0.0.1:55432','localhost:55432'].includes(url.host)||url.pathname!=='/sabalanerp'||url.search||url.hash)return outcome;
  url.pathname='/postgres';
  if(makeClient)client=makeClient(url.toString());
  else {const requireRoot=createRequire(path.join(checkoutRoot,'backend/package.json'));const {Client}=requireRoot(requireRoot.resolve('pg'));
   client=new Client({connectionString:url.toString(),connectionTimeoutMillis:5000,statement_timeout:5000,query_timeout:7000,application_name:'sabalan-protected-test-identity'});}
  await client!.connect();
  const result=await client!.query(`SELECT c.system_identifier::text AS "systemIdentifier",d.oid::text AS "databaseOid"
   FROM pg_catalog.pg_database d CROSS JOIN pg_catalog.pg_control_system() c WHERE d.datname=$1`,[name]);
  const row=result.rows[0];
  if(result.rows.length===1&&row?.systemIdentifier===cluster.systemIdentifier&&/^\d+$/.test(row?.databaseOid))outcome={state:'SUCCESS',value:{systemIdentifier:row.systemIdentifier,databaseOid:row.databaseOid}};
 }catch{outcome={state:'UNKNOWN'};}finally{if(client)try{await client.end();}catch{outcome={state:'UNKNOWN'};}}
 return outcome;
}

/** Read-only pre-cleanup census. This is a snapshot and does not exclude a
 * subsequent connection; the owning window must retain its exclusion guard. */
export async function inspectTemporaryDatabaseCensus(raw:string,name:string,identity:DatabaseIdentity,makeClient?:(url:string)=>ClientLike):Promise<Result<Census>>{
 let client:ClientLike|undefined,outcome:Result<Census>={state:'UNKNOWN'};
 try{
  if(!validName(name)||!/^\d+$/.test(identity?.systemIdentifier)||!/^\d+$/.test(identity?.databaseOid))return outcome;
  const url=new URL(raw);
  if(url.protocol!=='postgresql:'||!['127.0.0.1:55432','localhost:55432'].includes(url.host)||url.pathname!=='/sabalanerp'||url.search||url.hash)return outcome;
  url.pathname='/postgres';
  if(makeClient)client=makeClient(url.toString());
  else {const requireRoot=createRequire(path.join(checkoutRoot,'backend/package.json'));const {Client}=requireRoot(requireRoot.resolve('pg'));
   client=new Client({connectionString:url.toString(),connectionTimeoutMillis:5000,statement_timeout:5000,query_timeout:7000,application_name:'sabalan-protected-test-census'});}
  await client!.connect();
  const result=await client!.query(`SELECT c.system_identifier::text AS "systemIdentifier",d.oid::text AS "databaseOid",
   (SELECT count(*)::integer FROM pg_catalog.pg_stat_activity a WHERE a.datid=d.oid) AS sessions,
   (SELECT count(*)::integer FROM pg_catalog.pg_prepared_xacts p WHERE p.database=d.datname) AS prepared
   FROM pg_catalog.pg_database d CROSS JOIN pg_catalog.pg_control_system() c WHERE d.datname=$1`,[name]);
  const row=result.rows[0];
  if(result.rows.length===1&&row?.systemIdentifier===identity.systemIdentifier&&row.databaseOid===identity.databaseOid&&Number.isSafeInteger(row.sessions)&&row.sessions>=0&&Number.isSafeInteger(row.prepared)&&row.prepared>=0)outcome={state:'SUCCESS',value:{sessions:row.sessions,prepared:row.prepared}};
 }catch{outcome={state:'UNKNOWN'};}finally{if(client)try{await client.end();}catch{outcome={state:'UNKNOWN'};}}
 return outcome;
}
