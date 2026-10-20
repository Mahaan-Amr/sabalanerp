import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import type {PrismaClient} from '@prisma/client';
import {protectedBoundary} from './protectedBridgeMigrations';
import {assertRuntimeControlOwnership} from './runtimeControlOwnership';
import {protectedLegacyFileRoots} from './protectedLegacyFileRoots';
import {inventoryProtectedLegacyFiles} from './protectedLegacyFileInventory';

type Owner=Readonly<{deploymentId:string;releaseId:string;leaseToken:string}>;
type Root=Readonly<{root:string;liveRoot:string}>;
const issued=new WeakSet<ProtectedLegacyFileAdoptionAuthority>();
function requireProof(value:unknown,code:string):asserts value{if(!value)throw Error(code);}
const canonical=(value:any):any=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const pin=(value:fs.BigIntStats)=>[value.dev,value.ino,value.size,value.mtimeNs,value.ctimeNs,value.uid,value.mode,value.nlink].map(String).join(':');
function readCheckpoint(directory:string){
 const file=path.join(directory,'deployment-checkpoint.json');requireProof(fs.realpathSync(file)===file,'PROTECTED_FILE_CHECKPOINT_ALIAS');
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{const st=fs.fstatSync(fd,{bigint:true});requireProof(st.isFile()&&st.nlink===1n&&st.uid===0n&&!(st.mode&0o022n)&&st.size>0n&&st.size<=16n*1024n**2n,'PROTECTED_FILE_CHECKPOINT_UNSAFE');
  const raw=fs.readFileSync(fd);requireProof(pin(st)===pin(fs.fstatSync(fd,{bigint:true}))&&pin(st)===pin(fs.lstatSync(file,{bigint:true})),'PROTECTED_FILE_CHECKPOINT_CHANGED');return {file,pin:pin(st),value:JSON.parse(raw.toString())};
 }finally{fs.closeSync(fd);}
}
function assertDispatchPreparation(owner:Owner,point:any,directory:string){
 const name='online-dispatch-root-'+owner.deploymentId+'.json',file=path.join(directory,name);
 requireProof(fs.realpathSync(file)===file,'PROTECTED_DISPATCH_PREPARATION_ALIAS');
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{const before=fs.fstatSync(fd,{bigint:true});requireProof(before.isFile()&&before.nlink===1n&&before.uid===0n&&(before.mode&0o777n)===0o400n&&before.size>0n&&before.size<=16n*1024n**2n,'PROTECTED_DISPATCH_PREPARATION_UNSAFE');
  const raw=fs.readFileSync(fd),value=JSON.parse(raw.toString()),components=point.manifest.components.filter((component:any)=>component.path==='recovery-coordination/'+name);
  requireProof(pin(before)===pin(fs.fstatSync(fd,{bigint:true}))&&pin(before)===pin(fs.lstatSync(file,{bigint:true}))&&components.length===1&&components[0].size===raw.length&&components[0].sha256===createHash('sha256').update(raw).digest('hex'),'PROTECTED_DISPATCH_CHECKPOINT_PROOF_MISSING');
  const live=fs.lstatSync('/app/storage/dispatch-documents',{bigint:true});
  requireProof(value.format==='sabalan-protected-dispatch-root/v1'&&value.deploymentId===owner.deploymentId&&value.releaseId===owner.releaseId&&value.publicOnlineAdmission===false&&value.checkpointRequired===true&&value.directory?.device===String(live.dev)&&value.directory?.inode===String(live.ino)&&typeof value.sourceWasMissing==='boolean'&&Array.isArray(value.files)&&Array.isArray(value.directories),'PROTECTED_DISPATCH_PREPARATION_UNPROVEN');
  requireProof(value.sourceWasMissing?value.sourceArchiveSha256===null&&value.files.length===0&&value.directories.length===0:/^[a-f0-9]{64}$/.test(value.sourceArchiveSha256),'PROTECTED_DISPATCH_PREPARATION_UNPROVEN');
 }finally{fs.closeSync(fd);}
}
/** A predicate only; this does not issue an authority or accept caller booleans. */
export function validateProtectedFileCheckpoint(owner:Owner,point:any){
 requireProof(point&&point.deploymentId===owner.deploymentId&&point.releaseId===owner.releaseId&&point.localVerified===true&&point.remoteVerified===true&&point.localRestoreVerified===true&&point.restoreVerified===true&&point.manifestReadable===true&&point.compatibility?.local?.compatible===true&&point.compatibility?.remote?.compatible===true&&/^[a-f0-9]{64}$/.test(point.checksum)&&Number.isSafeInteger(point.size)&&point.size>0&&point.manifest?.packageType==='COMPLETE'&&point.manifest.sanitized===false&&Array.isArray(point.manifest.components),'PROTECTED_FILE_CHECKPOINT_UNVERIFIED');
}
export function assertProtectedLegacyFileAdoptionAuthority(authority:ProtectedLegacyFileAdoptionAuthority){requireProof(issued.has(authority),'PROTECTED_FILE_ADOPTION_AUTHORITY_REQUIRED');authority.assertOwned();}

/** Initial maintenance ONLY. FD9 excludes legacy controls and the independent
 * FD10 holds real write EX. A checkpoint/JSON/timeout alone issues nothing.
 * There is no serving port, SH context, reset, recovery or public admission. */
export class ProtectedLegacyFileAdoptionAuthority{
 private constructor(private readonly database:PrismaClient,private readonly owner:Owner,readonly source:Root,
  readonly captureId:string,private readonly directory:string,private readonly checkpoint:ReturnType<typeof readCheckpoint>,
  private readonly boundary:()=>void,private readonly gate:{file:string;device:string;inode:string;ownerUid:number}){}
 static async open(database:PrismaClient,owner:Owner,source:Root,captureId:string):Promise<ProtectedLegacyFileAdoptionAuthority>{
  assertRuntimeControlOwnership();requireProof(process.platform==='linux'&&process.getuid!()===0&&process.env.BACKEND_RUNTIME_ROLE==='control'&&/^[a-f0-9]{64}$/.test(captureId),'PROTECTED_FILE_ADOPTION_NATIVE_REQUIRED');
  const directory=process.env.RECOVERY_COORDINATION_DIR||'/app/recovery-coordination';
  requireProof(directory==='/app/recovery-coordination'&&protectedLegacyFileRoots().some(root=>root.liveRoot===source.liveRoot&&root.root===source.root),'PROTECTED_FILE_ADOPTION_SOURCE_INVALID');
  const checkpoint=readCheckpoint(directory);validateProtectedFileCheckpoint(owner,checkpoint.value);assertDispatchPreparation(owner,checkpoint.value,directory);
  const file=path.join(directory,'deployment-write-admission.lock'),st=fs.lstatSync(file,{bigint:true});
  const authority=new ProtectedLegacyFileAdoptionAuthority(database,Object.freeze({...owner}),Object.freeze({...source}),captureId,directory,checkpoint,protectedBoundary(owner),{file,device:String(st.dev),inode:String(st.ino),ownerUid:0});
  authority.assertOwned();await authority.assertLease();await authority.assertSource();authority.assertOwned();issued.add(authority);Object.freeze(authority);return authority;
 }
 gateIdentity(){this.assertOwned();return Object.freeze({device:this.gate.device,inode:this.gate.inode,ownerUid:0});}
 assertOwned(){
  this.boundary();const st=fs.fstatSync(10,{bigint:true}),named=fs.lstatSync(this.gate.file,{bigint:true});
  requireProof(fs.realpathSync(this.gate.file)===this.gate.file&&st.isFile()&&st.nlink===1n&&st.size===0n&&st.uid===0n&&!(st.mode&0o022n)&&String(st.dev)===this.gate.device&&String(st.ino)===this.gate.inode&&pin(st)===pin(named),'PROTECTED_FILE_ADOPTION_GATE_CHANGED');
  requireProof(new RegExp('^lock:\\s+\\d+:\\s+FLOCK\\s+ADVISORY\\s+WRITE\\s+\\S+\\s+[0-9a-f]+:[0-9a-f]+:'+this.gate.inode+'\\s+0\\s+EOF\\s*$','m').test(fs.readFileSync('/proc/self/fdinfo/10','utf8')),'PROTECTED_FILE_ADOPTION_EX_REQUIRED');
  requireProof(fs.realpathSync(this.checkpoint.file)===this.checkpoint.file&&pin(fs.lstatSync(this.checkpoint.file,{bigint:true}))===this.checkpoint.pin,'PROTECTED_FILE_CHECKPOINT_CHANGED');
 }
 async assertLease(){
  this.assertOwned();const rows=await this.database.$queryRaw<Array<{checkpoint:any;foreignSessions:number;prepared:number}>>`SELECT "checkpointJson" AS checkpoint,
   (SELECT count(*)::int FROM pg_stat_activity a WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend'
    AND NOT(application_name=${'sabalan-lock-'+this.owner.deploymentId} AND EXISTS(SELECT 1 FROM pg_locks l WHERE l.pid=a.pid AND l.locktype='advisory' AND l.classid=0 AND l.objid=741936425 AND l.objsubid=1 AND l.granted AND l.mode='ExclusiveLock'))) AS "foreignSessions",
   (SELECT count(*)::int FROM pg_prepared_xacts WHERE database=current_database()) AS prepared
   FROM deployment_operations WHERE id=${this.owner.deploymentId} AND "releaseId"=${this.owner.releaseId} AND "leaseToken"=${this.owner.leaseToken}
    AND "activeKey"='production' AND phase='MIGRATIONS_APPLIED' AND "leaseExpiresAt">clock_timestamp()+interval '20 seconds'
    AND EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR pg_has_role(current_user,'pg_read_all_stats','USAGE')))`;
  const {metadataPath,...point}=this.checkpoint.value;
  requireProof(metadataPath===point.archivePath+'.json'&&rows.length===1&&rows[0].foreignSessions===0&&rows[0].prepared===0&&hash(rows[0].checkpoint)===hash(point),'PROTECTED_FILE_ADOPTION_OWNED_LEASE_REQUIRED');this.assertOwned();
 }
 async assertSource(){
  this.assertOwned();const observed=await inventoryProtectedLegacyFiles(this.source.liveRoot,()=>this.assertOwned());
  const relative=path.relative('/app',this.source.liveRoot),prefix=relative.startsWith('storage/')?'files/'+relative.slice(8):'files/'+relative;
  const expected=this.checkpoint.value.manifest.components.filter((value:any)=>value.path.startsWith(prefix+'/')).map((value:any)=>({key:value.path.slice(prefix.length+1),bytes:value.size,sha256:value.sha256})).sort((a:any,b:any)=>a.key<b.key?-1:a.key>b.key?1:0);
  requireProof(hash(expected)===hash(observed.files),'PROTECTED_FILE_BASELINE_CHECKPOINT_INVENTORY_MISMATCH');this.assertOwned();return observed;
 }
}
