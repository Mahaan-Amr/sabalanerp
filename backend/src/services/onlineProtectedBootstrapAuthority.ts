/** Additional, separately signed PRIVATE HTTP preparation authority. It never
 * authorizes a business write or starts jobs while maintenance is active. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash,createPublicKey,verify} from 'node:crypto';
import {assertOriginalOnlineControllerAuthority,ONLINE_RELEASE_CONTROLLER_PUBLIC_KEY,type OnlineControllerAuthority} from './onlineReleaseControllerAuthority';
import {loadOnlineRuntimeScope} from './onlineRuntimeScope';
import {DEPLOYMENT_MAINTENANCE_FILE} from './deploymentMaintenance';
import type {PrismaClient} from '@prisma/client';

const DOMAIN='sabalan-protected-online-bootstrap/v1\n';
const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const encode=(v:unknown)=>Buffer.from(JSON.stringify(canonical(v)));
const sha=(v:Buffer)=>createHash('sha256').update(v).digest('hex');
const exact=(v:any,keys:string[])=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===keys.sort().join(',');
function required(v:unknown):asserts v{if(!v)throw Error('ONLINE_PROTECTED_BOOTSTRAP_AUTHORITY_UNPROVEN');}
const pin=(s:fs.BigIntStats)=>[s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs,s.uid,s.mode,s.nlink].map(String).join(':');
function read(file:string,mode:number){
 required(fs.realpathSync(file)===file);
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{const before=fs.fstatSync(fd,{bigint:true});
  required(before.isFile()&&before.nlink===1n&&before.size>0n&&before.size<=16384n
   &&(before.mode&0o777n)===BigInt(mode)&&before.uid===BigInt(process.getuid!()));
  const raw=fs.readFileSync(fd);required(pin(before)===pin(fs.fstatSync(fd,{bigint:true}))&&pin(before)===pin(fs.lstatSync(file,{bigint:true})));
  return{raw,pin:pin(before)};
 }finally{fs.closeSync(fd);}
}
export type ProtectedBootstrapDecision=Readonly<{format:'sabalan-protected-online-bootstrap/v1';purpose:'private-http-bootstrap';
 deploymentId:string;releaseId:string;runtimeId:string;startupDecisionSha256:string;checkpointSha256:string;maintenanceSha256:string;issuedAt:string;expiresAt:string}>;
/** Pure parser/signature verifier. It cannot mint the opaque live authority. */
export function verifyProtectedBootstrapDecision(raw:Buffer,keyRaw:Buffer,now=new Date()):ProtectedBootstrapDecision{
 required(raw.length>0&&raw.length<=16384&&keyRaw.length>0&&keyRaw.length<=4096);
 const envelope=JSON.parse(raw.toString('utf8')),v=envelope.decision;
 required(exact(envelope,['format','decision','signature'])&&envelope.format==='sabalan-signed-protected-online-bootstrap/v1'
  &&typeof envelope.signature==='string'&&/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature)
  &&exact(v,['format','purpose','deploymentId','releaseId','runtimeId','startupDecisionSha256','checkpointSha256','maintenanceSha256','issuedAt','expiresAt'])
  &&v.format==='sabalan-protected-online-bootstrap/v1'&&v.purpose==='private-http-bootstrap'
  &&[v.deploymentId,v.releaseId].every(value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{8,128}$/.test(value))
  &&[v.runtimeId,v.startupDecisionSha256,v.checkpointSha256,v.maintenanceSha256].every(value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)));
 const issued=Date.parse(v.issuedAt),expires=Date.parse(v.expiresAt);
 required(Number.isFinite(issued)&&Number.isFinite(expires)&&issued<=now.getTime()&&expires>now.getTime()
  &&expires>issued&&expires-issued<=600000&&new Date(issued).toISOString()===v.issuedAt&&new Date(expires).toISOString()===v.expiresAt);
 const key=createPublicKey(keyRaw);required(key.asymmetricKeyType==='ed25519'
  &&verify(null,Buffer.concat([Buffer.from(DOMAIN),encode(v)]),key,Buffer.from(envelope.signature,'base64')));
 return Object.freeze(v);
}
declare const protectedBrand:unique symbol;
export type ProtectedBootstrapRuntimeAuthority=Readonly<{[protectedBrand]:true}>;
type State={controller:OnlineControllerAuthority;input:NonNullable<ReturnType<typeof loadOnlineRuntimeScope>>;
 decision:ProtectedBootstrapDecision;file:string;filePin:string;maintenanceFile:string;maintenancePin:string;activated:boolean};
const authorities=new WeakMap<ProtectedBootstrapRuntimeAuthority,State>();
export const protectedBootstrapReadinessProbe=(method:string,requestPath:string)=>
 ['GET','HEAD'].includes(method)&&['/api/health','/api/ready'].includes(requestPath);
export function openProtectedBootstrapRuntimeAuthority(controller:OnlineControllerAuthority,
 expected:{deploymentId:string;checkpointSha256:string}):ProtectedBootstrapRuntimeAuthority|undefined{
 const startup=assertOriginalOnlineControllerAuthority(controller),input=loadOnlineRuntimeScope();required(input);
 const file=path.join(input.scope.nativeDirectory,'release-acceptance','protected-bootstrap.json');
 try{fs.lstatSync(file);}catch(error:any){if(error.code==='ENOENT')return undefined;throw error;}
 required(input.scope.purpose==='http'&&startup.runtimePurpose==='http'&&startup.role==='serving');
 const signed=read(file,0o400),key=fs.readFileSync(ONLINE_RELEASE_CONTROLLER_PUBLIC_KEY);
 const decision=verifyProtectedBootstrapDecision(signed.raw,key);
 const maintenanceFile=path.join(input.scope.coordinationDirectory,DEPLOYMENT_MAINTENANCE_FILE),marker=read(maintenanceFile,0o600);
 const value=JSON.parse(marker.raw.toString('utf8'));
 required(decision.startupDecisionSha256===sha(encode(startup))&&decision.runtimeId===startup.runtimeId
  &&decision.releaseId===startup.releaseId&&decision.deploymentId===expected.deploymentId
  &&decision.checkpointSha256===expected.checkpointSha256&&decision.maintenanceSha256===sha(marker.raw)
  &&value.deploymentId===expected.deploymentId&&value.releaseId===startup.releaseId);
 assertOriginalOnlineControllerAuthority(controller);
 const capability=Object.freeze({}) as ProtectedBootstrapRuntimeAuthority;
 authorities.set(capability,{controller,input,decision,file,filePin:signed.pin,maintenanceFile,maintenancePin:marker.pin,activated:false});return capability;
}
/** Only admission's SQL-verified fixed original-pipe ACTIVATE path calls this. */
export async function activateProtectedBootstrapRuntimeAuthority(capability:ProtectedBootstrapRuntimeAuthority,database:PrismaClient){
 const state=authorities.get(capability);required(state);assertProtectedBootstrapRuntimeAuthority(capability);
 const rows=await database.$queryRaw<Array<{id:string;checkpointJson:unknown}>>`SELECT r.id,d."checkpointJson" FROM online_releases r
  JOIN online_runtime_slots s ON s."releaseId"=r.id JOIN deployment_operations d ON d.id=r."deploymentId"
  JOIN online_serving_epochs e ON e."releaseId"=r.id AND e."deploymentId"=d.id
  WHERE r.id=${state.decision.releaseId} AND r.phase='SERVING' AND r."previousReleaseId" IS NULL
   AND s.id=${state.decision.runtimeId} AND s.phase='READY' AND s."stoppedAt" IS NULL
   AND d.id=${state.decision.deploymentId} AND d."releaseId"=r.id AND d."targetCommit"=r."sourceCommit"
   AND d.phase='GATES_PASSED' AND d."activeKey"='production'
   AND d."leaseExpiresAt">clock_timestamp()+interval '20 seconds' AND e.generation=1 AND e."retiredAt" IS NULL`;
 required(rows.length===1&&sha(encode(rows[0].checkpointJson))===state.decision.checkpointSha256);
 assertProtectedBootstrapRuntimeAuthority(capability);
 state.activated=true;
}
/** Denial observation only, never delivery or write admission. */
export function protectedBootstrapRealtimeSuspended(capability:ProtectedBootstrapRuntimeAuthority){
 assertProtectedBootstrapRuntimeAuthority(capability);const state=authorities.get(capability)!;
 if(!state.activated)return true;
 try{fs.lstatSync(state.maintenanceFile);return true;}catch(error:any){if(error.code==='ENOENT')return false;throw error;}
}
export function assertProtectedBootstrapRuntimeAuthority(capability:ProtectedBootstrapRuntimeAuthority){
 const state=authorities.get(capability);required(state&&loadOnlineRuntimeScope()===state.input);
 assertOriginalOnlineControllerAuthority(state.controller);required(read(state.file,0o400).pin===state.filePin);
 try{required(read(state.maintenanceFile,0o600).pin===state.maintenancePin);}
 catch(error:any){if(error.code!=='ENOENT'||!state.activated)throw error;}
 return state.decision;
}
