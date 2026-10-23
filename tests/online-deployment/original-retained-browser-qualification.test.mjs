import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const hashBytes=raw=>createHash('sha256').update(raw).digest('hex');
import {validateSelectedImageReceipt} from '../../scripts/run-independent-full-restore-controller.mjs';
import {validateRetainedInquiryStartupRefresh,validateRetainedInquiryProxy,assertRetainedPreActorClosure,validateRetainedBrowserPlan,readOriginalRetainedBrowserQualificationCompletion,assertRetainedControllerEof,validateRetainedBrowserCapacity,buildRetainedInquiryRotation,readRetainedInquiryAuthorityMount,retainedBrowserContainerInspectArguments} from '../../scripts/lib/original-retained-browser-qualification.mjs';
test('saved JSON cannot substitute an original retained-browser completion',()=>{
 for(const value of [{},{pass:true,allOriginalChildrenClosed:true},Object.freeze({})])assert.throws(()=>readOriginalRetainedBrowserQualificationCompletion(value),/ORIGINAL_RETAINED_BROWSER_COMPLETION_UNPROVEN/);
});
test('Inquiry rotation preserves the measured authority cohort instead of mounting its parent volume',()=>{
 const proxy={hostname:'inquiry-qualification.localhost',address:'172.18.0.3',containerId:'a'.repeat(64),image:'sha256:'+'b'.repeat(64),startedAt:'2026-10-22T00:00:00Z',networkId:'c'.repeat(64),networkName:'sabalanerp-local_default'};
 const authority={name:'sabalanerp-local_online_runtime_authority',subpath:'cohort-'+'e'.repeat(32)};
 const rotation=buildRetainedInquiryRotation({old:'sha256:'+'1'.repeat(64),current:'sha256:'+'2'.repeat(64)},'acceptance',authority,proxy);
 assert.equal(rotation.volumes.inquiry_pair_authority.name,authority.name);
 for(const service of Object.values(rotation.services)){
  const mount=service.volumes.find(row=>row.target==='/run/sabalan-online');
  assert.equal(mount.read_only,true);assert.deepEqual(mount.volume,{nocopy:true,subpath:authority.subpath});
 }
});
test('authority views require actual engine subpath or an unambiguous legacy whole-volume bind',()=>{
 const name='sabalanerp-local_online_runtime_authority',target='/app/runtime-authority',subpath='cohort-'+'a'.repeat(32);
 const container={Mounts:[{Type:'volume',Name:name,Destination:target,RW:true,Source:'/var/lib/docker/volumes/'+name+'/_data/'+subpath}],HostConfig:{Mounts:[{Type:'volume',Source:name,Target:target,ReadOnly:false,VolumeOptions:{NoCopy:true,Subpath:subpath}}],Binds:[]}};
 assert.deepEqual(readRetainedInquiryAuthorityMount(container,target,false),{name,subpath});
 for(const mutate of [v=>v.HostConfig.Mounts=[],v=>v.HostConfig.Mounts[0].VolumeOptions.NoCopy=false,v=>v.HostConfig.Mounts[0].VolumeOptions.Subpath='../parent',v=>v.HostConfig.Mounts[0].Source='foreign',v=>v.HostConfig.Mounts[0].ReadOnly=true,v=>v.Mounts[0].RW=false]){const changed=structuredClone(container);mutate(changed);assert.throws(()=>readRetainedInquiryAuthorityMount(changed,target,false));}
 const legacy=structuredClone(container);legacy.HostConfig={Mounts:[],Binds:[name+':'+target+':rw']};legacy.Mounts[0].Source='/var/lib/docker/volumes/'+name+'/_data';
 assert.deepEqual(readRetainedInquiryAuthorityMount(legacy,target,false),{name,subpath:''});
 legacy.Mounts[0].Source+='/'+subpath;assert.throws(()=>readRetainedInquiryAuthorityMount(legacy,target,false),/INQUIRY_AUTHORITY_WHOLE_VOLUME_UNPROVEN/);
 const actor=structuredClone(container);actor.Mounts[0].Destination='/run/sabalan-online';actor.Mounts[0].RW=false;actor.HostConfig.Mounts[0].Target='/run/sabalan-online';actor.HostConfig.Mounts[0].ReadOnly=true;
 assert.deepEqual(readRetainedInquiryAuthorityMount(actor,'/run/sabalan-online',true),{name,subpath});
});
test('a final JSON frame never hides truncated trailing bytes or an unclosed stream',()=>{
 assertRetainedControllerEof({stdoutEof:true,stderrEof:true,trailingBytes:0});
 for(const wrong of [{stdoutEof:false,stderrEof:true,trailingBytes:0},{stdoutEof:true,stderrEof:false,trailingBytes:0},{stdoutEof:true,stderrEof:true,trailingBytes:1}])assert.throws(()=>assertRetainedControllerEof(wrong));
});
test('retained browser plan cannot supply arbitrary images, commands or controllers',()=>{
 const plan={format:'sabalan-original-retained-browser-plan/v1',preflightFile:'D:/sabalanerp-online-qa/fresh-preflight.json'};
 assert.deepEqual(validateRetainedBrowserPlan(plan),plan);
 const actualLegacy={...plan,legacyAugmentationReceipt:'D:/sabalanerp-online-qa/original-augmentation/image.json',legacyAugmentationSha256:'a'.repeat(64)};assert.deepEqual(validateRetainedBrowserPlan(actualLegacy),actualLegacy);assert.throws(()=>validateRetainedBrowserPlan({...actualLegacy,legacyAugmentationSha256:'caller-pass'}));
 const refresh={...actualLegacy,startupRefreshReceipt:'D:/sabalanerp-online-qa/startup/image.json',startupRefreshSha256:'b'.repeat(64)};assert.equal(validateRetainedBrowserPlan(refresh),refresh);for(const changed of [{startupRefreshSha256:undefined},{startupRefreshReceipt:undefined},{startupRefreshSha256:'pass'}])assert.throws(()=>validateRetainedBrowserPlan({...refresh,...changed}));
 for(const field of ['image','argv','controllerFile','existingReport','sourceCommit'])assert.throws(()=>validateRetainedBrowserPlan({...plan,[field]:'caller-selected'}));
});

test('startup refresh preserves complete C1 provenance and only two frozen startup files',()=>{
 const digest=n=>n.repeat(64),sourceCommit='a'.repeat(40),baseImage='sha256:c1ef9462f192f03f62a781b35ad13ae3de4aa780670b7638bb53a713a4d256b4',image='sha256:'+digest('b'),base={format:'sabalan-inquiry-native-image-diagnostic/v1',image:baseImage,sourceCommit:'c'.repeat(40),inquirySourceCommit:'d'.repeat(40),browserDeploymentId:'inquiry_actual_compiled',archiveSha256:digest('f'),archiveBytes:5180250,runtimeSourceHashes:{native:digest('c')},materialSources:{business:digest('e')}},baseArchive={rootfsDiffIds:Array.from({length:23},(_,n)=>'sha256:'+n.toString(16).padStart(64,'0'))},canonicalBefore=Object.fromEntries(Array.from({length:10},(_,n)=>['service'+n,{id:digest('f')}]));
 const archive={index:image,platform:'sha256:'+digest('c'),config:'sha256:'+digest('d'),archiveSha256:digest('e'),archiveBytes:123456,rootfsDiffIds:[...baseArchive.rootfsDiffIds,'sha256:'+digest('a'),'sha256:'+digest('b')]},copyFiles=[['deploy/scripts/inquiry-compiled-browser.cjs','app/inquiry-compiled-browser.cjs','0644'],['deploy/scripts/run-inquiry-with-recovery.sh','app/run-inquiry-with-recovery.sh','0755']].map(([relative,target,imageMode])=>{const raw=Buffer.from('startup '+relative+'\r\n'),lf=Buffer.from(raw.toString().replace(/\r\n/g,'\n'));return {relative,target:'/'+target,imageMode,bytes:lf.length,sha256:hashBytes(lf),workingSha256:hashBytes(raw)};}),sourceFiles=Object.fromEntries(copyFiles.map(row=>[row.relative,{workingSha256:row.workingSha256,sha256:row.sha256,bytes:row.bytes,rawBase64:Buffer.from('startup '+row.relative+'\r\n').toString('base64')}])),addedFileDeltas=Object.fromEntries(copyFiles.map((row,n)=>[row.target.slice(1),{sha256:row.sha256,bytes:row.bytes,mode:row.imageMode,layer:23+n}]));
 const recipe={finalApplicationSourceCommit:sourceCommit,baseImage,baseImageReceiptSha256:'2d4259e7f3ca39c00a3d19a6e21d0dc8001a09794f4b5b4f6e0836206dcd8752',compiledBusinessRebuilt:false,cmd:['/app/run-inquiry-with-recovery.sh'],entrypointInheritedUnchanged:true,labelsInheritedNoRelabel:true,copyFiles},proof={...archive,format:'sabalan-inquiry-exact-startup-overlay-verification/v1',pass:true,productionAdmission:false,noBusinessOrCompiledRuntimeContentChanges:true,allLayersExpandedAndFullDiffIdsVerified:true,baseCompletePrefixLayers:23,addedFileDeltas},receipt={...base,image,sourceCommit,materialSources:{...base.materialSources,...Object.fromEntries(copyFiles.map(row=>[row.relative,row.workingSha256]))},startupRefresh:{format:'sabalan-inquiry-startup-refresh-provenance/v1',baseImage,baseImageReceiptSha256:recipe.baseImageReceiptSha256,preservedBusinessSourceCommit:base.sourceCommit,preservedCompiledGitlinkCommit:base.inquirySourceCommit,finalStartupSourceCommit:sourceCommit,compiledBusinessRebuilt:false,allBaseMaterialProvenanceInherited:true,currentMaterialSourcesOnlyOverridesTwoStartupFiles:true,canonicalBefore,canonicalAfter:structuredClone(canonicalBefore),fullBasePrefixLayers:23,nativeArchiveIdentity:{sha256:archive.archiveSha256,bytes:archive.archiveBytes},helperDeltas:addedFileDeltas}},closure={format:'sabalan-original-inquiry-startup-refresh-native-closure/v1',testOnly:false,pass:true,originalClosure:{allOriginalChildrenClosed:true,interrupted:false,childCount:2},canonicalBefore,canonicalAfter:structuredClone(canonicalBefore),graph:archive,commands:[{result:{code:0,signal:null,naturalChildClosure:true,originalPid:123,outputBoundExceeded:false}}]},input={receipt,base,baseArchive,archive,recipe,proof,closure,sourceCommit,sourceFiles,historicalSourceFiles:Object.fromEntries(Object.entries(sourceFiles).map(([name,row])=>[name,{rawBase64:Buffer.from(Buffer.from(row.rawBase64,'base64').toString().replace(/\r\n/g,'\n')).toString('base64')}])),inquirySourceCommit:base.inquirySourceCommit,historicalInquirySourceCommit:base.inquirySourceCommit};
 assert.notEqual(receipt.archiveSha256,archive.archiveSha256);assert.notEqual(receipt.archiveBytes,archive.archiveBytes);assert.equal(validateRetainedInquiryStartupRefresh(input),image);assert.equal(validateSelectedImageReceipt('inquiry',{sourceImageId:image,archiveSha256:base.archiveSha256,runtimeSourceHashes:base.runtimeSourceHashes},receipt),receipt);
 for(const mutate of [v=>v.receipt.testOnly=true,v=>v.receipt.archiveSha256=v.archive.archiveSha256,v=>v.receipt.archiveBytes=v.archive.archiveBytes,v=>v.receipt.startupRefresh.nativeArchiveIdentity.sha256=v.receipt.archiveSha256,v=>v.receipt.runtimeSourceHashes.native=digest('0'),v=>v.receipt.browserDeploymentId='guessed',v=>v.receipt.sourceCommit='f'.repeat(40),v=>v.archive.rootfsDiffIds[5]='sha256:'+digest('9'),v=>v.proof.addedFileDeltas['app/inquiry-compiled-browser.cjs'].sha256=digest('9'),v=>v.recipe.copyFiles.push({...v.recipe.copyFiles[0]}),v=>v.sourceFiles['deploy/scripts/run-inquiry-with-recovery.sh'].workingSha256=digest('8'),v=>v.closure.originalClosure.allOriginalChildrenClosed=false,v=>v.closure.commands[0].result.code=1,v=>v.closure.commands[0].result.spawnError='ENOENT',v=>v.closure.commands[0].result.streamError='EPIPE',v=>v.closure.commands[0].result.naturalChildClosure=false,v=>v.receipt.startupRefresh.canonicalAfter.service0.id=digest('9')]){const changed=JSON.parse(JSON.stringify(input));mutate(changed);assert.throws(()=>validateRetainedInquiryStartupRefresh(changed));}
});
test('measured working reserves refuse cap drift, OOM and insufficient VM memory',()=>{
 const M=1024*1024,valid={stage:'BEFORE_SLOT_MUTATION',hostFree:1800*M,linuxMemAvailable:1700*M,cgroups:{'backend-candidate':{current:200*M,maximum:1536*M,events:{oom:0,oom_kill:0}},'frontend-retained':{current:180*M,maximum:512*M,events:{oom:0,oom_kill:0}},'frontend-candidate':{current:180*M,maximum:512*M,events:{oom:0,oom_kill:0}}}};validateRetainedBrowserCapacity(valid);
 for(const mutate of [v=>v.linuxMemAvailable=1500*M,v=>v.cgroups['backend-candidate'].maximum=1024*M,v=>v.cgroups['frontend-retained'].current=300*M,v=>v.cgroups['frontend-candidate'].events.oom_kill=1]){const value=structuredClone(valid);mutate(value);assert.throws(()=>validateRetainedBrowserCapacity(value));}
});

test('real Compose inherits one /tmp during Inquiry rotation and leaves other services unchanged',{
 skip:process.env.SABALAN_COMPOSE_CONFIG_TEST!=='1'?'Set SABALAN_COMPOSE_CONFIG_TEST=1 for existing-project Compose validation':false,
},()=>{
 const root=path.resolve(import.meta.dirname,'../..'),base=path.join(root,'docker-compose.local.yml'),browser=path.join(root,'docker-compose.application-browser-acceptance.yml');
 const images={old:'sha256:'+'a'.repeat(64),current:'sha256:'+'b'.repeat(64)},proxy={hostname:'inquiry-qualification.localhost',address:'172.18.0.3',containerId:'c'.repeat(64),image:'sha256:'+'d'.repeat(64),startedAt:'2026-10-20T00:00:00Z',networkId:'e'.repeat(64),networkName:'sabalanerp-local_default'};
 const env={...process.env,ONLINE_BROWSER_OLD_IMAGE:images.old,ONLINE_BROWSER_NEW_IMAGE:images.current,ONLINE_BROWSER_OLD_BUILD_ID:'erp_retained_compose_regression',ONLINE_BROWSER_NEW_BUILD_ID:'erp_current_compose_regression'};
 const parse=raw=>{try{const value=JSON.parse(raw);return Array.isArray(value)?value:[value];}catch{return raw.trim().split(/\r?\n/).map(JSON.parse);}};
 function verifyProject(){
  const result=spawnSync('docker',['compose','-f',base,'ps','--all','--format','json'],{cwd:root,env,encoding:'utf8'});assert.equal(result.status,0,result.stderr);
  const rows=parse(result.stdout);assert.equal(rows.length,10);assert.ok(rows.every(row=>row.Project==='sabalanerp-local'&&row.State==='running'&&row.Health==='healthy'));return rows;
 }
 function docker(args){verifyProject();return spawnSync('docker',args,{cwd:root,env,encoding:'utf8',maxBuffer:4*1024**2});}
 function identities(){
  const rows=verifyProject(),result=docker(['inspect','--format','{"id":{{json .Id}},"image":{{json .Image}},"startedAt":{{json .State.StartedAt}},"running":{{json .State.Running}}}',...rows.map(row=>row.ID)]);
  assert.equal(result.status,0,result.stderr);return parse(result.stdout).sort((a,b)=>a.id.localeCompare(b.id));
 }
 const before=identities(),directory=fs.mkdtempSync(path.join(os.tmpdir(),'sabalan-inquiry-compose-'));
 try{
  const rotation=buildRetainedInquiryRotation(images,'sabalan-acceptance-config-test',{name:'sabalan-authority-config-test',subpath:'cohort-'+'a'.repeat(32)},proxy);
  const overlay=path.join(directory,'rotation.json');fs.writeFileSync(overlay,JSON.stringify(rotation));
  const compose=['compose','-f',base,'-f',browser,'--profile','application-browser-acceptance'];
  const baseline=docker([...compose,'config','--format','json']);assert.equal(baseline.status,0,baseline.stderr);
  const legacy=structuredClone(rotation);for(const service of Object.values(legacy.services))service.tmpfs.unshift('/tmp:rw,nosuid,nodev,mode=1777');
  const legacyFile=path.join(directory,'legacy-duplicate.json');fs.writeFileSync(legacyFile,JSON.stringify(legacy));
  const rejected=docker([...compose,'-f',legacyFile,'config','--format','json']);assert.notEqual(rejected.status,0);assert.match(rejected.stderr,/target \/tmp already mounted/);
  const result=docker([...compose,'-f',overlay,'config','--format','json']);assert.equal(result.status,0,result.stderr);
  const actual=JSON.parse(result.stdout),original=JSON.parse(baseline.stdout),targets=['frontend-retained','frontend-candidate'];assert.equal(actual.name,'sabalanerp-local');
  for(const name of targets){
   const service=actual.services[name];assert.equal(service.image,images[name==='frontend-retained'?'old':'current']);
   assert.deepEqual(service.tmpfs,['/tmp','/app/.next/cache:rw,nosuid,nodev,mode=0700']);
   assert.deepEqual(service.extra_hosts,['inquiry-qualification.localhost=172.18.0.3']);assert.equal(service.mem_limit,String(768*1024*1024));assert.equal(service.read_only,true);assert.deepEqual(service.ports??[],[]);assert.equal(service.build,undefined);assert.equal(service.healthcheck.disable,true);
   assert.deepEqual(service.cap_drop,['ALL']);assert.deepEqual(service.security_opt,['no-new-privileges:true']);
   assert.deepEqual(service.volumes.find(row=>row.target==='/run/sabalan-online').volume,{nocopy:true,subpath:'cohort-'+'a'.repeat(32)});
   assert.deepEqual(service.volumes.map(row=>({target:row.target,readOnly:row.read_only??false})).sort((a,b)=>a.target.localeCompare(b.target)),[{target:'/app/online-runtime-acceptance',readOnly:false},{target:'/run/sabalan-online',readOnly:true}]);
  }
  for(const name of Object.keys(original.services).filter(name=>!targets.includes(name)))assert.deepEqual(actual.services[name],original.services[name]);
  assert.deepEqual(identities(),before,'CONFIG_ONLY_MUST_PRESERVE_ALL_TEN_CONTAINER_IDENTITIES');
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});

// A deliberate negative event may reject the pending positive waiter, but any
// unrelated protocol error before OR after it must keep the original held.
test('known preactor failure cannot conceal malformed frames or open streams',()=>{
 const result={code:1,signal:null,stdoutEof:true,stderrEof:true,trailingBytes:0},owner={protocolFailure:null,events:[],actorStarted:false};
 assertRetainedPreActorClosure(result,owner);
 for(const changed of [{protocolFailure:Error('earlier malformed frame')},{protocolFailure:Error('later sequence mismatch')},{events:[{event:'unexpected'}]},{actorStarted:true}])assert.throws(()=>assertRetainedPreActorClosure(result,{...owner,...changed}));
 for(const changed of [{code:0},{signal:'SIGTERM'},{stdoutEof:false},{trailingBytes:1}])assert.throws(()=>assertRetainedPreActorClosure({...result,...changed},owner));
});

test('fixed Inquiry QA memory caps follow lifecycle stages while actual reserves remain enforced',()=>{
 const M=1048576;
 for(const [stage,cap]of Object.entries({BEFORE_SLOT_MUTATION:512,OWNED_KEEPERS_CREATED:768,BOTH_NATIVE_READY_BEFORE_CHROME:768,ORIGINALS_CLOSED_AND_ERP_SLOTS_RESTORED:512})){
  const value={stage,hostFree:1800*M,linuxMemAvailable:1800*M,cgroups:{'backend-candidate':{current:200*M,maximum:1536*M,events:{}},'frontend-retained':{current:278*M,maximum:cap*M,events:{}},'frontend-candidate':{current:278*M,maximum:cap*M,events:{}}}};
  if(cap===768)validateRetainedBrowserCapacity(value);else assert.throws(()=>validateRetainedBrowserCapacity(value),/INQUIRY_CGROUP_HEADROOM_REFUSED/);
  value.cgroups['frontend-retained'].current=value.cgroups['frontend-candidate'].current=200*M;validateRetainedBrowserCapacity(value);
  for(const wrong of [512,768,1024].filter(n=>n!==cap)){const drift=structuredClone(value);drift.cgroups['frontend-candidate'].maximum=wrong*M;assert.throws(()=>validateRetainedBrowserCapacity(drift),/INQUIRY_CGROUP_CAP_DRIFT/);}
  for(const change of [v=>v.hostFree=1535*M,v=>v.linuxMemAvailable=1535*M,v=>v.cgroups['backend-candidate'].current=1153*M,v=>v.cgroups['frontend-candidate'].current=(cap-255)*M,v=>v.cgroups['frontend-candidate'].events.oom_kill=1]){const bad=structuredClone(value);change(bad);assert.throws(()=>validateRetainedBrowserCapacity(bad));}
  assert.throws(()=>validateRetainedBrowserCapacity({...value,stage:'caller-selected'}),/INQUIRY_CAPACITY_STAGE_UNPROVEN/);
 }
});

test('QA proxy binds a fixed reserved hostname to measured private backend identity',()=>{
 const proxy={hostname:'inquiry-qualification.localhost',address:'172.18.0.3',containerId:'a'.repeat(64),image:'sha256:'+'b'.repeat(64),startedAt:'2026-10-20T00:00:00Z',networkId:'c'.repeat(64),networkName:'sabalanerp-local_default'};
 assert.equal(validateRetainedInquiryProxy(proxy),proxy);
 for(const changed of [{hostname:'external.example'},{address:'127.0.0.1'},{address:'0.0.0.0'},{address:'8.8.8.8'},{containerId:'unknown'},{networkId:'unknown'},{networkName:'other-project'},{image:'mutable:latest'},{port:443}])assert.throws(()=>validateRetainedInquiryProxy({...proxy,...changed}));
});


test('actual retained inspector handles all ten canonical legacy and cohort containers without changing them',{
 skip:process.env.SABALAN_RETAINED_INSPECT_TEST!=='1'?'Set SABALAN_RETAINED_INSPECT_TEST=1 for existing-project read-only inspector validation':false,
},()=>{
 const root=path.resolve(import.meta.dirname,'../..'),base='D:/sabalanerp/docker-compose.local.yml';
 const expected=['backend','backend-candidate','backend-retained','clamav','frontend','frontend-candidate','frontend-retained','inquiry','postgres','redis'].sort();
 const parse=raw=>{try{const value=JSON.parse(raw);return Array.isArray(value)?value:[value];}catch{return raw.trim().split(/\r?\n/).map(line=>JSON.parse(line));}};
 function canonicalPs(){
  const value=spawnSync('docker',['compose','-f',base,'ps','--all','--no-trunc','--format','json'],{cwd:root,encoding:'utf8',maxBuffer:4*1024**2});
  assert.equal(value.status,0,value.stderr);const entries=parse(value.stdout);assert.equal(entries.length,10);assert.deepEqual(entries.map(row=>row.Service).sort(),expected);
  assert.ok(entries.every(row=>row.Project==='sabalanerp-local'&&row.State==='running'&&row.Health==='healthy'));return entries;
 }
 function docker(args){const rows=canonicalPs();return{rows,result:spawnSync('docker',args,{cwd:root,encoding:'utf8',maxBuffer:4*1024**2})};}
 const ids=canonicalPs().map(row=>row.ID),argv=retainedBrowserContainerInspectArguments(ids);
 // Execute the previous faulty projection on those same real containers: this
 // must fail for optional fields missing from legacy Engine maps, not a mock.
 const prior=[...argv];prior[2]=prior[2].replace('{{json (index .HostConfig "Mounts")}}','{{json .HostConfig.Mounts}}');assert.notEqual(prior[2],argv[2]);
 const red=docker(prior).result;assert.notEqual(red.status,0);assert.match(red.stderr,/map has no entry for key "Mounts"/);
 const first=docker(argv);assert.equal(first.result.status,0,first.result.stderr);const observed=parse(first.result.stdout);assert.equal(observed.length,10);
 const labels=value=>value.Config.Labels;assert.deepEqual(observed.map(value=>labels(value)['com.docker.compose.service']).sort(),expected);
 for(const value of observed){assert.equal(labels(value)['com.docker.compose.project'],'sabalanerp-local');assert.equal(value.State.Running,true);assert.equal(value.State.Health.Status,'healthy');assert.ok(Array.isArray(value.HostConfig.Binds)||value.HostConfig.Binds===null);}
 const legacy=observed.filter(value=>value.HostConfig.Mounts===null),cohort=observed.filter(value=>Array.isArray(value.HostConfig.Mounts)&&value.HostConfig.Mounts.length>0);
 assert.equal(legacy.length,8,'ACTUAL_EIGHT_LEGACY_BIND_PROJECTIONS_REQUIRED');assert.equal(cohort.length,2,'ACTUAL_TWO_AUTHORITY_COHORT_PROJECTIONS_REQUIRED');
 for(const value of cohort){const service=labels(value)['com.docker.compose.service'];assert.ok(['backend-candidate','backend-retained'].includes(service));
  const own=readRetainedInquiryAuthorityMount(value,service==='backend-candidate'?'/app/runtime-authority':'/app/jobs-authority',false),peer=readRetainedInquiryAuthorityMount(value,'/run/sabalan-online',true);
  assert.match(own.subpath,/^cohort-[a-f0-9]{32}$/);assert.equal(peer.subpath,own.subpath);assert.notEqual(own.name,peer.name);
 }
 const final=docker(retainedBrowserContainerInspectArguments(canonicalPs().map(row=>row.ID)));assert.equal(final.result.status,0,final.result.stderr);
 const identity=values=>values.map(value=>({id:value.Id,image:value.Image,startedAt:value.State.StartedAt})).sort((a,b)=>a.id.localeCompare(b.id));
 assert.deepEqual(identity(parse(final.result.stdout)),identity(observed),'READ_ONLY_INSPECT_MUST_PRESERVE_ALL_TEN_IDENTITIES');
 assert.deepEqual(final.rows.map(row=>({id:row.ID,service:row.Service})).sort((a,b)=>a.service.localeCompare(b.service)),first.rows.map(row=>({id:row.ID,service:row.Service})).sort((a,b)=>a.service.localeCompare(b.service)));
});

test('candidate budget is exactly1536 while Inquiry frontend caps remain stage-specific',()=>{const M=1024**2,v={stage:'BEFORE_SLOT_MUTATION',hostFree:1800*M,linuxMemAvailable:1800*M,cgroups:{'backend-candidate':{maximum:1536*M,current:1152*M,events:{}},'frontend-retained':{maximum:512*M,current:256*M,events:{}},'frontend-candidate':{maximum:512*M,current:256*M,events:{}}}};validateRetainedBrowserCapacity(v);for(const cap of [768,1024,1280]){const wrong=structuredClone(v);wrong.cgroups['backend-candidate'].maximum=cap*M;assert.throws(()=>validateRetainedBrowserCapacity(wrong),/INQUIRY_CGROUP_CAP_DRIFT/);}const low=structuredClone(v);low.cgroups['backend-candidate'].current++;assert.throws(()=>validateRetainedBrowserCapacity(low),/INQUIRY_CGROUP_HEADROOM_REFUSED/);});
