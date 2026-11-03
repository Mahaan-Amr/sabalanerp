const fs=require('node:fs'),path=require('node:path');
const {prisma,disconnectDatabase}=require('/app/dist/lib/prisma.js');
const {RECOVERY_ROOT,RECOVERY_COORDINATION_DIR,getRecoveryRuntimeState}=require('/app/dist/services/recoveryRuntime.js');
const {planLocalCheckpointCleanup}=require('/app/dist/services/deploymentCheckpointPolicy.js');
const mode=process.argv[2]||'--inventory';
const fail=code=>{throw Object.assign(new Error(code),{code})};
async function guard(){
 if(fs.existsSync(path.join(RECOVERY_COORDINATION_DIR,'deployment-maintenance.json'))||getRecoveryRuntimeState().mode!=='NORMAL')fail('CLEANUP_MAINTENANCE_ACTIVE');
 if(await prisma.deploymentOperation.count({where:{activeKey:{not:null}}}))fail('CLEANUP_DEPLOYMENT_ACTIVE');
 if(await prisma.recoveryOperation.count({where:{status:{in:['CREATING','VALIDATING','RESTORING','RECOVERING']}}}))fail('CLEANUP_RECOVERY_ACTIVE');
 const report=JSON.parse(fs.readFileSync(path.join(RECOVERY_COORDINATION_DIR,'deployment-report.json'),'utf8'));
 const operation=await prisma.deploymentOperation.findUniqueOrThrow({where:{id:report.deploymentId},select:{phase:true,activeKey:true}});
 if(!['COMPLETED','ABORTED','ROLLED_BACK'].includes(operation.phase)||operation.activeKey!==null)fail('CLEANUP_RELEASE_NOT_TERMINAL');
 const response=await fetch('http://127.0.0.1:5000/api/ready',{signal:AbortSignal.timeout(5000)});if(response.status!==200)fail('CLEANUP_RELEASE_NOT_READY');
 const checkpoint=JSON.parse(fs.readFileSync(path.join(RECOVERY_COORDINATION_DIR,'deployment-checkpoint.json'),'utf8'));
 if(!checkpoint.localVerified||!checkpoint.remoteVerified||!checkpoint.manifestReadable)fail('CLEANUP_CHECKPOINT_UNVERIFIED');
 return checkpoint.deploymentId||checkpoint.id;
}
(async()=>{
 const protectedId=await guard();const root=fs.realpathSync(path.join(RECOVERY_ROOT,'packages'));
 const rows=fs.readdirSync(root).filter(n=>n.startsWith('deploy-')&&n.endsWith('.sabrec.json')).flatMap(name=>{try{
  const metadataFile=path.join(root,name),r=JSON.parse(fs.readFileSync(metadataFile,'utf8'));const archiveFile=path.join(root,name.slice(0,-5));
  if(!r.id||!Number.isFinite(r.size)||!Number.isFinite(new Date(r.createdAt).getTime())||!/^[a-f0-9]{64}$/i.test(r.checksum))return[];
  if(path.resolve(r.archivePath)!==archiveFile||path.resolve(r.metadataPath)!==metadataFile||!fs.lstatSync(archiveFile).isFile()||!fs.lstatSync(metadataFile).isFile()||fs.realpathSync(archiveFile)!==archiveFile||fs.realpathSync(metadataFile)!==metadataFile||fs.statSync(archiveFile).size!==r.size)return[];
  return[{id:r.id,createdAt:r.createdAt,createdAtRaw:r.createdAt,remotePath:r.remotePath,size:r.size,checksum:r.checksum,remoteVerified:r.remoteVerified===true,active:r.active===true||r.id===protectedId,incidentOpen:r.incidentOpen===true,archiveName:path.basename(archiveFile),remoteDirectory:path.basename(path.dirname(r.remotePath||'')),archiveFile,metadataFile}];
 }catch{return[]}});
 if(mode==='--inventory'){console.log(JSON.stringify(rows.map(({archiveFile,metadataFile,remotePath,createdAtRaw,...r})=>r)));return;}
 if(!['--plan','--apply'].includes(mode))fail('CLEANUP_INVALID_MODE');
 const proofPath=process.argv[3];if(!proofPath)fail('CLEANUP_PROOF_REQUIRED');
 const proofs=JSON.parse(fs.readFileSync(proofPath,'utf8').replace(/^\uFEFF/,''));const byId=new Map(proofs.map(r=>[r.id,r]));
 const artifacts=rows.map(r=>{const p=byId.get(r.id);const age=p?Date.now()-new Date(p.checkedAt).getTime():Infinity;return{...r,createdAt:new Date(r.createdAt),remoteVerified:r.remoteVerified&&p?.verified===true&&p.windowsDirectFullRead===true&&p.checksum===r.checksum&&p.size===r.size&&p.archiveName===r.archiveName&&p.remoteDirectory===r.remoteDirectory&&age>=0&&age<=300000}});
 const eligible=artifacts.filter(r=>r.remoteVerified&&!r.active&&!r.incidentOpen).sort((a,b)=>b.createdAt-a.createdAt).slice(2);
 const plan=planLocalCheckpointCleanup({artifacts,bytesNeeded:eligible.reduce((s,r)=>s+r.size,0),minimumSuccessfulLocal:2});
 const output={mode,protectedCheckpoint:protectedId,deleteIds:plan.deleteIds,reclaimedBytes:plan.reclaimedBytes,protectedUnverified:artifacts.filter(r=>!r.remoteVerified).length,minimumSuccessfulLocal:2};
 if(mode==='--apply'){
  const audit=path.join(RECOVERY_ROOT,'audit','deployment-retention.jsonl');fs.mkdirSync(path.dirname(audit),{recursive:true});
  for(const id of plan.deleteIds){
   if(await guard()!==protectedId)fail('CLEANUP_CHECKPOINT_CHANGED');
   const r=artifacts.find(a=>a.id===id);if(!r||r.active||r.incidentOpen||!r.remoteVerified)fail('CLEANUP_PROTECTED_ARTIFACT');
   if(fs.realpathSync(r.archiveFile)!==r.archiveFile||fs.realpathSync(r.metadataFile)!==r.metadataFile||!r.archiveFile.startsWith(root+path.sep)||!r.metadataFile.startsWith(root+path.sep))fail('CLEANUP_PATH_UNSAFE');
   const p=byId.get(id);const proofAge=p?Date.now()-new Date(p.checkedAt).getTime():Infinity;if(proofAge<0||proofAge>300000)fail('CLEANUP_PROOF_EXPIRED');
   const current=JSON.parse(fs.readFileSync(r.metadataFile,'utf8'));if(current.id!==r.id||current.createdAt!==r.createdAtRaw||path.resolve(current.archivePath)!==r.archiveFile||path.resolve(current.metadataPath)!==r.metadataFile||current.remotePath!==r.remotePath||current.remoteVerified!==true||current.checksum!==r.checksum||current.size!==r.size||current.active===true||current.incidentOpen===true||fs.statSync(r.archiveFile).size!==r.size)fail('CLEANUP_ARTIFACT_CHANGED');
   const entry={at:new Date().toISOString(),id:r.id,size:r.size,checksum:r.checksum,reason:'REMOTE_VERIFIED_RETENTION_PRUNE',proof:'WINDOWS_INDEPENDENT_FULL_READ_AND_SIDECAR',result:'PLANNED'};
   fs.appendFileSync(audit,JSON.stringify(entry)+'\n',{mode:0o600});fs.unlinkSync(r.archiveFile);fs.unlinkSync(r.metadataFile);fs.appendFileSync(audit,JSON.stringify({...entry,at:new Date().toISOString(),result:'DELETED'})+'\n',{mode:0o600});
  }
 }
 console.log(JSON.stringify(output));
})().catch(e=>{console.error(JSON.stringify({ok:false,code:e.code||'CLEANUP_FAILED'}));process.exitCode=1}).finally(disconnectDatabase);
