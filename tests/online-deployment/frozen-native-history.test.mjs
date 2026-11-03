import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import test from 'node:test';
import vm from 'node:vm';
import {readFrozenNativeHistoricalData,readPinnedHistoricalJson,nativeHistoricalFile} from '../../scripts/lib/frozen-native-history.mjs';

test('historical data reader retains the genuine original CRLF bytes and physical path',()=>{
 const value=readFrozenNativeHistoricalData('reports/qa/production-image-export-b39dbefcc66448449f62d93159a31151.json');
 assert.equal(value.reference.sha256,'316758304177064c0e1fd8f79598b5143bd97b4b826673a7123dce44341c8f3f');
 assert.ok(value.reference.file.replaceAll('\\','/').startsWith('C:/Users/mahan/.codex/worktrees/online-deployment/sabalanerp/reports/qa/'));
 assert.equal(createHash('sha256').update(value.raw).digest('hex'),value.reference.sha256);
 assert.ok(value.raw.includes(Buffer.from('\r\n')));
 assert.equal(value.historicalOnly,true);assert.equal(value.activeCapability,false);
 assert.throws(()=>readFrozenNativeHistoricalData('reports/qa/application-native-candidate-00000000000000000000000000000000.json'),/HISTORICAL_INPUT_NOT_ALLOWED/);
});

test('data validation refuses altered bytes, CRLF conversion, identity replacement and aliases',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'sabalan-history-419-')),file=path.join(root,'history.json');
 const raw=Buffer.from('{"legacy":true}\r\n');fs.writeFileSync(file,raw,{flag:'wx'});
 const snapshot=()=>{const n=fs.lstatSync(file,{bigint:true}),fd=fs.openSync(file,'r');try{const h=fs.fstatSync(fd,{bigint:true});return{file,bytes:raw.length,sha256:createHash('sha256').update(raw).digest('hex'),identity:{...Object.fromEntries(['dev','ino','size','mtimeNs','ctimeNs','mode','nlink'].map(k=>[k,String(n[k])])),descriptorDevice:String(h.dev)}};}finally{fs.closeSync(fd);}};
 try{
  const reference=snapshot();assert.deepEqual(readPinnedHistoricalJson(reference).raw,raw);
  assert.throws(()=>readPinnedHistoricalJson({...reference,sha256:'0'.repeat(64)}),/HISTORICAL_FILE_BYTES_CHANGED/);
  fs.writeFileSync(file,Buffer.from('{"legacy":true}\n'));
  assert.throws(()=>readPinnedHistoricalJson(reference),/HISTORICAL_FILE_IDENTITY_CHANGED/);
  fs.writeFileSync(file,raw);const restored=snapshot(),replacement=path.join(root,'replacement.json');fs.writeFileSync(replacement,raw,{flag:'wx'});fs.unlinkSync(file);fs.renameSync(replacement,file);
  assert.throws(()=>readPinnedHistoricalJson(restored),/HISTORICAL_FILE_IDENTITY_CHANGED/);
  const alias=path.join(root,'alias');fs.symlinkSync(root,alias,process.platform==='win32'?'junction':'dir');
  assert.throws(()=>readPinnedHistoricalJson({...snapshot(),file:path.join(alias,'history.json')}),/HISTORICAL_PATH_ALIAS/);fs.unlinkSync(alias);
 }finally{assert.equal(fs.realpathSync(root),root);assert.equal(path.dirname(root),fs.realpathSync(os.tmpdir()));assert.ok(path.basename(root).startsWith('sabalan-history-419-'));fs.rmSync(root,{recursive:true});}
});

test('fresh runtime evidence and code paths cannot acquire a historical-data binding',()=>{
 const root=path.resolve('C:/Users/mahan/.codex/worktrees/native-c3-execution-419/sabalanerp');
 const fresh='reports/qa/application-native-candidate-00000000000000000000000000000000.json';
 assert.equal(nativeHistoricalFile(root,fresh),path.join(root,...fresh.split('/')));
 assert.throws(()=>readFrozenNativeHistoricalData(fresh),/HISTORICAL_INPUT_NOT_ALLOWED/);
 assert.throws(()=>readFrozenNativeHistoricalData('scripts/run-original-online-qualification-master.mjs'),/HISTORICAL_INPUT_NOT_ALLOWED/);
 assert.throws(()=>nativeHistoricalFile(root,'../foreign.json'));
});


function candidateDataRevalidator(root,captured){
 const source=fs.readFileSync(new URL('../../scripts/lib/application-native-candidate-artifacts.mjs',import.meta.url),'utf8'),start=source.indexOf('const revalidate=()=>'),end=source.indexOf('\n revalidate();return',start);assert.ok(start>0&&end>start);
 const expression=source.slice(start+'const revalidate='.length,end).replace(/;$/,'');
 const context={root,captured,fs,path,assert,nativeHistoricalFile,sha:raw=>createHash('sha256').update(raw).digest('hex'),external:new Map(),negativeOriginToken:null,negativeProfileToken:null,evidence:{}};
 return vm.compileFunction('return('+expression+');',Object.keys(context))(...Object.values(context));
}

test('candidate revalidation consumes the same authenticated historical path when the local alias is absent',()=>{
 const root=path.resolve('C:/Users/mahan/.codex/worktrees/native-c3-execution-419/sabalanerp'),relative='reports/qa/application-native-role-slots-aeca1063d2275dde6b8fbda710d1de34.json',original=nativeHistoricalFile(root,relative),raw=fs.readFileSync(original);assert.equal(fs.existsSync(path.join(root,relative)),false);assert.equal(createHash('sha256').update(raw).digest('hex'),'bbcb8b820003b984dd75c9b89e622b13b6264626a8651fd7c95572a584d759f8');const revalidate=candidateDataRevalidator(root,new Map([[relative,'bbcb8b820003b984dd75c9b89e622b13b6264626a8651fd7c95572a584d759f8']]));assert.doesNotThrow(revalidate);assert.equal(fs.existsSync(path.join(root,relative)),false);
});

test('candidate data revalidation still rejects changed current bytes and invalid historical digest',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'sabalan-candidate-source-')),file=path.join(root,'current.mjs');try{fs.writeFileSync(file,'exact-current');const hash=createHash('sha256').update('exact-current').digest('hex'),revalidate=candidateDataRevalidator(root,new Map([['current.mjs',hash]]));assert.doesNotThrow(revalidate);fs.writeFileSync(file,'changed-current');assert.throws(revalidate,/ROLE_CAPTURE_CHANGED/);}finally{assert.equal(fs.realpathSync(root),root);assert.equal(path.dirname(root),fs.realpathSync(os.tmpdir()));fs.rmSync(root,{recursive:true});}
 const live=path.resolve('C:/Users/mahan/.codex/worktrees/native-c3-execution-419/sabalanerp'),alias='reports/qa/application-native-role-slots-aeca1063d2275dde6b8fbda710d1de34.json';assert.throws(candidateDataRevalidator(live,new Map([[alias,'0'.repeat(64)]])),/ROLE_CAPTURE_CHANGED/);
});
