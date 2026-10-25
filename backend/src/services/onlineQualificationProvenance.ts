import fs from 'node:fs';
import path from 'node:path';
import {createHash,createPublicKey,verify} from 'node:crypto';
import {readOnlineReleaseEvidence} from './onlineReleaseEvidence';
export const ONLINE_QUALIFICATION_PUBLIC_KEY='/etc/sabalan/online/qualification-public-key.pem';
const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(key=>[key,canonical(v[key])])):v;
const encode=(v:unknown)=>Buffer.from(JSON.stringify(canonical(v)));
const sha=(v:Buffer)=>createHash('sha256').update(v).digest('hex');
const hash=(v:unknown)=>sha(encode(v));
const hex=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
function required(value:unknown):asserts value{if(!value)throw Error('ONLINE_TRUSTED_ORIGINAL_QUALIFICATION_UNPROVEN');}
const pin=(s:fs.BigIntStats)=>[s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs,s.uid,s.mode,s.nlink].map(String).join(':');
function read(file:string,maximum:number,mode:number){
 required(fs.realpathSync(file)===file);const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{const before=fs.fstatSync(fd,{bigint:true});required(before.isFile()&&before.uid===0n&&before.nlink===1n
  &&(before.mode&0o777n)===BigInt(mode)&&before.size>0n&&before.size<=BigInt(maximum));
  const raw=fs.readFileSync(fd);required(pin(before)===pin(fs.fstatSync(fd,{bigint:true}))&&pin(before)===pin(fs.lstatSync(file,{bigint:true})));
  return{raw,pin:pin(before)};
 }finally{fs.closeSync(fd);}
}
/** Pure signature/data verification. Only the fixed OS-protected root key below
 * confers independent origin trust; an embedded/caller key never does. */
export function verifyOnlineQualificationOrigin(raw:Buffer,publicKey:Buffer,accepted:ReturnType<typeof readOnlineReleaseEvidence>){
 required(raw.length>0&&raw.length<=65536&&publicKey.length>0&&publicKey.length<=4096);
 const envelope=JSON.parse(raw.toString('utf8')),value=envelope.decision;
 required(Object.keys(envelope).sort().join(',')==='decision,format,signature'&&envelope.format==='sabalan-signed-online-qualification-origin/v1'
  &&Object.keys(value).sort().join(',')==='acceptanceSha256,checkpointSha256,evidenceInventorySha256,format,issuedAt,manifestSha256,nativeClosuresSha256,origins,releaseId'
  &&value.format==='sabalan-original-online-qualification/v1'&&value.releaseId===accepted.manifest.releaseId
  &&value.manifestSha256===accepted.acceptance.manifestSha256&&value.checkpointSha256===accepted.acceptance.checkpointSha256
  &&[value.acceptanceSha256,value.manifestSha256,value.evidenceInventorySha256,value.nativeClosuresSha256].every(hex)
  &&value.acceptanceSha256===accepted.evidenceInventory.find(row=>row.file==='acceptance.json')?.sha256
  &&value.evidenceInventorySha256===hash(accepted.evidenceInventory)&&value.nativeClosuresSha256===hash(accepted.nativeClosures)
  &&Array.isArray(value.origins)&&value.origins.length===2
  &&value.origins.map((row:any)=>row.kind).sort().join(',')==='independent-original,local-original'
  &&value.origins.every((row:any)=>Object.keys(row).sort().join(',')==='completionSha256,controllerSourceSha256,historySha256,kind'
   &&[row.completionSha256,row.controllerSourceSha256,row.historySha256].every(hex))
  &&Number.isFinite(Date.parse(value.issuedAt))&&Date.parse(value.issuedAt)<=Date.now()
  &&new Date(value.issuedAt).toISOString()===value.issuedAt&&typeof envelope.signature==='string'
  &&/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature));
 const key=createPublicKey(publicKey);required(key.asymmetricKeyType==='ed25519'
  &&verify(null,Buffer.concat([Buffer.from('sabalan-original-online-qualification/v1\n'),encode(value)]),key,Buffer.from(envelope.signature,'base64')));
 return Object.freeze(value);
}
/** An immutable, independently signed origin certificate supplements semantic
 * JSON validation. Its issuer owns the ACTUAL qualification children/channels;
 * production never reconstructs their ownership from a saved report. */
export function openTrustedOnlineQualification(directory:string,expected:{manifestSha256:string;acceptanceSha256:string}){
 required(process.platform==='linux'&&process.getuid?.()===0);
 const accepted=readOnlineReleaseEvidence(directory,expected),key=read(ONLINE_QUALIFICATION_PUBLIC_KEY,4096,0o444);
 const file=path.join(directory,'qualification-provenance.json'),certificate=read(file,65536,0o400);
 const decision=verifyOnlineQualificationOrigin(certificate.raw,key.raw,accepted);
 // Acceptance hash is the exact original file bytes (canonical JSON may have LF).
 required(decision.acceptanceSha256===expected.acceptanceSha256);
 return Object.freeze({decision,accepted,revalidate(){accepted.revalidate();required(read(ONLINE_QUALIFICATION_PUBLIC_KEY,4096,0o444).pin===key.pin
  &&read(file,65536,0o400).pin===certificate.pin);}});
}
