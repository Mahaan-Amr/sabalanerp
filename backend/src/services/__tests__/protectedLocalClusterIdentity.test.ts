import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {verifyLocalClusterIdentity,readLocalEndpointIdentity} from './protectedLocalClusterIdentity';

test('identity requires two matching compose snapshots and equal independent system IDs',async()=>{
 const id='a'.repeat(64), ps=JSON.stringify({ID:id,Project:'sabalanerp-local',Service:'postgres',State:'running',Health:'healthy'});
 const file=path.resolve(process.cwd(),'docker-compose.local.yml');
 const calls:readonly string[][]=[];let count=0;
 const run=async(args:readonly string[])=>{(calls as string[][]).push([...args]);return {state:'SUCCESS' as const,value:++count<3?ps:'123\n'};};
 assert.deepEqual(await verifyLocalClusterIdentity(file,run,async()=>({state:'SUCCESS',value:'123'})),{state:'SUCCESS',value:{containerId:id,systemIdentifier:'123'}});
 assert.equal(calls.length,3);assert.equal(calls[0][0],'compose');assert.ok(calls[0].includes('--no-trunc'));assert.equal(calls[1][0],'compose');assert.equal(calls[2][0],'exec');
 count=0;assert.equal((await verifyLocalClusterIdentity(file,run,async()=>({state:'SUCCESS',value:'124'}))).state,'UNKNOWN');
 assert.equal((await verifyLocalClusterIdentity(file,async()=>({state:'UNKNOWN'}),async()=>({state:'SUCCESS',value:'123'}))).state,'UNKNOWN');
 const events:string[]=[];const short=ps.replace(id,id.slice(0,12));
 assert.equal((await verifyLocalClusterIdentity(file,async()=>({state:'SUCCESS',value:short}),async()=>({state:'SUCCESS',value:'123'}),(stage,status)=>events.push(`${stage}:${status}`))).state,'UNKNOWN');
 assert.deepEqual(events,['PS1:INVALID_ID']);
 assert.equal((await verifyLocalClusterIdentity(path.resolve('other.yml'),run,async()=>({state:'SUCCESS',value:'123'}))).state,'UNKNOWN');
});

test('endpoint stages distinguish module, constructor, and connection failure without messages',async()=>{
 const url='postgresql://test:test@127.0.0.1:55432/sabalanerp';
 const capture=async(loader:()=>any)=>{const stages:string[]=[];const result=await readLocalEndpointIdentity(url,(stage,status)=>stages.push(`${stage}:${status}`),loader);assert.equal(result.state,'UNKNOWN');return stages;};
 assert.deepEqual(await capture(()=>{throw Error('private');}),['PG_MODULE_RESOLVED:MODULE_UNAVAILABLE']);
 assert.deepEqual(await capture(()=>class {constructor(){throw Error('private');}}),['PG_MODULE_RESOLVED:SUCCESS','CLIENT_CREATED:UNKNOWN']);
 assert.deepEqual(await capture(()=>class {async connect(){throw Object.assign(Error('private'),{code:'ECONNREFUSED'});}async end(){}}),['PG_MODULE_RESOLVED:SUCCESS','CLIENT_CREATED:SUCCESS','CONNECT:REFUSED','END:SUCCESS']);
});
