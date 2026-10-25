/** Exact preserved negative-recovery view; no current or historical closure waiver. */
import assert from 'node:assert/strict';
import {negativeCapsuleSubpath} from './application-native-negative-capsule-acceptance.mjs';
export const isNegativeAcceptanceSubpath=value=>typeof value==='string'&&(/^c16-recovery-[a-f0-9]{32}$/.test(value)||value===negativeCapsuleSubpath);
export const negativeAcceptanceVolume='sabalanerp-local_online_runtime_acceptance';
export const negativeAcceptanceTarget='/app/online-runtime-acceptance';
export function validateNegativeAcceptanceDescriptor(value){
 assert.deepEqual(Object.keys(value).sort(),['namedVolume','subpath','target']);assert.equal(value.namedVolume,negativeAcceptanceVolume);assert.equal(value.target,negativeAcceptanceTarget);assert.ok(isNegativeAcceptanceSubpath(value.subpath));return value;
}
export function validateNegativeAcceptanceConfiguration(configuration,descriptor){
 validateNegativeAcceptanceDescriptor(descriptor);assert.equal(configuration.name,'sabalanerp-local');
 for(const service of ['backend-candidate','backend-retained']){const mounts=configuration.services[service].volumes.filter(v=>v.target===descriptor.target);assert.equal(mounts.length,1);const m=mounts[0];assert.equal(m.type,'volume');assert.equal(configuration.volumes[m.source].name,descriptor.namedVolume);assert.equal(m.read_only??false,false);assert.equal(m.volume?.nocopy,true);assert.equal(m.volume?.subpath,descriptor.subpath);}
 return true;
}
export function validateNegativeAcceptanceSlots(containers,descriptor){
 validateNegativeAcceptanceDescriptor(descriptor);const observed=[];
 for(const service of ['backend-candidate','backend-retained']){const c=containers[service];assert.equal(c.Config.Labels['com.docker.compose.project'],'sabalanerp-local');assert.equal(c.Config.Labels['com.docker.compose.service'],service);const visible=c.Mounts.filter(m=>m.Destination===descriptor.target),requested=(c.HostConfig.Mounts??[]).filter(m=>m.Target===descriptor.target);assert.equal(visible.length,1);assert.equal(requested.length,1,'EXPLICIT_NEGATIVE_ACCEPTANCE_SUBPATH_REQUIRED');const a=visible[0],b=requested[0];assert.equal(a.Type,'volume');assert.equal(a.Name,descriptor.namedVolume);assert.equal(a.RW,true);assert.equal(b.Type,'volume');assert.equal(b.Source,descriptor.namedVolume);assert.equal(b.ReadOnly??false,false);assert.equal(b.VolumeOptions?.NoCopy,true);assert.equal(b.VolumeOptions?.Subpath,descriptor.subpath);observed.push(a.Source);}
 assert.equal(observed[0],observed[1],'SHARED_NEGATIVE_ACCEPTANCE_VIEW_REQUIRED');return true;
}
