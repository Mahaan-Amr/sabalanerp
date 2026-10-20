/** Read-only incident verification. The original repair owner retains all mutation authority. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {originalServiceConfiguration,configurationBytes} from './capture-only-release.mjs';
import {verifyCanonicalPreviousReleaseConfiguration,canonicalConfigurationSha256} from './canonical-previous-release-configuration.mjs';

const ROOT='/opt/sabalanerp',ROLES=['backend','frontend','inquiry','nginx','postgres','clamav'];
const ORIGINAL_BACKEND='5f8f1063a5207864c7408336d94a4e80045bad60d1749b72957d5a274dc71080';
const FIXED_HOST_ENV={PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',HOME:'/root',DOCKER_HOST:'unix:///var/run/docker.sock'};
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const identity=s=>['dev','ino','size','mtimeNs','ctimeNs','uid','gid','mode','nlink'].map(key=>String(s[key]));
function privateRead(file,expected,{mode,maximum=16*1024*1024}={}){
 assert.ok(path.isAbsolute(file)&&fs.realpathSync(file)===file);const before=fs.lstatSync(file,{bigint:true});
 assert.ok(before.isFile()&&before.uid===0n&&before.nlink===1n&&(before.mode&0o022n)===0n&&before.size>0n&&before.size<=BigInt(maximum));
 if(mode!==undefined)assert.equal(before.mode&0o777n,BigInt(mode));
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{assert.deepEqual(identity(fs.fstatSync(fd,{bigint:true})),identity(before));const raw=fs.readFileSync(fd);assert.equal(sha(raw),expected);assert.deepEqual(identity(fs.fstatSync(fd,{bigint:true})),identity(before));assert.deepEqual(identity(fs.lstatSync(file,{bigint:true})),identity(before));return raw;}finally{fs.closeSync(fd);}
}
function lockCustody(){
 const file=ROOT+'/.deploy-state/deployment.lock';assert.equal(fs.realpathSync(file),file);const named=fs.lstatSync(file,{bigint:true}),held=fs.fstatSync(9,{bigint:true});
 assert.ok(named.isFile()&&named.uid===0n&&named.nlink===1n&&(named.mode&0o022n)===0n);assert.deepEqual(identity(held),identity(named));
 assert.ok(fs.readFileSync('/proc/self/fdinfo/9','utf8').split('\n').some(line=>/^lock:\s+\d+:\s+FLOCK\s+ADVISORY\s+WRITE\s+\S+\s+[0-9a-f]+:[0-9a-f]+:([0-9]+)\s+0\s+EOF\s*$/.exec(line)?.[1]===String(held.ino)));return identity(held);
}
export function verifyPremutationConfigurationRepair(proofFile,proofSha256){
 assert.equal(process.platform,'linux');assert.equal(process.getuid(),0);assert.equal(process.cwd(),ROOT);assert.match(proofSha256,/^[a-f0-9]{64}$/);
 const lock=lockCustody(),raw=privateRead(proofFile,proofSha256,{mode:0o400}),proof=JSON.parse(raw),children=[];
 assert.equal(proof.format,'sabalan-premutation-configuration-repair-proof/v1');assert.match(proof.sourceCommit,/^[a-f0-9]{40}$/);assert.equal(proof.deploymentId,'deploy-'+proof.releaseId);
 assert.equal(proof.envFile,ROOT+'/deploy/.env.prod');assert.equal(proof.composeFile,ROOT+'/docker-compose.prod.yml');assert.equal(proof.originalBackendContainerId,ORIGINAL_BACKEND);
 const snapshotRaw=privateRead(proof.snapshotFile,proof.snapshotSha256,{mode:0o400}),snapshot=JSON.parse(snapshotRaw);
 privateRead(proof.envFile,proof.envSha256,{mode:0o600});const composeRaw=privateRead(proof.composeFile,proof.composeSha256);
 function command(binary,args,env=FIXED_HOST_ENV){
  assert.deepEqual(lockCustody(),lock);const result=spawnSync(binary,args,{cwd:ROOT,env,encoding:null,maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe', 'ignore','ignore','ignore','ignore','ignore','ignore',9]});
  children.push({pid:result.pid,code:result.status,signal:result.signal,stdoutSha256:sha(result.stdout??Buffer.alloc(0)),stderrSha256:sha(result.stderr??Buffer.alloc(0)),pipesClosed:true});
  assert.ok(!result.error&&result.status===0&&result.signal===null,'READONLY_NATIVE_CHILD_FAILED');assert.deepEqual(lockCustody(),lock);return result.stdout;
 }
 assert.equal(command('git',['rev-parse','HEAD']).toString().trim(),proof.sourceCommit);
 assert.ok(command('git',['show',proof.sourceCommit+':docker-compose.prod.yml']).equals(composeRaw));
 assert.equal(command('git',['status','--porcelain','--untracked-files=no','--','docker-compose.prod.yml']).length,0);
 const version=command('docker',['compose','version','--short']).toString().trim();assert.equal(version,proof.composeVersion);
 const overrides=proof.originalOverrides;const overrideKeys=['APP_COMMIT','DEPLOYMENT_BACKEND_IMAGE','DEPLOYMENT_FRONTEND_IMAGE','DEPLOYMENT_INQUIRY_IMAGE','DEPLOYMENT_RELEASE_ID','PERFORMANCE_RELEASE_BACKEND_IMAGE','PERFORMANCE_RELEASE_COMMIT','PERFORMANCE_RELEASE_FRONTEND_IMAGE','PERFORMANCE_RELEASE_INFRASTRUCTURE_HASH','PERFORMANCE_RELEASE_INQUIRY_IMAGE','PERFORMANCE_RELEASE_POLICY_HASH','PERFORMANCE_RELEASE_SCHEMA_HASH','PERFORMANCE_RELEASE_SOURCE_HASH','PERFORMANCE_RUNTIME_INFRASTRUCTURE_HASH'];assert.deepEqual(Object.keys(overrides).sort(),overrideKeys.sort());assert.ok(Object.values(overrides).every(value=>typeof value==='string'));assert.equal(overrides.APP_COMMIT,proof.sourceCommit);assert.equal(overrides.DEPLOYMENT_RELEASE_ID,proof.releaseId);
 for(const role of ['backend','frontend','inquiry']){
  assert.equal(overrides['DEPLOYMENT_'+role.toUpperCase()+'_IMAGE'],snapshot.services[role].image);
  assert.equal(overrides['PERFORMANCE_RELEASE_'+role.toUpperCase()+'_IMAGE'],snapshot.services[role].image);
 }
 assert.equal(overrides.PERFORMANCE_RUNTIME_INFRASTRUCTURE_HASH,overrides.PERFORMANCE_RELEASE_INFRASTRUCTURE_HASH);
 const env={...FIXED_HOST_ENV,...overrides},base=['compose','--project-name','sabalanerp','--env-file',proof.envFile,'-f',proof.composeFile];
 const rendered=JSON.parse(command('docker',[...base,'config','--format','json'],env));assert.equal(rendered.name,'sabalanerp');const service=rendered.services.backend;
 const hashLine=command('docker',[...base,'config','--hash','backend'],env).toString().trim();assert.match(hashLine,/^backend [a-f0-9]{64}$/);const composeHash=hashLine.slice(8);
 const labels=proof.expectedComposeLabels;assert.equal(labels['com.docker.compose.config-hash'],composeHash);assert.equal(labels['com.docker.compose.project'],'sabalanerp');assert.equal(labels['com.docker.compose.service'],'backend');assert.equal(labels['com.docker.compose.replace'],'backend-1');assert.equal(labels['com.docker.compose.container-number'],'1');assert.equal(labels['com.docker.compose.oneoff'],'False');assert.equal(labels['com.docker.compose.project.config_files'],proof.composeFile);assert.equal(labels['com.docker.compose.project.environment_file'],proof.envFile);assert.equal(labels['com.docker.compose.project.working_dir'],ROOT);assert.equal(labels['com.docker.compose.version'],version.replace(/^v/,''));
 const expectedLabelKeys=['config-hash','container-number','depends_on','image','oneoff','project','project.config_files','project.environment_file','project.working_dir','replace','service','version'].map(key=>'com.docker.compose.'+key);assert.deepEqual(Object.keys(labels).sort(),expectedLabelKeys.sort());
 const dependencies=Object.entries(service.depends_on??{}).map(([name,value])=>name+':'+value.condition+':'+String(value.restart??false)).sort();assert.deepEqual(labels['com.docker.compose.depends_on'].split(',').filter(Boolean).sort(),dependencies);
 const ids=command('docker',[...base,'ps','--all','--quiet',...ROLES],env).toString().trim().split(/\s+/);assert.equal(ids.length,6);assert.equal(new Set(ids).size,6);assert.ok(ids.every(id=>/^[a-f0-9]{64}$/.test(id)));
 const actual=JSON.parse(command('docker',['container','inspect',...ids]));assert.equal(actual.length,6);const byRole={};
 for(const row of actual){const role=row.Config.Labels['com.docker.compose.service'];assert.ok(ROLES.includes(role)&&!byRole[role]);assert.equal(row.Config.Labels['com.docker.compose.project'],'sabalanerp');assert.equal(row.Image,snapshot.services[role].image);assert.equal(row.State.Running,true);assert.equal(row.State.Health?.Status,'healthy');byRole[role]=row;}
 const services=originalServiceConfiguration(actual);for(const role of ROLES.filter(role=>!['backend','nginx'].includes(role)))assert.deepEqual(services[role],snapshot.services[role]);
 // Prove the complete original nginx projection through this one observed Env
 // permutation. Actual output keeps its current hash; this is not a waiver.
 assert.deepEqual(proof.nginxConfigEnvPermutation,[1,0,2,3,4,5,6,7]);assert.equal(byRole.nginx.Config.Env.length,8);
 const nginxPreimageRows=structuredClone(actual),nginxPreimage=nginxPreimageRows.find(row=>row.Config.Labels['com.docker.compose.service']==='nginx');nginxPreimage.Config.Env=proof.nginxConfigEnvPermutation.map(index=>byRole.nginx.Config.Env[index]);
 assert.deepEqual(originalServiceConfiguration(nginxPreimageRows).nginx,snapshot.services.nginx);

 const bindBytes=configurationBytes(actual,proof.envFile);assert.deepEqual(bindBytes,snapshot.configurationBytes);
 const backend=byRole.backend;assert.deepEqual(proof.hostConfigProof.bindsPermutation,[4,7,8,6,5,9,0,1,2,3]);assert.equal(backend.HostConfig.Binds.length,10);
 const expectedHostConfig={...backend.HostConfig,Binds:proof.hostConfigProof.bindsPermutation.map(index=>backend.HostConfig.Binds[index])};
 assert.equal(canonicalConfigurationSha256(expectedHostConfig),snapshot.services.backend.hostConfigSha256);assert.equal(proof.hostConfigProof.expectedSha256,snapshot.services.backend.hostConfigSha256);
 const images=JSON.parse(command('docker',['image','inspect',backend.Image]));assert.equal(images.length,1);assert.equal(labels['com.docker.compose.image'],backend.Image);
 const kernel=verifyCanonicalPreviousReleaseConfiguration({format:'sabalan-canonical-previous-release-config-input/v1',deploymentId:proof.deploymentId,releaseId:proof.releaseId,sourceCommit:proof.sourceCommit,snapshotSha256:proof.snapshotSha256,service:'backend',expectedIdentity:proof.expectedBackendIdentity,currentInspect:backend,immutableImageInspect:images[0],canonicalService:service,originalOverrides:overrides,expectedComposeLabels:labels,hostConfigProof:{actualSha256:canonicalConfigurationSha256(backend.HostConfig),expectedSha256:snapshot.services.backend.hostConfigSha256,expectedHostConfig,bindsPermutationVerified:true},environmentBindProof:{verified:true,expectedSha256:proof.envSha256,actualSha256:sha(privateRead(proof.envFile,proof.envSha256,{mode:0o600}))}});
 // Reobserve every incarnation and every private bind after all native reads.
 const again=JSON.parse(command('docker',['container','inspect',...ids]));assert.deepEqual(originalServiceConfiguration(again),services);assert.deepEqual(configurationBytes(again,proof.envFile),bindBytes);
 for(const row of again){const previous=byRole[row.Config.Labels['com.docker.compose.service']];assert.equal(row.Id,previous.Id);assert.equal(row.State.StartedAt,previous.State.StartedAt);assert.equal(row.State.Running,true);assert.equal(row.State.Health?.Status,'healthy');}
 privateRead(proofFile,proofSha256,{mode:0o400});privateRead(proof.snapshotFile,proof.snapshotSha256,{mode:0o400});privateRead(proof.composeFile,proof.composeSha256);assert.deepEqual(lockCustody(),lock);
 return {format:'sabalan-original-premutation-configuration-verification/v1',deploymentId:proof.deploymentId,sourceCommit:proof.sourceCommit,snapshotSha256:proof.snapshotSha256,repairKind:'CANONICAL_PREVIOUS_RELEASE_CONFIGURATION',originalCaptureGuardPassed:false,services,configurationBytes:bindBytes,kernel,composeConfigHash:composeHash,allOriginalChildrenClosed:true,originalChildren:children,readOnly:true};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{assert.equal(process.argv.length,4);process.stdout.write(JSON.stringify(verifyPremutationConfigurationRepair(process.argv[2],process.argv[3]))+'\n');}
 catch{process.stderr.write('PREMUTATION_CONFIGURATION_REPAIR_VERIFICATION_FAILED\n');process.exitCode=1;}
}
