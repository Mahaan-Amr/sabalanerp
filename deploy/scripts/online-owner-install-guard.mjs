/** Read-only initial owner installation guard, under the installer's original
 * inherited production FD9. It cannot deploy, sign, repair or admit traffic. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {validatePrebuiltReleasePlan} from './prebuilt-release-plan.mjs';
import {productionImageStore} from './production-image-execution-binding.mjs';

const require=createRequire(import.meta.url),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const canonical=value=>value instanceof Date?value.toISOString():Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const bytes=value=>Buffer.from(JSON.stringify(canonical(value)));
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const pin=st=>['dev','ino','uid','gid','mode','nlink','size','mtimeNs','ctimeNs'].map(key=>String(st[key]));
const directoryPin=st=>['dev','ino','uid','gid','mode'].map(key=>String(st[key]));
const digest=/^[a-f0-9]{64}$/;
function read(file,expected,mode,maximum=128*1024**2){
 assert.ok(path.isAbsolute(file)&&fs.realpathSync(file)===file);assert.match(expected,digest);
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{const before=fs.fstatSync(fd,{bigint:true});assert.ok(before.isFile()&&before.uid===0n&&before.nlink===1n&&before.size>0n&&before.size<=BigInt(maximum)&&!(before.mode&0o022n));
  if(mode!==undefined)assert.equal(before.mode&0o777n,BigInt(mode));
  const raw=fs.readFileSync(fd);assert.equal(sha(raw),expected);assert.deepEqual(pin(before),pin(fs.fstatSync(fd,{bigint:true})));assert.deepEqual(pin(before),pin(fs.lstatSync(file,{bigint:true})));return raw;
 }finally{fs.closeSync(fd);}
}
function absent(file){try{fs.lstatSync(file);}catch(error){if(error.code==='ENOENT')return;throw error;}throw Error('ONLINE_INSTALL_ACTIVE_MARKER');}
function installationFiles(renewalRoot){
 const files=['/opt/sabalanerp/deploy/.env.prod','/opt/sabalanerp/deploy/nginx/nginx.conf','/opt/sabalanerp/deploy/nginx/conf.d/app.conf.template','/opt/sabalanerp/deploy/nginx/maintenance-check.conf','/opt/sabalanerp/deploy/nginx/maintenance.html'];
 const secrets='/opt/sabalanerp/deploy/secrets';
 try{const st=fs.lstatSync(secrets,{bigint:true});assert.ok(st.isDirectory()&&!st.isSymbolicLink()&&st.uid===0n&&!(st.mode&0o022n));
  for(const entry of fs.readdirSync(secrets,{withFileTypes:true})){assert.ok(entry.isFile()&&!entry.isSymbolicLink());files.push(path.join(secrets,entry.name));}
 }catch(error){if(error.code!=='ENOENT')throw error;}
 const fingerprint=file=>{assert.equal(fs.realpathSync(file),file);const named=fs.lstatSync(file,{bigint:true});assert.ok(named.isFile()&&!named.isSymbolicLink()&&named.uid===0n&&named.nlink===1n&&!(named.mode&0o022n)&&named.size<=32n*1024n**2n);
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  try{assert.deepEqual(pin(fs.fstatSync(fd,{bigint:true})),pin(named));const raw=fs.readFileSync(fd);assert.deepEqual(pin(fs.fstatSync(fd,{bigint:true})),pin(named));assert.deepEqual(pin(fs.lstatSync(file,{bigint:true})),pin(named));return{identity:pin(named),sha256:sha(raw)};}finally{fs.closeSync(fd);}};
 const protectedFiles=Object.fromEntries(files.sort().map(file=>[file,fingerprint(file)]));
 assert.ok(path.isAbsolute(renewalRoot)&&fs.realpathSync(renewalRoot)===renewalRoot);
 const renewalDirectory=fs.lstatSync(renewalRoot,{bigint:true});assert.ok(renewalDirectory.isDirectory()&&renewalDirectory.uid===0n&&!(renewalDirectory.mode&0o022n));
 const renewals=fs.readdirSync(renewalRoot,{withFileTypes:true});assert.ok(renewals.length>0&&renewals.length<=256);
 // Bind the complete actual mounted renewal inventory. Certificate names come
 // from the configured deployment and need not equal the repository name.
 for(const entry of renewals)assert.ok(entry.isFile()&&!entry.isSymbolicLink()&&/^[A-Za-z0-9_.-]+\.conf$/.test(entry.name));
 const cronFiles=Object.fromEntries(['/var/spool/cron/crontabs/root','/opt/sabalanerp/deploy/scripts/renew-cert.sh',...renewals.map(entry=>path.join(renewalRoot,entry.name)).sort()].map(file=>[file,fingerprint(file)]));
 return{protectedFiles,cronFiles};
}
export async function observeOriginalOwnerInstall(configurationFile,configurationSha256){
 const observedAt=new Date().toISOString();
 assert.equal(process.platform,'linux');assert.equal(process.getuid(),0);
 assert.match(configurationFile,/^\/opt\/sabalanerp\/\.deploy-state\/online-control-[a-f0-9]{32}\/launcher-config\.json$/);
 assert.ok(!Object.keys(process.env).some(key=>key.startsWith('LD_')||key.startsWith('DOCKER_')||key.startsWith('GIT_')||key==='NODE_OPTIONS'||key.startsWith('NODE_PRELOAD')));
 const configuration=JSON.parse(read(configurationFile,configurationSha256,0o600,8*1024**2));
 assert.equal(configuration.format,'sabalan-online-original-launcher/v1');assert.equal(configuration.repositoryRoot,'/opt/sabalanerp');
 assert.equal(configuration.environmentFile,'/opt/sabalanerp/deploy/.env.prod');assert.equal(configuration.sessionFile,'/opt/sabalanerp/reports/deploy/active-deployment-session.json');
 assert.equal(configuration.controllerConfig.project,'sabalanerp');assert.equal(configuration.controllerConfig.composeFile,'/opt/sabalanerp/docker-compose.prod.yml');
 const repository=configuration.repositoryRoot,lock=path.join(repository,'.deploy-state/deployment.lock');
 assert.equal(fs.realpathSync(lock),lock);const inherited=fs.fstatSync(9,{bigint:true});
 assert.ok(inherited.isFile()&&inherited.uid===0n&&inherited.nlink===1n&&inherited.size===0n&&(inherited.mode&0o777n)===0o600n);
 const originalLock=pin(inherited);
 const guard=()=>{assert.deepEqual(pin(fs.fstatSync(9,{bigint:true})),originalLock);assert.deepEqual(pin(fs.lstatSync(lock,{bigint:true})),originalLock);
  for(const file of [configuration.sessionFile,path.join(repository,'.deploy-state/pending-restore.json'),path.join(repository,'.deploy-state/deployment-maintenance.json')])absent(file);};
 guard();
 let protectedBefore,renewalRoot;
 const children=[];let interrupted=false;const listeners=['SIGINT','SIGTERM','SIGHUP'].map(name=>{const fn=()=>{interrupted=true;};process.on(name,fn);return[name,fn];});
 async function run(executable,args){
  guard();assert.equal(interrupted,false);
  const child=spawn(executable,args,{cwd:repository,shell:false,env:{...process.env,GIT_OPTIONAL_LOCKS:'0'},stdio:['ignore','pipe','pipe','ignore','ignore','ignore','ignore','ignore','ignore',9]});
  const state={child,closed:false,overflow:false,stdout:[],stderr:[],bytes:0};children.push(state);
  for(const[name,target]of[['stdout',state.stdout],['stderr',state.stderr]])child[name].on('data',chunk=>{state.bytes+=chunk.length;if(state.bytes<=16*1024**2)target.push(chunk);else state.overflow=true;});
  let fault=null;child.once('error',error=>{fault=error;});
  const result=await new Promise(resolve=>child.once('close',(code,signal)=>{state.closed=true;state.result={code,signal};resolve(state.result);}));
  guard();assert.equal(interrupted,false);assert.equal(fault,null);assert.deepEqual(result,{code:0,signal:null});assert.ok(!state.overflow&&child.stdout.readableEnded&&child.stderr.readableEnded);
  return Buffer.concat(state.stdout).toString('utf8');
 }
 const compose=['compose','--env-file',configuration.environmentFile,'-f',configuration.controllerConfig.composeFile,'-p','sabalanerp'];
 const daemon=['--host','unix:///var/run/docker.sock'];
 const status=()=>run('/usr/bin/docker',[...daemon,...compose,'ps','--format','json']);
 const docker=async args=>{await status();return run('/usr/bin/docker',[...daemon,...args]);};
 const git=async(...args)=>(await run('/usr/bin/git',['-c','core.fsmonitor=false',...args])).trim();
 let database,completed;
 try{
  const selected=configuration.prebuiltReleasePlan;assert.ok(selected&&Object.keys(selected).sort().join(',')==='file,sha256');
  const plan=JSON.parse(read(selected.file,selected.sha256,0o400,8*1024**2));
  assert.equal(plan.format,'sabalan-prebuilt-protected-release-plan/v1');assert.equal(plan.operations.receiptSha256,configuration.hostPackReceiptSha256);
  const receipt=JSON.parse(read(path.join(root,'host-pack-receipt.json'),configuration.hostPackReceiptSha256));assert.equal(receipt.format,'sabalan-online-controller-host-pack/v1');assert.equal(receipt.packagingComplete,true);
  const actual={head:await git('rev-parse','HEAD'),tree:await git('rev-parse','HEAD^{tree}'),status:await git('status','--porcelain','--untracked-files=all'),
   inquiryGitlink:await git('rev-parse','HEAD:apps/sabalan-inquiry'),inquiryHead:await git('-C','apps/sabalan-inquiry','rev-parse','HEAD'),inquiryStatus:await git('-C','apps/sabalan-inquiry','status','--porcelain','--untracked-files=all'),
   operations:{receiptSha256:configuration.hostPackReceiptSha256,files:{}},buildReceipts:{},archiveReceipts:{},images:{}};
  for(const[relative,reference]of Object.entries(receipt.outputs)){
   assert.match(relative,/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/);assert.ok(!relative.split('/').includes('..'));
   const raw=read(path.join(root,relative),reference.sha256);assert.equal(raw.length,reference.bytes);actual.operations.files[relative]=sha(raw);
  }
  actual.imageStore=productionImageStore(JSON.parse(await docker(['info','--format','{{json .}}'])));
  for(const role of ['backend','frontend','inquiry']){
   const selection=plan.images[role];assert.match(selection.image,/^sha256:[a-f0-9]{64}$/);
   actual.buildReceipts[role]=JSON.parse(read(selection.buildReceipt.file,selection.buildReceipt.sha256,0o400));
   actual.archiveReceipts[role]=JSON.parse(read(selection.archiveReceipt.file,selection.archiveReceipt.sha256,0o400));
   const rows=JSON.parse(await docker(['image','inspect',selection.image]));assert.equal(rows.length,1);actual.images[role]=rows[0];
  }
  validatePrebuiltReleasePlan(plan,actual);
  const ids=(await docker(['ps','--all','--no-trunc','--format','{{.ID}}'])).trim().split('\n').filter(Boolean).sort();assert.ok(ids.length>0&&ids.length<=1024);for(const id of ids)assert.match(id,/^[a-f0-9]{64}$/);
  const containers=JSON.parse(await docker(['inspect',...ids]));assert.equal(containers.length,ids.length);
  const fullConfiguration=rows=>sha(bytes(rows.map(row=>({id:row.Id,config:row.Config,hostConfig:row.HostConfig,mounts:row.Mounts,networks:row.NetworkSettings?.Networks})).sort((a,b)=>a.id.localeCompare(b.id))));
  const serviceConfigurationSha256=fullConfiguration(containers);
  const containerCensus=rows=>rows.map(row=>({id:row.Id,image:row.Image,startedAt:row.State.StartedAt,restarts:row.RestartCount,running:row.State.Running,health:row.State.Health?.Status??null,project:row.Config.Labels?.['com.docker.compose.project']??null,service:row.Config.Labels?.['com.docker.compose.service']??null})).sort((a,b)=>a.id.localeCompare(b.id));
  const census=containerCensus(containers);
  const mains=['backend','frontend','inquiry','nginx','postgres','clamav'];
  for(const name of mains){const rows=containers.filter(row=>row.Config.Labels?.['com.docker.compose.project']==='sabalanerp'&&row.Config.Labels?.['com.docker.compose.service']===name&&row.State.Running);
   assert.equal(rows.length,1);assert.equal(rows[0].State.Health?.Status,'healthy');}
  const nginx=containers.find(row=>row.Config.Labels?.['com.docker.compose.project']==='sabalanerp'&&row.Config.Labels?.['com.docker.compose.service']==='nginx'&&row.State.Running);
  const certificates=nginx.Mounts.filter(row=>row.Type==='volume'&&row.Destination==='/etc/letsencrypt');assert.equal(certificates.length,1);
  renewalRoot=path.join(certificates[0].Source,'renewal');protectedBefore=installationFiles(renewalRoot);
  const backend=containers.find(row=>row.Config.Labels?.['com.docker.compose.project']==='sabalanerp'&&row.Config.Labels?.['com.docker.compose.service']==='backend'&&row.State.Running);
  const coordination=backend.Mounts.filter(row=>row.Type==='volume'&&row.Destination==='/app/recovery-coordination');assert.equal(coordination.length,1);
  const coordinationRoot=coordination[0].Source;assert.equal(fs.realpathSync(coordinationRoot),coordinationRoot);const directory=fs.lstatSync(coordinationRoot,{bigint:true});assert.ok(directory.isDirectory()&&directory.uid===0n&&!(directory.mode&0o022n));
  absent(path.join(coordinationRoot,'deployment-maintenance.json'));
  const url=new URL(configuration.databaseUrl);assert.equal(url.protocol,'postgresql:');assert.equal(url.searchParams.get('connection_limit'),'1');assert.equal(url.searchParams.get('pool_timeout'),'10');
  const {PrismaClient}=require('./online-release-host-dependencies/node_modules/@prisma/client');database=new PrismaClient({datasources:{db:{url:url.href}}});
  const active=await database.$queryRaw`SELECT id FROM deployment_operations WHERE "activeKey" IS NOT NULL`;assert.equal(active.length,0,'ONLINE_INSTALL_ACTIVE_DATABASE_OPERATION');
  const[identity]=await database.$queryRaw`SELECT current_database() AS name,(pg_control_system()).system_identifier::text AS system`;
  assert.equal(identity.name,decodeURIComponent(url.pathname.slice(1)));assert.match(identity.system,/^[0-9]+$/);
  const ledger=await database.$queryRaw`SELECT migration_name,checksum,finished_at,rolled_back_at FROM "_prisma_migrations" ORDER BY started_at,id`;
  assert.ok(ledger.length>0&&ledger.length<=10000);
  assert.deepEqual((await docker(['ps','--all','--no-trunc','--format','{{.ID}}'])).trim().split('\n').filter(Boolean).sort(),ids,'ONLINE_INSTALL_CENSUS_CHANGED_DURING_OBSERVATION');
  const after=JSON.parse(await docker(['inspect',...ids]));
  assert.equal(fullConfiguration(after),serviceConfigurationSha256,'ONLINE_INSTALL_CONFIGURATION_CHANGED_DURING_OBSERVATION');
  assert.deepEqual(containerCensus(after),census,'ONLINE_INSTALL_INCARNATION_CHANGED_DURING_OBSERVATION');
  guard();absent(path.join(coordinationRoot,'deployment-maintenance.json'));assert.deepEqual(directoryPin(fs.lstatSync(coordinationRoot,{bigint:true})),directoryPin(directory));
  const baseline={applicationCommit:actual.head,applicationTree:actual.tree,inquiryCommit:actual.inquiryHead,configurationSha256,operationsReceiptSha256:configuration.hostPackReceiptSha256,
   lockIdentity:originalLock,containers:census,databaseIdentity:identity,migrationLedgerSha256:sha(bytes(ledger)),machineUuidSha256:sha(fs.readFileSync('/sys/class/dmi/id/product_uuid','utf8').trim().toLowerCase()),kernelBootIdSha256:sha(fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim().toLowerCase()),
   ...protectedBefore,serviceConfigurationSha256,activeLeaseCount:0,creationOnly:true};
  assert.ok(children.every(row=>row.closed&&row.result.code===0&&row.result.signal===null));assert.equal(interrupted,false);
  completed={format:'sabalan-original-owner-install-readonly-guard/v1',baselineSha256:sha(bytes(baseline)),baseline,originalChildren:children.map(row=>({pid:row.child.pid,...row.result})),readOnly:true,productionAdmission:false};
 }finally{
  try{if(database)await database.$disconnect();guard();assert.equal(interrupted,false);if(protectedBefore)assert.deepEqual(installationFiles(renewalRoot),protectedBefore,'ONLINE_INSTALL_PROTECTED_OR_CRON_CHANGED');}
  finally{for(const[name,listener]of listeners)process.off(name,listener);}
 }
 return {...completed,observedAt,completedAt:new Date().toISOString()};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{assert.equal(process.argv.length,4);console.log(JSON.stringify(await observeOriginalOwnerInstall(...process.argv.slice(2))));}
 catch{process.stderr.write('ONLINE_OWNER_INSTALL_GUARD_REFUSED\n');process.exitCode=1;}
}
