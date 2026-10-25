import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {originalServiceConfiguration,checkpointCompletion,captureControlPlan,configurationBytes,captureOperationSources} from '../../deploy/scripts/capture-only-release.mjs';
const rows=()=>['backend','frontend','inquiry','nginx','postgres','clamav'].map((service,index)=>({Id:String(index+1).repeat(64),Image:'sha256:'+'a'.repeat(64),Config:{Hostname:'birth1',Image:'tag',Env:['A=B'],Labels:{'com.docker.compose.project':'sabalanerp','com.docker.compose.service':service}},HostConfig:{ReadonlyRootfs:true},Mounts:[{Type:'volume',Source:'/data/'+service,Destination:'/app/storage',RW:true,Propagation:''}],NetworkSettings:{Networks:{sabalanerp:{IPAddress:'private'}}}}));
test('capture-only unchanged proof ignores births but refuses actual code, config, mounts and resource changes',()=>{
 const original=originalServiceConfiguration(rows()),same=rows();same[0].Id='f'.repeat(64);same[0].Config.Hostname='birth2';assert.deepEqual(originalServiceConfiguration(same),original);
 for(const mutate of [r=>r.Image='sha256:'+'b'.repeat(64),r=>r.Config.Env=['A=C'],r=>r.Mounts[0].Source='/different',r=>r.HostConfig.ReadonlyRootfs=false]){const changed=rows();mutate(changed[0]);assert.notDeepEqual(originalServiceConfiguration(changed),original);}
 assert.throws(()=>originalServiceConfiguration(rows().slice(1)));
});
test('capture-only reports actual deadline overrun and refuses old missing-host checkpoint metadata',()=>{
 const checkpoint={captureMethod:'PROTECTED_MAINTENANCE_COMPLETE',sourceMachineUuidSha256:'a'.repeat(64),sourceKernelBootIdSha256:'b'.repeat(64),checksum:'c'.repeat(64),localVerified:true,remoteVerified:true,restoreVerified:true,sourceDatabase:{name:'actual',oid:'123',systemIdentifier:'456'}};
 const raw=()=>Buffer.from(JSON.stringify({ok:true,checkpoint})+'\n');assert.equal(checkpointCompletion(raw(),599,{}).pauseQualified,true);const late=checkpointCompletion(raw(),601,{});assert.equal(late.pauseQualified,false);assert.equal(late.mutationStarted,false);assert.equal(late.independentRestoreQualified,false);delete checkpoint.sourceMachineUuidSha256;assert.throws(()=>checkpointCompletion(raw(),10,{}));
});

test('capture-only accepts only the exact prebuilt control image and frozen operations source',()=>{
 const operations=Object.fromEntries(captureOperationSources.map(name=>[name,'a'.repeat(64)])),plan={preservedClamav:{format:'sabalan-preserved-clamav/v1',containerId:'1'.repeat(64),image:'sha256:'+'2'.repeat(64),startedAt:'2026-10-24T00:00:00Z',hostPid:2,stableConfigurationSha256:'3'.repeat(64),initialIdentitySha256:'4'.repeat(64),initialHealthSha256:'5'.repeat(64)},preservationContext:{phase:'CAPTURE_ONLY',observedAt:new Date().toISOString()},format:'sabalan-protected-capture-control-plan/v2',controlImage:'sha256:'+'c'.repeat(64),sourceCommit:'d'.repeat(40),sourceHash:'e'.repeat(64),operations},actual=[{Id:plan.controlImage,Config:{Labels:{'io.sabalan.performance.source-commit':plan.sourceCommit,'io.sabalan.performance.source-hash':plan.sourceHash}}}];
 assert.equal(captureControlPlan(plan,actual,operations),plan.controlImage);assert.throws(()=>captureControlPlan({...plan,controlImage:'mutable:tag'},actual,operations));assert.throws(()=>captureControlPlan(plan,actual,{...operations,'deploy/scripts/deploy.sh':'f'.repeat(64)}));const changed=structuredClone(actual);changed[0].Config.Labels['io.sabalan.performance.source-commit']='0'.repeat(40);assert.throws(()=>captureControlPlan(plan,changed,operations));
});

test('real bind config bytes and env change invalidate unchanged capture proof',{skip:process.platform!=='linux'||process.getuid()!==0},()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'capture-config-'));fs.chmodSync(root,0o700);const env=path.join(root,'env'),config=path.join(root,'nginx.conf');fs.writeFileSync(env,'A=B\n',{mode:0o600});fs.writeFileSync(config,'original upstream\n',{mode:0o600});
 try{const services=rows();services[0].Mounts=[{Type:'bind',Source:config,Destination:'/etc/nginx/nginx.conf',RW:false}];const original=configurationBytes(services,env);fs.writeFileSync(config,'changed upstream\n');assert.notDeepEqual(configurationBytes(services,env),original);}finally{fs.unlinkSync(config);fs.unlinkSync(env);fs.rmdirSync(root);}
});

test('capture audit stores hashes rather than environment credentials or host configuration values',()=>{
 const input=rows();input[0].Config.Env.push('DATABASE_URL=postgresql://user:secret-password@db/private');input[0].HostConfig.LogConfig={Config:{address:'https://user:host-secret@example.invalid'}};const report=JSON.stringify(originalServiceConfiguration(input));assert.equal(report.includes('secret-password'),false);assert.equal(report.includes('host-secret'),false);assert.match(JSON.parse(report).backend.configSha256,/^[a-f0-9]{64}$/);assert.match(JSON.parse(report).backend.hostConfigSha256,/^[a-f0-9]{64}$/);
});
