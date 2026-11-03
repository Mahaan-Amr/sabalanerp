import {spawn} from 'node:child_process';
import path from 'node:path';
import {createRequire} from 'node:module';
import type {Result} from './protectedTemporaryDatabase';

type ChildResult=Result<string>;
type Run=(args:readonly string[])=>Promise<ChildResult>;
type Endpoint=()=>Promise<Result<string>>;
/** Only own short-lived observation children. A timeout requests termination
 * of this child, then waits for close/EOF; parent crash remains UNKNOWN. */
export const runDockerObservation:Run=async args=>new Promise(resolve=>{
 let output:Buffer=Buffer.alloc(0),error:Buffer=Buffer.alloc(0),unknown=false,closed=false;
 const child=spawn('docker',[...args],{stdio:['ignore','pipe','pipe'],windowsHide:true});
 const timer=setTimeout(()=>{unknown=true;child.kill();},15000);
 const take=(old:Buffer,chunk:Buffer)=>{if(old.length+chunk.length>32768){unknown=true;return old;}return Buffer.concat([old,chunk]);};
 child.stdout.on('data',(chunk:Buffer)=>{output=take(output,chunk);});child.stderr.on('data',(chunk:Buffer)=>{error=take(error,chunk);});
 child.on('error',()=>{unknown=true;});
 child.on('close',(code,signal)=>{if(closed)return;closed=true;clearTimeout(timer);
  if(unknown||signal!==null||code===null)return resolve({state:'UNKNOWN'});
  if(code!==0||error.length)return resolve({state:'FAILURE'});
  resolve({state:'SUCCESS',value:output.toString('utf8')});
 });
});

/** Connection URL is constrained locally and never included in output. */
type EndpointStage='PG_MODULE_RESOLVED'|'CLIENT_CREATED'|'CONNECT'|'QUERY'|'END';
type EndpointStatus='SUCCESS'|'UNKNOWN'|'REFUSED'|'AUTH'|'TIMEOUT'|'MODULE_UNAVAILABLE';
export async function readLocalEndpointIdentity(raw:string,report?:(stage:EndpointStage,status:EndpointStatus)=>void,loadClient?:()=>any):Promise<Result<string>>{
 let client:any;let outcome:Result<string>={state:'UNKNOWN'};let phase:EndpointStage='PG_MODULE_RESOLVED';
 try{
  const url=new URL(raw);
  if(url.protocol!=='postgresql:'||!['localhost:55432','127.0.0.1:55432'].includes(url.host)||url.pathname!=='/sabalanerp'||url.search||url.hash)return {state:'UNKNOWN'};
  const requireRoot=createRequire(path.join(path.resolve(__dirname,'../../../..'),'backend/package.json'));
  const Client=loadClient?loadClient():requireRoot(requireRoot.resolve('pg')).Client;
  report?.('PG_MODULE_RESOLVED','SUCCESS');phase='CLIENT_CREATED';
  client=new Client({connectionString:url.toString(),connectionTimeoutMillis:5000,statement_timeout:5000,query_timeout:7000,application_name:'sabalan-protected-identity-read'});
  report?.('CLIENT_CREATED','SUCCESS');phase='CONNECT';await client.connect();report?.('CONNECT','SUCCESS');phase='QUERY';const result=await client.query('SELECT system_identifier::text AS id FROM pg_catalog.pg_control_system()');
  if(result.rows.length===1&&/^\d+$/.test(result.rows[0].id)){outcome={state:'SUCCESS',value:result.rows[0].id};report?.('QUERY','SUCCESS');}else report?.('QUERY','UNKNOWN');
 }catch(error){outcome={state:'UNKNOWN'};const code=(error as {code?:unknown})?.code;const status=phase==='PG_MODULE_RESOLVED'?'MODULE_UNAVAILABLE':code==='ECONNREFUSED'?'REFUSED':code==='28P01'?'AUTH':code==='ETIMEDOUT'?'TIMEOUT':'UNKNOWN';report?.(phase,status);}finally{if(client)try{await client.end();report?.('END','SUCCESS');}catch{outcome={state:'UNKNOWN'};report?.('END','UNKNOWN');}}
 return outcome;
}

/** Read-only observation. An equal system ID is not proof of continuous
 * identity, exclusive ownership, or authorization to create a database. */
type Stage='PS1'|'ENDPOINT'|'PS2'|'CONTAINER_QUERY';
type StageStatus='SUCCESS'|'FAILURE'|'UNKNOWN'|'MISMATCH'|'INVALID_ID';
export async function verifyLocalClusterIdentity(composeFile:string,run:Run,endpoint:Endpoint,report?:(stage:Stage,status:StageStatus)=>void):Promise<Result<{containerId:string;systemIdentifier:string}>>{
 const expected=path.resolve(process.cwd(),'docker-compose.local.yml');
 if(path.resolve(composeFile)!==expected)return {state:'UNKNOWN'};
 const psArgs=['compose','-p','sabalanerp-local','-f',expected,'ps','--no-trunc','--format','json','postgres'];
 const badId=(raw:string)=>{try{const v=JSON.parse(raw.trim());const row=Array.isArray(v)?v[0]:v;return typeof row.ID==='string'&&!/^[a-f0-9]{64}$/.test(row.ID);}catch{return false;}};
 const parse=(raw:string)=>{try{const rows=raw.trim().split(/\r?\n/).filter(Boolean).flatMap(line=>{const x=JSON.parse(line);return Array.isArray(x)?x:[x];});
  if(rows.length!==1)return null;const row=rows[0];
  return row.Project==='sabalanerp-local'&&row.Service==='postgres'&&row.State==='running'&&row.Health==='healthy'&&/^[a-f0-9]{64}$/.test(row.ID)?row.ID as string:null;
 }catch{return null;}};
 const first=await run(psArgs);if(first.state!=='SUCCESS'){report?.('PS1',first.state);return {state:'UNKNOWN'};}const id=parse(first.value);if(!id){report?.('PS1',badId(first.value)?'INVALID_ID':'MISMATCH');return {state:'UNKNOWN'};}report?.('PS1','SUCCESS');
 const host=await endpoint();if(host.state!=='SUCCESS'){report?.('ENDPOINT',host.state);return {state:'UNKNOWN'};}if(!/^\d+$/.test(host.value)){report?.('ENDPOINT','MISMATCH');return {state:'UNKNOWN'};}report?.('ENDPOINT','SUCCESS');
 const second=await run(psArgs);if(second.state!=='SUCCESS'){report?.('PS2',second.state);return {state:'UNKNOWN'};}if(parse(second.value)!==id){report?.('PS2','MISMATCH');return {state:'UNKNOWN'};}report?.('PS2','SUCCESS');
 const inside=await run(['exec',id,'sh','-c',`exec psql -X -A -t -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres -c 'SELECT system_identifier::text FROM pg_catalog.pg_control_system()'`]);
 if(inside.state!=='SUCCESS'){report?.('CONTAINER_QUERY',inside.state);return {state:'UNKNOWN'};}if(inside.value.trim()!==host.value){report?.('CONTAINER_QUERY','MISMATCH');return {state:'UNKNOWN'};}report?.('CONTAINER_QUERY','SUCCESS');
 return {state:'SUCCESS',value:{containerId:id,systemIdentifier:host.value}};
}
