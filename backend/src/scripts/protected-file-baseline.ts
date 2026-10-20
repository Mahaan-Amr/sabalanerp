/** Fixed protected initial-baseline child. Never starts an application/jobs. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import type {OnlineRetainedRoot} from '../services/onlineReleaseEvidence';
function required(value:unknown,code:string):asserts value{if(!value)throw Error(code);}
const sha=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
const canonical=(value:any):any=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const encoded=(value:unknown)=>Buffer.from(JSON.stringify(canonical(value))+'\n');
const pin=(value:fs.BigIntStats)=>[value.dev,value.ino,value.size,value.mtimeNs,value.ctimeNs,value.uid,value.mode,value.nlink].map(String).join(':');
type File={key:string;bytes:number;sha256:string};
async function inventory(root:string):Promise<{files:File[];directories:string[];identity:{device:string;inode:string}}>{
 const files:File[]=[],directories:string[]=[],rootStat=fs.lstatSync(root,{bigint:true});let total=0;
 async function walk(directory:string,prefix:string){
  const before=fs.lstatSync(directory,{bigint:true});required(before.isDirectory()&&before.uid===0n&&!(before.mode&0o022n)&&before.dev===rootStat.dev&&fs.realpathSync(directory)===directory,'PROTECTED_FILE_SOURCE_UNSAFE');
  directories.push(directory);required(directories.length<=10000,'PROTECTED_FILE_SOURCE_CAPACITY');const children=fs.readdirSync(directory).sort();
  for(const name of children){required(name!=='.'&&name!=='..'&&!name.startsWith('.sabalan-file-'),'PROTECTED_FILE_SOURCE_NAME_UNSAFE');const target=path.join(directory,name),st=fs.lstatSync(target,{bigint:true});
   if(st.isDirectory()){await walk(target,prefix+name+'/');continue;}
   required(st.isFile()&&st.nlink===1n&&st.uid===0n&&!(st.mode&0o022n)&&st.dev===rootStat.dev&&st.size<=2n*1024n**3n,'PROTECTED_FILE_SOURCE_UNSAFE');
   const descriptor=fs.openSync(target,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK),hash=createHash('sha256');let bytes=0;
   try{const buffer=Buffer.alloc(262144);for(;;){const n=fs.readSync(descriptor,buffer,0,buffer.length,null);if(!n)break;bytes+=n;hash.update(buffer.subarray(0,n));}required(bytes===Number(st.size)&&pin(st)===pin(fs.fstatSync(descriptor,{bigint:true}))&&pin(st)===pin(fs.lstatSync(target,{bigint:true})),'PROTECTED_FILE_SOURCE_CHANGED');fs.fsyncSync(descriptor);}finally{fs.closeSync(descriptor);}
   files.push({key:prefix+name,bytes,sha256:hash.digest('hex')});total+=bytes;required(files.length<=10000&&total<=32*1024**3,'PROTECTED_FILE_SOURCE_CAPACITY');
  }
  required(pin(before)===pin(fs.lstatSync(directory,{bigint:true})),'PROTECTED_FILE_SOURCE_CHANGED');
 }
 await walk(root,'');files.sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);return {files,directories,identity:{device:String(rootStat.dev),inode:String(rootStat.ino)}};
}
async function start(){
 required(process.platform==='linux'&&process.getuid!()===0&&process.argv[2]==='adopt-initial-file-baseline'&&process.argv.length===3,'PROTECTED_FILE_BASELINE_FIXED_COMMAND');
 const start=await new Promise<Buffer>((resolve,reject)=>{const chunks:Buffer[]=[];let bytes=0;process.stdin.on('data',chunk=>{bytes+=chunk.length;if(bytes>4)reject(Error('PROTECTED_FILE_BASELINE_PIPE_INVALID'));else chunks.push(chunk);});process.stdin.once('end',()=>resolve(Buffer.concat(chunks)));process.stdin.once('error',reject);});
 required(start.equals(Buffer.from('RUN\n')),'PROTECTED_FILE_BASELINE_PIPE_INVALID');
 const {assertRuntimeControlOwnership}=await import('../services/runtimeControlOwnership');assertRuntimeControlOwnership();
 const {prisma,disconnectDatabase}=await import('../lib/prisma');
 try{
  const {ProtectedLegacyFileAdoptionAuthority}=await import('../services/protectedLegacyFileAdoptionAuthority');
  const {protectedLegacyFileRoots}=await import('../services/protectedLegacyFileRoots');
  const {VersionedFilePublication}=await import('../services/versionedFilePublication');
  const captureId=process.env.PROTECTED_FILE_ADOPTION_CAPTURE_ID!;required(/^[a-f0-9]{64}$/.test(captureId),'PROTECTED_FILE_CAPTURE_ID_REQUIRED');
  const owner={deploymentId:process.env.DEPLOYMENT_ID!,releaseId:process.env.DEPLOYMENT_RELEASE_ID!,leaseToken:process.env.DEPLOYMENT_LEASE_TOKEN!};
  const sources=protectedLegacyFileRoots();
  const authorities:Array<Awaited<ReturnType<typeof ProtectedLegacyFileAdoptionAuthority.open>>>=[];
  for(const source of sources)authorities.push(await ProtectedLegacyFileAdoptionAuthority.open(prisma,owner,source,captureId));
  const checkpoint=JSON.parse(fs.readFileSync('/app/recovery-coordination/deployment-checkpoint.json','utf8'));
  const selected:Array<{source:(typeof sources)[number];current:Awaited<ReturnType<typeof inventory>>}>=[];
  // Verify every acknowledged original against the already decrypted/restored
  // local and remote-identical checkpoint BEFORE chmod/store/intent mutation.
  for(const source of sources){
   required(!fs.existsSync(source.root),'PROTECTED_FILE_BASELINE_STORE_ALREADY_EXISTS');const current=await inventory(source.liveRoot);
   const relative=path.relative('/app',source.liveRoot),prefix=relative.startsWith('storage/')?'files/'+relative.slice(8):'files/'+relative;
   const components=checkpoint.manifest.components.filter((value:any)=>value.path.startsWith(prefix+'/')).map((value:any)=>({key:value.path.slice(prefix.length+1),bytes:value.size,sha256:value.sha256})).sort((a:File,b:File)=>a.key<b.key?-1:a.key>b.key?1:0);
   required(encoded(components).equals(encoded(current.files)),'PROTECTED_FILE_BASELINE_CHECKPOINT_INVENTORY_MISMATCH');selected.push({source,current});
  }
  const coordination='/app/recovery-coordination',intent=path.join(coordination,'protected-file-baseline-'+captureId+'.intent.json');
  const fd=fs.openSync(intent,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o400);
  try{fs.writeFileSync(fd,encoded({format:'sabalan-protected-file-baseline-intent/v1',captureId,deploymentId:owner.deploymentId,releaseId:owner.releaseId,checkpointChecksum:checkpoint.checksum,sources:selected.map(value=>({liveRoot:value.source.liveRoot,storeRoot:value.source.root,inventorySha256:sha(encoded(value.current.files)),...value.current.identity}))}));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  const parent=path.join(coordination,'online-file-versions');if(!fs.existsSync(parent))fs.mkdirSync(parent,{mode:0o700});required(fs.realpathSync(parent)===parent&&(fs.lstatSync(parent).mode&0o077)===0,'PROTECTED_FILE_STORE_PARENT_UNSAFE');
  const roots:OnlineRetainedRoot[]=[];
  for(let i=0;i<selected.length;i++){
   const {source,current}=selected[i],authority=authorities[i];await authority.assertLease();
   for(const directory of current.directories){authority.assertOwned();const before=fs.lstatSync(directory,{bigint:true});fs.chmodSync(directory,0o700);const after=fs.lstatSync(directory,{bigint:true});required(before.dev===after.dev&&before.ino===after.ino,'PROTECTED_FILE_BASELINE_LIVE_INODE_CHANGED');}
   fs.mkdirSync(source.root,{mode:0o700});const port=await VersionedFilePublication.openForProtectedLegacyAdoption(authority),proof=await port.adoptLegacy();
   required(encoded((await inventory(source.liveRoot)).files).equals(encoded(current.files)),'PROTECTED_FILE_BASELINE_ORIGINAL_BYTES_CHANGED');
   const live=fs.lstatSync(source.liveRoot,{bigint:true}),store=fs.lstatSync(source.root,{bigint:true});required(String(live.dev)===current.identity.device&&String(live.ino)===current.identity.inode,'PROTECTED_FILE_BASELINE_LIVE_INODE_CHANGED');
   roots.push({live:source.liveRoot,store:source.root,liveDevice:String(live.dev),liveInode:String(live.ino),storeDevice:String(store.dev),storeInode:String(store.ino),baselineSha256:proof.sha256});
  }
  const official='/app/storage/accounting-contracts/.official-reports';if(!fs.existsSync(official))fs.mkdirSync(official,{mode:0o700});required(fs.realpathSync(official)===official&&(fs.lstatSync(official).mode&0o077)===0,'PROTECTED_FILE_OFFICIAL_ROOT_UNSAFE');
  for(const authority of authorities)await authority.assertLease();
  const proof={format:'sabalan-protected-file-baseline/v1',captureId,deploymentId:owner.deploymentId,releaseId:owner.releaseId,checkpointChecksum:checkpoint.checksum,roots,publicOnlineAdmission:false};
  const output=path.join(coordination,'protected-file-baseline-'+captureId+'.json'),out=fs.openSync(output,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o400);
  try{fs.writeFileSync(out,encoded(proof));fs.fsyncSync(out);}finally{fs.closeSync(out);}
  const dir=fs.openSync(coordination,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
  console.log(JSON.stringify({event:'protected-file-baseline-complete',path:output,sha256:sha(encoded(proof)),retainedRoots:roots.length,publicOnlineAdmission:false}));
 }finally{await disconnectDatabase();}
}
start().catch(error=>{console.error(error);process.exitCode=1;});
