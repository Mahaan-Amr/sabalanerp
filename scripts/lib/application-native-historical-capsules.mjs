/** Exact inactive diagnostic content views. Never a native-owner capability. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

const volumeName='sabalanerp-local_online_runtime_acceptance';
const roots=Object.freeze([
  'application-prisma-ebcfd40fff0a28e39d983c6616893b50',
  'inquiry-coherent-7878c93646acd9ac37cef95e27a4029d',
]);
const prefix='/app/online-runtime-acceptance/';
export const historicalCapsuleTargets=Object.freeze(roots.map(name=>prefix+name));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

export function historicalCapsuleVolumes(){
  return roots.map((subpath,index)=>({type:'volume',source:'online_runtime_acceptance',
    target:historicalCapsuleTargets[index],read_only:true,volume:{nocopy:true,subpath}}));
}

export function validateHistoricalCapsuleConfiguration(service,volumes){
  assert.ok(Array.isArray(service.volumes));
  const children=service.volumes.filter(row=>row.target?.startsWith(prefix));
  assert.equal(children.length,2,'EXACT_TWO_HISTORICAL_CAPSULE_VIEWS_REQUIRED');
  for(const expected of historicalCapsuleVolumes()){
    const found=children.filter(row=>row.target===expected.target);
    assert.equal(found.length,1,'HISTORICAL_CAPSULE_TARGET_CHANGED');
    const row=found[0];
    assert.equal(row.type,'volume');assert.equal(row.read_only,true);
    assert.equal(volumes[row.source]?.name,volumeName);
    assert.deepEqual(row.volume,{nocopy:true,subpath:expected.volume.subpath});
    assert.ok(Object.keys(row).every(key=>['type','source','target','read_only','volume'].includes(key)));
  }
}

export function validateHistoricalCapsuleMounts(container){
  const visible=container.Mounts??[],requested=container.HostConfig.Mounts??[];
  const children=visible.filter(row=>row.Destination?.startsWith(prefix));
  assert.equal(children.length,2,'EXACT_TWO_HISTORICAL_CAPSULE_MOUNTS_REQUIRED');
  assert.equal(requested.filter(row=>row.Target?.startsWith(prefix)).length,2,'EXACT_TWO_HISTORICAL_CAPSULE_REQUESTS_REQUIRED');
  const result={};
  for(const [index,subpath]of roots.entries()){
    const target=historicalCapsuleTargets[index];
    const found=visible.filter(row=>row.Destination===target);
    const requests=requested.filter(row=>row.Target===target);
    assert.equal(found.length,1);assert.equal(requests.length,1);
    assert.ok(!(container.HostConfig.Binds??[]).some(row=>row.split(':')[1]===target),'AMBIGUOUS_CAPSULE_BIND');
    const mount=found[0],request=requests[0];
    assert.equal(mount.Type,'volume');assert.equal(mount.Name,volumeName);assert.equal(mount.RW,false);
    assert.equal(request.Type,'volume');assert.equal(request.Source,volumeName);assert.equal(request.ReadOnly,true);
    assert.deepEqual(request.VolumeOptions,{NoCopy:true,Subpath:subpath});
    assert.equal(typeof mount.Source,'string');assert.ok(mount.Source.startsWith('/'));
    const suffix='/'+volumeName+'/_data';
    assert.ok(mount.Source.endsWith(suffix)||mount.Source.endsWith(suffix+'/'+subpath),'HISTORICAL_CAPSULE_SOURCE_CHANGED');
    result[target]={name:mount.Name,source:mount.Source,subpath,readOnly:true};
  }
  return result;
}

export function validateHistoricalCapsulePair(candidate,retained){
  const value=validateHistoricalCapsuleMounts(candidate);
  assert.deepEqual(validateHistoricalCapsuleMounts(retained),value,'HISTORICAL_CAPSULE_PEER_VIEW_CHANGED');
  return value;
}

export function validatePreviousHistoricalCapsulePair(candidate,retained){
  const counts=[candidate,retained].map(value=>(value.Mounts??[]).filter(row=>row.Destination?.startsWith(prefix)).length);
  if(counts.every(count=>count===0))return null;
  return validateHistoricalCapsulePair(candidate,retained);
}

const inputs=Object.freeze({
  prisma:Object.freeze({file:'reports/qa/application-prisma-ebcfd40fff0a28e39d983c6616893b50.json',sha256:'95063299b73e3ef2212e2359e544643dd73b268cfa198faee16d8b53747da384'}),
  inquiry:Object.freeze({file:'reports/qa/inquiry-coherent-61138945df5c6dfceba7b55726201e9c.json',sha256:'e88d42144d37ea567047db1d6a8bdf66244ba39f5a7606b7fc9d0612a51d634f'}),
  closure:Object.freeze({file:'reports/qa/inquiry-restored-continuation-f86e6b783a3fb12f5079750e1b66d85e.json',sha256:'796274cb1342ec6c371529b882ddebea8fd022483793c74e0afa502d8b412d5b'}),
  prismaSource:Object.freeze({file:'tests/online-deployment/application-native-prisma.fixture.py',sha256:'7af630e015aaf87872823b3f4e41bdfccd23214c356432604a7c149dcb347a79'}),
  inquirySource:Object.freeze({file:'tests/online-deployment/inquiry-dependency-inventory.fixture.cjs',sha256:'197ae9581b67efd7f28a8e3b87422eaee81511bf486567b0d633cc716f5dcf91'}),
});

export function historicalCapsuleInputFiles(repositoryRoot){
  return Object.values(inputs).map(ref=>path.join(repositoryRoot,ref.file));
}

/** Host-side constructor authenticates existing receipts/helpers; no caller paths. */
export function historicalCapsulePreflightSpec(repositoryRoot,capture=file=>fs.readFileSync(path.join(repositoryRoot,file))){
  const bytes={};
  for(const [name,ref]of Object.entries(inputs)){
    const raw=capture(ref.file);assert.equal(sha(raw),ref.sha256,'HISTORICAL_CAPSULE_INPUT_CHANGED:'+ref.file);
    bytes[name]=raw;
  }
  const prisma=JSON.parse(bytes.prisma),inquiry=JSON.parse(bytes.inquiry),closure=JSON.parse(bytes.closure);
  assert.equal(prisma.pass,true);assert.equal(prisma.result.databaseRetiredWithoutForce,true);
  assert.equal(prisma.directory,historicalCapsuleTargets[0]);
  assert.equal(closure.pass,true);assert.equal(closure.directory,historicalCapsuleTargets[1]);
  assert.equal(inquiry.dependencyReuse.originalClosureReportSha256,inputs.closure.sha256);
  return {prisma:prisma.result.generated,prismaNativeSha256:prisma.result.nativeClosure.nativeSha256,
    inquiry:inquiry.dependencyReuse,inquiryNativeSha256:{...closure.originalClosureSha256,restored:closure.restoredClosureSha256},
    prismaSource:bytes.prismaSource.toString('base64'),inquirySource:bytes.inquirySource.toString('base64')};
}
