import test from 'node:test';
import assert from 'node:assert/strict';
import {historicalCapsuleTargets,historicalCapsuleVolumes,validateHistoricalCapsuleConfiguration,
  validateHistoricalCapsulePair,validatePreviousHistoricalCapsulePair,historicalCapsulePreflightSpec} from '../../scripts/lib/application-native-historical-capsules.mjs';

const name='sabalanerp-local_online_runtime_acceptance';
function container(){
  const rows=historicalCapsuleVolumes();
  return {Mounts:rows.map(row=>({Type:'volume',Name:name,Source:'/var/lib/docker/volumes/'+name+'/_data',Destination:row.target,RW:false})),
    HostConfig:{Mounts:rows.map(row=>({Type:'volume',Source:name,Target:row.target,ReadOnly:true,
      VolumeOptions:{NoCopy:true,Subpath:row.volume.subpath}})),Binds:[]}};
}

test('current scoped acceptance without old Prisma/Inquiry mounts refuses before capsule execution',()=>{
  const hidden={Mounts:[{Destination:'/app/online-runtime-acceptance',RW:true}],HostConfig:{Mounts:[],Binds:[]}};
  assert.throws(()=>validateHistoricalCapsulePair(hidden,hidden),/EXACT_TWO_HISTORICAL/);
  assert.equal(validatePreviousHistoricalCapsulePair(hidden,hidden),null);
});

test('exact two read-only child views accepted for both QA roles',()=>{
  const volumes={online_runtime_acceptance:{name}};
  validateHistoricalCapsuleConfiguration({volumes:historicalCapsuleVolumes()},volumes);
  assert.deepEqual(Object.keys(validateHistoricalCapsulePair(container(),container())),historicalCapsuleTargets);
});

test('compose refuses wrong target, root view, extra or missing capsule, write access and copy',()=>{
  const changes=[
    rows=>rows[0].target='/app/online-runtime-acceptance/application-prisma-'+ '0'.repeat(32),
    rows=>rows[0].volume.subpath='',rows=>rows[0].read_only=false,rows=>rows[0].volume.nocopy=false,
    rows=>rows[0].source='other',rows=>rows.pop(),rows=>rows.push({...rows[0]}),
    rows=>rows[0].volume.subpath=rows[1].volume.subpath,rows=>rows[0].bind={propagation:'shared'},
  ];
  for(const change of changes){const rows=historicalCapsuleVolumes();change(rows);
    assert.throws(()=>validateHistoricalCapsuleConfiguration({volumes:rows},{online_runtime_acceptance:{name}}));}
});

test('engine refuses wrong identity, writable mount, wrong subpath, alias, duplicate and ambiguous bind',()=>{
  const changes=[
    row=>row.Mounts[0].RW=true,row=>row.Mounts[0].Name='other',
    row=>row.Mounts[0].Source='/unrelated/path',row=>row.HostConfig.Mounts[0].ReadOnly=false,
    row=>row.HostConfig.Mounts[0].VolumeOptions.NoCopy=false,
    row=>row.HostConfig.Mounts[0].VolumeOptions.Subpath='c16-recovery-'+ '0'.repeat(32),
    row=>row.HostConfig.Binds.push('/tmp:'+historicalCapsuleTargets[0]+':ro'),
    row=>row.Mounts.push({...row.Mounts[0]}),row=>row.HostConfig.Mounts.pop(),
  ];
  for(const change of changes){const bad=container();change(bad);assert.throws(()=>validateHistoricalCapsulePair(bad,container()));}
});

test('roles must observe the same exact physical volume source',()=>{
  const peer=container();peer.Mounts[0].Source+='/'+historicalCapsuleVolumes()[0].volume.subpath;
  assert.throws(()=>validateHistoricalCapsulePair(container(),peer),/HISTORICAL_CAPSULE_PEER_VIEW_CHANGED/);
});

test('existing partial historical mounts never qualify as a legacy predecessor',()=>{
  const partial=container();partial.Mounts.pop();partial.HostConfig.Mounts.pop();
  assert.throws(()=>validatePreviousHistoricalCapsulePair(partial,container()));
});

test('source-owned preflight rejects arbitrary or tampered receipt/helper inputs',()=>{
  assert.throws(()=>historicalCapsulePreflightSpec('D:/unused',()=>Buffer.from('{}')),/HISTORICAL_CAPSULE_INPUT_CHANGED/);
});
