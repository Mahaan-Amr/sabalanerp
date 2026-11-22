import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createHash,randomBytes} from 'node:crypto';
import {assertOnlineCarrierRootCoverage,onlineCarrierRootIdentitySource} from '../../deploy/scripts/online-carrier-root-coverage.mjs';
const source=fs.readFileSync('deploy/scripts/online-release-carriers.mjs','utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
const id='a'.repeat(64),image='sha256:'+'b'.repeat(64),containerId='c'.repeat(64),networkId='d'.repeat(64),project='sabalanerp';
function fixture({badScope=false,badImage=false,failStart=false}={}){
 const service={read_only:true,cap_drop:['ALL'],security_opt:['no-new-privileges:true'],restart:'no',networks:{app_network:null},mem_limit:'768m',cpus:1,pids_limit:256,entrypoint:['node','/app/dist/scripts/online-runtime-hold.js'],command:[],environment:{NODE_ENV:'production',BACKEND_RUNTIME_ROLE:'control',DATABASE_URL:'postgresql://private@postgres/db?connection_limit=1&pool_timeout=10'},volumes:[{type:'volume',source:'storage',target:'/app/storage'},{type:'bind',source:'/srv/trust',target:'/run/sabalan-online',read_only:true}],tmpfs:['/tmp:rw,nosuid,nodev,size=32m','/app/storage/reports:rw,nosuid,nodev,size=32m','/app/storage/sales-reports:rw,nosuid,nodev,size=32m','/app/storage/bi-reports:rw,nosuid,nodev,size=32m'],healthcheck:{test:['CMD','node','/app/health.js'],interval:'15s',timeout:'8s',retries:8}};
 const configuration={services:{backend:service},networks:{app_network:{name:project+'_app_network'}},volumes:{storage:{name:project+'_storage'}}},network={Id:networkId,Name:project+'_app_network',Driver:'bridge',Scope:'local',Labels:{'com.docker.compose.project':project},Containers:{}};
 const scope={runtimeId:id,releaseId:'release_old',image,purpose:badScope?'http':'jobs',role:'control',worker:{identity:'original-worker'}};
 const evidence={manifest:{releaseId:'release_old',image,roots:Array.from({length:9},(_,n)=>({live:'/app/storage/live'+n,store:'/app/storage/store'+n})),ephemeralRoots:['/app/storage/reports','/app/storage/sales-reports','/app/storage/bi-reports']},scopes:[{scope}],imageGraphs:{backend:{config:image,rootfsDiffIds:['sha256:'+'e'.repeat(64)]}}};
 const calls=[],failures=[],state={phase:'ONLINE_ROLLBACK_PUBLISHING',target:{releaseId:'release_old',runtimeId:id,scope},plan:null,started:false};let api;
 const inspection=()=>({Id:containerId,Image:image,Name:'/'+state.plan.name,Config:{Labels:{'com.docker.compose.project':project,'io.sabalan.online.runtime':id,'io.sabalan.online.release':'release_old'},Env:Object.entries(state.plan.environment).map(([k,v])=>k+'='+v)},HostConfig:{ReadonlyRootfs:true,Privileged:false,CapDrop:['ALL'],SecurityOpt:['no-new-privileges:true'],Memory:state.plan.memory,MemorySwap:state.plan.memory,NanoCpus:state.plan.nanoCpus,PidsLimit:state.plan.pids,Tmpfs:Object.fromEntries(state.plan.tmpfs.map(x=>[x.split(':')[0],x.split(':')[1]])),NetworkMode:networkId},Mounts:state.plan.mounts.map(m=>({Type:m.type,Destination:m.target,RW:!m.readOnly,...(m.type==='volume'?{Name:m.source}:{Source:m.source})})),NetworkSettings:{Networks:{app:{NetworkID:networkId,IPAddress:'172.20.0.2',Aliases:[state.plan.dnsAlias]}}},State:{Running:state.started,Pid:state.started?100:0,StartedAt:'2026-10-21T00:00:00Z'}});
 class Controller{
  async assertOwned(phases){assert.ok(phases.includes(state.phase)&&state.phase==='ONLINE_ROLLBACK_PUBLISHING','FIXTURE_ACTIVE_LEASE_REQUIRED');}
  readOriginalRetainedWorkerCarrierTarget(){return state.target;}
  readCarrierReleaseEvidence(){return evidence;}
  readCarrierProvisioningTarget(){return {backendService:'backend',frontendService:'frontend',project,composeFile:'/repo/compose.yml',onlineOverlayFile:'/repo/online.yml',storageOverlayFile:'/repo/storage.yml'};}
  async executeOriginalCarrierDockerCommand(token){const a=api.consumeOriginalCarrierDockerCommand(this,token);calls.push(a);
   if(a[0]==='compose')return JSON.stringify(configuration);
   if(a[0]==='network')return JSON.stringify([network]);
   if(a[0]==='volume')return JSON.stringify([{Name:project+'_storage',Driver:'local',Options:{},Labels:{'com.docker.compose.project':project}}]);
   if(a[0]==='image')return JSON.stringify([{Id:image,Config:{},RootFS:{Layers:[badImage?'sha256:'+'f'.repeat(64):'sha256:'+'e'.repeat(64)]}}]);
   if(a[0]==='create'){state.plan=api.compileOnlineCarrierPlan({configuration,serviceName:'backend',project,kind:'backend',runtimeId:id,image,releaseId:'release_old',network,volumeNames:[project+'_storage']});return containerId;}
   if(a[0]==='inspect')return JSON.stringify([inspection()]);
   if(a[0]==='start'){if(failStart)throw Error('FIXTURE_START_UNKNOWN');state.started=true;return containerId;}
   if(a[0]==='exec')return JSON.stringify({existingIdentityVerified:true,baselineAdoptionAuthorized:false});
   throw Error('UNEXPECTED_NATIVE_COMMAND');
  }
  retainOriginalCarrierFailure(token){failures.push(api.consumeOriginalCarrierFailure(this,token));}
 }
 const fakeFs={statSync:p=>({dev:1n,ino:p.includes('private-key')?1n:2n,uid:0n,mode:0o400n,isFile:()=>true,isDirectory:()=>false}),realpathSync:p=>p};
 api=vm.runInNewContext(source+'\n({provisionOriginalRetainedWorkerCarrier,readOriginalOnlineCarrier,compileOnlineCarrierPlan,consumeOriginalCarrierDockerCommand,consumeOriginalCarrierFailure})',{OriginalOnlineReleaseController:Controller,createHash,randomBytes,fs:fakeFs,path,assertOnlineCarrierRootCoverage,onlineCarrierRootIdentitySource,pause:async()=>{},Object,Set,Map,WeakMap,Buffer,JSON,URLSearchParams});
 return {api,controller:new Controller(),calls,failures,state};
}
test('actual backend-only retained worker factory creates one original keeper and reuses shared inspection/token guards',async()=>{
 const f=fixture();const token=await f.api.provisionOriginalRetainedWorkerCarrier(f.controller,{releaseId:'release_old',runtimeId:id});
 const facts=await f.api.readOriginalOnlineCarrier(f.controller,token);assert.equal(facts.runtimeId,id);assert.equal(facts.kind,'backend');assert.equal(facts.rootIdentityVerified,true);
 assert.equal(f.calls.filter(a=>a[0]==='create').length,1);assert.equal(f.calls.filter(a=>a[0]==='start').length,1);assert.ok(!f.calls.some(a=>a.some(x=>typeof x==='string'&&x.startsWith('frontend-'))));
 await assert.rejects(f.api.provisionOriginalRetainedWorkerCarrier(f.controller,{releaseId:'release_old',runtimeId:id}),/ALREADY_ATTEMPTED/);
});
test('scope, input and live phase mismatches refuse before any native mutation',async()=>{
 for(const mutate of [f=>f.state.phase='COMPLETED',f=>f.state.target.runtimeId='1'.repeat(64),f=>f.state.target.scope.purpose='http']){const f=fixture();mutate(f);await assert.rejects(f.api.provisionOriginalRetainedWorkerCarrier(f.controller,{releaseId:'release_old',runtimeId:id}));assert.equal(f.calls.length,0);}
 const f=fixture();await assert.rejects(f.api.provisionOriginalRetainedWorkerCarrier(f.controller,{releaseId:'release_old',runtimeId:id,scope:{}}));assert.equal(f.calls.length,0);
});
test('full immutable layer admission precedes create and uncertain start retains its original failure without frontend retry',async()=>{
 const f=fixture({badImage:true});await assert.rejects(f.api.provisionOriginalRetainedWorkerCarrier(f.controller,{releaseId:'release_old',runtimeId:id}),/ORDERED_LAYERS_CHANGED/);assert.ok(!f.calls.some(a=>a[0]==='create'));
 const g=fixture({failStart:true});await assert.rejects(g.api.provisionOriginalRetainedWorkerCarrier(g.controller,{releaseId:'release_old',runtimeId:id}),/FIXTURE_START_UNKNOWN/);assert.equal(g.failures.length,1);assert.equal(g.failures[0].originalCreations[0].containerId,containerId);assert.equal(g.failures[0].outcomeUnproven,true);assert.equal(g.failures[0].cleanupPerformed,false);assert.equal(g.calls.filter(a=>a[0]==='create').length,1);
});
