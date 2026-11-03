import test from 'node:test';
import assert from 'node:assert/strict';
import {assertRestoredInquiryCarrierObservation} from '../../scripts/lib/restored-qa/inquiry-carrier-observation.mjs';
import {fixture,reference} from './restored-inquiry-carrier-observation.fixture.mjs';

test('Inquiry consumer retains actual requested-stop status128/143 without manufacturing natural zero or EOF',()=>{
 const f=fixture(),result=assertRestoredInquiryCarrierObservation(f.evidence,f.expected);
 assert.equal(result.wrapperStatus,128);assert.equal(result.nativeStatus,143);assert.equal(result.naturalExitZero,false);
 assert.equal(result.nativeQualified,false);assert.equal(result.productionAdmission,false);assert.ok(!Object.hasOwn(result,'stdoutEof'));
});

test('missing, tampered, unstarted or unclosed Inquiry output refuses',()=>{
 for(const change of [f=>delete f.evidence.retirement,f=>f.evidence.finalNative.sha256='0'.repeat(64),f=>f.expected.restoredSqliteSha256='0'.repeat(64)]){const f=fixture();change(f);assert.throws(()=>assertRestoredInquiryCarrierObservation(f.evidence,f.expected));}
 for(const [name,change]of [
  ['retirement',v=>v.closure=null],['retirement',v=>v.retired=false],['retirement',v=>v.phase='RETIRING'],['retirement',v=>v.closure.wrapperStatus=0],['retirement',v=>v.nativeQualified=true],
  ['finalNative',v=>v.nativeReaped=false],['finalNative',v=>v.sqliteNativeClosed=false],['finalNative',v=>v.nativeStatus=0],['finalNative',v=>v.guardian.pid=99],
  ['requestedStop',v=>v.signal='SIGKILL'],['work',v=>v.phase='ACTIVE'],['workClaim',v=>v.native.claimSha256='0'.repeat(64)],
 ]){const f=fixture(),value=JSON.parse(Buffer.from(f.evidence[name].rawBase64,'base64'));change(value);f.evidence[name]=reference(value);assert.throws(()=>assertRestoredInquiryCarrierObservation(f.evidence,f.expected),name);}
});

test('self-consistent retirement hashes cannot replace the engine COMPLETE SQLite or original carrier snapshot',()=>{
 for(const change of [v=>v.inputSqlite.sha256='9'.repeat(64),v=>v.originalDatabase.inode='999',v=>v.closure.naturalExitZero=true]){
  const f=fixture(),value=JSON.parse(Buffer.from(f.evidence.retirement.rawBase64,'base64'));change(value);f.evidence.retirement=reference(value);
  assert.throws(()=>assertRestoredInquiryCarrierObservation(f.evidence,f.expected));
 }
});

import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('Inquiry observation agrees with the consumed canonical requested-stop policy',()=>{
 const f=fixture(),decode=r=>JSON.parse(Buffer.from(r.rawBase64,'base64'));
 const policy=fileURLToPath(new URL('./inquiry-requested-stop.fixture.py',import.meta.url));
 const python=process.platform==='win32'?'C:/Users/mahan/AppData/Local/Programs/Python/Python314/python.exe':'/usr/bin/python3';
 const program="import importlib.util,json,sys; s=importlib.util.spec_from_file_location('stop',sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); v=json.load(sys.stdin); print(json.dumps(m.qualify_requested_stop(*v)))";
 const result=spawnSync(python,['-I','-B','-c',program,policy],{encoding:'utf8',maxBuffer:65536,input:JSON.stringify([decode(f.evidence.requestedStop),decode(f.evidence.activeNative),decode(f.evidence.finalNative),128])});
 assert.equal(result.status,0,result.stderr);assert.equal(result.signal,null);
 const observed=assertRestoredInquiryCarrierObservation(f.evidence,f.expected),canonical=JSON.parse(result.stdout);
 assert.equal(canonical.retiredByRequestedSigterm,true);assert.equal(observed.nativeStatus,canonical.nativeStatus);assert.equal(observed.naturalExitZero,canonical.naturalExitZero);
});
