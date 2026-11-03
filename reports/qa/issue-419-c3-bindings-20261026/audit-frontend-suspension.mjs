// Read-only assessment. This script never calls the suspension or restoration owner.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {acquireSerialHostLease} from '../../../scripts/lib/serial-physical/host-lease.mjs';
import {prepareOriginalPrivateEvidenceDirectory,assertOriginalPrivateEvidenceDirectory} from '../../../scripts/lib/original-private-evidence-directory.mjs';
import {createLocalDevLifecycleCommands} from '../../../scripts/run-local-dev-frontend-suspension.mjs';
import {localDevCompose,localDevIdentity,localDevSha,parseLocalDevRows,validateLocalDevMasterPlan} from '../../../scripts/lib/local-dev-frontend-suspension.mjs';
import {validateCandidateProjectRows,candidateBeforeUpConfiguration} from '../../../scripts/replace-qualified-application-native-candidate-local.mjs';
import {validateQaHostMemoryObservation} from '../../../scripts/lib/application-native-qa-memory.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const directory=path.resolve('D:/sabalanerp-online-qa/419-frontend-suspension-assessment-'+randomBytes(16).toString('hex'));
const report={format:'sabalan-419-frontend-suspension-contract-assessment/v1',observedAt:new Date().toISOString(),readOnly:true,stopPerformed:false,restorePerformed:false,postStopMemory:null,fullPreflightStarted:false,upStarted:false,masterStarted:false,productionAdmission:false,cacheChanged:false,cacheCreditUsed:false,privateDirectory:directory};
const lease=await acquireSerialHostLease('D:/sabalanerp-online-qa/deployment.lock');
report.lease={originalPid:lease.originalPid,acquiredAt:new Date().toISOString(),closed:false};
const commands=createLocalDevLifecycleCommands();
let custody,index=0;
function save(file,raw){assertOriginalPrivateEvidenceDirectory(custody,directory);const fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,raw);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}return{file,sha256:localDevSha(raw)};}
async function run(executable,args){lease.assertHeld();const result=await commands.run(executable,args);commands.assertSuccessful(result);save(path.join(directory,String(++index)+'.stdout'),result.stdout);return result.stdout.toString();}
async function census(){const rows=parseLocalDevRows(await run('docker',['compose','-f',localDevCompose,'ps','--all','--no-trunc','--format','json']));validateCandidateProjectRows(rows);return rows;}
async function docker(args){await census();return run('docker',args);}
function rejected(fn){try{fn();return{rejected:false};}catch(e){return{rejected:true,name:e.name,message:e.message};}}
function identities(all){return Object.fromEntries(all.map(c=>[c.Config.Labels['com.docker.compose.service'],{...localDevIdentity(c),restartCount:c.RestartCount,running:c.State.Running,health:c.State.Health.Status}]));}
try{
 custody=await prepareOriginalPrivateEvidenceDirectory(directory);
 report.sourceCommit=(await run('git',['rev-parse','HEAD'])).trim();
 const rows=await census();const all=JSON.parse(await docker(['inspect',...rows.map(r=>r.ID)]));candidateBeforeUpConfiguration(all);
 report.before=identities(all);
 const frontend=all.find(c=>c.Config.Labels['com.docker.compose.service']==='frontend');
 report.frontend={...report.before.frontend,command:frontend.Config.Cmd,entrypoint:frontend.Config.Entrypoint,mounts:frontend.Mounts.map(m=>({type:m.Type,destination:m.Destination,rw:m.RW})),restartPolicy:frontend.HostConfig.RestartPolicy};
 const config=JSON.parse(await docker(['compose','-f',localDevCompose,'config','--format','json']));
 report.dependencies=config.services.frontend.depends_on;
 report.dependents=Object.entries(config.services).filter(([,s])=>Object.hasOwn(s.depends_on??{},'frontend')).map(([name])=>name);
 report.composeSha256=localDevSha(fs.readFileSync(localDevCompose));
 await docker(['image','inspect',frontend.Image]);
 const stoppedRows=structuredClone(rows);Object.assign(stoppedRows.find(r=>r.Service==='frontend'),{State:'exited',Health:''});
 const stoppedInspect=structuredClone(all);Object.assign(stoppedInspect.find(c=>c.Id===frontend.Id).State,{Running:false,Pid:0,Status:'exited'});
 report.simulatedStopOnly={notRuntimeEvidence:true,census:rejected(()=>validateCandidateProjectRows(stoppedRows)),beforeUpConfiguration:rejected(()=>candidateBeforeUpConfiguration(stoppedInspect))};
 assert.equal(report.simulatedStopOnly.census.rejected,true);assert.equal(report.simulatedStopOnly.beforeUpConfiguration.rejected,true);
 const launch=JSON.parse(fs.readFileSync(path.join(here,'NATIVE-LAUNCH-PREPARATION-r9.stdout.json')));
 const plan=JSON.parse(fs.readFileSync(launch.supervisorPlan.file));
 assert.equal(localDevSha(fs.readFileSync(launch.supervisorPlan.file)),launch.supervisorPlan.sha256);
 report.selectedHistoricalPlan={file:launch.supervisorPlan.file,sha256:launch.supervisorPlan.sha256,format:plan.format,liveAuthority:false};
 report.suspensionMasterPlanCompatibility=rejected(()=>validateLocalDevMasterPlan(plan,{},{}));
 assert.equal(report.suspensionMasterPlanCompatibility.rejected,true);
 report.wslMeminfo=await run('wsl.exe',['-d','docker-desktop','--','cat','/proc/meminfo']);
 report.windowsMemory=[];
 for(let i=0;i<3;i++){
  const sample={platform:process.platform,availableBytes:os.freemem(),observedAt:new Date().toISOString()};
  const gate=rejected(()=>validateQaHostMemoryObservation(sample,'preserve-v3'));
  report.windowsMemory.push({...sample,floorBytes:2147483648,shortfallBytes:Math.max(0,2147483648-sample.availableBytes),gatePassed:!gate.rejected,failure:gate.rejected?gate:null});
  if(i<2)await new Promise(r=>setTimeout(r,1000));
 }
 report.after=identities(JSON.parse(await docker(['inspect',...rows.map(r=>r.ID)])));
 assert.deepEqual(report.after,report.before);
 report.identitiesAndConfigurationsUnchanged=true;
 report.restoration={executed:false,allowedOwner:'scripts/run-local-dev-frontend-suspension.mjs',sameContainerRequired:true,requiresSuccessfulSameIncarnationCandidateReceipt:true,requiresNativeAndSqlQuietness:true,requiresOriginalMasterClosureIfBound:true,quietnessExecuted:false};
 report.decision='NO_STOP_CONTRACT_REQUIRES_QUALIFIED_CANDIDATE_FIRST';
 report.reason='Current pre-UP root and creator require all ten services running/healthy; suspension requires a successful same-incarnation candidate replacement, then enrollment of the original master. Current C3 v2 plan is not accepted by the v1 suspension enrollment verifier. No stopped exception is bound until original LOCAL completion.';
}catch(e){report.assessmentError={name:e.name,message:e.message};process.exitCode=1;}
finally{
 report.children=commands.close();await lease.release();report.lease.closed=true;report.completedAt=new Date().toISOString();
 const raw=Buffer.from(JSON.stringify(report,null,2)+'\n');
 if(custody)save(path.join(directory,'assessment.json'),raw);
 const publicFile=path.join(here,'FRONTEND-SUSPENSION-ASSESSMENT-20261029.json');
 const fd=fs.openSync(publicFile,'wx');try{fs.writeFileSync(fd,raw);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 console.log(JSON.stringify({file:publicFile,sha256:localDevSha(raw),decision:report.decision,error:report.assessmentError,windowsMemory:report.windowsMemory,leaseClosed:report.lease.closed}));
}
