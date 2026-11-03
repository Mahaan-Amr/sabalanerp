/** Fixed canonical nine-root layout for a genuine live restored B scope. No authority is minted here. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash,randomBytes}=require('node:crypto');
const {produce}=require('./lineage.cjs');
const sha=b=>createHash('sha256').update(b).digest('hex'),canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v,bytes=v=>Buffer.from(JSON.stringify(canonical(v))+'\n');
const retained=['storage/contracts','storage/hr-hiring','storage/accounting-contracts','storage/dispatch-documents','storage/support-tickets','storage/performance-exports','uploads/images','uploads/security-shift-log','uploads/security-vehicle-pairs'];
function mkdir(p){fs.mkdirSync(p,{mode:0o700});const s=fs.lstatSync(p);assert.ok(s.isDirectory()&&!s.isSymbolicLink()&&s.uid===0&&!(s.mode&0o077));}
function ancestors(base,relative){let cur=base;for(const part of relative.split('/')){assert.ok(part&&part!=='.'&&part!=='..'&&!part.includes('\\'));cur=path.join(cur,part);if(!fs.existsSync(cur))mkdir(cur);else{const s=fs.lstatSync(cur);assert.ok(s.isDirectory()&&!s.isSymbolicLink()&&s.uid===0&&!(s.mode&0o077));}}return cur;}
function save(file,raw){const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o400);try{fs.writeFileSync(fd,raw);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}const parent=fs.openSync(path.dirname(file),fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}assert.deepEqual(fs.readFileSync(file),raw);return{path:file,sha256:sha(raw)};}
function snapshot(root){
 assert.equal(fs.realpathSync(root),root);
 const files=[],directories=[];
 const identity=s=>['dev','ino','mode','nlink','size','mtimeNs','ctimeNs'].map(k=>String(s[k])).join(':');
 const rootStat=fs.lstatSync(root,{bigint:true});
 function walk(dir,relative=''){
  const before=fs.lstatSync(dir,{bigint:true});
  assert.ok(before.isDirectory()&&!before.isSymbolicLink()&&before.uid===0n&&!(before.mode&0o022n)&&before.dev===rootStat.dev);
  for(const name of fs.readdirSync(dir).sort()){
   const full=path.join(dir,name),key=relative?relative+'/'+name:name,s=fs.lstatSync(full,{bigint:true});
   assert.ok(!s.isSymbolicLink()&&s.uid===0n&&!(s.mode&0o022n)&&s.dev===rootStat.dev);
   if(s.isDirectory()){
    directories.push(key);assert.ok(directories.length<=10000);walk(full,key);
   }else{
    assert.ok(s.isFile()&&s.nlink===1n&&s.size<=2n*1024n**3n);
    const fd=fs.openSync(full,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
    try{
     const before=fs.fstatSync(fd,{bigint:true}),h=createHash('sha256'),buffer=Buffer.alloc(262144);let count=0;
     for(;;){const n=fs.readSync(fd,buffer,0,buffer.length,null);if(!n)break;count+=n;assert.ok(BigInt(count)<=s.size);h.update(buffer.subarray(0,n));}
     assert.equal(count,Number(s.size));assert.equal(identity(before),identity(s));
     assert.equal(identity(before),identity(fs.fstatSync(fd,{bigint:true})));assert.equal(identity(s),identity(fs.lstatSync(full,{bigint:true})));
     files.push({key,bytes:count,sha256:h.digest('hex')});assert.ok(files.length<=10000);
    }finally{fs.closeSync(fd);}
   }
  }
  assert.equal(identity(before),identity(fs.lstatSync(dir,{bigint:true})));
 }
 walk(root);files.sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);directories.sort();return{files,directories};
}
function rootIdentity(root){const s=fs.lstatSync(root,{bigint:true});assert.equal(fs.realpathSync(root),root);assert.ok(s.isDirectory()&&!s.isSymbolicLink());return[s.dev,s.ino,s.uid,s.mode].map(String).join(':');}
function copyRoot(source,dest,snap){
 for(const directory of snap.directories)ancestors(dest,directory);
 for(const row of snap.files){
  const src=path.join(source,row.key),target=path.join(dest,row.key),parts=row.key.split('/');parts.pop();
  if(parts.length)ancestors(dest,parts.join('/'));
  const fd=fs.openSync(src,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  try{
   const out=fs.openSync(target,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
   try{
    const before=fs.fstatSync(fd,{bigint:true}),h=createHash('sha256'),buffer=Buffer.alloc(262144);let count=0;
    for(;;){const n=fs.readSync(fd,buffer,0,buffer.length,null);if(!n)break;h.update(buffer.subarray(0,n));count+=n;assert.ok(count<=row.bytes);fs.writeFileSync(out,buffer.subarray(0,n));}
    assert.equal(count,row.bytes);assert.equal(h.digest('hex'),row.sha256);
    const identity=s=>['dev','ino','mode','nlink','size','mtimeNs','ctimeNs'].map(k=>String(s[k])).join(':');
    assert.equal(identity(before),identity(fs.fstatSync(fd,{bigint:true})));assert.equal(identity(before),identity(fs.lstatSync(src,{bigint:true})));
    fs.fsyncSync(out);
   }finally{fs.closeSync(out);}
  }finally{fs.closeSync(fd);}
 }
 assert.deepEqual(snapshot(dest),snap);
}
function createLayout({context,view,sourceDatabase,sourceOwned,assertActive}){
 assert.equal(process.platform,'linux');assert.equal(process.getuid(),0);assertActive();assert.match(view.root,/^\/app\/runtime-authority\/application-native-[a-f0-9]{32}\/restored-complete-app$/);assert.equal(process.cwd(),view.root);assert.equal(context.database,undefined); // database identity belongs to the opaque proof/view, not a caller context alias.
 const root=path.join(view.root,'coherent-private');mkdir(root);const coordination=ancestors(root,'coordination'),qualificationId=randomBytes(32).toString('hex'),app=ancestors(coordination,'private-qualifications/'+qualificationId+'/restored-app');
 const sources=retained.map((relative,i)=>{assertActive();const source=path.join(view.root,relative),live=ancestors(app,relative),store=ancestors(app,'.versions/root-'+i),snap=snapshot(source),prefix='files/'+relative.replace(/^storage\//,'');const expected=context.manifest.components.filter(c=>c.path.startsWith(prefix+'/')).map(c=>({key:c.path.slice(prefix.length+1),bytes:c.size,sha256:c.sha256})).sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);assert.deepEqual(snap.files,expected);copyRoot(source,live,snap);return{name:'root-'+i,liveRoot:live,storeRoot:store,...snap};});
 for(const n of['reports','sales-reports','bi-reports'])ancestors(app,'storage/'+n);
 const produced=produce(context.manifest,{database:view.database,sourceDatabase,sourceManifestValueSha256:view.sourceManifestValueSha256},context.proof.rawHistoryJson,sources);
 const complete=save(root+'/complete-manifest-value.json',produced.completeManifestValueRaw),working=save(root+'/working-manifest-value.json',produced.workingManifestValueRaw);
 save(root+'/native-history-value.json',Buffer.from(context.proof.rawHistoryJson));
 for(const n of['online/native','online/work','online/admission/staging'])ancestors(coordination,n);
 const lock=name=>{const file=coordination+'/'+name,fd=fs.openSync(file,fs.constants.O_RDWR|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);try{fs.fsyncSync(fd);const s=fs.fstatSync(fd,{bigint:true});return{file,device:String(s.dev),inode:String(s.ino),ownerUid:0};}finally{fs.closeSync(fd);}};
 const gate=lock('deployment-write-admission.lock'),interlock=lock('deployment-runtime-control.lock'),worker=lock('deployment-online-worker.lock'),definition=bytes({format:'sabalan-online-admission-scope/v1',gate,interlock,worker,database:{systemIdentifier:view.database.systemIdentifier,name:view.database.name}});
 save(coordination+'/online/admission/scope.json',definition);save(coordination+'/online/admission/00000000.json',bytes({format:'sabalan-online-capture-admission/v1',generation:0,phase:'OPEN',previousSha256:null,capture:null,closureSha256:null}));
 const grant=purpose=>{const runtimeId=randomBytes(32).toString('hex'),nativeDirectory=ancestors(coordination,'online/native/'+runtimeId),boundaryDirectory=ancestors(coordination,'online/work/'+runtimeId);save(nativeDirectory+'/deployment-runtime-control.lock',Buffer.alloc(0));fs.chmodSync(nativeDirectory+'/deployment-runtime-control.lock',0o600);const scope={format:'sabalan-online-runtime-scope/v2',runtimeId,releaseId:sourceOwned.releaseId,manifestSha256:sourceOwned.runtime.distTreeSha256,sourceCommit:sourceOwned.sourceCommit,image:sourceOwned.image,nonce:randomBytes(32).toString('hex'),purpose,role:purpose==='http'?'serving':'control',coordinationDirectory:coordination,nativeDirectory,boundaryDirectory,gate,interlock,worker:purpose==='http'?null:worker,database:{systemIdentifier:view.database.systemIdentifier,name:view.database.name},admission:{directory:coordination+'/online/admission',scopeSha256:sha(definition)}};save(boundaryDirectory+'/scope.json',bytes({format:'sabalan-runtime-namespace/v1',scope:{runtimeId,image:scope.image,registrySha256:scope.manifestSha256,generation:1,gate:{device:gate.device,inode:gate.inode,ownerUid:0},postgresApplicationName:'sabalan-rt-'+sha(runtimeId).slice(0,48)}}));const raw=bytes(scope);return{scope,file:'/run/sabalan-online/'+runtimeId+'.json',sha256:sha(raw),raw};};
 const baselineGrant=grant('jobs'),httpGrant=grant('http'),jobsGrant=grant('jobs'),index={sourceDatabaseRole:'VERIFIED_COMPLETE_RESTORED_QA',database:sourceDatabase.name,oid:sourceDatabase.oid,restoredDatabase:view.database.name,restoredOid:view.database.oid,schemaSha256:sourceOwned.runtime.schemaSha256,grants:[],restoredBaselineGrant:baselineGrant,restoredQaLineage:produced.lineage,privateQualification:{qualificationId,runtimeBundleSha256:sourceOwned.runtime.distTreeSha256,qualificationRoot:app,httpGrant,jobsGrant}};
 // Raw public bytes are carried separately and removed from signed/index objects.
 const publicGrants=[baselineGrant,httpGrant,jobsGrant].map(g=>({name:g.scope.runtimeId+'.json',rawBase64:g.raw.toString('base64'),sha256:g.sha256}));for(const g of[baselineGrant,httpGrant,jobsGrant])delete g.raw;
 const captureId=sha(bytes({sourceManifest:complete.sha256,database:view.database,operation:sourceOwned.operation}));
 const baselineInput={format:'sabalan-independent-restored-baseline-input/v1',qualificationRoot:app,captureId,checkpointSha256:sourceOwned.checkpointChecksum,captureSource:'live-verified-complete-restored-qa',restoredQaLineage:produced.lineage,originalRestoreOutput:complete,database:view.database,roots:sources.map(r=>({name:r.name,live:r.liveRoot,store:r.storeRoot})),outputManifest:root+'/restored-file-baseline.json'};
 const identities=new Map(sources.flatMap(row=>[row.liveRoot,row.storeRoot]).map(root=>[root,rootIdentity(root)]));
 assertActive();return{root,coordination,app,index,publicGrants,baselineInput,complete,working,sources,revalidate(){assertActive();for(const[root,id]of identities)assert.equal(rootIdentity(root),id);for(const row of sources){assert.deepEqual(snapshot(row.liveRoot),{files:row.files,directories:row.directories});}assert.equal(sha(fs.readFileSync(complete.path)),complete.sha256);assert.equal(sha(fs.readFileSync(working.path)),working.sha256);},save:(name,raw)=>{assert.equal(path.basename(name),name);return save(root+'/'+name,raw);}};
}
module.exports={createLayout,snapshot};
