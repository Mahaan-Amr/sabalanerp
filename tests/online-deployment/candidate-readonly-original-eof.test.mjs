/** Production observer bodies, finite real children, synthetic probe payloads. No Docker. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {spawn as realSpawn} from 'node:child_process';
import test from 'node:test';
const source=fs.readFileSync(new URL('../../scripts/replace-qualified-application-native-candidate-local.mjs',import.meta.url),'utf8');
const start=source.indexOf('async function originalInstalledReadback('),end=source.indexOf('async function originalNegativeAcceptanceVerify(',start),body=source.slice(start,end);
assert.ok(start>0&&end>start);
function harness({authorityCode=0,forceMissingEof=false,authorityOverflow=false}={}){
 const children=[],report={authorityCohort:{prepared:{},verified:{}}},service='backend-candidate',cid='a'.repeat(64),root=path.resolve('synthetic-readonly-probe');let statusCalls=0,saves=0;
 const authoritySource=Buffer.from(authorityOverflow?"import sys;sys.stderr.write('x'*65537)":authorityCode?`import sys;sys.exit(${authorityCode})`:"import json,sys;p=json.load(sys.stdin);print(json.dumps({'mode':p['mode'],'synthetic':True}))");
 const context={assert,Buffer,JSON,path,Promise,root,report,children,interrupted:false,cohortNonce:'b'.repeat(32),authorityCohortSources:['unused','synthetic.fixture.py'],previous:{[service]:{Id:cid}},
  digest:b=>createHash('sha256').update(b).digest('hex'),status:()=>{statusCalls++;},save:()=>{saves++;},authorityWriterRoot:(observed,name)=>{assert.equal(name,service);assert.equal(observed.Id,cid);return{kind:'runtime',target:'/synthetic-authority'};},
  fs:{readFileSync:file=>{assert.equal(file,path.join(root,'synthetic.fixture.py'));return authoritySource;}},
  installedProbe:Buffer.from('console.log(JSON.stringify({synthetic:true}));console.error("finite-probe-stderr");'),validateInstalledNativeRole:(value,expected)=>assert.deepEqual(value,expected),
  spawn:(command,argv,options)=>{
   assert.equal(command,'docker');assert.deepEqual(Array.from(argv).slice(0,3),['exec','-i',cid]);assert.deepEqual(Array.from(options.stdio),['pipe','pipe','pipe']);
   const child=argv[3]==='node'?realSpawn(process.execPath,['--input-type=module','-'],{stdio:options.stdio}):realSpawn(process.env.PYTHON??'python',['-I','-B','-c',argv.at(-1)],{stdio:options.stdio,windowsHide:true});
   if(forceMissingEof)Object.defineProperty(child.stderr,'readableEnded',{get:()=>false});return child;
  }};
 vm.runInNewContext(body+'\nglobalThis.installed=originalInstalledReadback;globalThis.authority=originalAuthorityDirectory;',context);
 return{context,children,report,service,get statusCalls(){return statusCalls;},get saves(){return saves;}};
}
test('installed observer records both real finite-child EOFs and actual original PID',async()=>{
 const h=harness(),result=await h.context.installed(h.service,{synthetic:true});assert.equal(result.stdoutEof,true);assert.equal(result.stderrEof,true);assert.ok(result.originalPid>0);assert.equal(result.code,0);assert.equal(result.signal,null);assert.equal(result.stderr,'finite-probe-stderr\n');assert.equal(h.children.length,1);assert.equal(h.children[0].exitCode,0);assert.equal(h.statusCalls,1);
});
test('authority readonly verify records both EOFs and preserves source-owned result',async()=>{
 const h=harness(),result=await h.context.authority(h.service,'verify',h.context.previous);assert.equal(result.stdoutEof,true);assert.equal(result.stderrEof,true);assert.equal(result.result.mode,'verify');assert.equal(result.code,0);assert.ok(result.originalPid>0);assert.equal(h.report.authorityCohort.verified[h.service].stderrEof,true);assert.equal(h.saves,1);
});
test('failed authority original remains failed with real EOF evidence saved',async()=>{
 const h=harness({authorityCode:7});await assert.rejects(h.context.authority(h.service,'verify',h.context.previous));const row=h.report.authorityCohort.verified[h.service];assert.equal(row.code,7);assert.equal(row.stdoutEof,true);assert.equal(row.stderrEof,true);assert.equal(h.saves,1);
});
test('closed installed child with unproven stderr EOF cannot return success',async()=>{
 const h=harness({forceMissingEof:true});await assert.rejects(h.context.installed(h.service,{synthetic:true}));assert.equal(h.children[0].exitCode,0);
});
test('existing authority output bound still refuses after both real pipes close',async()=>{
 const h=harness({authorityOverflow:true});await assert.rejects(h.context.authority(h.service,'verify',h.context.previous));const row=h.report.authorityCohort.verified[h.service];assert.equal(row.failure,'AUTHORITY_COHORT_STDERR_BOUND');assert.equal(row.stdoutEof,true);assert.equal(row.stderrEof,true);
});
