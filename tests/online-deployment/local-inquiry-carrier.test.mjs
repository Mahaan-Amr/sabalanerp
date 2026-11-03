import test from 'node:test';
import assert from 'node:assert/strict';
import {composeInquiryAuthorityOverride, validateInquiryCarrierTransition, InquiryCarrierIncarnation, bindLocalInquirySelection} from '../../deploy/scripts/local-inquiry-carrier.mjs';

const hash = c => c.repeat(64);
function fixture() {
  const request = {project:'sabalanerp-local', service:'inquiry', cohortNonce:'a'.repeat(32), existingImage:'sha256:'+hash('b'), existingHostname:'inquiry-local', composeConfigHash:hash('c')};
  const database = {path:'/data/inquiry.db', sha256:hash('d'), device:'1', inode:'2', size:4096, mode:33152, uid:0, gid:0, mtimeNs:'123', ctimeNs:'456', sidecars:[]};
  Object.assign(request, {originalDatabaseBefore:database, originalDatabaseAfter:structuredClone(database)});
  const before = {Id:hash('e'), Image:request.existingImage, Config:{Hostname:request.existingHostname, Image:'local-inquiry', Env:['DATABASE_URL=file:/data/inquiry.db'], Entrypoint:['/entry'], Cmd:['start'], Labels:{'com.docker.compose.project':request.project, 'com.docker.compose.service':'inquiry', 'com.docker.compose.config-hash':hash('f')}}, HostConfig:{PortBindings:{'3001/tcp':[{HostIp:'127.0.0.1',HostPort:'3001'}]}, Mounts:[]}, Mounts:[], State:{Running:true, StartedAt:'2026-10-25T00:00:00Z', Health:{Status:'healthy'}}, NetworkSettings:{Ports:{'3001/tcp':[{HostIp:'127.0.0.1',HostPort:'3001'}]}, Networks:{sabalanerp_local:{NetworkID:hash('1'), Aliases:['inquiry-local','inquiry'], IPAddress:'172.20.0.2', EndpointID:hash('2')}}}};
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
  // An absolute Windows path does not license replacing an ancestor config file.
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
