import test from 'node:test';
import assert from 'node:assert/strict';
import {originalServiceConfiguration} from '../../deploy/scripts/capture-only-release.mjs';

const marker='QA_ONLY_PASSWORD_MUST_NOT_BE_ARCHIVED_7ef18c8b';
const services=()=>['backend','frontend','inquiry','nginx','postgres','clamav'].map((service,index)=>({
 Id:String(index+1).repeat(64),Image:'sha256:'+'a'.repeat(64),
 Config:{Hostname:'original-birth',Image:'original-tag',Env:['DATABASE_PASSWORD='+marker,'ORDINARY_CONFIG=kept'],Labels:{'com.docker.compose.project':'sabalanerp','com.docker.compose.service':service}},
 HostConfig:{ReadonlyRootfs:true,Memory:512*1024*1024},
 Mounts:[{Type:'volume',Source:'/data/'+service,Destination:'/app/storage',RW:true,Propagation:''}],
 NetworkSettings:{Networks:{sabalanerp:{IPAddress:'172.18.0.2'}}},
}));

test('unchanged-release snapshot never archives plaintext environment credentials',()=>{
 const actual=services(),before=structuredClone(actual),snapshot=originalServiceConfiguration(actual);
 const raw=JSON.stringify(snapshot);
 assert.equal(raw.includes(marker),false,'the durable snapshot must not duplicate a credential');
 assert.equal(raw.includes('DATABASE_PASSWORD='),false,'environment entries belong only in a digest projection');
 assert.deepEqual(actual,before,'hash projection must not mutate original Docker observations');
});

test('hash-only privacy preserves exact configuration drift rejection and permits only a new container birth',()=>{
 const original=originalServiceConfiguration(services()),reborn=services();
 reborn[0].Id='f'.repeat(64);reborn[0].Config.Hostname='new-birth';
 assert.deepEqual(originalServiceConfiguration(reborn),original);
 for(const mutate of [
  rows=>rows[0].Config.Env[0]+='-changed',
  rows=>rows[0].Config.Env.push('NEW_SETTING=present'),
  rows=>rows[0].HostConfig.ReadonlyRootfs=false,
  rows=>rows[0].Mounts[0].Source='/different-source',
 ]){const changed=services();mutate(changed);assert.notDeepEqual(originalServiceConfiguration(changed),original);}
});
