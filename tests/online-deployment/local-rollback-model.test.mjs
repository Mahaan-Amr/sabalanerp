import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {validateLocalRollbackModel,restoredSlotNetworkConfiguration,validateRestoredLocalSlot,validateOwnedBrowserReturn,validateLocalRollbackResources} from '../../scripts/lib/local-rollback-model.mjs';
const fixture=JSON.parse(fs.readFileSync(new URL('./local-rollback-model.fixture.json',import.meta.url)));
const inquiryFixture=JSON.parse(fs.readFileSync(new URL('./inquiry-rollback-model.fixture.json',import.meta.url)));
test('observed Inquiry without tmpfs validates its full source model; extra tmpfs refuses',()=>{
 validateLocalRollbackModel({model:inquiryFixture.model,service:'inquiry',container:inquiryFixture.container,image:inquiryFixture.image});
 const changed=structuredClone(inquiryFixture);changed.container.HostConfig.Tmpfs={'/unreviewed':'rw'};
 assert.throws(()=>validateLocalRollbackModel({model:changed.model,service:'inquiry',container:changed.container,image:changed.image}),/ROLLBACK_FULL_HOST_CONFIG_DIFFERS/);
});
test('implicit logging requires measured daemon defaults and still rejects every logging difference',()=>{
 const f=structuredClone(fixture),service='backend-candidate',c=f.slots[service].container,image=f.slots[service].image;delete f.model.services[service].logging;
 const daemonDefaults={logging:{driver:c.HostConfig.LogConfig.Type,options:structuredClone(c.HostConfig.LogConfig.Config)}};
 assert.throws(()=>validateLocalRollbackModel({model:f.model,service,container:c,image}),/ROLLBACK_OBSERVED_DAEMON_LOGGING_REQUIRED/);
 validateLocalRollbackModel({model:f.model,service,container:c,image,daemonDefaults});
 for(const change of [d=>d.logging.driver=d.logging.driver==='local'?'json-file':'local',d=>d.logging.options['max-size']='unreviewed']){const bad=structuredClone(daemonDefaults);change(bad);assert.throws(()=>validateLocalRollbackModel({model:f.model,service,container:c,image,daemonDefaults:bad}),/ROLLBACK_FULL_HOST_CONFIG_DIFFERS/);}
});
test('full effective local model matches independently observed sanitized historical container data',()=>{for(const [service,{container,image}]of Object.entries(fixture.slots))validateLocalRollbackModel({model:fixture.model,service,container,image});});
for(const key of ['Memory','NanoCpus','MemorySwap','ReadonlyRootfs','OomScoreAdj','PidsLimit','NetworkMode'])test('daemon-updated '+key+' cannot hide behind an unchanged Compose hash',()=>{
 const f=structuredClone(fixture),container=f.slots['backend-candidate'].container;container.HostConfig[key]=typeof container.HostConfig[key]==='boolean'?!container.HostConfig[key]:typeof container.HostConfig[key]==='number'?container.HostConfig[key]+1:'changed';
 assert.throws(()=>validateLocalRollbackModel({model:f.model,service:'backend-candidate',...f.slots['backend-candidate']}));
});
test('only dynamic endpoint addresses and this incarnation short DNS name normalize away',()=>{
 const c=fixture.slots['backend-candidate'].container,before=c.NetworkSettings.Networks,after=structuredClone(before),id='f'.repeat(64),name=Object.keys(after)[0];after[name].EndpointID='new';after[name].IPAddress='172.18.0.44';after[name].MacAddress='02:00:00:00:00:44';after[name].DNSNames=after[name].DNSNames.map(v=>v===c.Id.slice(0,12)?id.slice(0,12):v);
 assert.deepEqual(restoredSlotNetworkConfiguration(after,id),restoredSlotNetworkConfiguration(before,c.Id));after[name].Aliases.push('extra');assert.notDeepEqual(restoredSlotNetworkConfiguration(after,id),restoredSlotNetworkConfiguration(before,c.Id));
});

function recreated(){const before=structuredClone(fixture.slots['backend-candidate'].container),after=structuredClone(before);after.Id='f'.repeat(64);after.StartedAt='2026-10-28T00:00:00Z';before.State={StartedAt:before.StartedAt};after.State={StartedAt:after.StartedAt};after.Config.Hostname=after.Id.slice(0,12);for(const n of Object.values(after.NetworkSettings.Networks)){n.DNSNames=n.DNSNames.map(v=>v===before.Id.slice(0,12)?after.Id.slice(0,12):v);n.EndpointID='new-endpoint';n.IPAddress='172.18.0.44';n.MacAddress='02:00:00:00:00:44';}return{before,after,model:fixture.model,service:'backend-candidate',image:fixture.slots['backend-candidate'].image};}

function returnedBrowser(){
 const f=structuredClone(recreated());f.service='frontend-candidate';f.model.services[f.service]=f.model.services['backend-candidate'];const m=f.model.services[f.service];m.read_only=true;m.volumes=[];f.image.Config.Volumes=null;
 for(const c of [f.before,f.after]){c.Config.Labels['com.docker.compose.service']=f.service;c.Config.Volumes=null;c.HostConfig.ReadonlyRootfs=true;c.HostConfig.Binds=null;c.HostConfig.Mounts=[];c.Mounts=[];c.ImageManifestDescriptor={digest:'sha256:'+'a'.repeat(64),mediaType:'application/vnd.oci.image.manifest.v1+json',size:1234};}
 f.before.Config.Labels['com.docker.compose.project.config_files']='D:\\sabalanerp\\docker-compose.local.yml,C:\\original\\browser.yml';
 f.currentSource={model:structuredClone(f.model),configHash:'b'.repeat(64),files:['D:\\sabalanerp\\docker-compose.local.yml','C:\\current\\browser.yml']};f.after.Config.Labels['com.docker.compose.config-hash']=f.currentSource.configHash;f.after.Config.Labels['com.docker.compose.project.config_files']=f.currentSource.files.join(',');return f;
}
test('owned frontend return accepts only measured generator metadata with the same whole model and configuration',()=>{
 const f=returnedBrowser(),result=validateOwnedBrowserReturn(f);assert.equal(result.onlyMeasuredGeneratorLabelsChanged,true);assert.equal(result.additionalBrowserUp,false);assert.equal(result.productionAdmission,false);
});
for(const mutate of [f=>f.after.Config.Labels['com.docker.compose.project.config_files']='C:\\other\\browser.yml',f=>f.after.Config.Labels['com.docker.compose.config-hash']='c'.repeat(64),f=>f.after.Config.Labels.extra='ignored?',f=>f.after.Config.Env.push('UNREVIEWED=1'),f=>f.after.HostConfig.Memory++,f=>f.after.ImageManifestDescriptor.digest='sha256:'+'d'.repeat(64),f=>f.currentSource.model.services[f.service].read_only=false,f=>f.after.Mounts.push({Destination:'/data',RW:true})])test('frontend metadata allowance never masks unrelated drift '+mutate.toString(),()=>{const f=returnedBrowser();mutate(f);assert.throws(()=>validateOwnedBrowserReturn(f));});
test('recreated baseline slot conserves complete configuration, mounts and stable network semantics',()=>validateRestoredLocalSlot(recreated()));
test('real Compose recreation may reorder exact duplicate-free environment values',()=>{const f=recreated();f.after.Config.Env.reverse();validateRestoredLocalSlot(f);});
test('environment map equality rejects changed/missing names, values and duplicates on either side',()=>{
 for(const change of [f=>f.after.Config.Env[0]+='changed',f=>f.after.Config.Env.pop(),f=>f.after.Config.Env.push('FOREIGN=1'),f=>f.after.Config.Env.push(f.after.Config.Env[0]),f=>f.before.Config.Env.push(f.before.Config.Env[0]),f=>f.after.Config.Env.push('INVALID_NO_EQUALS')]){const f=recreated();change(f);assert.throws(()=>validateRestoredLocalSlot(f));}
});
test('literal __proto__ environment names remain exact own values and duplicate-free',()=>{
 const valid=()=>{const f=recreated();f.model=structuredClone(f.model);f.before.Config.Env.push('__proto__=original');f.after.Config.Env.push('__proto__=original');Object.defineProperty(f.model.services[f.service].environment,'__proto__',{value:'original',enumerable:true,configurable:true});return f;};
 validateRestoredLocalSlot(valid());
 for(const change of [f=>f.after.Config.Env.push('__proto__=extra'),f=>f.after.Config.Env[f.after.Config.Env.length-1]='__proto__=changed',f=>f.before.Config.Env.push('__proto__=duplicate')]){const f=valid();change(f);assert.throws(()=>validateRestoredLocalSlot(f));}
 const extra=recreated();extra.after.Config.Env.push('__proto__=extra');assert.throws(()=>validateRestoredLocalSlot(extra));
});
for(const field of ['Aliases','DNSNames','IPAMConfig','DriverOpts','GwPriority','Gateway','NetworkID'])test('restored-slot '+field+' drift is refused',()=>{const x=recreated(),n=Object.values(x.after.NetworkSettings.Networks)[0];n[field]=Array.isArray(n[field])?[...n[field],'wrong']:typeof n[field]==='number'?n[field]+1:{changed:true};assert.throws(()=>validateRestoredLocalSlot(x));});

function resourceFixture(){const service='backend-candidate',container=fixture.slots[service].container,model=structuredClone(fixture.model);const network={Name:'sabalanerp-local_default',Id:Object.values(container.NetworkSettings.Networks)[0].NetworkID,Driver:'bridge',Scope:'local',Internal:false,Attachable:false,Ingress:false,ConfigOnly:false,EnableIPv4:true,EnableIPv6:false,Options:{'com.docker.network.enable_ipv4':'true','com.docker.network.enable_ipv6':'false'},IPAM:{Driver:'default',Options:null,Config:[{Subnet:'172.18.0.0/16',Gateway:'172.18.0.1'}]},Labels:{'com.docker.compose.project':'sabalanerp-local','com.docker.compose.network':'default'}};const volumes=model.services[service].volumes.map(m=>({Name:model.volumes[m.source].name,Driver:'local',Scope:'local',Options:null,Mountpoint:'/var/lib/docker/volumes/'+model.volumes[m.source].name+'/_data',Labels:{'com.docker.compose.project':'sabalanerp-local','com.docker.compose.volume':m.source}}));return{model,service,container,network,volumes};}
test('existing bridge and each physical named volume satisfy the closed definition contract',()=>validateLocalRollbackResources(resourceFixture()));
for(const change of ['network-driver','network-ipam','network-unknown','volume-driver','volume-options','volume-mountpoint'])test('resource mismatch '+change+' is refused before restoration',()=>{const f=resourceFixture();if(change==='network-driver')f.network.Driver='overlay';if(change==='network-ipam')f.network.IPAM.Driver='changed';if(change==='network-unknown')f.model.networks.default.unsupported=true;if(change==='volume-driver')f.volumes[0].Driver='nfs';if(change==='volume-options')f.volumes[0].Options={device:'/foreign'};if(change==='volume-mountpoint')f.volumes[0].Mountpoint='/foreign';assert.throws(()=>validateLocalRollbackResources(f));});
