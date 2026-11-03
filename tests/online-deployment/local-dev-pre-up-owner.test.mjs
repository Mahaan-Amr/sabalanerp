import {PassThrough} from 'node:stream';
import {observeLocalDevFrontendMemory,validateLocalDevFrontendMemory} from '../../scripts/lib/local-qa-memory-pressure.mjs';
import {spawn} from 'node:child_process';
import {runCandidateRollbackBoundary} from '../../scripts/lib/candidate-rollback-boundary.mjs';
import {acquireSerialHostLease,retainOriginalSerialHostLease} from '../../scripts/lib/serial-physical/host-lease.mjs';
/** The existing owner runs against deterministic OS/Compose ports, never Docker. */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import vm from 'node:vm';
import fs from 'node:fs';
import {randomBytes} from 'node:crypto';
import {suspendOriginalLocalDevFrontend,restoreOriginalLocalDevFrontend,qualifySuspendedLocalDevFrontend,createLocalDevLifecycleCommands,assertOriginalLocalDevLifecycleRestoration,validateLocalDevLifecycleClosure} from '../../scripts/run-local-dev-frontend-suspension.mjs';
import {EventEmitter,once} from 'node:events';
import * as rules from '../../scripts/lib/local-dev-frontend-suspension.mjs';
import {validateCandidateProjectRows,candidateBeforeUpConfiguration} from '../../scripts/replace-qualified-application-native-candidate-local.mjs';
import {validateQaHostMemoryObservation} from '../../scripts/lib/application-native-qa-memory.mjs';

function frontendReturnFixture(){
 const networkId='e'.repeat(64),name='sabalanerp-local_default',all=Object.fromEntries(rules.localDevServices.map((s,i)=>[s,{Id:(i+1).toString(16).padStart(64,'0'),Name:'/fixture-'+s,Image:'sha256:'+(i+1).toString(16).padStart(64,'0'),Config:{Labels:{'com.docker.compose.project':'sabalanerp-local','com.docker.compose.service':s},Env:['PRIVATE_FIXTURE=value']},HostConfig:{},Mounts:[],RestartCount:0,State:{Running:true,Pid:i+10,StartedAt:'2026-10-29T00:00:00Z',Health:{Status:'healthy'},OOMKilled:false,Dead:false,Error:''},NetworkSettings:{Ports:{},SandboxID:'a'.repeat(64),SandboxKey:'/var/run/docker/netns/'+'a'.repeat(12),Networks:{[name]:{NetworkID:networkId,EndpointID:'b'.repeat(64),IPAddress:'172.20.0.'+(i+2),IPPrefixLen:16,GlobalIPv6Address:'',GlobalIPv6PrefixLen:0,MacAddress:'02:00:00:00:00:01',Aliases:[s]}}}}]));
 const beforeRunning=structuredClone(all.frontend),qualified=structuredClone(candidateBeforeUpConfiguration(Object.values(all)));const old=qualified.find(r=>r.service==='frontend');old.Pid=0;
 all.frontend.State.Pid=999;all.frontend.State.StartedAt='2026-11-01T15:00:00Z';all.frontend.NetworkSettings.SandboxID='c'.repeat(64);all.frontend.NetworkSettings.SandboxKey='/var/run/docker/netns/'+'c'.repeat(12);const net=all.frontend.NetworkSettings.Networks[name];net.EndpointID='d'.repeat(64);net.IPAddress='172.20.0.90';net.MacAddress='02:00:00:00:00:02';
 const network={Id:networkId,Status:{IPAM:{Subnets:{'172.20.0.0/16':{IPsInUse:10,DynamicIPsAvailable:65520}}}},IPAM:{Driver:'default',Options:null,Config:[{Subnet:'172.20.0.0/16'}]},Containers:{[all.frontend.Id]:{Name:all.frontend.Name.slice(1),EndpointID:net.EndpointID,IPv4Address:net.IPAddress+'/16',IPv6Address:'',MacAddress:net.MacAddress}}};return{beforeRunning,qualified,after:all,network,beforeNetwork:structuredClone(network)};
}
test('pre-master frontend return accepts only its real measured incarnation and endpoint',()=>{
 const value=frontendReturnFixture(),result=rules.validateLocalDevBeforeMasterReturn(value);assert.equal(result.frontend.id,value.beforeRunning.Id);assert.equal(result.productionAdmission,false);
 for(const mutate of [v=>v.after.frontend.Image='sha256:'+'f'.repeat(64),v=>v.after.frontend.Config.Env.push('DRIFT=true'),v=>v.after.frontend.State.Health.Status='unhealthy',v=>v.after.frontend.State.OOMKilled=true,v=>v.after.redis.State.StartedAt='2026-11-01T00:00:00Z',v=>v.after.redis.NetworkSettings.Ports.changed=true,v=>v.network.Containers[v.after.frontend.Id].IPv4Address='172.20.0.91/16',v=>v.after.frontend.NetworkSettings.Networks.sabalanerp_local_default={changed:true}]){
  const changed=frontendReturnFixture();mutate(changed);assert.throws(()=>rules.validateLocalDevBeforeMasterReturn(changed));
 }
});
test('matching daemon endpoint views cannot authorize an empty or out-of-original-subnet return',()=>{
 for(const change of [n=>n.IPAddress='8.8.8.8',n=>n.IPAddress='',n=>n.EndpointID='',n=>n.EndpointID='not-an-endpoint',n=>n.MacAddress='not-a-mac']){
  const value=frontendReturnFixture(),n=value.after.frontend.NetworkSettings.Networks['sabalanerp-local_default'];change(n);const row=value.network.Containers[value.after.frontend.Id];Object.assign(row,{EndpointID:n.EndpointID,IPv4Address:n.IPAddress+'/16',MacAddress:n.MacAddress});assert.throws(()=>rules.validateLocalDevBeforeMasterReturn(value));
 }
});
test('pre-master return requires the same successful drained candidate boundary and no master',()=>{
 const closed={code:0,signal:null,stdoutEof:true,stderrEof:true,observationFault:false},value={phase:'CANDIDATE_VERIFIED',masterStarted:false,completeBound:false,completeConstructionStarted:false,localDirectory:null,activeOriginals:0,unknown:false,children:[closed],boundary:{phase:'CANDIDATE_VERIFIED',candidateVerified:true,primaryFailureObserved:false,mutationIntent:true,originalUp:closed,originalAuxiliaries:[closed]}};
 assert.equal(rules.validateLocalDevCandidateReturnBoundary(value),true);
 for(const mutate of [v=>v.masterStarted=true,v=>v.phase='MASTER_RETAINED',v=>v.completeBound=true,v=>v.completeConstructionStarted=true,v=>v.localDirectory='live',v=>v.activeOriginals=1,v=>v.unknown=true,v=>v.boundary.candidateVerified=false,v=>v.boundary.primaryFailureObserved=true,v=>v.boundary.originalUp.stderrEof=false,v=>v.boundary.originalAuxiliaries[0].signal='SIGTERM']){
  const changed=structuredClone(value);mutate(changed);assert.throws(()=>rules.validateLocalDevCandidateReturnBoundary(changed));
 }
});

function harness({dependent=false,unhealthy=false,incompleteEof=false,failStopPublication=false,initialAll,lifecycleRegistry,restorationFault}={}){
 const trace=[],memoryStages=[],files=new Map(),all=Object.fromEntries(rules.localDevServices.map((s,i)=>[s,{Id:(i+1).toString(16).padStart(64,'0'),Image:'sha256:'+(i+1).toString(16).padStart(64,'0'),Config:{Cmd:['npm','run','dev','--','-p','3000'],Env:['NODE_ENV=development'],Labels:{'com.docker.compose.project':'sabalanerp-local','com.docker.compose.service':s,'com.docker.compose.project.config_files':rules.localDevCompose}},HostConfig:{AutoRemove:false},Mounts:[],State:{Running:true,Status:'running',Pid:i+10,StartedAt:'2026-10-29T00:00:00.000000001Z',Health:{Status:'healthy'},OOMKilled:false,Dead:false,Error:''}}]));
 if(initialAll)for(const[name,value]of Object.entries(initialAll))all[name]=structuredClone(value);
 if(unhealthy)all.redis.State.Health.Status='unhealthy';
 const others=values=>Object.fromEntries(Object.entries(values).filter(([s])=>s!=='frontend').map(([s,c])=>[s,{...rules.localDevIdentity(c),running:c.State.Running,health:c.State.Health.Status}]));
 const baseline={format:'sabalan-local-dev-pre-up-baseline/v1',rootOperation:'a'.repeat(32),allTenHealthy:true,restorationVerified:true,frontend:rules.localDevIdentity(all.frontend),otherNine:others(all)};
 const baselineFile=path.resolve('D:/fixture/baseline.json'),raw=Buffer.from(JSON.stringify(baseline)),baselineRef={file:baselineFile,sha256:rules.localDevSha(raw)};files.set(baselineFile,raw);
 const nativeOwner={async observeDevelopmentFrontendMemory(stage){memoryStages.push(stage);},operation:baseline.rootOperation,async bindFrontendLifecycleCommands(){},async prepareFrontendSuspension(){trace.push('fresh-ten-and-rollback');return baselineRef;},async assertFrontendReadersIndependent(){trace.push('root-owned-compose-bindings');rules.validateLocalDevFrontendCompatibility({services:{frontend:{environment:{NODE_ENV:'development'}},backend:dependent?{depends_on:{frontend:{condition:'service_started'}}}:{}}},['frontend-candidate','frontend-retained']);},registerFrontendRestorationObligation(){trace.push('durable-obligation');},async acceptPreUpFrontendSuspension(ref){trace.push('same-root-stopped-scope');const value=JSON.parse(files.get(ref.file));rules.validateLocalDevStopReceipt(value);}};
 const successful=value=>({receipt:{argv:[],originalPid:123,code:0,signal:null,stdoutEof:true,stderrEof:true,spawnError:null,streamError:null,outputBoundExceeded:false,interrupted:false},stdout:Buffer.from(JSON.stringify(value))});
 const context={assert,process:{platform:'win32'},path,randomBytes,root:path.resolve('D:/fixture'),ownerFile:'owner',localDevVerifierFile:'verifier',localDevCompose:rules.localDevCompose,localDevIdentity:rules.localDevIdentity,localDevSha:rules.localDevSha,validateLocalDevStopReceipt:rules.validateLocalDevStopReceipt,assertLocalDevCensus:rules.assertLocalDevCensus,assertLocalDevStoppedInspect:rules.assertLocalDevStoppedInspect,validateLocalDevFrontendCompatibility:rules.validateLocalDevFrontendCompatibility,
  readLocalDevCandidate:ref=>JSON.parse(files.get(ref.file)),readLocalDevSuspension:ref=>({selection:ref,receipt:rules.validateLocalDevStopReceipt(JSON.parse(files.get(ref.file)))}),assertOriginalCandidateRollbackOwner:o=>assert.equal(o,nativeOwner),stableLocalDevFile:f=>files.get(f)??Buffer.from('pinned actual fixture source'),
  fs:{mkdirSync(){},existsSync:file=>files.has(file),unlinkSync:file=>{if(restorationFault==='unlink'&&file.endsWith('pending-restoration.json'))throw Error('FIXTURE_UNLINK_FAILED');assert.equal(files.delete(file),true);trace.push('obligation-retired');}},localDevControlLock:()=>({release(){trace.push('control-closed');}}),others,inspected:async()=>structuredClone(all),
  census:async()=>Object.entries(all).map(([Service,c])=>({ID:c.Id,Service,Project:'sabalanerp-local',State:c.State.Status,Health:c.State.Health.Status})),
  publish:(file,value)=>{if(restorationFault==='publication'&&file.endsWith('restored.json'))throw Error('FIXTURE_PUBLICATION_FAILED');if(failStopPublication&&file.endsWith('pre-up-stopped.json'))throw Error('STOP_RECEIPT_PUBLICATION_FAILED');assert.equal(files.has(file),false);const raw=Buffer.from(JSON.stringify(value));files.set(file,raw);return{file,sha256:rules.localDevSha(raw)};},commands:lifecycleRegistry??{snapshot:()=>({allOriginalChildrenClosed:true})},
  verifyRestorationBoundary:async()=>{trace.push('fresh-native-sql-and-root-boundary');},
  docker:async args=>{
   if(args[0]==='compose')throw Error('LIFECYCLE_MUST_NOT_RENDER_UNBOUND_COMPOSE');
   if(args[0]==='image')return successful([{Id:all.frontend.Image}]);
   if(args[0]==='start'){assert.deepEqual(args,['start',all.frontend.Id]);const actual=lifecycleRegistry?await lifecycleRegistry.run(process.execPath,['-e',"process.stdout.write('null')"]):null;trace.push('start-original-frontend');Object.assign(all.frontend.State,{Running:true,Pid:456,Status:'running',StartedAt:'2026-10-29T00:02:00.000000001Z'});const result=actual?{receipt:{...actual.receipt,argv:args,modeledComposeCommand:true,actualCommand:actual.receipt.argv},stdout:actual.stdout}:successful(null);result.receipt.argv=args;return result;}
   assert.deepEqual(args,['stop','--time','-1',all.frontend.Id]);const actual=lifecycleRegistry?await lifecycleRegistry.run(process.execPath,['-e',"process.stdout.write('null')"]):null;trace.push('natural-sole-frontend-stop');Object.assign(all.frontend.State,{Running:false,Pid:0,Status:'exited',ExitCode:143,OOMKilled:false,Dead:false,Error:'',FinishedAt:'2026-10-29T00:01:00Z'});const result=actual?{receipt:{...actual.receipt,argv:args,modeledComposeCommand:true,actualCommand:actual.receipt.argv},stdout:actual.stdout}:successful(null);result.receipt.argv=args;result.receipt.stdoutEof=!incompleteEof;return result;
  }};
 const compile=fn=>vm.compileFunction('return ('+fn.toString()+')',Object.keys(context))(...Object.values(context));
 return{trace,memoryStages,files,all,nativeOwner,run:()=>compile(suspendOriginalLocalDevFrontend)(null,{nativeOwner,evidence:{planFile:'D:/fixture/supervisor-plan.json',evidenceDirectory:'D:/fixture/original-evidence'}}),restore:selection=>compile(restoreOriginalLocalDevFrontend)(selection,{nativeOwner}),qualify:(selection,candidateReplacementReceipt)=>compile(qualifySuspendedLocalDevFrontend)(selection,{nativeOwner,candidateReplacementReceipt}),restorationBoundary:fn=>{context.verifyRestorationBoundary=fn;},refuseRestoration:()=>{context.verifyRestorationBoundary=async()=>{throw Error('ORIGINAL_OWNER_STILL_LIVE');};}};
}

/** Deterministic Compose/SQL ports; STOP, UP, return and master control use
 * real finite owned Node children. These fixtures grant no runtime admission. */
async function beforeMasterReturnHarness({fault=null,afterRetained=false}={}){
 const fixture=frontendReturnFixture(),initial=structuredClone(fixture.after);initial.frontend=structuredClone(fixture.beforeRunning);
 for(const c of Object.values(initial)){c.Config.Cmd=['npm','run','dev','--','-p','3000'];c.Config.Env=['NODE_ENV=development'];c.Config.Labels['com.docker.compose.project.config_files']=rules.localDevCompose;c.HostConfig.AutoRemove=false;c.State.Status='running';}
 const lifecycle=createLocalDevLifecycleCommands(new EventEmitter()),h=harness({initialAll:initial,lifecycleRegistry:lifecycle,restorationFault:fault}),selection=await h.run(),beforeUp=structuredClone(h.all),trace=h.trace;
 const actual=async(label,enroll)=>{const child=spawn(process.execPath,['-e',"process.stdin.resume();process.stdin.once('end',()=>process.stdout.write(process.argv[1]));",label],{windowsHide:true,stdio:['pipe','pipe','pipe']});const closed=once(child,'close');enroll(child);child.stdout.resume();child.stderr.resume();child.stdin.end();await closed;return{originalPid:child.pid,code:child.exitCode,signal:child.signalCode,stdoutEof:child.stdout.readableEnded,stderrEof:child.stderr.readableEnded};};
 const boundary=await runCandidateRollbackBoundary({assertLease(){},captureBaseline:async()=>beforeUp,revalidateBaseline:async()=>{},assertQuiet:async()=>{},
  attemptReplacement:async hooks=>{await actual('auxiliary',hooks.originalAuxiliary);await hooks.mutationIntent();await actual('up',hooks.originalUp);for(const [i,s]of ['backend-candidate','backend-retained'].entries()){h.all[s].Id=(i?'d':'c').repeat(64);h.all[s].State.Pid+=100;h.all[s].State.StartedAt='2026-11-01T00:00:00Z';}},verifyCandidate:async()=>{},persist:async value=>trace.push(value.phase),persistIntent(){trace.push('up-intent');},restoreBaseline:async()=>{},verifyBaseline:async()=>{},hold:async()=>{throw Error('UNEXPECTED_FIXTURE_HOLD');}});
 assert.equal(boundary.phase,'CANDIDATE_VERIFIED');const candidate={fixtureOnly:true,operation:'b'.repeat(32),reobservedBaseline:{format:'sabalan-root-current-predecessor-slots/v1'},previous:Object.fromEntries(['backend-candidate','backend-retained'].map(s=>[s,{id:beforeUp[s].Id,image:beforeUp[s].Image,startedAt:beforeUp[s].State.StartedAt}])),actual:Object.fromEntries(['backend-candidate','backend-retained'].map(s=>[s,{id:h.all[s].Id,image:h.all[s].Image,startedAt:h.all[s].State.StartedAt}]))};
 const candidateFile=path.resolve('D:/fixture/reports/qa/application-native-candidate-'+candidate.operation+'.json');h.files.set(candidateFile,Buffer.from(JSON.stringify(candidate)));const pin=file=>{if(fault==='readback'&&file.endsWith('restored.json'))throw Error('FIXTURE_READBACK_FAILED');const raw=h.files.get(file);assert.ok(raw,'FIXTURE_FILE_MISSING:'+file);return{file,sha256:rules.localDevSha(raw)};};const pendingFile=[...h.files.keys()].find(f=>f.endsWith('pending-restoration.json')),baseline={resources:{network:structuredClone(fixture.beforeNetwork),volumes:[]},byService:beforeUp,configuration:candidateBeforeUpConfiguration(Object.values({...initial,frontend:initial.frontend})),files:[],sqlite:{sha256:'fixture-original'},model:{networks:{default:{name:'sabalanerp-local_default'}},services:Object.fromEntries(['backend-candidate','backend-retained'].map(s=>[s,{image:h.all[s].Image,volumes:[]}])),volumes:{}},inquiryCurrent:h.all.inquiry};
 const source=fs.readFileSync(new URL('../../scripts/lib/original-candidate-rollback-owner.mjs',import.meta.url),'utf8'),member=(name,next)=>{const a=source.indexOf('  '+name),b=source.indexOf('\n  '+next,a);assert.ok(a>=0&&b>a);return source.slice(a,b);};
 let methods=member('assertFrontendReturnBoundary(','async restoreDevelopmentFrontendBeforeLocal(')+member('async restoreDevelopmentFrontendBeforeLocal(','async validateFrontendRestorationReturn(')+member('async validateFrontendRestorationReturn(','async assertFrontendRestorationAllowed(')+member('async assertFrontendRestorationAllowed(','readFrontendSuspension(')+member('async assertFrontendQualifiedResources(','async freshPreUpPreflight(')+member('assertCurrentCandidatePredecessor(','registerOriginalLocalDirectory(')+member('async restoreBeforeMasterFailure(','async prepareOnly(');
 methods+=member('async bindOriginalRetainedBrowserReturn(','async observeLocalMemoryPressure(')+member('async runWithMemoryPressure(','async continueWithOriginalMaster(');
 methods+=member('async bindOriginalLocalCompletion(','async readImageRepositoryOwnerContext(');
 const negativeStart=source.indexOf('     const negative=readOriginalMasterKnownRetainedNegative(terminal,owner);'),negativeEnd=source.indexOf('\n    }\n    if(isOriginalMasterKnownImageNegative',negativeStart);assert.ok(negativeStart>=0&&negativeEnd>negativeStart);methods+='async fixtureRestoreKnownRetainedNegative(terminal){'+source.slice(negativeStart,negativeEnd)+'},';
 methods=methods.replace("await import('../run-local-dev-frontend-suspension.mjs')",'await restorationApi()');
 methods=methods.replaceAll("await import('./original-retained-browser-qualification.mjs')",'retainedApi');
 let leaseHeld=true;const retainedApi={},roleApi={},active=new Set(),context={recovering:false,readOriginalMasterKnownRetainedNegative:(token,owner)=>retainedApi.readOriginalRetainedBrowserReturnCustody(token,owner),completeLocalCompletion:null,completeScope:null,completeSnapshot:null,sha:rules.localDevSha,readOriginalRoleQualificationCompletion:t=>roleApi.read(t),readOriginalRoleRetainedBrowserCompletion:t=>roleApi.retained(t),validateOwnedBrowserReturn:({before,after,service})=>{assert.equal(after.Image,before.Image);assert.deepEqual(after.Config,before.Config);return{modeledComposeBoundary:true,service};},serial:0,retainedApi,bindRetainedParent:async facts=>{assert.equal(facts.closure.originalSessions.length,4);for(const row of facts.closure.originalSessions)assert.ok(row.code===0&&row.stdoutEof&&row.stderrEof);trace.push('retained-hold-model-audited');return{file:'modeled-storage-hold',sha256:'1'.repeat(64)};},assert,structuredClone,JSON,path,process:{pid:process.pid},root:path.resolve('D:/fixture'),operation:'a'.repeat(32),trace,phase:'CANDIDATE_VERIFIED',masterStarted:false,completeBound:false,completeConstructionStarted:false,localDirectory:null,unknown:false,children:lifecycle.snapshot().children,activeOriginals:active,candidateVerifiedClosure:boundary,candidateReport:candidate,
  devPending:pin(pendingFile),devScope:{selection,receipt:JSON.parse(h.files.get(selection.file))},devRunningFrontend:structuredClone(initial.frontend),devCandidateReturn:null,devRetainedReturn:null,devRestored:false,devRestorationObservation:false,inquiryIntent:true,inquiryMutating:false,relaxed:false,qualifiedConfiguration:structuredClone(candidateBeforeUpConfiguration(Object.values(h.all),{receipt:JSON.parse(h.files.get(selection.file))})),baseline,slots:['backend-candidate','backend-retained'],compose:[],owner:h.nativeOwner,
  guard(){assert.equal(leaseHeld,true);},pin,localDevIdentity:rules.localDevIdentity,localDevWindowsBirth:()=> '639000000000000001',candidateBeforeUpConfiguration,validateLocalDevCandidateReturnBoundary:rules.validateLocalDevCandidateReturnBoundary,validateLocalDevRetainedReturnBoundary:rules.validateLocalDevRetainedReturnBoundary,validateLocalDevBeforeMasterReturn:rules.validateLocalDevBeforeMasterReturn,validateLocalDevRestoredEndpoint:rules.validateLocalDevRestoredEndpoint,
  validatePreviousCandidateReplacement:value=>assert.deepEqual(value,candidate),assertLocalDevSuspensionCurrent:ref=>ref?({selection:ref,receipt:JSON.parse(h.files.get(ref.file))}):null,assertFrontendLifecycleClosed:async()=>{assertOriginalLocalDevLifecycleRestoration(lifecycle);},inspectAll:async()=>structuredClone(h.all),
  protectedEqual:all=>{for(const s of rules.localDevServices.filter(s=>!['backend-candidate','backend-retained','frontend'].includes(s)))assert.deepEqual(all[s],beforeUp[s]);},plannedModel:null,readLocalDevSuspension:ref=>({selection:ref,receipt:JSON.parse(h.files.get(ref.file))}),assertLocalDevStoppedInspect:rules.assertLocalDevStoppedInspect,assertLocalDevReleasedNetwork:rules.assertLocalDevReleasedNetwork,validateLocalRollbackResources:()=>{},quiet:async()=>{if(fault==='reader')throw Error('OWNED_READER_NOT_CLOSED');trace.push('quiet');},inquiryQuiet:async()=>{},sqlite:async()=>fault==='sqlite'?{sha256:'drift'}:baseline.sqlite,
  save:(name,value)=>{const file=path.resolve('D:/fixture/root/'+name);assert.ok(!h.files.has(file));h.files.set(file,Buffer.from(JSON.stringify(value)));trace.push(name);return pin(file);},
  docker:async args=>{if(args[0]==='network'){const c=h.all.frontend,n=c.NetworkSettings.Networks.sabalanerp_local_default??c.NetworkSettings.Networks['sabalanerp-local_default'];const network=structuredClone(fixture.beforeNetwork);network.Containers={[c.Id]:{Name:c.Name.slice(1),EndpointID:n.EndpointID,IPv4Address:n.IPAddress+'/'+n.IPPrefixLen,IPv6Address:'',MacAddress:n.MacAddress}};if(!c.State.Running){delete network.Containers[c.Id];network.Status.IPAM.Subnets['172.20.0.0/16'].IPsInUse--;network.Status.IPAM.Subnets['172.20.0.0/16'].DynamicIPsAvailable++;}return JSON.stringify([network]);}if(args[0]==='volume')return JSON.stringify([]);assert.ok(args.includes('up'));trace.push('rollback-up');await actual('rollback',()=>{});for(const s of ['backend-candidate','backend-retained'])h.all[s]=structuredClone(beforeUp[s]);return'';},
  pressure:{enterRecovery:async()=>trace.push('sampler-drained-for-recovery'),sample:async stage=>{trace.push(stage);if(fault==='pressure'&&stage==='frontend-restored-before-master'||fault==='retained-return-pressure'&&stage==='frontend-restored-before-local')throw Error('QA_MEMORY_PRESSURE_REFUSED');},assertAdmission(){},async run(stage,work){return work();}},revalidate:async()=>trace.push('rollback-boundary'),restoreInquiry:async()=>trace.push('rollback-inquiry'),verifyBaseline:async()=>{assert.deepEqual(rules.localDevIdentity(h.all.frontend),rules.localDevIdentity(baseline.byService.frontend));trace.push('rollback-verified');},
  restorationApi:async()=>({restoreOriginalLocalDevFrontend:ref=>h.restore(ref),closeLocalDevLifecycleCommands:()=>lifecycle.close()})};
 if(afterRetained){const originalSessions=await Promise.all(Array.from({length:4},(_,i)=>actual('retained-session-'+i,()=>{})));trace.push('retained-originals-closed');context.devRetainedReturn={completion:{},facts:{rootOperation:context.operation,operation:'e'.repeat(32),reportSha256:'f'.repeat(64),componentQualified:true,closure:{controllersClosed:true,retainedUiTransition:false,originalSessions}},assertUninterrupted(){if(fault==='retained-signal')throw Error('ORIGINAL_MASTER_SIGNAL_HELD');},status:'BOUND'};}
 const resourceStart=source.indexOf(' async function resources('),resourceEnd=source.indexOf('\n async function revalidate(',resourceStart);assert.ok(resourceStart>=0&&resourceEnd>resourceStart);
 const object=vm.compileFunction(source.slice(resourceStart,resourceEnd)+"\nconst checkedResources=resources;resources=async(...args)=>{await checkedResources(...args);trace.push('resources-verified');};\nreturn ({"+methods+"state(){return{phase,masterStarted,devRestored,devScope,devCandidateReturn,devRestorationObservation};},setScope(value){devScope=value;},markRetainedMaster(){phase='MASTER_RETAINED';masterStarted=true;},prepareRetainedFixture(){assert.equal(masterStarted,true);const facts=devRetainedReturn.facts;devRetainedReturn=null;return structuredClone(facts);},setUnknown(){unknown=true;},setHeld(){phase='HELD';unknown=true;}});",Object.keys(context))(...Object.values(context));Object.assign(h.nativeOwner,object);h.nativeOwner.retainUnclassifiedFailure=async()=>{object.setHeld();trace.push('held');};
 const qualified=await h.qualify(selection,pin(candidateFile));object.setScope({selection:qualified,receipt:JSON.parse(h.files.get(qualified.file))});h.restorationBoundary(()=>h.nativeOwner.assertFrontendRestorationAllowed());if(afterRetained)object.markRetainedMaster();
 if(fault==='drift')h.all.redis.State.StartedAt='2026-11-02T00:00:00Z';if(fault==='unknown')object.setUnknown();if(fault==='receipt')h.files.set(pendingFile,Buffer.from('tampered obligation'));
 return{...h,boundary,lifecycle,root:object,baseline,trace,retainedApi,roleApi,held:()=>leaseHeld,cleanup(){assert.equal(lifecycle.snapshot().allOriginalChildrenClosed,true);try{lifecycle.close();}catch{}leaseHeld=false;}};
}

test('joined actual child chain returns frontend before master and retires only its obligation',async()=>{
 const h=await beforeMasterReturnHarness();try{const returned=await h.nativeOwner.restoreDevelopmentFrontendBeforeLocal();assert.ok(returned.file.endsWith('frontend-returned-before-master.json'));assert.equal(h.root.state().devRestored,true);assert.equal(h.root.state().devScope,null);assert.equal(h.root.state().masterStarted,false);assert.equal(h.held(),true);assert.ok(h.trace.indexOf('start-original-frontend')>h.trace.indexOf('CANDIDATE_VERIFIED'));assert.ok(h.trace.indexOf('obligation-retired')>h.trace.indexOf('resources-verified'));assert.ok(h.trace.includes('frontend-restored-before-master'));assert.ok(![...h.files.keys()].some(f=>f.endsWith('pending-restoration.json')));assert.equal(h.lifecycle.snapshot().children.length,2);}finally{h.cleanup();}
});
for(const fault of ['reader','sqlite','drift','unknown','receipt'])test('pre-master return refuses '+fault+' without START or obligation retirement',async()=>{
 const h=await beforeMasterReturnHarness({fault});try{await assert.rejects(h.nativeOwner.restoreDevelopmentFrontendBeforeLocal);assert.equal(h.held(),true);assert.ok(!h.trace.includes('start-original-frontend'));assert.ok([...h.files.keys()].some(f=>f.endsWith('pending-restoration.json')));assert.equal(h.root.state().masterStarted,false);}finally{h.cleanup();}
});
test('pressure refusal after verified return keeps its transition and runs the original negative rollback',async()=>{
 const h=await beforeMasterReturnHarness({fault:'pressure'});try{await assert.rejects(h.nativeOwner.restoreDevelopmentFrontendBeforeLocal,/QA_MEMORY_PRESSURE_REFUSED/);assert.equal(h.root.state().devRestored,true);assert.equal(h.root.state().masterStarted,false);await h.nativeOwner.restoreBeforeMasterFailure(Error('QA_MEMORY_PRESSURE_REFUSED'));assert.equal(h.root.state().phase,'RESTORED_AFTER_FAILED_UP');assert.ok(h.trace.includes('rollback-verified'));assert.equal(h.held(),true);assert.ok(!h.trace.includes('held'));}finally{h.cleanup();}
});

test('existing owner checks current ten, dependency and durable rollback before sole natural stop',async()=>{
 const h=harness(),before=structuredClone(h.all),ref=await h.run(),receipt=JSON.parse(h.files.get(ref.file));
 assert.deepEqual(h.trace,['fresh-ten-and-rollback','root-owned-compose-bindings','durable-obligation','fresh-native-sql-and-root-boundary','natural-sole-frontend-stop','same-root-stopped-scope','control-closed']);
 assert.equal(receipt.format,'sabalan-local-dev-frontend-pre-up-suspension/v1');assert.equal(receipt.candidateReplacementReceipt,undefined);assert.equal(receipt.productionAdmission,false);assert.equal(receipt.stopped.running,false);assert.equal(receipt.stop.stderrEof,true);
 for(const s of rules.localDevServices.filter(s=>s!=='frontend'))assert.deepEqual(h.all[s],before[s]);
});

test('same Root pending-only observation restores a clean STOP even before stopped receipt publication',async()=>{
 const h=harness({failStopPublication:true}),before=structuredClone(h.all);await assert.rejects(h.run,/STOP_RECEIPT_PUBLICATION_FAILED/);const pendingFile=[...h.files.keys()].find(f=>f.endsWith('pending-restoration.json'));assert.ok(pendingFile);assert.ok(!h.trace.includes('same-root-stopped-scope'));
 const source=fs.readFileSync(new URL('../../scripts/lib/original-candidate-rollback-owner.mjs',import.meta.url),'utf8'),census=source.slice(source.indexOf(' async function census(){'),source.indexOf(' async function docker(args)')),method=source.slice(source.indexOf('  async assertFrontendRestorationAllowed(){'),source.indexOf('\n  readFrontendSuspension()'));
 const trace=[],context={assert,guard(){},devPending:{file:pendingFile},assertFrontendLifecycleClosed:async()=>trace.push('same-registry-closed'),unknown:false,completeBound:false,phase:'PREPARING',children:[],devScope:null,baseline:{byService:before,sqlite:{sha256:'preserved-original'}},localDevIdentity:rules.localDevIdentity,localDevWindowsBirth:()=> '639000000000000001',process:{pid:123},operation:'a'.repeat(32),masterStarted:false,parse:JSON.parse,run:async()=>JSON.stringify(Object.entries(h.all).map(([Service,c])=>({ID:c.Id,Service,Project:'sabalanerp-local',State:c.State.Status,Health:c.State.Health.Status}))),base:rules.localDevCompose,inquiryMutating:false,slots:['backend-candidate','backend-retained'],relaxed:false,completeScope:null,validateCandidateProjectRows,assertLocalDevCensus:rules.assertLocalDevCensus,read:async()=>structuredClone(h.all)};
 const execute=vm.compileFunction('let devRestorationObservation=false,devRetainedReturn=null;'+census+';const inspectAll=async()=>{await census();return read();};const inquiryQuiet=async()=>{await census();};const sqlite=async()=>baseline.sqlite;return ({'+method+'}).assertFrontendRestorationAllowed();',Object.keys(context));
 let rootControl;h.restorationBoundary(async()=>{rootControl=await execute(...Object.values(context));return rootControl;});
 const pending={file:pendingFile,sha256:rules.localDevSha(h.files.get(pendingFile))};await h.restore(pending);assert.equal(h.all.frontend.State.Running,true);assert.equal(rootControl.rootOperation,'a'.repeat(32));assert.deepEqual(trace,['same-registry-closed']);
 h.all.redis.Id='f'.repeat(64);await assert.rejects(()=>execute(...Object.values(context)));
});

test('entry failure classifies original STOP faults before any restoration START or lease release',async()=>{
 const source=fs.readFileSync(new URL('../../scripts/lib/original-candidate-rollback-owner.mjs',import.meta.url),'utf8'),line=source.split('\n').find(l=>l.includes('async closeReadOnlyOrRestored(){'));
 const entrySource=fs.readFileSync(new URL('../../scripts/lib/native-c3-master-entry.mjs',import.meta.url),'utf8'),entry=entrySource.slice(entrySource.indexOf('export async function executeNativeC3MasterEntry(')).replace(/^export /,'');
 for(const fault of [{signal:'SIGTERM',code:null},{stdoutEof:false},{stderrEof:false},{streamError:'EIO'}]){
  const calls=[],child={code:0,signal:null,stdoutEof:true,stderrEof:true,spawnError:null,streamError:null,outputBoundExceeded:false,interrupted:false,...fault},closure={allOriginalChildrenClosed:true,interrupted:false,children:[child]};
  const close=vm.compileFunction('return ({'+line+'}).closeReadOnlyOrRestored;', ['assertFrontendLifecycleClosed','pressure'])(async()=>{calls.push('classify-stop');validateLocalDevLifecycleClosure(closure);},{close:async()=>{calls.push('sampler-drained');}});
  const owner={inspect:()=>({phase:'PREPARING'}),suspendDevelopmentFrontend:async()=>{calls.push('durable-pending-stop');throw Error('STOP_UNKNOWN');},closeReadOnlyOrRestored:close,retainUnclassifiedFailure:async()=>calls.push('held-same-lease')};
  const context={assert,process:{exitCode:0},JSON,readNativeC3MasterLaunch:()=>({value:{localDevFrontend:{}},revalidate(){}}),createOriginalCandidateRollbackOwner:async()=>owner};
  await vm.compileFunction('return ('+entry+')',Object.keys(context))(...Object.values(context))({},{output:{write(){}}});
  assert.deepEqual(calls,['durable-pending-stop','sampler-drained','classify-stop','held-same-lease']);
 }
});
test('real dependency and any unhealthy initial service refuse before stop or obligation',async()=>{
 for(const options of [{dependent:true},{unhealthy:true}]){const h=harness(options);await assert.rejects(h.run);assert.ok(!h.trace.includes('natural-sole-frontend-stop'));assert.ok(!h.trace.includes('durable-obligation'));}
});
test('incomplete original stop EOF stays negative and retains durable restoration obligation',async()=>{
 const h=harness({incompleteEof:true});await assert.rejects(h.run);assert.ok(h.trace.includes('durable-obligation'));assert.ok(!h.trace.includes('same-root-stopped-scope'));assert.ok([...h.files.keys()].some(f=>f.endsWith('suspension-failed.json')));assert.ok(![...h.files.keys()].some(f=>f.endsWith('pre-up-stopped.json')));
});
test('public pre-UP owner refuses caller JSON as a genuine Root before any Docker command',async()=>{
 await assert.rejects(()=>suspendOriginalLocalDevFrontend(null,{nativeOwner:{operation:'a'.repeat(32)}}),/ORIGINAL_NATIVE_ROLLBACK_OWNER_REQUIRED/);
});

test('same existing owner restores original CID/configuration, proves health and then retires obligation',async()=>{
 const h=harness(),before=structuredClone(h.all),selection=await h.run();h.trace.length=0;const restored=await h.restore(selection),value=JSON.parse(h.files.get(restored.file));
 assert.equal(value.frontend.id,before.frontend.Id);assert.equal(value.frontend.image,before.frontend.Image);assert.equal(value.frontend.configurationSha256,rules.localDevIdentity(before.frontend).configurationSha256);assert.equal(value.previousStartedAt,before.frontend.State.StartedAt);assert.notEqual(value.frontend.startedAt,value.previousStartedAt);assert.equal(value.running,true);assert.equal(value.health,'healthy');assert.equal(value.restorationRequired,false);
 assert.deepEqual(h.trace,['fresh-native-sql-and-root-boundary','start-original-frontend','obligation-retired','control-closed']);for(const s of rules.localDevServices.filter(s=>s!=='frontend'))assert.deepEqual(h.all[s],before[s]);
});
test('unknown live owner prevents start and keeps the stopped state and obligation negative',async()=>{
 const h=harness(),selection=await h.run();h.trace.length=0;h.refuseRestoration();await assert.rejects(()=>h.restore(selection),/ORIGINAL_OWNER_STILL_LIVE/);assert.equal(h.all.frontend.State.Running,false);assert.ok(!h.trace.includes('start-original-frontend'));assert.ok([...h.files.keys()].some(f=>f.endsWith('pending-restoration.json')));
});

test('canonical selected route closes the same owner on RAM refusal and never reaches UP/master',async()=>{
 const source=fs.readFileSync(new URL('../../scripts/lib/native-c3-master-entry.mjs',import.meta.url),'utf8'),fn=source.slice(source.indexOf('export async function executeNativeC3MasterEntry(')).replace(/^export /,''),trace=[];
 let stopped=false,healthy=true,released=false;const owner={operation:'same-original',inspect:()=>({phase:'PREPARING',released,unknown:false,cancelled:false}),suspendDevelopmentFrontend:async()=>{trace.push('stop-with-current-lease');stopped=true;healthy=false;return{file:'actual-stop'};},freshPreUpPreflight:async()=>{trace.push('fresh-gates');throw new Error('LOCAL_QA_HOST_MEMORY_FLOOR_REFUSED');},closeReadOnlyOrRestored:async()=>{assert.equal(stopped,true);trace.push('restore-same-frontend-and-prove-health');stopped=false;healthy=true;released=true;return{leaseClosed:true};},retainUnclassifiedFailure:async()=>{throw Error('unexpected hold');}};
 const context={assert,process:{exitCode:0},JSON,readNativeC3MasterLaunch:()=>({value:{localDevFrontend:{planFile:'selected',evidenceDirectory:'owned'}},revalidate(){}}),createOriginalCandidateRollbackOwner:async()=>owner};
 await vm.runInNewContext('('+fn+')',context)({},{input:new PassThrough(),output:{write(){}}});
 assert.deepEqual(trace,['stop-with-current-lease','fresh-gates','restore-same-frontend-and-prove-health']);assert.equal(stopped,false);assert.equal(healthy,true);
});

test('same Root census permits only enrolled stopped frontend throughout forward and rollback Inquiry transition',async()=>{
 const h=harness(),selection=await h.run(),receipt=JSON.parse(h.files.get(selection.file)),scope={selection,receipt};
 const source=fs.readFileSync(new URL('../../scripts/lib/original-candidate-rollback-owner.mjs',import.meta.url),'utf8'),body=source.slice(source.indexOf(' async function census(){'),source.indexOf(' async function docker(args)'));
 const baseline={byService:h.all},rows=Object.entries(h.all).map(([Service,c])=>({ID:c.Id,Service,Project:'sabalanerp-local',State:c.State.Status,Health:c.State.Health.Status}));rows.find(r=>r.Service==='inquiry').State='created';
 const context={assert,parse:JSON.parse,run:async()=>JSON.stringify(rows),base:rules.localDevCompose,inquiryMutating:true,baseline,completeBound:false,completeScope:null,devScope:scope,devPending:null,devRestorationObservation:false,relaxed:false,slots:['backend-candidate','backend-retained'],validateCandidateProjectRows,assertLocalDevCensus:rules.assertLocalDevCensus};
 const invoke=()=>vm.compileFunction(body+';return census()',Object.keys(context))(...Object.values(context));
 await invoke();rows.splice(rows.findIndex(r=>r.Service==='inquiry'),1);await invoke();
 rows.find(r=>r.Service==='frontend').ID='f'.repeat(64);await assert.rejects(invoke);rows.find(r=>r.Service==='frontend').ID=receipt.frontend.id;rows.find(r=>r.Service==='redis').Health='unhealthy';await assert.rejects(invoke);
});

test('restoration requires the same genuine drained lifecycle registry; caller reports and interruption refuse',async()=>{
 assert.throws(()=>assertOriginalLocalDevLifecycleRestoration({snapshot:()=>({allOriginalChildrenClosed:true,children:[]})}),/ORIGINAL_LOCAL_DEV_LIFECYCLE_REQUIRED/);
 const signals=new EventEmitter(),registry=createLocalDevLifecycleCommands(signals),pending=registry.run(process.execPath,['-e','setTimeout(()=>process.exit(1),80)']);
 assert.throws(()=>assertOriginalLocalDevLifecycleRestoration(registry),/LOCAL_DEV_ORIGINAL_CHILD_STILL_OWNED/);await pending;
 assertOriginalLocalDevLifecycleRestoration(registry);signals.emit('SIGINT');assert.throws(()=>assertOriginalLocalDevLifecycleRestoration(registry),/LOCAL_DEV_OWNER_INTERRUPTED/);registry.close();
});

test('pending-only restoration observation cannot become candidate or UP authority',async()=>{
 const source=fs.readFileSync(new URL('../../scripts/lib/original-candidate-rollback-owner.mjs',import.meta.url),'utf8'),method=source.slice(source.indexOf('  async runReplacement('),source.indexOf('\n  assertCurrentCandidatePredecessor('));
 for(const devRestorationObservation of [true,false]){
  const invoke=vm.compileFunction('return ({'+method+'}).runReplacement;', ['assert','devRestorationObservation','devPending','devScope'])(assert,devRestorationObservation,{},null);
  await assert.rejects(()=>invoke(['--replace']),devRestorationObservation?/LOCAL_DEV_RESTORATION_ONLY_OBSERVATION/:/LOCAL_DEV_STOP_NOT_BOUND/);
 }
});

test('read-only preparation persists actual capacity and safe failure location before unwinding',async()=>{
 const source=fs.readFileSync(new URL('../../scripts/lib/original-candidate-rollback-owner.mjs',import.meta.url),'utf8'),method=source.slice(source.indexOf('  async prepareFrontendSuspension('),source.indexOf('\n  registerFrontendRestorationObligation(')),saved=[];
 const lastCapacity={readOnlyPreparation:true,memory:{platform:'win32',availableBytes:536000000,observedAt:'2026-10-29T00:00:00Z'},drives:{}};
 const context={assert,owner:{assertPreparingCurrent(){}},devBaseline:null,devPending:null,devEvidence:null,path,preparationOnly:false,capture:async()=>{throw Error('ROLLBACK_READ_ONLY_MEMORY_RESERVE');},lastCapacity,save:(name,value)=>saved.push({name,value:structuredClone(value)}),operation:'a'.repeat(32),children:[]};
 const compiled=vm.compileFunction('const value={'+method+'};return {run:value.prepareFrontendSuspension,readonly:()=>preparationOnly};',Object.keys(context))(...Object.values(context));
 await assert.rejects(()=>compiled.run({planFile:path.resolve('D:/fixture/supervisor-plan.json'),evidenceDirectory:path.resolve('D:/fixture/original-evidence')}),/ROLLBACK_READ_ONLY_MEMORY_RESERVE/);
 assert.equal(compiled.readonly(),false);assert.equal(saved.length,1);assert.equal(saved[0].name,'frontend-pre-up-preparation-failed.json');assert.deepEqual(saved[0].value.capacity,lastCapacity);assert.equal(saved[0].value.reason,'ROLLBACK_READ_ONLY_MEMORY_RESERVE');assert.equal(saved[0].value.stopStarted,false);
});

test('capacity persists before refusal; read-only reserve and selected pressure admission stay distinct',async()=>{
 const source=fs.readFileSync(new URL('../../scripts/lib/original-candidate-rollback-owner.mjs',import.meta.url),'utf8'),body=source.slice(source.indexOf(' async function capacity('),source.indexOf(' const databaseIdentity='));
 for(const [preparationOnly,free,reason]of [[true,536870911,/ROLLBACK_READ_ONLY_MEMORY_RESERVE/],[false,256*1024**2,/QA_MEMORY_PRESSURE_REFUSED/],[false,256*1024**2,null]]){
  const saved=[],context={assert,recovering:false,pressure:{sample:async()=>({availableBytes:free}),assertAdmission(){if(reason)throw Error('QA_MEMORY_PRESSURE_REFUSED');}},os:{freemem:()=>free},process:{platform:'win32'},Date,path,lastCapacity:null,serial:0,preparationOnly,save:(_,v)=>saved.push(structuredClone(v)),fs:{readFileSync:()=>JSON.stringify({CustomWslDistroDir:'E:/DockerData'}),realpathSync:()=>path.resolve('E:/DockerData/disk/docker_data.vhdx'),statfsSync:()=>({bavail:20n*1024n**3n,bsize:1n})},validateQaHostMemoryObservation};
  const invoke=vm.compileFunction(body+';return capacity();',Object.keys(context));const run=()=>invoke(...Object.values(context));if(reason)await assert.rejects(run,reason);else await run();
  assert.equal(saved.length,4);assert.equal(saved.at(-1).memory.availableBytes,free);assert.equal(saved.at(-1).readOnlyPreparation,preparationOnly);assert.equal(Object.keys(saved.at(-1).drives).length,3);
 }
});

test('dependency inspection uses the existing Root Compose port and never reconstructs bindings from a report',async()=>{
 const source=fs.readFileSync(new URL('../../scripts/lib/original-candidate-rollback-owner.mjs',import.meta.url),'utf8'),method=source.slice(source.indexOf('  async assertFrontendReadersIndependent(){'),source.indexOf('\n  recordEntryFailure(')),compose=['compose','--project-name','sabalanerp-local','-f','D:/actual/base.yml','-f','D:/actual/owned-overlay.yml'],saved=[];
 const model={services:{frontend:{environment:{NODE_ENV:'development'}},backend:{}}};
 const context={assert,owner:{assertPreparingCurrent(){}},devBaseline:{file:'same-root-fresh-baseline'},devPending:null,baseline:{files:[]},pin(){throw Error('unexpected pin');},docker:async args=>{assert.deepEqual(args,[...compose,'config','--format','json']);return JSON.stringify(model);},compose,validateLocalDevFrontendCompatibility:rules.validateLocalDevFrontendCompatibility,guard(){},save:(name,value)=>{saved.push({name,value});return{name};},operation:'a'.repeat(32),sha:rules.localDevSha};
 const invoke=()=>vm.compileFunction('return ({'+method+'}).assertFrontendReadersIndependent();',Object.keys(context))(...Object.values(context));await invoke();assert.equal(saved.length,1);assert.equal(saved[0].name,'frontend-live-compose-dependency-proof.json');assert.deepEqual(saved[0].value.selectedFrontendServices,['frontend-candidate','frontend-retained']);
 model.services.backend.depends_on={frontend:{condition:'service_started'}};await assert.rejects(invoke,/LOCAL_DEV_DEPENDENT_SERVICE/);assert.equal(saved.length,1);
});

/** Actual boundary, Root restoration gate/close source and existing lifecycle;
 * deterministic Docker/SQLite ports, original real auxiliary and private lease. */
async function inspectedFrontendCycle(fault=null){
 const h=harness(),selection=await h.run(),source=fs.readFileSync(new URL('../../scripts/lib/original-candidate-rollback-owner.mjs',import.meta.url),'utf8');
 const gate=source.slice(source.indexOf('  async assertFrontendRestorationAllowed(){'),source.indexOf('  readFrontendSuspension(){'));
 const close=source.split('\n').find(line=>line.includes('async closeReadOnlyOrRestored(){'));
 const remember=source.split('\n').find(line=>line.includes("if(inspectionOnly&&result.phase==='PREPARED_READ_ONLY')preparedInspectionClosure="));assert.ok(remember);
 const dir=fs.mkdtempSync('D:/sabalanerp-online-qa/inspection-frontend-proof-'),data=path.join(dir,'protected-data');fs.writeFileSync(data,'private unchanged data');
 const lease=await acquireSerialHostLease(path.join(dir,'lease.lock')),obligation=retainOriginalSerialHostLease(lease);let root,child,closedRow,drift=false;
 const verifyBaseline=async()=>{lease.assertHeld();assert.equal(fs.readFileSync(data,'utf8'),'private unchanged data');if(drift)throw Error('ORIGINAL_SQLITE_CONSERVATION_FAILED');};
 const ctx={pressure:{close:async()=>{h.trace.push('sampler-drained');}},assert,structuredClone,lease,obligation,operation:h.nativeOwner.operation,process:{pid:process.pid,off(){}},clearInterval(){},guard:()=>lease.assertHeld(),assertFrontendLifecycleClosed:async()=>{},verifyBaseline,
  inquiryQuiet:async()=>{},sqlite:async()=>({data:'unchanged'}),localDevWindowsBirth:()=> '639000000000000001',localDevIdentity:rules.localDevIdentity,
  inspectAll:async()=>h.all,candidateBeforeUpConfiguration:()=>({same:true}),save(){},cancel(){},
  lifecycle:{restoreOriginalLocalDevFrontend:()=>h.restore(selection),closeLocalDevLifecycleCommands:()=>({allOriginalChildrenClosed:true,interrupted:false})}};
 const closeWithPort=close.replace("await import('../run-local-dev-frontend-suspension.mjs')",'lifecycle');assert.notEqual(closeWithPort,close);
 const create=vm.compileFunction(`let phase='PREPARING',runStarted=false,preparationOnly=false,masterStarted=false,completeBound=false,unknown=false,inquiryIntent=false,inquiryMutating=false,preparedInspectionClosure=null;
 let devRetainedReturn=null,devPending={},devScope={},devRestored=false,devRestorationObservation=false,released=false,keeper,candidateReport,baseline={sqlite:{data:'unchanged'},byService:{frontend:null}},children=[];const activeOriginals=new Set();
 const owner={${gate}${closeWithPort}remember(result,row){const inspectionOnly=true;${remember}phase=result.phase;runStarted=true;preparationOnly=true;children=row?[row]:[];candidateReport={inspectionOnly:true,phase:'INSPECTION_COMPLETE',pass:false};},
 fault(name){if(name==='no-owned-proof')preparedInspectionClosure=null;if(name==='mutation')preparedInspectionClosure.mutationIntent=true;if(name==='active-original')activeOriginals.add({});if(name==='master')masterStarted=true;if(name==='complete')completeBound=true;if(name==='candidate-up')candidateReport.up={};},inspect(){return{phase,released};}};return owner;`,Object.keys(ctx));root=create(...Object.values(ctx));h.restorationBoundary(()=>root.assertFrontendRestorationAllowed());
 try{
  const result=await runCandidateRollbackBoundary({assertLease:ctx.guard,captureBaseline:async()=>({}),revalidateBaseline:async()=>{},
   attemptReplacement:async hooks=>{child=spawn(process.execPath,['-e',"process.stdout.write('owned readonly auxiliary');"],{stdio:['ignore','pipe','pipe'],windowsHide:true});hooks.originalAuxiliary(child);await new Promise(resolve=>child.once('close',resolve));},
   assertQuiet(){},restoreBaseline(){throw Error('NO_UP_RESTORE');},verifyBaseline,verifyCandidate(){throw Error('NO_CANDIDATE');},persist(){},persistIntent(){throw Error('NO_UP_INTENT');},hold(){throw Error('UNEXPECTED_HELD');}},{inspectionOnly:true});
  assert.equal(result.phase,'PREPARED_READ_ONLY');closedRow=result.originalAuxiliaries[0];assert.equal(closedRow.code,0);assert.ok(closedRow.stdoutEof&&closedRow.stderrEof);root.remember(result,closedRow);
  // Public returned data cannot change the private same-boundary witness.
  result.mutationIntent=true;
  if(fault==='data-drift')drift=true;if(fault)root.fault(fault);
  if(fault){await assert.rejects(root.closeReadOnlyOrRestored);assert.ok(!h.trace.includes('start-original-frontend'));assert.equal(root.inspect().released,false);}
  else{await root.closeReadOnlyOrRestored();assert.ok(h.trace.includes('start-original-frontend'));assert.equal(root.inspect().released,true);assert.equal(h.all.frontend.State.Health.Status,'healthy');assert.equal(h.all.frontend.State.Running,true);assert.equal(fs.readFileSync(data,'utf8'),'private unchanged data');assert.throws(()=>lease.assertHeld());}
 }finally{
  // Test-only cleanup of these private modeled resources, never a real Root.
  if(!root.inspect().released){h.restorationBoundary(async()=>{});await h.restore(selection);obligation.close();await lease.release();}
  assert.equal(path.dirname(path.resolve(dir)),path.resolve('D:/sabalanerp-online-qa'));assert.ok(path.basename(dir).startsWith('inspection-frontend-proof-'));fs.rmSync(dir,{recursive:true});
 }
}
test('positive same-original inspection restores frontend, conserves data and naturally releases private lease',async()=>inspectedFrontendCycle());
for(const fault of ['no-owned-proof','mutation','active-original','master','complete','candidate-up','data-drift'])test('positive inspection restoration refuses uncertain proof before frontend start: '+fault,async()=>inspectedFrontendCycle(fault));

test('event-driven measurements bracket the same frontend stop and healthy restoration without a poller',async()=>{
 const h=harness(),selection=await h.run();assert.deepEqual(h.memoryStages,['before-stop','after-stop']);await h.restore(selection);assert.deepEqual(h.memoryStages,['before-stop','after-stop','before-restore','after-restore']);
});

test('known closed telemetry failure cannot block recovery; unknown custody and source/lease drift still refuse',async()=>{
 const source=fs.readFileSync(new URL('../../scripts/lib/original-candidate-rollback-owner.mjs',import.meta.url),'utf8'),method=source.slice(source.indexOf('  async observeDevelopmentFrontendMemory('),source.indexOf('  async suspendDevelopmentFrontend('));
 for(const stage of ['before-stop','after-stop','before-restore','after-restore'])for(const unknown of [false,true]){
  const saved=[],ctx={assert,unknown,serial:0,baseline:{},observerCustody:{},guard(){},observeLocalDevFrontendMemory:async()=>{throw Error('KNOWN_CLOSED_METRIC_UNAVAILABLE');},save:(_,v)=>{saved.push(v);return v;}};
  const run=vm.compileFunction('return ({'+method+'}).observeDevelopmentFrontendMemory;',Object.keys(ctx))(...Object.values(ctx));
  if(stage==='before-stop'||unknown)await assert.rejects(run(stage));else assert.equal((await run(stage)).telemetryQualified,false);assert.equal(saved.at(-1).memoryFreedClaimed,false);
 }
 let checks=0;const ctx={assert,unknown:false,serial:0,baseline:{},observerCustody:{},guard(){if(++checks>1)throw Error('SOURCE_OR_LEASE_CHANGED');},observeLocalDevFrontendMemory:async()=>{throw Error('METRIC_FAILED');},save(){throw Error('MUST_NOT_PUBLISH_WITHOUT_LEASE');}};
 const run=vm.compileFunction('return ({'+method+'}).observeDevelopmentFrontendMemory;',Object.keys(ctx))(...Object.values(ctx));await assert.rejects(run('after-stop'),/SOURCE_OR_LEASE_CHANGED/);
});

test('observer custody persistence failure remains unknown and cannot enable frontend restoration',()=>{
 const source=fs.readFileSync(new URL('../../scripts/lib/original-candidate-rollback-owner.mjs',import.meta.url),'utf8'),line=source.split('\n').find(l=>l.includes('const observerCustody=')),body=line.slice(line.indexOf('const observerCustody='),line.indexOf(';const pressure='));
 const child={},activeOriginals=new Set([child]),ctx={save(){throw Error('EVIDENCE_EIO');},activeOriginals};
 const value=vm.compileFunction('let unknown=false,serial=0;'+body+';return{custody:observerCustody,unknown:()=>unknown};',Object.keys(ctx))(...Object.values(ctx));
 assert.throws(()=>value.custody.onClosed(child,{code:0,signal:null,stdoutEof:true,stderrEof:true,observationFault:false}),/EVIDENCE_EIO/);assert.equal(value.unknown(),true);assert.equal(activeOriginals.size,1);
});

for(const fault of ['restart','config','network','oom','other-service'])test('after-restore metric drift keeps obligation and refuses stale healthy receipt: '+fault,async()=>{
 const h=harness(),selection=await h.run();h.nativeOwner.observeDevelopmentFrontendMemory=async stage=>{if(stage!=='after-restore')return;if(fault==='restart')h.all.frontend.State.StartedAt='2026-10-29T00:03:00Z';if(fault==='config')h.all.frontend.Config.Env.push('DRIFT=true');if(fault==='network')h.all.frontend.NetworkSettings={changed:true};if(fault==='oom')h.all.frontend.State.OOMKilled=true;if(fault==='other-service')h.all.redis.State.Health.Status='unhealthy';};
 await assert.rejects(h.restore(selection));assert.ok([...h.files.keys()].some(f=>f.endsWith('pending-restoration.json')));assert.ok([...h.files.keys()].some(f=>f.includes('restoration-failed-')));assert.ok(![...h.files.keys()].some(f=>f.endsWith('restored.json')));
});

test('actual authenticated readonly observer closure followed by metric-validation failure permits recovery observation',{skip:process.env.SABALAN_FRONTEND_MEMORY_ACTUAL_READONLY_TEST!=='1'?'explicit existing-project read-only measurement opt-in':false},async()=>{
 const source=fs.readFileSync(new URL('../../scripts/lib/original-candidate-rollback-owner.mjs',import.meta.url),'utf8'),line=source.split('\n').find(l=>l.includes('const observerCustody=')),custody=line.slice(line.indexOf('const observerCustody='),line.indexOf(';const pressure=')),method=source.slice(source.indexOf('  async observeDevelopmentFrontendMemory('),source.indexOf('  async suspendDevelopmentFrontend(')),saved=[];let actual;
 const ctx={assert,baseline:{},guard(){},save:(name,value)=>{saved.push({name,value});return{file:'private-'+name};},observeLocalDevFrontendMemory:async options=>{actual=await observeLocalDevFrontendMemory(options);validateLocalDevFrontendMemory({...actual,durationMs:15001});}};
 const root=vm.compileFunction('let unknown=false,serial=0;const activeOriginals=new Set();'+custody+';return{'+method+'status(){return{unknown,activeOriginals:activeOriginals.size};}};',Object.keys(ctx))(...Object.values(ctx));
 const result=await root.observeDevelopmentFrontendMemory('before-restore');assert.match(result.file,/negative/);assert.equal(actual.originalChildren.length,4);assert.equal(saved[0].value.code,0);assert.equal(saved[0].value.stdoutEof,true);assert.equal(saved[0].value.stderrEof,true);assert.equal(saved.at(-1).value.telemetryQualified,false);assert.deepEqual(root.status(),{unknown:false,activeOriginals:0});
 const file='D:/sabalanerp-online-qa/native-held-recovery-d475adcf-20261031/ACTUAL-FRONTEND-MEMORY-PROBE-QUALIFICATION.json';fs.writeFileSync(file,JSON.stringify({actualReadonlyProbe:actual,modeledRootGuard:true,postSuccessValidationFaultInjected:true,originalChild:saved[0].value,negativeTelemetry:saved.at(-1).value,unknown:false,allOriginalChildrenClosed:true,frontendStopped:false,productionAdmission:false},null,2)+'\n',{flag:'wx'});
});

for(const fault of ['publication','unlink','readback'])test('joined post-START '+fault+' failure preserves evidence and refuses a master',async()=>{
 const h=await beforeMasterReturnHarness({fault});try{await assert.rejects(h.nativeOwner.restoreDevelopmentFrontendBeforeLocal);assert.ok(h.trace.includes('start-original-frontend'));assert.equal(h.root.state().devRestored,false);assert.equal(h.root.state().masterStarted,false);assert.equal(h.held(),true);assert.ok([...h.files.keys()].some(f=>f.endsWith('restoring.json')));if(fault!=='readback')assert.ok([...h.files.keys()].some(f=>f.endsWith('pending-restoration.json')));else assert.ok([...h.files.keys()].some(f=>f.endsWith('restored.json')));await h.nativeOwner.restoreBeforeMasterFailure(Error('FIXTURE_RETURN_FAILURE'));assert.equal(h.root.state().phase,'HELD');assert.ok(!h.trace.includes('rollback-verified'));}finally{h.cleanup();}
});


test('post-retained frontend return requires its distinct closed pre-LOCAL boundary',async()=>{
 const {validateLocalDevRetainedReturnBoundary:validate}=await import('../../scripts/lib/local-dev-frontend-suspension.mjs');
 assert.equal(typeof validate,'function');
 const child={code:0,signal:null,stdoutEof:true,stderrEof:true,observationFault:false};
 const v={phase:'MASTER_RETAINED',masterStarted:true,completeBound:false,completeConstructionStarted:false,unknown:false,localDirectory:null,activeOriginals:0,children:[child],boundary:{phase:'CANDIDATE_VERIFIED',candidateVerified:true,primaryFailureObserved:false,mutationIntent:true,originalUp:child,originalAuxiliaries:[child]},retained:{rootOperation:'a'.repeat(32),operation:'b'.repeat(32),componentQualified:true,closure:{controllersClosed:true,retainedUiTransition:false,originalSessions:Array.from({length:4},()=>child)}}};
 assert.equal(validate(v),true);
 for(const change of [x=>x.masterStarted=false,x=>x.phase='CANDIDATE_VERIFIED',x=>x.localDirectory='already-started',x=>x.completeBound=true,x=>x.activeOriginals=1,x=>x.retained=null,x=>x.retained.componentQualified=false,x=>x.retained.closure.originalSessions.pop(),x=>x.retained.closure.originalSessions[0]={...child,stdoutEof:false},x=>x.boundary.originalUp={...child,code:1}]){const wrong=structuredClone(v);change(wrong);assert.throws(()=>validate(wrong));}
});


test('same real finite child path returns frontend after four retained EOFs with original master alive',async()=>{
 const h=await beforeMasterReturnHarness({afterRetained:true});try{const returned=await h.nativeOwner.restoreDevelopmentFrontendBeforeLocal();assert.ok(returned.file.endsWith('frontend-returned-after-retained.json'));const receipt=JSON.parse(h.files.get(returned.file));assert.equal(receipt.masterStarted,true);assert.equal(receipt.retained.operation,'e'.repeat(32));assert.equal(h.root.state().masterStarted,true);assert.equal(h.root.state().phase,'MASTER_RETAINED');assert.equal(h.root.state().devRestored,true);assert.equal(h.root.state().devScope,null);assert.ok(h.trace.indexOf('start-original-frontend')>h.trace.indexOf('retained-originals-closed'));assert.equal(h.held(),true);assert.ok(![...h.files.keys()].some(f=>f.endsWith('pending-restoration.json')));}finally{h.cleanup();}
});

test('same post-retained return refuses interruption before frontend start',async()=>{
 const h=await beforeMasterReturnHarness({afterRetained:true,fault:'retained-signal'});try{await assert.rejects(h.nativeOwner.restoreDevelopmentFrontendBeforeLocal,/ORIGINAL_MASTER_SIGNAL_HELD/);assert.ok(!h.trace.includes('start-original-frontend'));assert.equal(h.held(),true);assert.equal(h.root.state().devRestored,false);}finally{h.cleanup();}
});


// Actual producer token/read/epoch and Root bind/return code; storage, Compose,
// SQL and source-owner branding are modeled OS boundaries. Four children are real.
async function coupledRetainedFrontend({fault=null}={}){
 const h=await beforeMasterReturnHarness({afterRetained:true,fault}),facts=h.root.prepareRetainedFixture(),source=fs.readFileSync(new URL('../../scripts/lib/original-retained-browser-qualification.mjs',import.meta.url),'utf8');
 const reportFile=path.resolve('D:/fixture/retained-browser-'+facts.operation+'.json'),planFile=path.resolve('D:/fixture/retained-plan.json'),localDevSuspension=h.root.state().devScope.selection,report={operation:facts.operation,rootOperation:facts.rootOperation,localDevSuspension,originalSessions:facts.closure.originalSessions,restoredSlots:Object.fromEntries(['frontend-retained','frontend-candidate'].map(name=>[name,{id:h.all[name].Id,image:h.all[name].Image,startedAt:h.all[name].State.StartedAt}]))};
 h.files.set(reportFile,Buffer.from(JSON.stringify(report)));h.files.set(planFile,Buffer.from('fixed modeled retained plan'));
 const stableFile=file=>{const raw=h.files.get(file)??fs.readFileSync(file);return{raw,sha256:rules.localDevSha(raw)};},completionFacts=new WeakMap(),brands=new WeakSet([h.nativeOwner]);
 const ctx={assert,structuredClone,completionFacts,stableFile,report,reportFile,planFile,planSha256:stableFile(planFile).sha256,sourcePins:new Map(),retainedUiTransition:false,nativeOwner:h.nativeOwner,after:structuredClone(h.all),localDevSuspension,assertLocalDevSuspensionCurrent(selection){assert.deepEqual(selection,localDevSuspension);assert.equal(h.all.frontend.State.Running,false);assert.ok([...h.files.keys()].some(f=>f.endsWith('pending-restoration.json')));},assertOriginalCandidateRollbackOwner:owner=>assert.ok(brands.has(owner),'MODELED_ORIGINAL_OWNER_REQUIRED')};
 const a=source.indexOf(' let frontendReturn=null;'),b=source.indexOf(' const images=',a),t=source.indexOf('const token=Object.freeze({});completionFacts.set(token,'),end=source.indexOf('return token;',t)+'return token;'.length;
 assert.ok(a>=0&&b>a&&t>b&&end>t);const completion=vm.compileFunction(source.slice(a,b)+source.slice(t,end),Object.keys(ctx))(...Object.values(ctx));
 const readStart=source.indexOf('export function readOriginalRetainedBrowserQualificationCompletion(');
 const readBody=source.slice(readStart,source.indexOf('\n\n/** Genuine closed',readStart)).replace(/^export /,'');
 const acceptBody=source.slice(source.indexOf('export function acceptOriginalRetainedFrontendReturn(')).replace(/^export /,'');
 const api=vm.compileFunction(readBody+'\n'+acceptBody+'\nreturn {read:readOriginalRetainedBrowserQualificationCompletion,accept:acceptOriginalRetainedFrontendReturn};',Object.keys(ctx))(...Object.values(ctx));
 Object.assign(h.retainedApi,{readOriginalRetainedBrowserQualificationCompletion:api.read,readOriginalRetainedBrowserReturnCustody(value,owner){assert.equal(value,completion);assert.equal(owner,h.nativeOwner);const row=api.read(value);return{...facts,localDevSuspension:row.currentLocalDevSuspension,currentServiceIdentities:Object.fromEntries(Object.entries(h.all).map(([name,c])=>[name,{id:c.Id,image:c.Image,startedAt:c.State.StartedAt}])),reportFile,reportSha256:stableFile(reportFile).sha256};},acceptOriginalRetainedFrontendReturn:api.accept});
 const roleSource=fs.readFileSync(new URL('../../scripts/lib/application-native-role-coordinator.mjs',import.meta.url),'utf8'),originalQualificationCompletions=new WeakMap(),originalQualificationRetainedCompletions=new WeakMap();
 const localReads=roleSource.slice(roleSource.indexOf('export function readOriginalRoleRetainedBrowserCompletion('),roleSource.indexOf('\n\n\n/** Validates original closure')).replaceAll('export function','function');
 const roleCtx={assert,structuredClone,originalQualificationCompletions,originalQualificationRetainedCompletions,readOriginalRetainedBrowserQualificationCompletion:api.read};Object.assign(h.roleApi,vm.compileFunction(localReads+';return {read:readOriginalRoleQualificationCompletion,retained:readOriginalRoleRetainedBrowserCompletion};',Object.keys(roleCtx))(...Object.values(roleCtx)));
 function finishLocal({wrongReport=false}={}){
  const row=api.read(completion),legacy={restored:{id:h.all['frontend-retained'].Id,image:h.all['frontend-retained'].Image,startedAt:h.all['frontend-retained'].State.StartedAt}},browser={...row.report,restoredSlots:Object.fromEntries(['frontend-retained','frontend-candidate'].map(name=>[name,{id:h.all[name].Id,image:h.all[name].Image,startedAt:h.all[name].State.StartedAt}]))};
  // A real retained producer already records these slots before it publishes.
  assert.ok(report.restoredSlots,'FIXTURE_REPORT_MUST_BE_COMPLETE_BEFORE_EPOCH');
  const owned=(value)=>{const raw=Buffer.from(JSON.stringify(value));return{rawBase64:raw.toString('base64'),bytes:raw.length,sha256:rules.localDevSha(raw)};},ownedOutputs={'original-retained-browser-result.json':owned(wrongReport?{...row.report,changed:true}:row.report),'original-private-legacy-ui-restoration.json':owned(legacy)},ctx={...roleCtx,fs,sha:rules.localDevSha,roles:new Map(row.report.originalSessions.map((result,i)=>['fixture-'+i,{child:{pid:result.originalPid},result}])),fileHashes:{},ownedOutputs,closures:new Map(),history:[],localQualificationMode:'PROTECTED_COMPLETE',retainedFinal:row,retainedBrowserCompletion:completion,localOnlineCompletion:null,retainedCompleteIssuer:null,originalQualificationPointCompletions:new WeakMap(),originalRestoredIssuers:new WeakMap(),Buffer};
  const start=roleSource.indexOf('const token=Object.freeze({});originalQualificationCompletions.set'),end=roleSource.indexOf('return token;',start)+'return token;'.length,tail=roleSource.slice(start,end).replace('new URL(import.meta.url)',JSON.stringify(path.resolve('scripts/lib/application-native-role-coordinator.mjs')));
  h.baseline.browsers=Object.fromEntries(['frontend-retained','frontend-candidate'].map(name=>[name,{files:[],model:{modeled:true},image:{Id:h.all[name].Image},daemonDefaults:{},currentSource:{}}]));h.baseline.browserCurrent=Object.fromEntries(['frontend-retained','frontend-candidate'].map(name=>[name,structuredClone(h.all[name])]));
  return vm.compileFunction(tail,Object.keys(ctx))(...Object.values(ctx));
 }
 return{...h,completion,api,finishLocal,reportFile,reportRaw:Buffer.from(h.files.get(reportFile))};
}

test('coupled original completion survives genuine Root return without rewriting its stopped report',async()=>{
 const h=await coupledRetainedFrontend();try{assert.ok(h.api.read(h.completion).currentLocalDevSuspension);await h.nativeOwner.bindOriginalRetainedBrowserReturn(h.completion,()=>{});const current=h.api.read(h.completion);assert.equal(current.currentLocalDevSuspension,null);assert.deepEqual(h.files.get(h.reportFile),h.reportRaw);assert.ok(current.report.localDevSuspension);await h.nativeOwner.assertRetainedFrontendCurrent(h.completion);assert.equal(h.held(),true);assert.throws(()=>h.api.accept({},h.nativeOwner),/CUSTODY/);assert.throws(()=>h.api.accept(h.completion,{}),/CUSTODY/);assert.throws(()=>h.api.accept(h.completion,h.nativeOwner));}finally{h.cleanup();}
});

for(const change of [c=>c.State.StartedAt='changed',c=>c.Config.Cmd=['changed'],c=>c.RestartCount++,c=>c.NetworkSettings.Networks['sabalanerp-local_default'].EndpointID='0'.repeat(64)])test('same Root fresh admission rejects drift after private epoch '+String(change),async()=>{
 const h=await coupledRetainedFrontend();try{await h.nativeOwner.bindOriginalRetainedBrowserReturn(h.completion,()=>{});change(h.all.frontend);await assert.rejects(h.nativeOwner.assertRetainedFrontendCurrent(h.completion));assert.equal(h.held(),true);}finally{h.cleanup();}
});

test('pressure after private epoch stays negative while its verified returned incarnation remains revalidatable',async()=>{
 const h=await coupledRetainedFrontend({fault:'retained-return-pressure'});try{await assert.rejects(h.nativeOwner.bindOriginalRetainedBrowserReturn.bind(null,h.completion,()=>{}),/QA_MEMORY_PRESSURE_REFUSED/);assert.equal(h.api.read(h.completion).currentLocalDevSuspension,null);assert.equal(h.root.state().devRestored,true);assert.deepEqual(h.files.get(h.reportFile),h.reportRaw);assert.equal(h.held(),true);}finally{h.cleanup();}
});


test('coupled STOP UP retained return LOCAL registry and COMPLETE scope preserve the original stopped report',async()=>{
 const h=await coupledRetainedFrontend();try{await h.nativeOwner.bindOriginalRetainedBrowserReturn(h.completion,()=>{});await h.nativeOwner.assertRetainedFrontendCurrent(h.completion);const local=h.finishLocal();assert.equal(h.roleApi.retained(local),h.completion);assert.throws(()=>h.roleApi.retained({}),/COMPLETION/);await h.nativeOwner.bindOriginalLocalCompletion(local);await h.nativeOwner.assertCompleteCurrent();assert.deepEqual(h.files.get(h.reportFile),h.reportRaw);assert.ok(h.api.read(h.completion).report.localDevSuspension);h.all.frontend.RestartCount++;await assert.rejects(h.nativeOwner.assertCompleteCurrent());assert.equal(h.held(),true);}finally{h.cleanup();}
});

test('owned LOCAL report bytes cannot substitute another retained report in COMPLETE binding',async()=>{
 const h=await coupledRetainedFrontend();try{await h.nativeOwner.bindOriginalRetainedBrowserReturn(h.completion,()=>{});const local=h.finishLocal({wrongReport:true});await assert.rejects(h.nativeOwner.bindOriginalLocalCompletion(local));assert.equal(h.held(),true);}finally{h.cleanup();}
});


for(const fault of ['publication','unlink','readback'])test('post-retained '+fault+' uncertainty cannot issue the current epoch or start LOCAL',async()=>{
 const h=await coupledRetainedFrontend({fault});try{await assert.rejects(h.nativeOwner.bindOriginalRetainedBrowserReturn.bind(null,h.completion,()=>{}));assert.equal(h.root.state().devRestored,false);assert.ok(h.trace.includes('start-original-frontend'));assert.throws(()=>h.api.read(h.completion));assert.deepEqual(h.files.get(h.reportFile),h.reportRaw);assert.equal(h.held(),true);}finally{h.cleanup();}
});

test('same actual Root negative-return code rolls back after verified epoch without restoring frontend again',async()=>{
 const h=await coupledRetainedFrontend({fault:'retained-return-pressure'});try{await assert.rejects(h.nativeOwner.bindOriginalRetainedBrowserReturn.bind(null,h.completion,()=>{}),/QA_MEMORY_PRESSURE_REFUSED/);const before=rules.localDevIdentity(h.all.frontend),starts=h.trace.filter(v=>v==='start-original-frontend').length;await h.nativeOwner.fixtureRestoreKnownRetainedNegative(h.completion);assert.equal(h.root.state().phase,'RESTORED_AFTER_FAILED_UP');assert.deepEqual(rules.localDevIdentity(h.all.frontend),before);assert.equal(h.trace.filter(v=>v==='start-original-frontend').length,starts);assert.ok(h.trace.indexOf('sampler-drained-for-recovery')<h.trace.indexOf('rollback-up'));assert.ok(h.trace.includes('rollback-verified'));assert.deepEqual(h.files.get(h.reportFile),h.reportRaw);assert.equal(h.held(),true);}finally{h.cleanup();}
});
