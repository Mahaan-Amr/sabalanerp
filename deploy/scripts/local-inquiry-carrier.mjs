/** Source-only contract for the coordinator's existing Inquiry service.
 * Never executes Compose or grants native/public admission. */
import assert from 'node:assert/strict';
import {bindTargetBrowserImage} from './online-release-carriers.mjs';
import {assertProductionImageInspection} from './production-image-execution-binding.mjs';
import inquiryCompiledBrowser from './inquiry-compiled-browser.cjs';
const same = (a,b) => assert.deepEqual(a,b);
const hash = /^[a-f0-9]{64}$/;
const authority = 'sabalanerp-local_online_runtime_authority';
const destination = '/run/sabalan-online';

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

export function validateInquiryCarrierTransition(before,after,request) {
  requestIdentity(request); assert.match(request.composeConfigHash,hash);
  for (const value of [before,after]) {
    assert.match(value.Id,hash); same(value.Image,request.existingImage);
    same(value.Config.Hostname,request.existingHostname);
    same(value.Config.Labels['com.docker.compose.project'],request.project);
    same(value.Config.Labels['com.docker.compose.service'],request.service);
    same(value.State.Running,true); same(value.State.Health.Status,'healthy');
  }
  assert.notEqual(before.Id,after.Id); assert.notEqual(before.State.StartedAt,after.State.StartedAt);
  assert.ok(Number.isFinite(Date.parse(before.State.StartedAt)) && Date.parse(after.State.StartedAt)>Date.parse(before.State.StartedAt));
  // `docker compose config --hash inquiry` is observed by the coordinator for
  // the exact merged proposal. No blanket Compose label exemption is allowed.
  const config=structuredClone(after.Config);
  same(config.Labels['com.docker.compose.config-hash'],request.composeConfigHash);
  config.Labels['com.docker.compose.config-hash']=before.Config.Labels['com.docker.compose.config-hash'];
  if (request.composeConfigFiles !== undefined) {
    assert.ok(Array.isArray(request.composeConfigFiles) && request.composeConfigFiles.length>=2
      && request.composeConfigFiles.every(value=>typeof value==='string' && value.startsWith('/') && !/[,\r\n\0]/.test(value)));
    same(config.Labels['com.docker.compose.project.config_files'],request.composeConfigFiles.join(','));
    same(request.composeConfigFiles.slice(0,-1).join(','),before.Config.Labels['com.docker.compose.project.config_files']);
    config.Labels['com.docker.compose.project.config_files']=before.Config.Labels['com.docker.compose.project.config_files'];
  }
  // Compose may resolve the pinned immutable Image rather than the original
  // tag in Config.Image. Both must still execute the same measured Image ID.
  if (config.Image===request.existingImage) config.Image=before.Config.Image;
  same(config,before.Config);
  const host=structuredClone(after.HostConfig), mounts=host.Mounts||[];
  same((before.HostConfig.Mounts||[]).filter(m=>m.Target===destination),[]);
  same(mounts.filter(m=>m.Target===destination),[{Type:'volume',Source:authority,Target:destination,ReadOnly:true,VolumeOptions:{NoCopy:true,Subpath:'cohort-'+request.cohortNonce}}]);
  host.Mounts=mounts.filter(m=>m.Target!==destination);
  if (!Object.hasOwn(before.HostConfig,'Mounts') && !host.Mounts.length) delete host.Mounts;
  same(host,before.HostConfig);
  same(before.Mounts.filter(m=>m.Destination===destination),[]);
  const added=after.Mounts.filter(m=>m.Destination===destination); same(added.length,1);
  same(added[0].Type,'volume'); same(added[0].Name,authority); same(added[0].Driver,'local'); same(added[0].RW,false);
  // Docker versions report either the volume root or the resolved subpath.
  // HostConfig above must independently prove the exact subpath in both cases.
  assert.ok([`/var/lib/docker/volumes/${authority}/_data`,`/var/lib/docker/volumes/${authority}/_data/cohort-${request.cohortNonce}`].includes(added[0].Source));
  same(after.Mounts.filter(m=>m.Destination!==destination),before.Mounts);
  same(after.NetworkSettings.Ports,before.NetworkSettings.Ports);
  same(networkConfiguration(after.NetworkSettings.Networks,after.Id),networkConfiguration(before.NetworkSettings.Networks,before.Id));
  const database=request.originalDatabaseBefore;
  same(database.path,'/data/inquiry.db'); assert.match(database.sha256,hash);
  for (const key of ['device','inode','size','mode','uid','gid','mtimeNs','ctimeNs','sidecars']) assert.ok(Object.hasOwn(database,key),'ORIGINAL_SQLITE_METADATA_REQUIRED');
  same(database,request.originalDatabaseAfter);
  return {format:'sabalan-same-inquiry-authority-mount-transition/v1',beforeId:before.Id,afterId:after.Id,image:after.Image,
    beforeStartedAt:before.State.StartedAt,afterStartedAt:after.State.StartedAt,cohortNonce:request.cohortNonce,
    composeConfigHash:request.composeConfigHash,originalDatabase:structuredClone(database),productionAdmission:false};
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
