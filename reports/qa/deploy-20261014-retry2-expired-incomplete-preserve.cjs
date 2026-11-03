const fs=require('fs'),path=require('path'),crypto=require('crypto'),{execFileSync}=require('child_process');
const cwd='/opt/sabalanerp',id='deploy-20261014T020913Z-725afe3c1725-release';
const run=(cmd,args)=>execFileSync(cmd,args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const fail=code=>{throw new Error(code)};
(async()=>{
run('docker',['compose','--env-file','deploy/.env.prod','-f','docker-compose.prod.yml','ps']);
const containers=JSON.parse(run('docker',['inspect',...['backend','frontend','inquiry','nginx','postgres','clamav'].map(s=>'sabalanerp-'+s+'-1')]));
if(containers.some(c=>c.State.Status!=='running'||c.State.Health?.Status!=='healthy'))fail('SERVICES_UNHEALTHY');
const coord=containers[0].Mounts.find(m=>m.Destination==='/app/recovery-coordination')?.Source;
const recovery=containers[0].Mounts.find(m=>m.Destination==='/app/storage/recovery')?.Source;if(!coord||!recovery)fail('MOUNT_MISSING');
if(fs.existsSync(path.join(coord,'deployment-maintenance.json'))||JSON.parse(fs.readFileSync(path.join(coord,'state.json'),'utf8')).mode!=='NORMAL')fail('MAINTENANCE_ACTIVE');
const env=fs.readFileSync(cwd+'/deploy/.env.prod','utf8'),reports=env.match(/^DEPLOYMENT_REPORT_DIR_HOST=(.*)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g,'');
if(!reports||fs.existsSync(path.resolve(cwd,reports,'active-deployment-session.json')))fail('SESSION_ACTIVE');
const query='const {prisma,disconnectDatabase}=require("/app/dist/lib/prisma.js");(async()=>console.log(JSON.stringify({operation:await prisma.deploymentOperation.findUniqueOrThrow({where:{id:"'+id+'"},select:{id:true,targetCommit:true,phase:true,activeKey:true,leaseExpiresAt:true,completedAt:true,checkpointJson:true}}),active:await prisma.deploymentOperation.count({where:{activeKey:{not:null}}}),recovery:await prisma.recoveryOperation.count({where:{status:{in:["CREATING","VALIDATING","RESTORING","RECOVERING"]}}}),runningCommit:process.env.APP_COMMIT,performanceCommit:process.env.PERFORMANCE_RELEASE_COMMIT})))().finally(disconnectDatabase)';
const state=JSON.parse(run('docker',['exec','sabalanerp-backend-1','node','-e',query]));
if(state.active||state.recovery||state.operation.phase!=='ABORTED'||state.operation.activeKey!==null||state.operation.targetCommit!=='725afe3c1725715d4aabe9004cbe39a9abb8c2fc'||!Number.isFinite(Date.parse(state.operation.completedAt))||!Number.isFinite(Date.parse(state.operation.leaseExpiresAt))||Date.parse(state.operation.leaseExpiresAt)>=Date.now()||state.runningCommit!==state.performanceCommit||state.runningCommit!=='129b1f970e1a65de425c921f377f594ddb8549a0')fail('TERMINAL_STATE_UNPROVEN');
if(process.argv[2]==='--stop-orphan'){
 const orphan=JSON.parse(run('docker',['inspect','725f5e0575d8']))[0];
 if(orphan.Name!=='/sabalanerp-deployment-run-00ea7e2df7a9'||orphan.Config.Labels?.['com.docker.compose.service']!=='deployment'||orphan.Config.Labels?.['com.docker.compose.project']!=='sabalanerp'||orphan.Config.Labels?.['com.docker.compose.oneoff']!=='True'||JSON.stringify(orphan.Config.Cmd)!==JSON.stringify(['node','dist/scripts/deployment-checkpoint.js'])||orphan.State.Status!=='running')fail('ORPHAN_IDENTITY_UNPROVEN');
 run('docker',['stop','--time','20',orphan.Id]);console.log(JSON.stringify({ok:true,stoppedExpiredOrphan:orphan.Id,phase:'ABORTED',leaseExpired:true}));return;
}
const archive=path.join(recovery,'packages',id+'.sabrec');
if(fs.existsSync(archive+'.json')||fs.realpathSync(archive)!==archive||!fs.lstatSync(archive).isFile())fail('NOT_EXPIRED_INCOMPLETE');
const current=JSON.parse(fs.readFileSync(path.join(coord,'deployment-checkpoint.json'),'utf8'));
if(!current.localVerified||!current.remoteVerified||!current.manifestReadable||JSON.stringify(current).includes(id)||JSON.stringify(state.operation.checkpointJson).includes(id))fail('CHECKPOINT_PROTECTED');
for(const n of fs.readdirSync(path.join(recovery,'packages')).filter(n=>n.endsWith('.sabrec.json')))if(fs.readFileSync(path.join(recovery,'packages',n),'utf8').includes(id))fail('RETAINED_CHECKPOINT_REFERENCE');
const proof=JSON.parse(fs.readFileSync(cwd+'/reports/qa/deploy-20261014-retry2-incomplete-offsite-proof.json','utf8').replace(/^\uFEFF/,''));
const age=Date.now()-Date.parse(proof.checkedAt);
if(proof.id!==id||proof.size!==893174498||proof.checksum!=='e15d6790f4ba664fc188612ae41b6e9d169bfb6362415fc2916c71123cbcd175'||proof.verified!==true||proof.windowsDirectFullRead!==true||!Number.isFinite(age)||age<0||age>300000||proof.preservedPath!=='D:/SabalanERP-Offsite-Recovery/20261014T020913Z-725afe3c1725-release/'+id+'.expired-incomplete-preserved-20261014.sabrec')fail('OFFSITE_PROOF_INVALID');
const before=fs.statSync(archive),hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(archive,{highWaterMark:1024*1024}))hash.update(chunk);
const after=fs.statSync(archive);if(before.size!==proof.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||hash.digest('hex')!==proof.checksum||Date.now()-Date.parse(proof.checkedAt)>300000)fail('LOCAL_COPY_CHANGED');
const audit=cwd+'/reports/qa/expired-incomplete-retention-20261014.jsonl';const entry={at:new Date().toISOString(),id,size:proof.size,checksum:proof.checksum,reason:'EXPIRED_INCOMPLETE_ARTIFACT_PRESERVED_OFFSERVER',offsiteProof:proof.preservedPath,checkpointSuccessful:false,result:'PLANNED'};
fs.appendFileSync(audit,JSON.stringify(entry)+'\n',{mode:0o600});fs.unlinkSync(archive);fs.appendFileSync(audit,JSON.stringify({...entry,at:new Date().toISOString(),result:'LOCAL_COPY_DELETED_OFFSITE_PRESERVED'})+'\n',{mode:0o600});
const privateBackup=cwd+'/.deploy-state/env-before-checkpoint-budget-20261014-retry2';if(fs.existsSync(privateBackup))fail('PRIVATE_BACKUP_EXISTS');fs.writeFileSync(privateBackup,env,{mode:0o600,flag:'wx'});
const updated=/^DEPLOYMENT_CHECKPOINT_TIMEOUT_SECONDS=.*$/m.test(env)?env.replace(/^DEPLOYMENT_CHECKPOINT_TIMEOUT_SECONDS=.*$/m,'DEPLOYMENT_CHECKPOINT_TIMEOUT_SECONDS=14400'):env+'\nDEPLOYMENT_CHECKPOINT_TIMEOUT_SECONDS=14400\n';
const envPath=cwd+'/deploy/.env.prod',temp=envPath+'.checkpoint-budget-20261014-retry2.pending';if(fs.readFileSync(envPath,'utf8')!==env)fail('ENV_CHANGED');const fd=fs.openSync(temp,'wx',0o600);try{fs.writeFileSync(fd,updated);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}if(fs.readFileSync(envPath,'utf8')!==env)fail('ENV_CHANGED');fs.renameSync(temp,envPath);const dir=fs.openSync(path.dirname(envPath),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}if(fs.readFileSync(envPath,'utf8')!==updated)fail('ENV_UPDATE_UNPROVEN');
const stat=fs.statfsSync(cwd);console.log(JSON.stringify({ok:true,id,localBytesReclaimed:proof.size,offsitePreserved:true,checkpointTimeoutSeconds:14400,runningCommit:state.runningCommit,availableBytes:stat.bavail*stat.bsize}));
})().catch(()=>{console.error(JSON.stringify({ok:false,code:'EXPIRED_INCOMPLETE_CLEANUP_FAILED'}));process.exitCode=1});
