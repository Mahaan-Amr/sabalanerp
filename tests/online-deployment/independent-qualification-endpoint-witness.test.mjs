import test from 'node:test';
import assert from 'node:assert/strict';
import * as controller from '../../scripts/lib/independent-private-qualification-controller.mjs';

test('receipt, PID, copied URI and serialized token cannot become a live original endpoint',()=>{
 assert.equal(typeof controller.assertOriginalIndependentQualificationEndpoint,'function');
 for(const value of [null,{},Object.freeze({}),{pid:123,url:'http://172.18.0.10:1234',phase:'HTTP_READY'},JSON.parse('{}')])
  assert.throws(()=>controller.assertOriginalIndependentQualificationEndpoint(value),/ORIGINAL_INDEPENDENT_HTTP_ENDPOINT_REQUIRED/);
});
test('new original owner cannot issue endpoint authority before its own original HTTP READY',()=>{
 const owner=controller.createOriginalIndependentQualificationController({root:'/app/online-runtime-acceptance/application-native-'+'a'.repeat(32),index:{},config:{},sourcePins:Object.fromEntries(['independent-private-runtime.py','private-qualification-observer.py','private-qualification-materialize.py','private-qualification-bootstrap.sql'].map(name=>[name,'b'.repeat(64)])),beforeDocker:async()=>{throw Error('NO_DOCKER_IN_PURE_TEST');}});
 assert.equal(typeof owner.httpEndpointWitness,'function');
 assert.throws(()=>owner.httpEndpointWitness());
 assert.equal(owner.inspect().phase,'NEW');
});

// Pure simulated owner state exercises the actual private guard body. This
// creates no processes, container, native receipt or accepted endpoint token.
import fs from 'node:fs';
import {ChildProcess} from 'node:child_process';
import {PassThrough} from 'node:stream';
function simulatedGuard(){
 const source=fs.readFileSync(new URL('../../scripts/lib/independent-private-qualification-controller.mjs',import.meta.url),'utf8');
 const start=source.indexOf('  function assertLiveHttpEndpoint(){'),end=source.indexOf('  return Object.freeze({\n    httpEndpointWitness(){',start);assert.ok(start>0&&end>start);
 const child=new ChildProcess();Object.assign(child,{spawnfile:'docker',spawnargs:['docker','exec','-i','a'.repeat(64)],stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),pid:456});
 const decision={runtimeId:'b'.repeat(64),image:'sha256:'+'c'.repeat(64),sourceCommit:'d'.repeat(40),database:{name:'qa_owned',oid:'123',systemIdentifier:'456'},httpIngress:{bindHost:'172.18.0.10',port:3100},runtimeBundleSha256:'e'.repeat(64),restoreManifestSha256:'f'.repeat(64),artifactsSha256:'1'.repeat(64)};
 const grant={scope:{runtimeId:decision.runtimeId},sha256:'2'.repeat(64)};
 const identity={...decision,scopeSha256:grant.sha256};
 const http={owner:{child,closed:false},ready:{result:{identity}},started:{originalPopenPid:789}};
 const index={privateQualification:{httpGrant:grant},restoredDatabase:'qa_owned',restoredOid:123};
 const container={id:'a'.repeat(64),image:decision.image};let held=false;
 const fn=Function('assert','ChildProcess','check','same','http','container','materials','index','config','phase',source.slice(start,end)+';return {read:assertLiveHttpEndpoint,setPhase(v){phase=v}};');
 const api=fn(assert,ChildProcess,()=>assert.equal(held,false),assert.deepEqual,http,container,{[decision.runtimeId]:{decision:{decision}}},index,{roleTopology:{main:{host:decision.httpIngress.bindHost}}},'HTTP_READY');
 return{...api,http,child,index,decision,hold(){held=true;}};
}
test('actual live guard binds DB identity and revokes at native closure, drain and HELD',()=>{
 const state=simulatedGuard();const result=state.read();assert.equal(result.database.oid,'123');assert.equal(result.productionAdmission,false);assert.equal(result.independentPointHealthy,false);assert.equal(result.cleanupPending,true);
 for(const change of [s=>{s.http.owner.closed=true;},s=>{s.setPhase('HTTP_PREPARING');},s=>{s.hold();},s=>{s.child.exitCode=0;},s=>{s.child.killed=true;},s=>{s.index.restoredOid=999;},s=>{s.http.ready.result.identity={...s.http.ready.result.identity,database:{...s.decision.database,oid:'999'}};}]){
  const current=simulatedGuard();change(current);assert.throws(()=>current.read());
 }
});
