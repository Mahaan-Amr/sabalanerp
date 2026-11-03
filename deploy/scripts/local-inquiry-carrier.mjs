/** Source-only contract for the coordinator's existing Inquiry service.
 * Never executes Compose or grants native/public admission. */
import assert from 'node:assert/strict';
import path from 'node:path';
import {bindTargetBrowserImage} from './online-release-carriers.mjs';
import {assertProductionImageInspection} from './production-image-execution-binding.mjs';
import inquiryCompiledBrowser from './inquiry-compiled-browser.cjs';
const same = (a,b) => assert.deepEqual(a,b);
const hash = /^[a-f0-9]{64}$/;
const authority = 'sabalanerp-local_online_runtime_authority';
const destination = '/run/sabalan-online';
const absoluteComposeFile = value => typeof value === 'string' && !/[,\r\n\0]/.test(value)
  && (value.startsWith('/') || /^[A-Za-z]:\\/.test(value) && path.win32.normalize(value) === value);

function recreationConfiguration(value) {
  const config=structuredClone(value),names=new Set();
  assert.ok(Array.isArray(config.Env));
  for(const entry of config.Env){
    assert.equal(typeof entry,'string');assert.ok(!entry.includes('\0'));
    const separator=entry.indexOf('=');assert.ok(separator>0,'INQUIRY_ENVIRONMENT_ENTRY_REQUIRED');
    const name=entry.slice(0,separator);assert.ok(!names.has(name),'INQUIRY_DUPLICATE_ENVIRONMENT_KEY');names.add(name);
  }
  // Compose may reorder unique environment entries when recreating the same
  // service. Compare every complete key=value byte string; never ignore a key,
  // a changed credential/value, or an ambiguous duplicate-key environment.
  config.Env.sort();return config;
}

/** Same container, not a recreation. Health timestamps are observations rather
 * than incarnation identity; retain every other inspected field verbatim. */
export function assertUnchangedHealthyInquiry(before,after,now=Date.now()) {
  for(const value of [before,after]) {
    same(value.State.Running,true);same(value.State.Status,'running');same(value.State.Paused,false);
    same(value.State.Restarting,false);same(value.State.Dead,false);same(value.State.OOMKilled,false);
    same(value.State.Error,'');same(value.State.ExitCode,0);assert.ok(value.State.Pid>0);
    same(value.State.Health.Status,'healthy');same(value.State.Health.FailingStreak,0);
    assert.ok(Array.isArray(value.State.Health.Log)&&value.State.Health.Log.length>0);
    for(const row of value.State.Health.Log){same(row.ExitCode,0);const start=Date.parse(row.Start),end=Date.parse(row.End);assert.ok(Number.isFinite(start)&&Number.isFinite(end)&&start<=end&&end<=now);}
  }
  const current=after.State.Health.Log.at(-1),age=now-Date.parse(current.End);
  const interval=after.Config.Healthcheck.Interval,timeout=after.Config.Healthcheck.Timeout;
  assert.ok(Number.isSafeInteger(interval)&&interval>0&&Number.isSafeInteger(timeout)&&timeout>0);
  assert.ok(age<=(interval+timeout)/1e6,'INQUIRY_CURRENT_HEALTH_STALE');
  const stable=value=>{const copy=structuredClone(value);for(const row of copy.State.Health.Log){delete row.Start;delete row.End;}return copy;};
  same(stable(after),stable(before));
  return{sameIncarnationVerified:true,freshHealthy:true,volatileHealthTimestampsExcluded:true,latestHealthEnd:current.End,productionAdmission:false};
}

/** Observe a bounded quiet window; this is neither exec custody nor acceptance.
 * Busy snapshots remain diagnostics. The caller still compares the final raw
 * inspection to its original raw quiet baseline without ignoring ExecIDs. */
export async function observeQuiescentInquiry({read,guard,observe}){
 assert.equal(typeof read,'function');assert.equal(typeof guard,'function');assert.equal(typeof observe,'function');
 const started=performance.now();let anchor;
 const waitingIdentity=value=>{const copy=structuredClone(value);delete copy.ExecIDs;for(const row of copy.State.Health.Log){delete row.Start;delete row.End;}return copy;};
 for(let attempt=1;attempt<=12;attempt++){
  guard();const all=await read();guard();assert.ok(performance.now()-started<=15000,'INQUIRY_QUIET_OBSERVATION_BUDGET_EXCEEDED');
  const current=all.inquiry;assert.ok(current);assertUnchangedHealthyInquiry(current,current);
  const ids=current.ExecIDs;assert.ok(ids===null||Array.isArray(ids)&&ids.length>0,'INQUIRY_EXEC_LIST_AMBIGUOUS');
  if(ids!==null){assert.ok(ids.length<=1024);for(const id of ids)assert.match(id,hash);assert.equal(new Set(ids).size,ids.length,'INQUIRY_DUPLICATE_EXEC_ID');}
  const identity=waitingIdentity(current);if(anchor)same(identity,anchor);else anchor=identity;
  observe({attempt,containerId:current.Id,startedAt:current.State.StartedAt,pid:current.State.Pid,observedAt:new Date().toISOString(),execIds:ids===null?null:[...ids],presentExecsAbsent:ids===null,execClosureClaimed:false,productionAdmission:false});
  guard();assert.ok(performance.now()-started<=15000,'INQUIRY_QUIET_OBSERVATION_BUDGET_EXCEEDED');
  if(ids===null)return all;
  if(attempt<12)await new Promise(resolve=>setTimeout(resolve,100));
 }
 throw Error('INQUIRY_ACTIVE_EXECS_REMAIN');
}

function requestIdentity(request) {
  same(request.project,'sabalanerp-local'); same(request.service,'inquiry');
  assert.match(request.cohortNonce,/^[a-f0-9]{32}$/);
  assert.match(request.existingImage,/^sha256:[a-f0-9]{64}$/);
  assert.match(request.existingHostname,/^[A-Za-z0-9_.-]{1,63}$/);
}

export function composeInquiryAuthorityOverride(request) {
  requestIdentity(request);
  return {services:{inquiry:{image:request.existingImage,hostname:request.existingHostname,volumes:[{
    type:'volume',source:'online_runtime_authority',target:destination,read_only:true,
    volume:{nocopy:true,subpath:'cohort-'+request.cohortNonce},
  }]}},volumes:{online_runtime_authority:{external:true,name:authority}}};
}

function networkConfiguration(networks,containerId) {
  // Only Docker-assigned addresses/endpoints may change. Preserve aliases,
  // attachment configuration, network identity and every unknown field.
  return Object.fromEntries(Object.entries(networks).map(([name,value]) => {
    const configuration=structuredClone(value);
    if (configuration.DNSNames) configuration.DNSNames=configuration.DNSNames.map(name=>name===containerId.slice(0,12)?'<docker-container-id>':name);
    for (const key of ['EndpointID','IPAddress','GlobalIPv6Address','MacAddress']) delete configuration[key];
    return [name,configuration];
  }));
}

/** Validate the merged proposal before Compose can recreate Inquiry. */
export function validateInquiryAuthorityProposal(before,after,request) {
  requestIdentity(request);
  const selected=structuredClone(after);
  same(selected.image,request.existingImage);
  same(selected.hostname,request.existingHostname);
  selected.image=before.image;
  if(Object.hasOwn(before,'hostname')) selected.hostname=before.hostname;
  else delete selected.hostname;
  const additions=selected.volumes.filter(v=>v.target===destination);
  same(additions,composeInquiryAuthorityOverride(request).services.inquiry.volumes);
  same(before.volumes.filter(v=>v.target===destination),[]);
  selected.volumes=selected.volumes.filter(v=>v.target!==destination);
  same(selected,before);
  return true;
}

function recreationHostConfiguration(value) {
  const host=structuredClone(value);
  if(host.Binds!==undefined&&host.Binds!==null){
    assert.ok(Array.isArray(host.Binds));const targets=new Set();
    for(const bind of host.Binds){
      assert.equal(typeof bind,'string');assert.ok(!/[\r\n\0]/.test(bind));
      const parts=bind.split(':'),last=parts.at(-1),target=last.startsWith('/')?last:parts.at(-2);
      assert.ok(parts.length>=2&&typeof target==='string'&&target.startsWith('/'),'INQUIRY_RESTORE_BIND_TARGET_REQUIRED');
      assert.equal(targets.has(target),false,'INQUIRY_RESTORE_DUPLICATE_BIND_TARGET');targets.add(target);
    }
    // Docker may reorder distinct binds during recreation. Their complete
    // source/target/options strings and every other HostConfig field stay exact.
    host.Binds.sort();
  }
  return host;
}

/** A new container can restore configuration without copying the database.
 * Every mount and non-generated configuration field must return exactly. */
export function validateInquiryCarrierRestoration(before,after,databaseBefore,databaseAfter) {
  for(const value of [before,after]) {
    assert.match(value.Id,hash);same(value.State.Running,true);
    same(value.State.Health.Status,'healthy');
    same(value.Config.Labels['com.docker.compose.project'],'sabalanerp-local');
    same(value.Config.Labels['com.docker.compose.service'],'inquiry');
  }
  same(after.Image,before.Image);same(after.ImageManifestDescriptor,before.ImageManifestDescriptor);
  const config=recreationConfiguration(after.Config);
  // Original Compose files and original tag are selected during rollback.
  same(config,recreationConfiguration(before.Config));
  same(recreationHostConfiguration(after.HostConfig),recreationHostConfiguration(before.HostConfig));same(after.Mounts,before.Mounts);
  same(after.NetworkSettings.Ports,before.NetworkSettings.Ports);
  same(networkConfiguration(after.NetworkSettings.Networks,after.Id),networkConfiguration(before.NetworkSettings.Networks,before.Id));
  if(after.Id!==before.Id)assert.ok(Date.parse(after.State.StartedAt)>Date.parse(before.State.StartedAt));
  same(databaseAfter,databaseBefore);same(databaseBefore.path,'/data/inquiry.db');
  assert.match(databaseBefore.sha256,hash);
  return {format:'sabalan-inquiry-original-configuration-restored/v1',beforeId:before.Id,afterId:after.Id,
    image:after.Image,databaseUnchanged:true,databaseCopied:false,productionAdmission:false};
}

export function validateInquiryCarrierConfiguration(before,after,request) {
  requestIdentity(request); assert.match(request.composeConfigHash,hash);
  for (const value of [before,after]) {
    assert.match(value.Id,hash); same(value.Image,request.existingImage);
    same(value.Config.Hostname,request.existingHostname);
    same(value.Config.Labels['com.docker.compose.project'],request.project);
    same(value.Config.Labels['com.docker.compose.service'],request.service);
  }
  assert.ok(before.ImageManifestDescriptor&&after.ImageManifestDescriptor,'INQUIRY_PLATFORM_DESCRIPTOR_REQUIRED');
  same(after.ImageManifestDescriptor,before.ImageManifestDescriptor);
  assert.notEqual(before.Id,after.Id); assert.notEqual(before.State.StartedAt,after.State.StartedAt);
  assert.ok(Number.isFinite(Date.parse(before.State.StartedAt)) && Date.parse(after.State.StartedAt)>Date.parse(before.State.StartedAt));
  // `docker compose config --hash inquiry` is observed by the coordinator for
  // the exact merged proposal. No blanket Compose label exemption is allowed.
  const config=recreationConfiguration(after.Config);
  same(config.Labels['com.docker.compose.config-hash'],request.composeConfigHash);
  config.Labels['com.docker.compose.config-hash']=before.Config.Labels['com.docker.compose.config-hash'];
  if (request.composeConfigFiles !== undefined) {
    assert.ok(Array.isArray(request.composeConfigFiles) && request.composeConfigFiles.length>=2
      && request.composeConfigFiles.every(absoluteComposeFile));
    same(config.Labels['com.docker.compose.project.config_files'],request.composeConfigFiles.join(','));
    same(request.composeConfigFiles.slice(0,-1).join(','),before.Config.Labels['com.docker.compose.project.config_files']);
    config.Labels['com.docker.compose.project.config_files']=before.Config.Labels['com.docker.compose.project.config_files'];
  }
  // Compose may resolve the pinned immutable Image rather than the original
  // tag in Config.Image. Both must still execute the same measured Image ID.
  if (config.Image===request.existingImage) config.Image=before.Config.Image;
  same(config,recreationConfiguration(before.Config));
  const host=structuredClone(after.HostConfig), mounts=host.Mounts||[];
  same((before.HostConfig.Mounts||[]).filter(m=>m.Target===destination),[]);
  same(mounts.filter(m=>m.Target===destination),[{Type:'volume',Source:authority,Target:destination,ReadOnly:true,VolumeOptions:{NoCopy:true,Subpath:'cohort-'+request.cohortNonce}}]);
  host.Mounts=mounts.filter(m=>m.Target!==destination);
  if (!Object.hasOwn(before.HostConfig,'Mounts') && !host.Mounts.length) delete host.Mounts;
  same(recreationHostConfiguration(host),recreationHostConfiguration(before.HostConfig));
  same(before.Mounts.filter(m=>m.Destination===destination),[]);
  const added=after.Mounts.filter(m=>m.Destination===destination); same(added.length,1);
  same(added[0].Type,'volume'); same(added[0].Name,authority); same(added[0].Driver,'local'); same(added[0].RW,false);
  // Docker versions report either the volume root or the resolved subpath.
  // HostConfig above must independently prove the exact subpath in both cases.
  assert.ok([`/var/lib/docker/volumes/${authority}/_data`,`/var/lib/docker/volumes/${authority}/_data/cohort-${request.cohortNonce}`].includes(added[0].Source));
  same(after.Mounts.filter(m=>m.Destination!==destination),before.Mounts);
  same(after.NetworkSettings.Ports,before.NetworkSettings.Ports);
  same(networkConfiguration(after.NetworkSettings.Networks,after.Id),networkConfiguration(before.NetworkSettings.Networks,before.Id));
  return {format:'sabalan-inquiry-authority-configuration/v1',beforeId:before.Id,afterId:after.Id,image:after.Image,
    beforeStartedAt:before.State.StartedAt,afterStartedAt:after.State.StartedAt,cohortNonce:request.cohortNonce,
    composeConfigHash:request.composeConfigHash,productionAdmission:false};
}

export function validateInquiryCarrierTransition(before,after,request) {
  for(const value of [before,after]){same(value.State.Running,true);same(value.State.Health.Status,'healthy');}
  const configuration=validateInquiryCarrierConfiguration(before,after,request),database=request.originalDatabaseBefore;
  same(database.path,'/data/inquiry.db');assert.match(database.sha256,hash);
  for(const key of ['device','inode','size','mode','uid','gid','mtimeNs','ctimeNs','sidecars'])assert.ok(Object.hasOwn(database,key),'ORIGINAL_SQLITE_METADATA_REQUIRED');
  same(database,request.originalDatabaseAfter);
  return {...configuration,format:'sabalan-same-inquiry-authority-mount-transition/v1',originalDatabase:structuredClone(database)};
}

export function bindLocalInquirySelection({inspection,imageInspection,graph,sourceBuild,compiled,executionBinding}) {
  same(inspection.Config.Labels['com.docker.compose.project'],'sabalanerp-local');
  same(inspection.Config.Labels['com.docker.compose.service'],'inquiry');
  same(sourceBuild.application,'inquiry');
  const binding=bindTargetBrowserImage(sourceBuild,'inquiry',graph,inspection.Image,executionBinding);
  same(imageInspection.Id,inspection.Image); same(imageInspection.Os,'linux'); same(imageInspection.Architecture,'amd64');
  same(imageInspection.RootFS.Type,'layers'); same(imageInspection.RootFS.Layers,graph.rootfsDiffIds);
  if (executionBinding) assertProductionImageInspection(executionBinding,imageInspection,graph);
  for (const key of ['id','manifestSha256','assets','actionIds']) same(compiled[key],sourceBuild[key]);
  assert.match(compiled.manifestSha256,hash); assert.match(compiled.frameworkBuildId,/^[A-Za-z0-9_-]{1,128}$/);
  const environment={};
  for (const entry of inspection.Config.Env||[]) {
    const offset=entry.indexOf('='), key=entry.slice(0,offset);
    assert.ok(offset>0 && !Object.hasOwn(environment,key),'INQUIRY_ENVIRONMENT_AMBIGUOUS');
    environment[key]=entry.slice(offset+1);
  }
  const runtimeEnvironment=inquiryCompiledBrowser.inquiryRuntimeBuildEnvironment(compiled,environment);
  return {...binding,containerId:inspection.Id,startedAt:inspection.State.StartedAt,
    compiled:structuredClone(compiled),runtimeEnvironment,productionAdmission:false};
}

/** Handles remain process-local; even a rejected recreation burns old grants. */
export class InquiryCarrierIncarnation {
  #inspection; #handles=new WeakSet();
  constructor(inspection) { this.#inspection=structuredClone(inspection); }
  acquire() { assert.ok(this.#inspection,'INQUIRY_CARRIER_INVALIDATED'); const token=Object.freeze({}); this.#handles.add(token); return token; }
  assertCurrent(token,inspection) {
    assert.ok(this.#handles.has(token) && this.#inspection,'INQUIRY_CARRIER_STALE');
    for (const key of ['Id','Image','Config','HostConfig','Mounts']) same(inspection[key],this.#inspection[key]);
    same(inspection.State.StartedAt,this.#inspection.State.StartedAt); same(inspection.State.Running,true);
    same(inspection.NetworkSettings.Ports,this.#inspection.NetworkSettings.Ports);
    same(inspection.NetworkSettings.Networks,this.#inspection.NetworkSettings.Networks);
  }
  transition(after,request) {
    const before=this.#inspection; this.#handles=new WeakSet(); this.#inspection=null;
    const receipt=validateInquiryCarrierTransition(before,after,request);
    this.#inspection=structuredClone(after); return receipt;
  }
}
