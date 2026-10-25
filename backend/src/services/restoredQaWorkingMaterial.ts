/** Private working copies for a live strict-restore callback. No database,
 * deployment lease, endpoint, production or completed-restore authority. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {assertActiveStrictRestoreProof} from './systemRecoveryEngine';
import {assertRuntimeControlOwnership} from './runtimeControlOwnership';

const mappings = {
  'files/contracts':'storage/contracts', 'files/hr-hiring':'storage/hr-hiring',
  'files/accounting-contracts':'storage/accounting-contracts',
  'files/dispatch-documents':'storage/dispatch-documents',
  'files/support-tickets':'storage/support-tickets',
  'files/performance-exports':'storage/performance-exports', 'files/uploads':'uploads',
  'inquiry':'recovery-sources/inquiry', 'recovery-coordination':'recovery-coordination',
} as const;
function required(value:unknown):asserts value {assert.ok(value,'RESTORED_QA_WORKING_MATERIAL_REQUIRED');}
const hash=(raw:Buffer)=>createHash('sha256').update(raw).digest('hex');
const stable=(s:fs.BigIntStats)=>[s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs,s.uid,s.mode,s.nlink].join(':');
const directoryIdentity=(s:fs.BigIntStats)=>[s.dev,s.ino,s.uid,s.mode].join(':');
/** Data-only path classifier, not authority to read or copy a path. */
export function restoredQaMaterialPath(component:string):string {
  required(typeof component==='string'&&!component.includes('\\')&&!component.startsWith('/')
    &&component.split('/').every(part=>part!==''&&part!=='.'&&part!=='..'));
  const prefix=Object.keys(mappings).find(value=>component.startsWith(value+'/')) as keyof typeof mappings|undefined;
  required(prefix);
  // Native/session/lease authority is the current original's own state, never
  // a restored file. Unknown coordination inputs need explicit source review.
  if(prefix==='recovery-coordination')required(component==='recovery-coordination/state.json');
  return mappings[prefix]+'/'+component.slice(prefix.length+1);
}
declare const workingBrand:unique symbol;
export type RestoredQaWorkingMaterial=Readonly<{[workingBrand]:true}>;
type State={proof:unknown;context:ReturnType<typeof assertActiveStrictRestoreProof>;root:string;rootIdentity:string;
 owner:Readonly<{deploymentId:string;releaseId:string}>;roots:Readonly<Record<string,string>>;
 identities:Readonly<Record<string,string>>;active:boolean;sourceManifestValueSha256:string;sourcePerformanceExports:string;controlLockIdentity:string};
const scopes=new WeakMap<RestoredQaWorkingMaterial,State>(),consumed=new WeakSet<object>();
function privateDirectory(directory:string){
 required(path.isAbsolute(directory)&&fs.realpathSync(directory)===directory);
 const s=fs.lstatSync(directory,{bigint:true});required(s.isDirectory()&&!s.isSymbolicLink()
   &&s.uid===BigInt(process.getuid!())&&(s.mode&0o077n)===0n);return directoryIdentity(s);
}
function retainedControlLockIdentity(root:string){
 const file=path.join(root,'recovery-coordination','deployment-runtime-control.lock');
 required(process.platform==='linux'&&process.env.BACKEND_CONTROL_LOCK_FD==='9'&&process.env.BACKEND_CONTROL_LOCK_FILE===file
   &&fs.realpathSync(file)===file);
 const held=fs.fstatSync(9,{bigint:true}),named=fs.lstatSync(file,{bigint:true});
 required(held.isFile()&&held.nlink===1n&&held.uid===BigInt(process.getuid!())&&!(held.mode&0o022n)
   &&stable(held)===stable(named));
 const info=fs.readFileSync('/proc/self/fdinfo/9','utf8');
 required(new RegExp('^lock:\\s+\\d+:\\s+FLOCK\\s+ADVISORY\\s+WRITE\\s+\\S+\\s+[0-9a-f]+:[0-9a-f]+:'+held.ino+'\\s+0\\s+EOF\\s*$','m').test(info));
 return stable(held);
}
function copyComponent(source:string,destination:string,component:{size:number;sha256:string}){
 required(fs.realpathSync(source)===source);
 const fd=fs.openSync(source,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{
  const before=fs.fstatSync(fd,{bigint:true});required(before.isFile()&&before.nlink===1n
    &&before.uid===BigInt(process.getuid!())&&before.size===BigInt(component.size));
  fs.mkdirSync(path.dirname(destination),{recursive:true,mode:0o700});
  const out=fs.openSync(destination,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600);
  const digest=createHash('sha256'),buffer=Buffer.alloc(256*1024);let total=0;
  try{for(;;){const count=fs.readSync(fd,buffer,0,buffer.length,null);if(!count)break;total+=count;
    required(total<=component.size);digest.update(buffer.subarray(0,count));let offset=0;
    while(offset<count){const written=fs.writeSync(out,buffer,offset,count-offset);required(written>0);offset+=written;}}
    fs.fsyncSync(out);
  }finally{fs.closeSync(out);}
  required(total===component.size&&digest.digest('hex')===component.sha256
    &&stable(before)===stable(fs.fstatSync(fd,{bigint:true}))&&stable(before)===stable(fs.lstatSync(source,{bigint:true})));
  const copied=fs.lstatSync(destination,{bigint:true});required(copied.isFile()&&copied.nlink===1n&&copied.size===before.size
    &&copied.uid===before.uid&&(copied.mode&0o777n)===0o600n&&copied.ino!==before.ino);
  const verify=fs.openSync(destination,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  try{const digest=createHash('sha256'),buffer=Buffer.alloc(256*1024);let total=0;
    for(;;){const count=fs.readSync(verify,buffer,0,buffer.length,null);if(!count)break;total+=count;required(total<=component.size);digest.update(buffer.subarray(0,count));}
    required(total===component.size&&digest.digest('hex')===component.sha256&&stable(copied)===stable(fs.fstatSync(verify,{bigint:true}))
      &&stable(copied)===stable(fs.lstatSync(destination,{bigint:true})));
  }finally{fs.closeSync(verify);}
 }finally{fs.closeSync(fd);}
}
/** The engine created and verified this source, and still owns its lifetime.
 * Only exact manifest bytes are copied; no source database dump, symlink,
 * global file promotion, key substitution or authentication rewrite occurs. */
export async function withRestoredQaWorkingMaterial<T>(proof:unknown,owner:Readonly<{deploymentId:string;releaseId:string}>,
 work:(material:RestoredQaWorkingMaterial)=>Promise<T>):Promise<T>{
 const context=assertActiveStrictRestoreProof(proof);required(process.platform==='linux'&&process.getuid?.()===0
   &&[owner.deploymentId,owner.releaseId].every(value=>/^[A-Za-z0-9_-]{8,128}$/.test(value))&&!consumed.has(context.proof));
 consumed.add(context.proof);assertRuntimeControlOwnership();
 // The original native owner preallocated this app/CWD and coordination root
 // before importing the engine. Never retarget an inherited FD9 afterwards.
 const root=process.cwd(),coordination=path.join(root,'recovery-coordination'),rootIdentity=privateDirectory(root);
 required(process.env.RECOVERY_COORDINATION_DIR===coordination
   &&(!process.env.RECOVERY_STORAGE_DIR||process.env.RECOVERY_STORAGE_DIR===path.join(root,'storage','recovery'))
   &&context.payloadRoot.startsWith(path.join(root,'storage','recovery','work')+path.sep));
 privateDirectory(coordination);privateDirectory(path.dirname(context.payloadRoot));const controlLockIdentity=retainedControlLockIdentity(root);
 for(const [component,relative]of Object.entries(mappings))if(component!=='recovery-coordination')required(!fs.existsSync(path.join(root,relative)));
 const seen=new Set<string>();
 for(const component of context.manifest.components){
   required(Number.isSafeInteger(component.size)&&component.size>=0&&/^[a-f0-9]{64}$/.test(component.sha256));
   if(component.path==='database/main.dump')continue;
   const relative=restoredQaMaterialPath(component.path);required(!seen.has(relative));seen.add(relative);
   assertActiveStrictRestoreProof(proof);copyComponent(path.join(context.payloadRoot,component.path),path.join(root,relative),component);
 }
 const roots:Record<string,string>={},identities:Record<string,string>={};
 for(const [component,relative]of Object.entries(mappings)){
   const target=path.join(root,relative);fs.mkdirSync(target,{recursive:true,mode:0o700});roots[component]=target;identities[component]=privateDirectory(target);
 }
 const material=Object.freeze({})as RestoredQaWorkingMaterial;
 const state:State={proof,context,root,rootIdentity,owner:Object.freeze({...owner}),roots:Object.freeze(roots),
   identities:Object.freeze(identities),active:true,sourceManifestValueSha256:hash(Buffer.from(JSON.stringify(context.manifest))),
   sourcePerformanceExports:context.sourceStorageRoots.performanceExports,controlLockIdentity};
 scopes.set(material,state);
 try{assertRestoredQaWorkingMaterial(material,owner);return await work(material);}
 finally{state.active=false;scopes.delete(material);}
}
export function assertRestoredQaWorkingMaterial(material:RestoredQaWorkingMaterial,owner:Readonly<{deploymentId:string;releaseId:string}>){
 const state=scopes.get(material);required(state?.active&&state.owner.deploymentId===owner.deploymentId&&state.owner.releaseId===owner.releaseId);
 required(assertActiveStrictRestoreProof(state.proof)===state.context&&privateDirectory(state.root)===state.rootIdentity
   &&process.cwd()===state.root&&process.env.RECOVERY_COORDINATION_DIR===state.roots['recovery-coordination']);
 // Admission occurred before actors. Retain only that SAME original kernel
 // lock here; this path cap cannot authorize DDL or adopt another native owner.
 required(retainedControlLockIdentity(state.root)===state.controlLockIdentity);
 // Until an exact own-LIVE-cohort validator is integrated, retain the stricter
 // canonical empty-inventory boundary. Never filter unknown native entries.
 assertRuntimeControlOwnership();
 for(const [component,root]of Object.entries(state.roots))required(privateDirectory(root)===state.identities[component]);
 return Object.freeze({root:state.root,roots:state.roots,database:state.context.proof.database,
   sourceManifestValueSha256:state.sourceManifestValueSha256,sourcePerformanceExports:state.sourcePerformanceExports,inspectionTarget:'RESTORED_QA' as const,
   cleanupPending:true as const,independentPointHealthy:false as const,productionAdmission:false as const});
}
