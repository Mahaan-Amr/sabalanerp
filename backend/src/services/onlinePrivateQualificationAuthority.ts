import fs from 'node:fs';
import path from 'node:path';
import {createHash,createPublicKey,verify} from 'node:crypto';
import type {PrismaClient} from '@prisma/client';
import {loadOnlineRuntimeScope} from './onlineRuntimeScope';
import {applicationRuntimeDatabaseUrl} from './runtimeNativeAuthority';
import {writableTrustKeyAliases} from './onlineTrustMountPaths';
import {parseOnlineHttpIngress,assertOnlineHttpIngressAssigned,type OnlineHttpIngress} from './onlinePrivateIngress';
import {canonicalRealtimeTargets,type RealtimeTarget} from './onlineRealtimeBridgeIdentity';
import type {OnlineRetainedRoot} from './onlineReleaseEvidence';

export const ONLINE_PRIVATE_QUALIFICATION_PUBLIC_KEY='/run/sabalan-online/qualification-controller-public-key.pem';
const DOMAIN='sabalan-online-private-qualification/v1\n';
const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const exact=(v:any,keys:string[])=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.prototype.hasOwnProperty.call(v,k));
const hex=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const pin=(v:fs.BigIntStats)=>[v.dev,v.ino,v.size,v.mtimeNs,v.ctimeNs,v.uid,v.mode,v.nlink].map(String).join(':');
function fail():never{throw Error('ONLINE_PRIVATE_QUALIFICATION_UNPROVEN');}
type Db=Readonly<{name:string;systemIdentifier:string;oid:string}>;
const validDb=(v:any)=>exact(v,['name','systemIdentifier','oid'])&&typeof v.name==='string'&&/^[A-Za-z0-9_]{1,63}$/.test(v.name)&&/^[1-9][0-9]*$/.test(v.systemIdentifier)&&/^[1-9][0-9]*$/.test(v.oid);
type Input=NonNullable<ReturnType<typeof loadOnlineRuntimeScope>>;
export type OnlinePrivateQualificationDecision=Readonly<{
 format:'sabalan-online-private-qualification-decision/v1';purpose:'private-qualification';
 qualificationId:string;scopeSha256:string;runtimeId:string;nonceSha256:string;runtimePurpose:'http'|'jobs';
 role:'serving'|'control';releaseId:string;image:string;sourceCommit:string;runtimeBundleSha256:string;
 artifactsSha256:string;restoreManifestSha256:string;database:Db;sourceDatabase:Db;
 httpIngress:OnlineHttpIngress|null;issuedAt:string;expiresAt:string;
}>;
export type OnlinePrivateQualificationArtifacts=Readonly<{
 format:'sabalan-online-private-qualification-artifacts/v1';qualificationId:string;releaseId:string;
 image:string;sourceCommit:string;runtimeBundleSha256:string;generation:number;database:Db;
 restoreManifestSha256:string;qualificationRoot:string;targetsSha256:string;targets:readonly (RealtimeTarget & {scopeSha256:string})[];roots:readonly OnlineRetainedRoot[];ephemeralRoots:readonly string[];
}>;

/** Data-only verification cannot mint any admission/composition capability. */
export function verifyOnlinePrivateQualificationDecision(bytes:Buffer,keyBytes:Buffer,now=new Date()):OnlinePrivateQualificationDecision{
 if(!bytes.length||bytes.length>16384||!keyBytes.length||keyBytes.length>4096)fail();
 if(!/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----\r?\n?$/.test(keyBytes.toString('ascii')))fail();
 const envelope=JSON.parse(bytes.toString('utf8'));
 if(!exact(envelope,['format','decision','signature'])||envelope.format!=='sabalan-signed-online-private-qualification/v1'
  ||typeof envelope.signature!=='string'||!/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature)
  ||Buffer.from(envelope.signature,'base64').toString('base64')!==envelope.signature)fail();
 const v=envelope.decision;
 if(!exact(v,['format','purpose','qualificationId','scopeSha256','runtimeId','nonceSha256','runtimePurpose','role','releaseId','image','sourceCommit','runtimeBundleSha256','artifactsSha256','restoreManifestSha256','database','sourceDatabase','httpIngress','issuedAt','expiresAt'])
  ||v.format!=='sabalan-online-private-qualification-decision/v1'||v.purpose!=='private-qualification'
  ||![v.qualificationId,v.scopeSha256,v.runtimeId,v.nonceSha256,v.runtimeBundleSha256,v.artifactsSha256,v.restoreManifestSha256].every(hex)
  ||!((v.runtimePurpose==='http'&&v.role==='serving')||(v.runtimePurpose==='jobs'&&v.role==='control'))
  ||typeof v.releaseId!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(v.releaseId)||!/^sha256:[a-f0-9]{64}$/.test(v.image)
  ||!/^[a-f0-9]{40}$/.test(v.sourceCommit)||!validDb(v.database)||!validDb(v.sourceDatabase)
  ||JSON.stringify(canonical(v.database))===JSON.stringify(canonical(v.sourceDatabase)))fail();
 if(v.runtimePurpose==='http')v.httpIngress=parseOnlineHttpIngress(v.httpIngress);else if(v.httpIngress!==null)fail();
 const issued=Date.parse(v.issuedAt),expires=Date.parse(v.expiresAt),current=now.getTime();
 if(!Number.isFinite(issued)||!Number.isFinite(expires)||!Number.isFinite(current)
  ||new Date(issued).toISOString()!==v.issuedAt||new Date(expires).toISOString()!==v.expiresAt
  ||issued>current||expires<=current||expires<=issued||expires-issued>600_000)fail();
 const key=createPublicKey(keyBytes);
 if(key.asymmetricKeyType!=='ed25519'||!verify(null,Buffer.concat([Buffer.from(DOMAIN),Buffer.from(JSON.stringify(canonical(v)))]),key,Buffer.from(envelope.signature,'base64')))fail();
 Object.freeze(v.database);Object.freeze(v.sourceDatabase);return Object.freeze(v);
}

function read(file: string, maximum: number, mode: number) {
  if (fs.realpathSync(file) !== file) fail();
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const before = fs.fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.size < 1n || before.size > BigInt(maximum)
      || (before.mode & 0o777n) !== BigInt(mode)) fail();
    const bytes = Buffer.alloc(Number(before.size)); let offset = 0;
    while (offset < bytes.length) { const count = fs.readSync(fd, bytes, offset, bytes.length - offset, null); if (!count) fail(); offset += count; }
    if (fs.readSync(fd, Buffer.alloc(1), 0, 1, null) !== 0 || pin(before) !== pin(fs.fstatSync(fd, { bigint: true }))
      || pin(before) !== pin(fs.lstatSync(file, { bigint: true }))) fail();
    return { bytes, identity: pin(before), uid: before.uid, stat: before,
      mountId: fs.readFileSync(`/proc/self/fdinfo/${fd}`, 'utf8').match(/^mnt_id:\s+([0-9]+)$/m)?.[1] };
  } finally { fs.closeSync(fd); }
}
/** Bounded digest revalidation does not allocate an entire restore inventory. */
function readDigest(file:string,maximum:number){
 if(fs.realpathSync(file)!==file)fail();
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{
  const before=fs.fstatSync(fd,{bigint:true});
  if(!before.isFile()||before.nlink!==1n||before.size<1n||before.size>BigInt(maximum)
   ||(before.mode&0o777n)!==0o400n||before.uid!==BigInt(process.getuid!()))fail();
  const hash=createHash('sha256'),buffer=Buffer.alloc(256*1024);let total=0;
  for(;;){const count=fs.readSync(fd,buffer,0,buffer.length,null);if(!count)break;total+=count;if(total>maximum)fail();hash.update(buffer.subarray(0,count));}
  if(BigInt(total)!==before.size||pin(before)!==pin(fs.fstatSync(fd,{bigint:true}))||pin(before)!==pin(fs.lstatSync(file,{bigint:true})))fail();
  return {identity:pin(before),sha256:hash.digest('hex')};
 }finally{fs.closeSync(fd);}
}
function assertTrustMount(input: Input, key: ReturnType<typeof read>) {
  const file = fs.openSync('/proc/self/mountinfo', fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  let raw: Buffer;
  try { const buffer = Buffer.alloc(262145); let length = 0;
    while (length < buffer.length) { const count = fs.readSync(file, buffer, length, buffer.length - length, null); if (!count) break; length += count; }
    if (!length || length >= buffer.length) fail(); raw = buffer.subarray(0, length);
  } finally { fs.closeSync(file); }
  if (digest(raw) !== input.mountInfoSha256 || key.uid !== 0n || !key.mountId) fail();
  const decode = (value: string) => value.replace(/\\([0-7]{3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)));
  const mounts = raw.toString('utf8').trim().split('\n').map(line => {
    const [before, after] = line.split(' - '), fields = before.split(' ');
    if (!after || fields.length < 6) fail();
    return { id: fields[0], device: fields[2], root: decode(fields[3]), target: decode(fields[4]), options: fields[5].split(',') };
  });
  const selected = mounts.find(value => value.id === key.mountId);
  if (!selected || ![ONLINE_PRIVATE_QUALIFICATION_PUBLIC_KEY, '/run/sabalan-online'].includes(selected.target) || !selected.options.includes('ro')
    || selected.options.includes('rw')) fail();
  for (const alias of writableTrustKeyAliases(mounts, selected, ONLINE_PRIVATE_QUALIFICATION_PUBLIC_KEY)) {
    try { const value = fs.statSync(alias, { bigint: true });
      if (value.dev === key.stat.dev && value.ino === key.stat.ino) fail();
    } catch (error: any) { if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error; }
  }
}


declare const qualificationBrand:unique symbol;
export type OnlinePrivateQualification=Readonly<{[qualificationBrand]:true}>;
type State={input:Input;decision:OnlinePrivateQualificationDecision;artifacts:OnlinePrivateQualificationArtifacts;
 keyPin:string;keySha256:string;files:ReadonlyArray<{file:string;identity:string;sha256:string;maximum:number}>;directoryPin:string;directory:string};
declare const qualificationAuthorityBrand:unique symbol;
export type OnlinePrivateQualificationAuthority=Readonly<{[qualificationAuthorityBrand]:true}>;
const originalAuthorities=new WeakMap<OnlinePrivateQualificationAuthority,State>();
const qualifications=new WeakMap<OnlinePrivateQualification,State>();
const contained=(root:string,file:string)=>{const relative=path.relative(root,file);return relative!==''&&!path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+path.sep);};
function parseArtifacts(v:any,decision:OnlinePrivateQualificationDecision,input:Input):OnlinePrivateQualificationArtifacts{
 if(!exact(v,['format','qualificationId','releaseId','image','sourceCommit','runtimeBundleSha256','generation','database','restoreManifestSha256','qualificationRoot','targetsSha256','targets','roots','ephemeralRoots'])
  ||v.format!=='sabalan-online-private-qualification-artifacts/v1'||v.qualificationId!==decision.qualificationId
  ||v.releaseId!==decision.releaseId||v.image!==decision.image||v.sourceCommit!==decision.sourceCommit
  ||v.runtimeBundleSha256!==decision.runtimeBundleSha256||v.restoreManifestSha256!==decision.restoreManifestSha256
  ||!Number.isSafeInteger(v.generation)||v.generation<1||JSON.stringify(canonical(v.database))!==JSON.stringify(canonical(decision.database))
  ||v.qualificationRoot!==path.join(input.scope.coordinationDirectory,'private-qualifications',decision.qualificationId,'restored-app')
  ||!Array.isArray(v.roots)||v.roots.length!==9||!Array.isArray(v.ephemeralRoots)||v.ephemeralRoots.length!==3)fail();
 if(!hex(v.targetsSha256)||!Array.isArray(v.targets)||!v.targets.length||v.targets.length>1024)fail();
 for(const target of v.targets){if(!exact(target,['runtimeId','nonceSha256','releaseId','imageIdentity','scopeSha256'])||!hex(target.scopeSha256))fail();Object.freeze(target);}
 canonicalRealtimeTargets(v.targets);
 if(digest(Buffer.from(JSON.stringify(canonical(v.targets))))!==v.targetsSha256)fail();
 if(decision.runtimePurpose==='http'&&!v.targets.some((target:any)=>target.runtimeId===decision.runtimeId&&target.nonceSha256===decision.nonceSha256
  &&target.releaseId===decision.releaseId&&target.imageIdentity===decision.image&&target.scopeSha256===decision.scopeSha256))fail();
 Object.freeze(v.targets);
 for(const root of v.roots){
  if(!exact(root,['live','store','liveDevice','liveInode','storeDevice','storeInode','baselineSha256'])||!hex(root.baselineSha256)
   ||![root.liveDevice,root.liveInode,root.storeDevice,root.storeInode].every(x=>typeof x==='string'&&/^[1-9][0-9]*$/.test(x))
   ||![root.live,root.store].every(file=>typeof file==='string'&&path.isAbsolute(file)&&path.resolve(file)===file&&contained(v.qualificationRoot,file)))fail();
  Object.freeze(root);
 }
 if(new Set(v.roots.map((r:any)=>r.live)).size!==9||new Set(v.roots.map((r:any)=>r.store)).size!==9
  ||new Set(v.ephemeralRoots).size!==3||v.ephemeralRoots.some((file:any)=>typeof file!=='string'||!path.isAbsolute(file)||path.resolve(file)!==file||!contained(v.qualificationRoot,file)))fail();
 Object.freeze(v.roots);Object.freeze(v.ephemeralRoots);Object.freeze(v.database);return Object.freeze(v);
}

/** Original fixed RO key + native scope + real isolated SQL connection only.
 * No accepted-release row/report is created, queried or supplied as a boolean.
 * The original host separately proves restore semantics before signing. */
export function openOriginalOnlinePrivateQualificationAuthority():OnlinePrivateQualificationAuthority{
 if(process.platform!=='linux')fail();
 const input=loadOnlineRuntimeScope();
 if(!input||input.scope.format!=='sabalan-online-runtime-scope/v2'||!applicationRuntimeDatabaseUrl()
  ||!['http','jobs'].includes(input.scope.purpose))fail();
 const key=read(ONLINE_PRIVATE_QUALIFICATION_PUBLIC_KEY,4096,0o444);assertTrustMount(input,key);
 const directory=path.join(input.scope.nativeDirectory,'private-qualification');
 if(fs.realpathSync(directory)!==directory)fail();
 const directoryStat=fs.lstatSync(directory,{bigint:true});
 if(!directoryStat.isDirectory()||directoryStat.isSymbolicLink()||(directoryStat.mode&0o077n)!==0n||directoryStat.uid!==BigInt(process.getuid!()))fail();
 const files:State['files'][number][]=[];
 const ownedRead=(name:string,maximum:number,expected?:string)=>{
  const file=path.join(directory,name),value=read(file,maximum,0o400);
  if(value.uid!==BigInt(process.getuid!())||(expected&&digest(value.bytes)!==expected))fail();
  files.push({file,identity:value.identity,sha256:digest(value.bytes),maximum});return value.bytes;
 };
 const decision=verifyOnlinePrivateQualificationDecision(ownedRead('decision.json',16384),key.bytes);
 if(decision.scopeSha256!==input.sha256||decision.runtimeId!==input.scope.runtimeId||decision.nonceSha256!==digest(Buffer.from(input.scope.nonce))
  ||decision.runtimePurpose!==input.scope.purpose||decision.role!==input.scope.role||decision.releaseId!==input.scope.releaseId
  ||decision.image!==input.scope.image||decision.sourceCommit!==input.scope.sourceCommit||decision.runtimeBundleSha256!==input.scope.manifestSha256
  ||decision.database.name!==input.scope.database.name||decision.database.systemIdentifier!==input.scope.database.systemIdentifier)fail();
 const artifacts=parseArtifacts(JSON.parse(ownedRead('artifacts.json',131072,decision.artifactsSha256).toString('utf8')),decision,input);
 // Retrievable immutable restore input bytes are data, not self-issued success.
 const restoreFile=path.join(directory,'restore-input-manifest.json'),restore=readDigest(restoreFile,8*1024*1024);
 if(restore.sha256!==decision.restoreManifestSha256)fail();files.push({file:restoreFile,maximum:8*1024*1024,...restore});
 if(process.cwd()!==artifacts.qualificationRoot
  ||(process.env.RECOVERY_STORAGE_DIR!==undefined&&path.resolve(process.env.RECOVERY_STORAGE_DIR)!==path.join(artifacts.qualificationRoot,'storage','recovery')))fail();
 const rootStat=fs.lstatSync(artifacts.qualificationRoot,{bigint:true});
 if(fs.realpathSync(artifacts.qualificationRoot)!==artifacts.qualificationRoot||!rootStat.isDirectory()||rootStat.isSymbolicLink()
  ||(rootStat.mode&0o077n)!==0n||rootStat.uid!==BigInt(process.getuid!()))fail();
 const authority=Object.freeze({}) as OnlinePrivateQualificationAuthority;
 originalAuthorities.set(authority,{input,decision,artifacts,keyPin:key.identity,keySha256:digest(key.bytes),files,directory,directoryPin:pin(directoryStat)});
 return authority;
}
export async function admitOnlinePrivateQualification(authority:OnlinePrivateQualificationAuthority,database:PrismaClient):Promise<OnlinePrivateQualification>{
 const state=originalAuthorities.get(authority);if(!state)fail();assertState(state);
 const {decision}=state;
 const {prisma}=await import('../lib/prisma');if(database!==prisma)fail();
 const rows=await database.$queryRaw<Array<{name:string;oid:string;systemIdentifier:string;namespace:string}>>`
  SELECT current_database()::text AS name,(SELECT oid::text FROM pg_database WHERE datname=current_database()) AS oid,
   (SELECT system_identifier::text FROM pg_control_system()) AS "systemIdentifier",current_setting('application_name')::text AS namespace`;
 if(rows.length!==1||rows[0].name!==decision.database.name||rows[0].oid!==decision.database.oid||rows[0].systemIdentifier!==decision.database.systemIdentifier
  ||rows[0].namespace!==process.env.BACKEND_NATIVE_POSTGRES_APPLICATION_NAME||Date.parse(decision.expiresAt)<=Date.now())fail();
 if(decision.httpIngress)assertOnlineHttpIngressAssigned(decision.httpIngress);
 const capability=Object.freeze({}) as OnlinePrivateQualification;
 qualifications.set(capability,state);assertOriginalOnlinePrivateQualification(capability);return capability;
}

export function assertOriginalOnlinePrivateQualification(capability:OnlinePrivateQualification,purpose?:'http'|'jobs'){
 const state=qualifications.get(capability);
 if(!state||loadOnlineRuntimeScope()!==state.input||!applicationRuntimeDatabaseUrl()||(purpose&&state.decision.runtimePurpose!==purpose))fail();
 assertState(state);return Object.freeze({decision:state.decision,artifacts:state.artifacts});
}
function assertState(state:State){
 if(loadOnlineRuntimeScope()!==state.input||!applicationRuntimeDatabaseUrl())fail();
 const key=read(ONLINE_PRIVATE_QUALIFICATION_PUBLIC_KEY,4096,0o444);assertTrustMount(state.input,key);
 if(key.identity!==state.keyPin||digest(key.bytes)!==state.keySha256||pin(fs.lstatSync(state.directory,{bigint:true}))!==state.directoryPin)fail();
 for(const item of state.files){const value=readDigest(item.file,item.maximum);if(value.identity!==item.identity||value.sha256!==item.sha256)fail();}

}
