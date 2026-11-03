import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {assertUnchangedHealthyInquiry,observeQuiescentInquiry,composeInquiryAuthorityOverride, validateInquiryAuthorityProposal, validateInquiryCarrierRestoration, validateInquiryCarrierTransition, InquiryCarrierIncarnation, bindLocalInquirySelection} from '../../deploy/scripts/local-inquiry-carrier.mjs';

const hash = c => c.repeat(64);
function unchangedHealthy(){
 const {before}=fixture();before.RestartCount=0;before.Config.Healthcheck={Interval:30e9,Timeout:5e9};
 Object.assign(before.State,{Status:'running',Paused:false,Restarting:false,Dead:false,OOMKilled:false,Error:'',ExitCode:0,Pid:123});
 before.State.Health={Status:'healthy',FailingStreak:0,Log:[{Start:'2026-10-31T12:00:00Z',End:'2026-10-31T12:00:01Z',ExitCode:0,Output:''}]};
 const after=structuredClone(before);after.State.Health.Log[0].Start='2026-10-31T12:00:30Z';after.State.Health.Log[0].End='2026-10-31T12:00:31Z';
 return{before,after,now:Date.parse('2026-10-31T12:00:32Z')};
}
test('same Inquiry incarnation accepts only fresh successful health timestamp rotation',()=>{
 const f=unchangedHealthy();assert.equal(assertUnchangedHealthyInquiry(f.before,f.after,f.now).sameIncarnationVerified,true);
});
test('health timestamp allowance never masks state, configuration, namespace or image drift',()=>{
 const edits=[v=>v.Id=hash('9'),v=>v.Image='sha256:'+hash('9'),v=>v.ImageManifestDescriptor.digest='sha256:'+hash('9'),v=>v.State.StartedAt='2026-10-31T12:00:31Z',v=>v.RestartCount++,v=>v.State.Pid++,v=>v.State.Running=false,v=>v.State.Paused=true,v=>v.State.Restarting=true,v=>v.State.OOMKilled=true,v=>v.State.Dead=true,v=>v.State.Error='failed',v=>v.State.ExitCode=137,v=>v.State.Health.Status='unhealthy',v=>v.State.Health.FailingStreak=1,v=>v.State.Health.Log[0].ExitCode=1,v=>v.State.Health.Log[0].Output='changed',v=>v.State.Health.Log[0].End='2026-10-31T11:00:31Z',v=>v.State.Health.Log[0].End='2026-10-31T13:00:31Z',v=>v.Config.Env.push('UNREVIEWED=1'),v=>v.HostConfig.Mounts.push({Target:'/foreign'}),v=>v.Mounts.push({Name:'foreign'}),v=>v.NetworkSettings.Networks.sabalanerp_local.NetworkID=hash('8'),v=>v.State.unknownField=true];
 for(const edit of edits){const f=unchangedHealthy();edit(f.after);assert.throws(()=>assertUnchangedHealthyInquiry(f.before,f.after,f.now));}
 const f=unchangedHealthy();assert.throws(()=>assertUnchangedHealthyInquiry(f.before,f.after,f.now+35000),/INQUIRY_CURRENT_HEALTH_STALE/);
});
function fixture() {
  const request = {project:'sabalanerp-local', service:'inquiry', cohortNonce:'a'.repeat(32), existingImage:'sha256:'+hash('b'), existingHostname:'inquiry-local', composeConfigHash:hash('c')};
  const database = {path:'/data/inquiry.db', sha256:hash('d'), device:'1', inode:'2', size:4096, mode:33152, uid:0, gid:0, mtimeNs:'123', ctimeNs:'456', sidecars:[]};
  Object.assign(request, {originalDatabaseBefore:database, originalDatabaseAfter:structuredClone(database)});
  const before = {Id:hash('e'), Image:request.existingImage, Config:{Hostname:request.existingHostname, Image:'local-inquiry', Env:['DATABASE_URL=file:/data/inquiry.db'], Entrypoint:['/entry'], Cmd:['start'], Labels:{'com.docker.compose.project':request.project, 'com.docker.compose.service':'inquiry', 'com.docker.compose.config-hash':hash('f')}}, HostConfig:{PortBindings:{'3001/tcp':[{HostIp:'127.0.0.1',HostPort:'3001'}]}, Mounts:[]}, Mounts:[], State:{Running:true, StartedAt:'2026-10-25T00:00:00Z', Health:{Status:'healthy'}}, NetworkSettings:{Ports:{'3001/tcp':[{HostIp:'127.0.0.1',HostPort:'3001'}]}, Networks:{sabalanerp_local:{NetworkID:hash('1'), Aliases:['inquiry-local','inquiry'], IPAddress:'172.20.0.2', EndpointID:hash('2')}}}};
  before.ImageManifestDescriptor={digest:'sha256:'+hash('7'),mediaType:'application/vnd.oci.image.manifest.v1+json',size:1234,platform:{os:'linux',architecture:'amd64'}};
  const after = structuredClone(before);
  after.Id=hash('3'); after.State.StartedAt='2026-10-25T01:00:00Z'; after.Config.Labels['com.docker.compose.config-hash']=request.composeConfigHash;
  after.HostConfig.Mounts.push({Type:'volume',Source:'sabalanerp-local_online_runtime_authority',Target:'/run/sabalan-online',ReadOnly:true,VolumeOptions:{NoCopy:true,Subpath:'cohort-'+request.cohortNonce}});
  after.Mounts.push({Type:'volume',Name:'sabalanerp-local_online_runtime_authority',Source:'/var/lib/docker/volumes/sabalanerp-local_online_runtime_authority/_data/cohort-'+request.cohortNonce,Destination:'/run/sabalan-online',Driver:'local',Mode:'',RW:false,Propagation:''});
  Object.assign(after.NetworkSettings.Networks.sabalanerp_local,{IPAddress:'172.20.0.3',EndpointID:hash('4')});
  return {before,after,request};
}

test('accepts only the pinned Compose config hash and actual network reincarnation', () => {
  const f=fixture(), receipt=validateInquiryCarrierTransition(f.before,f.after,f.request);
  assert.equal(receipt.afterId,f.after.Id); assert.equal(receipt.productionAdmission,false);
  const override=composeInquiryAuthorityOverride(f.request);
  assert.equal(override.services.inquiry.volumes[0].read_only,true);
  assert.equal(override.services.inquiry.hostname,f.before.Config.Hostname);
  assert.equal(override.services.inquiry.image,f.before.Image);
  assert.deepEqual(Object.keys(override.services.inquiry).sort(),['hostname','image','volumes']);
});

test('merged Inquiry proposal changes only the immutable selection, hostname and single RO mount',()=>{
  const {request}=fixture();
  const before={image:'existing-native-tag',command:['node','entry.cjs'],environment:{DATABASE_URL:'file:/data/inquiry.db'},volumes:[{type:'volume',source:'inquiry_data',target:'/data',read_only:true,volume:{}}]};
  const after={...structuredClone(before),...composeInquiryAuthorityOverride(request).services.inquiry};
  after.volumes=[...before.volumes,...after.volumes];
  assert.equal(validateInquiryAuthorityProposal(before,after,request),true);
  for(const edit of [v=>v.command.push('seed'),v=>v.environment.DATABASE_URL='file:/private.db',v=>v.volumes[0].read_only=false,v=>v.volumes.at(-1).volume.subpath='old-cohort',v=>v.volumes.at(-1).read_only=false]){
    const bad=structuredClone(after);edit(bad);assert.throws(()=>validateInquiryAuthorityProposal(before,bad,request));
  }
});

test('rollback requires the original mount/configuration and identical SQLite metadata without copying',()=>{
  const {before,request}=fixture(),restored=structuredClone(before);
  restored.Id=hash('7');restored.State.StartedAt='2026-10-25T02:00:00Z';
  restored.NetworkSettings.Networks.sabalanerp_local.IPAddress='172.20.0.8';
  const result=validateInquiryCarrierRestoration(before,restored,request.originalDatabaseBefore,request.originalDatabaseAfter);
  assert.equal(result.databaseCopied,false);assert.equal(result.productionAdmission,false);
  for(const edit of [v=>v.Config.Env.push('SEED=1'),v=>v.Config.Cmd=['db:push'],v=>v.Image='sha256:'+hash('9'),v=>v.Mounts.push({Destination:'/data',RW:true}),v=>v.HostConfig.RestartPolicy={Name:'always'},v=>v.NetworkSettings.Networks.sabalanerp_local.NetworkID=hash('9')]){
    const bad=structuredClone(restored);edit(bad);assert.throws(()=>validateInquiryCarrierRestoration(before,bad,request.originalDatabaseBefore,request.originalDatabaseAfter));
  }
  assert.throws(()=>validateInquiryCarrierRestoration(before,restored,request.originalDatabaseBefore,{...request.originalDatabaseAfter,inode:'different'}));
});

test('recreation and restoration preserve every unique environment entry despite Compose ordering',()=>{
  const {before,after,request}=fixture();before.Config.Env.push('STARTUP_MODE=readonly','PRIVATE_CREDENTIAL=unchanged');after.Config.Env=[...before.Config.Env].reverse();
  validateInquiryCarrierTransition(before,after,request);
  const returned=structuredClone(before);returned.Id=hash('8');returned.State.StartedAt='2026-10-25T03:00:00Z';returned.Config.Env.reverse();
  validateInquiryCarrierRestoration(before,returned,request.originalDatabaseBefore,request.originalDatabaseAfter);
  const mutations=[env=>env.push('STARTUP_MODE=seed'),env=>env.push('EXTRA=1'),env=>env.splice(0,1),env=>env[0]='PRIVATE_CREDENTIAL=changed',env=>env.push('INVALID_ENTRY'),env=>env.push('=value'),env=>env.push('KEY=value\0tail')];
  for(const mutate of mutations){
    for(const lane of ['authority','restoration']){
      const candidate=structuredClone(lane==='authority'?after:returned);mutate(candidate.Config.Env);
      assert.throws(()=>lane==='authority'?validateInquiryCarrierTransition(before,candidate,request):validateInquiryCarrierRestoration(before,candidate,request.originalDatabaseBefore,request.originalDatabaseAfter));
    }
  }
  for(const lane of ['authority','restoration']){
    const prior=structuredClone(before),candidate=structuredClone(lane==='authority'?after:returned);prior.Config.Env.push('STARTUP_MODE=readonly');candidate.Config.Env.push('STARTUP_MODE=readonly');
    assert.throws(()=>lane==='authority'?validateInquiryCarrierTransition(prior,candidate,request):validateInquiryCarrierRestoration(prior,candidate,request.originalDatabaseBefore,request.originalDatabaseAfter),/INQUIRY_DUPLICATE_ENVIRONMENT_KEY/);
  }
});

test('captured actual Compose recreation preserves the complete configuration after opaque environment permutation',()=>{
  const raw=fs.readFileSync(new URL('../../reports/qa/issue-419-c3-bindings-20261026/E5D0-INQUIRY-ENVIRONMENT-RECREATION-DATA-20261101.json',import.meta.url));
  assert.equal(createHash('sha256').update(raw).digest('hex'),'644b740ca118f61891756aee5b1828f8a87464e17c580217f604953a013d3e22');
  const f=JSON.parse(raw);assert.equal(f.nativeAdmission,false);assert.equal(f.environmentValuesOpaque,true);assert.notDeepEqual(f.before.Config.Env,f.after.Config.Env);
  validateInquiryCarrierTransition(f.before,f.after,f.request);
  for(const mutate of [c=>c.Config.Env[0]+='changed',c=>c.Config.Env.push(c.Config.Env[0]),c=>c.Config.Cmd.push('seed'),c=>c.HostConfig.Memory++,c=>c.Mounts.find(m=>m.Destination==='/data').RW=true,c=>c.Config.unobserved=true]){
    const c=structuredClone(f.after);mutate(c);assert.throws(()=>validateInquiryCarrierTransition(f.before,c,f.request));
  }
});

test('records the exact appended Compose file and immutable-image metadata transition', () => {
  const {before,after,request}=fixture();
  before.Config.Labels['com.docker.compose.project.config_files']='/repo/docker-compose.local.yml';
  request.composeConfigFiles=['/repo/docker-compose.local.yml','/private/inquiry-cohort.json'];
  after.Config.Labels['com.docker.compose.project.config_files']=request.composeConfigFiles.join(',');
  after.Config.Image=request.existingImage;
  before.NetworkSettings.Networks.sabalanerp_local.DNSNames=['inquiry',before.Id.slice(0,12)];
  after.NetworkSettings.Networks.sabalanerp_local.DNSNames=['inquiry',after.Id.slice(0,12)];
  validateInquiryCarrierTransition(before,after,request);
  after.Config.Labels['com.docker.compose.project.config_files']='/unreviewed/other.yml';
  assert.throws(()=>validateInquiryCarrierTransition(before,after,request));
});

test('accepts the exact Windows Compose file transition observed on the local project', () => {
  const {before,after,request}=fixture();
  const original=String.raw`D:\sabalanerp\docker-compose.local.yml`;
  const override=String.raw`C:\Users\mahan\.codex\worktrees\native-complete-419\sabalanerp\inquiry-cohort.json`;
  before.Config.Labels['com.docker.compose.project.config_files']=original;
  request.composeConfigFiles=[original,override];
  after.Config.Labels['com.docker.compose.project.config_files']=request.composeConfigFiles.join(',');
  assert.equal(validateInquiryCarrierTransition(before,after,request).afterId,after.Id);
  request.composeConfigFiles=[String.raw`D:\other\docker-compose.local.yml`,override];
  after.Config.Labels['com.docker.compose.project.config_files']=request.composeConfigFiles.join(',');
  assert.throws(()=>validateInquiryCarrierTransition(before,after,request));
});

test('Windows Compose admission rejects relative, noncanonical and injected file names', () => {
  for(const override of [String.raw`C:inquiry.json`,String.raw`\private\inquiry.json`,
    String.raw`C:\private\..\inquiry.json`,String.raw`C:\private\inquiry.json,other.json`]) {
    const {before,after,request}=fixture();
    const original=String.raw`D:\sabalanerp\docker-compose.local.yml`;
    before.Config.Labels['com.docker.compose.project.config_files']=original;
    request.composeConfigFiles=[original,override];
    after.Config.Labels['com.docker.compose.project.config_files']=request.composeConfigFiles.join(',');
    assert.throws(()=>validateInquiryCarrierTransition(before,after,request));
  }
});

test('local selection binds the observed image graph and actual compiled browser bytes', () => {
  const {before:inspection}=fixture();
  const graph={index:'sha256:'+hash('6'),platform:'sha256:'+hash('7'),config:inspection.Image,rootfsDiffIds:['sha256:'+hash('8')]};
  const imageInspection={Id:inspection.Image,RootFS:{Type:'layers',Layers:graph.rootfsDiffIds},Os:'linux',Architecture:'amd64'};
  const compiled={id:'inquiry_local',manifestSha256:hash('9'),frameworkBuildId:'actual-next-id',deploymentId:'inquiry_local',assets:[{path:'/_next/static/app.js',sha256:hash('a')}],actionIds:['a'.repeat(40)]};
  const sourceBuild={application:'inquiry',image:graph.index,id:compiled.id,manifestSha256:compiled.manifestSha256,assets:compiled.assets,actionIds:compiled.actionIds};
  const input={inspection,imageInspection,graph,compiled,sourceBuild};
  assert.equal(bindLocalInquirySelection(input).build.image,inspection.Image);
  for (const mutate of [f=>f.graph.config='sha256:'+hash('0'),f=>f.imageInspection.RootFS.Layers=[],f=>f.compiled.actionIds=[],f=>f.sourceBuild.image='sha256:'+hash('0')]) {
    const f=structuredClone(input); mutate(f); assert.throws(()=>bindLocalInquirySelection(f));
  }
});

test('rejects arbitrary configuration, data, mount and network drift', () => {
  for (const mutate of [
    f=>f.after.Config.Env.push('INJECTED=1'), f=>f.after.Config.Labels.extra='ignored?',
    f=>f.after.Config.Labels['com.docker.compose.config-hash']=hash('0'),
    f=>f.after.Config.Cmd=['seed'], f=>f.after.Image='sha256:'+hash('0'),
    f=>f.after.Mounts[0].RW=true, f=>f.after.HostConfig.Mounts[0].VolumeOptions.Subpath='another-cohort',
    f=>f.after.NetworkSettings.Networks.sabalanerp_local.Aliases.push('unexpected'),
    f=>f.after.NetworkSettings.Networks.sabalanerp_local.NetworkID=hash('0'),
    f=>f.after.NetworkSettings.Networks.sabalanerp_local.Gateway='172.20.0.254',
    f=>f.after.NetworkSettings.Networks.sabalanerp_local.IPPrefixLen=16,
    f=>f.after.NetworkSettings.Networks.sabalanerp_local.IPv6Gateway='::1',
    f=>f.after.NetworkSettings.Networks.sabalanerp_local.GlobalIPv6PrefixLen=64,
    f=>f.after.NetworkSettings.Ports={}, f=>f.request.originalDatabaseAfter.sha256=hash('0'),
    f=>f.after.Id=f.before.Id,
    f=>f.after.ImageManifestDescriptor.digest='sha256:'+hash('0'),
    f=>f.after.ImageManifestDescriptor.platform.architecture='arm64',
    f=>f.after.ImageManifestDescriptor.mediaType='wrong',
    f=>f.after.ImageManifestDescriptor.size++,
    f=>delete f.after.ImageManifestDescriptor,
  ]) { const f=fixture(); mutate(f); assert.throws(()=>validateInquiryCarrierTransition(f.before,f.after,f.request)); }
});

test('recreation permanently invalidates old private handles, including a failed transition', () => {
  const f=fixture(), owner=new InquiryCarrierIncarnation(f.before), old=owner.acquire();
  owner.transition(f.after,f.request);
  assert.throws(()=>owner.assertCurrent(old,f.before));
  const current=owner.acquire(); owner.assertCurrent(current,f.after);
  const health=structuredClone(f.after); health.State.Health.Log=[{Output:'fresh health observation'}];
  owner.assertCurrent(current,health);
  assert.throws(()=>owner.assertCurrent(structuredClone(current),f.after));
  const bad=structuredClone(f.after); bad.Id=hash('5'); bad.Config.Env=[];
  assert.throws(()=>owner.transition(bad,f.request));
  assert.throws(()=>owner.assertCurrent(current,f.after));
  assert.throws(()=>owner.acquire());
});

test('restoration keeps exact bind descriptors while accepting Docker serialization order',()=>{
 const {before,request}=fixture();before.HostConfig.Binds=['sabalanerp-local_inquiry_data:/data:ro','sabalanerp-local_recovery_coordination:/app/recovery-coordination:rw'];before.Mounts=before.HostConfig.Binds.map(bind=>{const[name,Destination,Mode]=bind.split(':');return{Type:'volume',Name:name,Source:'/var/lib/docker/volumes/'+name+'/_data',Destination,Driver:'local',Mode,RW:Mode==='rw',Propagation:''};});
 const after=structuredClone(before);after.Id=hash('9');after.State.StartedAt='2026-10-25T02:00:00Z';after.HostConfig.Binds.reverse();const first=structuredClone(before),second=structuredClone(after);
 assert.equal(validateInquiryCarrierRestoration(before,after,request.originalDatabaseBefore,request.originalDatabaseAfter).databaseCopied,false);assert.deepEqual(before,first);assert.deepEqual(after,second);
 for(const edit of[v=>v.HostConfig.Binds[0]=v.HostConfig.Binds[0].replace('recovery_coordination','foreign'),v=>v.HostConfig.Binds=v.HostConfig.Binds.map(x=>x.replace(':/data:ro',':/data:rw')),v=>v.HostConfig.ReadonlyRootfs=true,v=>v.Mounts[0].RW=true,v=>v.Config.Cmd=['seed']]){const changed=structuredClone(after);edit(changed);assert.throws(()=>validateInquiryCarrierRestoration(before,changed,request.originalDatabaseBefore,request.originalDatabaseAfter));}
 const duplicate=structuredClone(before);duplicate.HostConfig.Binds.push(duplicate.HostConfig.Binds[0]);assert.throws(()=>validateInquiryCarrierRestoration(duplicate,structuredClone(duplicate),request.originalDatabaseBefore,request.originalDatabaseAfter));
});


test('authority recreation preserves exact unique bind descriptors across Docker ordering',()=>{
 const f=fixture();f.before.HostConfig.Binds=['sabalanerp-local_recovery_coordination:/app/recovery-coordination:rw','sabalanerp-local_inquiry_data:/data:ro'];f.after.HostConfig.Binds=[...f.before.HostConfig.Binds].reverse();
 const before=JSON.stringify(f.before),after=JSON.stringify(f.after);validateInquiryCarrierTransition(f.before,f.after,f.request);assert.equal(JSON.stringify(f.before),before);assert.equal(JSON.stringify(f.after),after);
 for(const mutate of [h=>h.Binds[0]=h.Binds[0].replace(':ro',':rw'),h=>h.Binds[0]=h.Binds[0].replace('inquiry_data','foreign_data'),h=>h.Binds[0]=h.Binds[0].replace('/data','/changed'),h=>h.Binds.push(h.Binds[0]),h=>h.Binds[0]+='\n',h=>h.Binds[0]+='\0',h=>h.Binds[0]=null,h=>h.Memory=1,h=>h.Mounts[0].ReadOnly=false]){const bad=structuredClone(f.after);mutate(bad.HostConfig);assert.throws(()=>validateInquiryCarrierTransition(f.before,bad,f.request));}
});


test('Inquiry quiescence consumes one whole actual quiet read after finite busy observations',async()=>{
 const {before}=unchangedHealthy();before.ExecIDs=[hash('1')];const busy=structuredClone(before);busy.ExecIDs=[hash('2')];const quiet=structuredClone(before);quiet.ExecIDs=null;const reads=[before,busy,quiet],proof=[];let guards=0;
 for(const item of reads)refreshHealth(item);const maps=reads.map(inquiry=>({inquiry,other:{marker:'whole-map'}}));const result=await observeQuiescentInquiry({read:async()=>maps.shift(),guard:()=>guards++,observe:row=>proof.push(row)});
 assert.equal(result.inquiry,quiet);assert.equal(result.other.marker,'whole-map');assert.equal(proof.length,3);assert.ok(guards>=6);assert.equal(proof.at(-1).presentExecsAbsent,true);
 assert.throws(()=>assertUnchangedHealthyInquiry(before,quiet,Date.now())); // acceptance never normalizes ExecIDs
});

test('Inquiry quiescence refuses malformed, ambiguous and continuously active exec lists',async()=>{
 for(const ids of [undefined,[],['bad'],[hash('1'),hash('1')]]){const {before}=unchangedHealthy();before.ExecIDs=ids;refreshHealth(before);await assert.rejects(observeQuiescentInquiry({read:async()=>({inquiry:before}),guard(){},observe(){}}));}
 const {before}=unchangedHealthy();before.ExecIDs=[hash('1')];refreshHealth(before);let count=0;
 await assert.rejects(observeQuiescentInquiry({read:async()=>{count++;return{inquiry:before};},guard(){},observe(){}}),/INQUIRY_ACTIVE_EXECS_REMAIN/);assert.equal(count,12);
});

test('Inquiry quiescence never waits away incarnation, configuration or health drift',async()=>{
 const edits=[v=>v.Id=hash('9'),v=>v.Image='sha256:'+hash('9'),v=>v.State.StartedAt='changed',v=>v.State.Pid++,v=>v.RestartCount++,v=>v.Config.Env.push('NEW=1'),v=>v.Mounts.push({Destination:'/foreign'}),v=>v.State.OOMKilled=true,v=>v.State.Health.Log[0].ExitCode=1,v=>v.State.Health.Log[0].Output='changed'];
 for(const edit of edits){const {before}=unchangedHealthy();before.ExecIDs=[hash('1')];const quiet=structuredClone(before);quiet.ExecIDs=null;refreshHealth(before);refreshHealth(quiet);edit(quiet);const frames=[before,quiet];await assert.rejects(observeQuiescentInquiry({read:async()=>({inquiry:frames.shift()}),guard(){},observe(){}}));}
});

test('Inquiry quiescence preserves reader errors and checks guard after awaited read',async()=>{
 await assert.rejects(observeQuiescentInquiry({read:async()=>{throw Error('READER_EOF_UNKNOWN');},guard(){},observe(){}}),/READER_EOF_UNKNOWN/);
 const {before}=unchangedHealthy();before.ExecIDs=null;refreshHealth(before);let calls=0;
 await assert.rejects(observeQuiescentInquiry({read:async()=>({inquiry:before}),guard(){if(++calls===2)throw Error('LEASE_OR_SOURCE_LOST');},observe(){}}),/LEASE_OR_SOURCE_LOST/);
});

function refreshHealth(value){const end=Date.now()-100;for(const row of value.State.Health.Log){row.Start=new Date(end-20).toISOString();row.End=new Date(end).toISOString();}}


test('Inquiry quiet observation refuses persistence and guard failure without a usable baseline',async()=>{
 const {before}=unchangedHealthy();before.ExecIDs=null;refreshHealth(before);
 await assert.rejects(observeQuiescentInquiry({read:async()=>({inquiry:before}),guard(){},observe(){throw Error('OBSERVER_PERSIST_FAILED');}}),/OBSERVER_PERSIST_FAILED/);
 let guardCalls=0;await assert.rejects(observeQuiescentInquiry({read:async()=>({inquiry:before}),guard(){if(++guardCalls===3)throw Error('SOURCE_CHANGED_AFTER_PROOF');},observe(){}}),/SOURCE_CHANGED_AFTER_PROOF/);
});


test('actual Root capture and pre-authority ports consume the same bounded quiet-inspection seam',async()=>{
 const source=fs.readFileSync(new URL('../../scripts/lib/original-candidate-rollback-owner.mjs',import.meta.url),'utf8');
 const wrapper=source.slice(source.indexOf(' async function inspectQuiescentInquiry('),source.indexOf(' async function attachInquiryAuthority('));
 const attach=source.slice(source.indexOf(' async function attachInquiryAuthority('),source.indexOf(' async function capture(){'));
 const capture=source.slice(source.indexOf(' async function capture(){'),source.indexOf(' function verifyInitialInspectionPreparationFailure('));
 for(const lane of ['capture','authority']){
  const {before}=unchangedHealthy();before.ExecIDs=null;refreshHealth(before);const busy=structuredClone(before);busy.ExecIDs=[hash('1')];const quietMap={inquiry:structuredClone(before),other:{actualWholeMap:true}},queue=[{inquiry:busy},quietMap],records=[];let selected;
  const context={assert,observeQuiescentInquiry,assertUnchangedHealthyInquiry,guard(){},inspectAll:async()=>queue.shift(),capacity:async()=>{},quiet:async()=>{},inquiryQuiet:async()=>{},save:(name,value)=>{records.push({name,value});},candidateBeforeUpConfiguration:value=>{selected=value;throw Error('CAPTURE_STOP_AFTER_QUIET');},candidateReport:new Proxy({},{get(){throw Error('AUTHORITY_STOP_AFTER_CONSERVATION');}}),devScope:null,initialCapacityFailure:null,preparationOnly:false};
  const executable=vm.compileFunction('let serial=0,inquiryIntent=false,baseline='+JSON.stringify({byService:{inquiry:before}})+';'+wrapper+capture+attach+';return '+(lane==='capture'?'capture':'attachInquiryAuthority')+';',Object.keys(context))(...Object.values(context));
  await assert.rejects(executable(),new RegExp(lane==='capture'?'CAPTURE_STOP_AFTER_QUIET':'AUTHORITY_STOP_AFTER_CONSERVATION'));
  assert.equal(queue.length,0);assert.equal(records.filter(r=>r.name.startsWith('inquiry-quiet-')).length,2);
  if(lane==='capture')assert.equal(selected[1],quietMap.other);else assert.ok(records.some(r=>r.name==='inquiry-before-authority-conservation.json'&&r.value.sameIncarnationVerified));
 }
});
