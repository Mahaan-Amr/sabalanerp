import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readProductionInquirySnapshot,assertSnapshotInquiryJoin} from '../../scripts/lib/production-inquiry-snapshot.mjs';
const hash=raw=>createHash('sha256').update(raw).digest('hex');
function fixture(){const services=Object.fromEntries(['backend','clamav','frontend','inquiry','nginx','postgres'].map((name,i)=>[name,{id:String(i+1).repeat(64),image:'sha256:'+String(i+1).repeat(64),startedAt:'2026-10-20T12:00:00Z',running:true,health:'healthy'}]));return{format:'sabalan-readonly-capture-only-readiness/v1',readOnly:true,productionMutation:false,allSixIdentitiesUnchanged:true,head:'a'.repeat(40),originalSsh:{code:0,signal:null},originalChildren:[{code:0,signal:null}],services};}
test('snapshot pins exact bytes, original closure and six healthy incarnations',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sabalan-inquiry-snapshot-')),file=path.join(dir,'baseline.json');
 try{const value=fixture();let raw=JSON.stringify(value);fs.writeFileSync(file,raw);const snapshot=readProductionInquirySnapshot(file,hash(raw));assert.equal(snapshot.services.inquiry.id,value.services.inquiry.id);assert.equal(snapshot.productionAdmission,false);assert.throws(()=>readProductionInquirySnapshot(file,'0'.repeat(64)),/SNAPSHOT_BYTES_CHANGED/);value.originalChildren[0].code=1;raw=JSON.stringify(value);fs.writeFileSync(file,raw);assert.throws(()=>readProductionInquirySnapshot(file,hash(raw)));}finally{assert.equal(path.dirname(fs.realpathSync(dir)),fs.realpathSync(os.tmpdir()));fs.rmSync(dir,{recursive:true});}
});
test('joined inventory and export cannot exchange a different original container or failed child',()=>{
 const value=fixture(),snapshot={sha256:'b'.repeat(64),deployedHead:value.head,services:value.services},target=value.services.inquiry,before=Object.entries(value.services).map(([service,row])=>({service,id:row.id,image:row.image,birth:row.startedAt}));
 const code={passResult:true,allSixIdentitiesUnchanged:true,allOriginalChildrenClosed:true,originalCommands:[{returncode:0}],inquiry:before.find(v=>v.service==='inquiry'),snapshotBaseline:snapshot,before,image:{id:target.image,rootfs:[]},value:{frameworkBuildId:'actual_build',knownBusinessSourceCommit:null,sourceSnapshot:{format:'sabalan-measured-inquiry-source/v1',baselineSha256:snapshot.sha256,deployedHead:value.head,engineImage:target.image,containerId:target.id,startedAt:target.startedAt}}};
 const exported={passResult:true,originalSsh:{code:0,signal:null},originalTransfer:{code:0,signal:null},originalClosure:{interrupted:false,allOriginalChildrenClosed:true},snapshotBaseline:snapshot,remote:{sourceImage:target.image,before:structuredClone(before),image:code.image,allSixIdentitiesUnchanged:true,allOriginalChildrenClosed:true,originalCommands:[{returncode:0}]}};
 const codeOuter={format:'sabalan-production-inquiry-legacy-code-ssh/v1',originalSsh:{code:0,signal:null,stdout:JSON.stringify(code)},originalClosure:{interrupted:false,allOriginalChildrenClosed:true}};
 assert.deepEqual(assertSnapshotInquiryJoin(snapshot,code,exported,codeOuter),code.value.sourceSnapshot);codeOuter.originalClosure.interrupted=true;assert.throws(()=>assertSnapshotInquiryJoin(snapshot,code,exported,codeOuter));codeOuter.originalClosure.interrupted=false;codeOuter.originalClosure.allOriginalChildrenClosed=false;assert.throws(()=>assertSnapshotInquiryJoin(snapshot,code,exported,codeOuter));codeOuter.originalClosure.allOriginalChildrenClosed=true;codeOuter.originalSsh.signal='SIGTERM';assert.throws(()=>assertSnapshotInquiryJoin(snapshot,code,exported,codeOuter));codeOuter.originalSsh.signal=null;exported.remote.before[0].id='f'.repeat(64);assert.throws(()=>assertSnapshotInquiryJoin(snapshot,code,exported,codeOuter));exported.remote.before=structuredClone(before);exported.remote.originalCommands[0].returncode=1;assert.throws(()=>assertSnapshotInquiryJoin(snapshot,code,exported,codeOuter));
});
test('fixed remote inventory/export templates compile without running remote commands',()=>{
 for(const [file,name] of [['observe-production-inquiry-legacy-source.mjs','controller'],['export-production-inquiry-legacy-image.mjs','source']]){
  const text=fs.readFileSync(new URL('../../scripts/'+file,import.meta.url),'utf8'),match=text.match(new RegExp('const '+name+'=String.raw`([\\s\\S]*?)`;?\\.replace'));
  assert.ok(match,file);const source=match[1].replaceAll('__BASELINE__',Buffer.from('null').toString('base64')).replaceAll('__ROOT__','/root/owned-fixture').replaceAll('__SOURCE__','').replaceAll('__SHA__','a'.repeat(64));
  execFileSync('python',['-X','utf8','-B','-c','import ast,sys;ast.parse(sys.stdin.read())'],{input:source});
 }
});
