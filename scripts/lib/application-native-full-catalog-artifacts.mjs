import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const sourceRoot='D:/sabalanerp-online-qa/compiled-support-catalog-preparation-71252b8661294649a91d36447cf8f246/full-catalog-e27cf134619ad7bbb550abd2994e11f7';
const manifestSha256='16b9a7b22822da6bf1b95e04646c75e65fc47c626e35aa12e5798b27ba20a9d3';
const qualificationReceipt='reports/qa/application-prisma-adc49c06e111ddb62501a67feceb6eca.json';
const preparationReceipt='reports/qa/full-catalog-source-e27cf134619ad7bbb550abd2994e11f7.json';
const listReceipt='reports/qa/full-catalog-list-inventory-e27cf134619ad7bbb550abd2994e11f7.json';
const statKeys=['dev','ino','size','mtimeNs','ctimeNs','nlink','mode'];
const regular=file=>{assert.equal(fs.realpathSync(file),path.resolve(file));const value=fs.lstatSync(file,{bigint:true});assert.ok(value.isFile()&&!value.isSymbolicLink()&&value.nlink===1n);return value;};
const same=(a,b)=>{for(const key of statKeys)assert.equal(a[key],b[key]);};

export function collectApplicationFullCatalogArtifacts({root,capture}){
 capture('scripts/lib/application-native-full-catalog-artifacts.mjs');
 const preparation=JSON.parse(capture(preparationReceipt));assert.equal(preparation.sourcePreparationComplete,true);
 assert.equal(preparation.originalToolSessionClosed,true);assert.equal(preparation.observedOriginalExitCode,0);
 assert.equal(preparation.nativeCatalogQualified,false);assert.equal(path.resolve(preparation.sourceRoot),path.resolve(sourceRoot));assert.equal(preparation.manifestSha256,manifestSha256);
 const listed=JSON.parse(capture(listReceipt));assert.equal(listed.pass,true,'Actual full catalog --list qualification is required before staging');
 assert.equal(listed.observedOriginalExitCode,0);assert.equal(listed.originalToolSessionClosed,true);assert.equal(listed.manifestSha256,manifestSha256);assert.equal(listed.tests,288);assert.equal(listed.specFiles,67);assert.equal(listed.caseInventory.length,listed.tests);assert.equal(listed.caseInventorySha256,'7e37aa8fbfed0b5983c847d1bd589c1dc0897b6d7ab7a92894f41ab290ae493f');
 const raw=fs.readFileSync(path.join(sourceRoot,'source-manifest.json'));assert.equal(sha(raw),manifestSha256);
 const manifest=JSON.parse(raw);assert.equal(manifest.format,'sabalan-full-catalog-source/v1');assert.match(manifest.operation,/^[a-f0-9]{32}$/);
 const specFiles=Object.keys(manifest.files).filter(name=>name.startsWith('tests/design-system-e2e/')&&name.endsWith('.spec.ts')).map(name=>name.slice('tests/design-system-e2e/'.length)).sort();
 assert.deepEqual(specFiles,[...listed.specFileInventory].sort(),'Every canonical catalog spec must be listed');
 const qualification=capture(qualificationReceipt);assert.equal(manifest.nativeQualificationReceiptSha256,sha(qualification));
 assert.equal(manifest.schemaSha256,sha(capture('backend/prisma/schema.prisma')));
 const entries=[...manifest.entries].sort((a,b)=>a.relativePath<b.relativePath?-1:a.relativePath>b.relativePath?1:0);
 assert.ok(entries.length>0&&entries.length<=8192);assert.equal(entries.length,Object.keys(manifest.files).length);
 assert.equal(new Set(entries.map(row=>row.relativePath)).size,entries.length);
 let total=0;
 const prepared=entries.map(entry=>{
  const name=entry.relativePath;assert.ok(typeof name==='string'&&name&&!name.startsWith('/')&&!name.includes('\\')&&name.split('/').every(part=>part&&part!=='.'&&part!=='..'));
  assert.equal(entry.mode,0o400);assert.ok(Number.isSafeInteger(entry.bytes)&&entry.bytes>=0);assert.match(entry.sha256,/^[a-f0-9]{64}$/);
  assert.deepEqual(manifest.files[name],{sha256:entry.sha256,bytes:entry.bytes});total+=entry.bytes;
  const file=path.join(sourceRoot,name),before=regular(file),bytes=fs.readFileSync(file);same(before,regular(file));
  assert.equal(bytes.length,entry.bytes);assert.equal(sha(bytes),entry.sha256);
  // Repository-owned inputs must still be exactly current. Dependency files
  // are bound to the actual qualified Linux capsule and the frozen pack.
  if(/^(?:frontend\/src\/|tests\/|backend\/src\/|packages\/)/.test(name)||['playwright.design-system.config.ts','frontend/tsconfig.json','backend/tsconfig.json'].includes(name))assert.equal(sha(capture(name)),entry.sha256,'Catalog source changed: '+name);
  return {...entry,file,identity:before};
 });
 assert.ok(total<=256*1024**2);
 return {files:{'full-catalog-source-manifest.json':raw},catalog:{operation:manifest.operation,sourceManifestSha256:manifestSha256},
  proof:{format:'sabalan-original-full-catalog-source/v1',sourceRoot,operation:manifest.operation,manifestSha256,files:entries.length,bytes:total,schemaSha256:manifest.schemaSha256,nativeQualificationReceiptSha256:manifest.nativeQualificationReceiptSha256},entries:prepared};
}

/** SAME original host owns the sole staging Dockerexec until actual close.
 * Failure can leave only a fresh partial source tree, never native/SQL work. */
export async function stageOriginalFullCatalog({prepared,directory,containerId,beforeDocker,onObservation}){
 beforeDocker();
 const child=spawn('docker',['exec','-i',containerId,'python3','-I','-B',directory+'/full-catalog-stage.py',directory,prepared.catalog.sourceManifestSha256],{stdio:['pipe','pipe','pipe']});
 let stdout='',stderr='',failure;
 const closed=new Promise(resolve=>{child.on('error',error=>{failure=error;});child.on('close',(code,signal)=>resolve({code,signal}));});
 child.stdout.on('data',data=>{if(Buffer.byteLength(stdout)+data.length<=65536)stdout+=data;else failure??=Error('CATALOG_STAGE_STDOUT_BOUND');});
 child.stderr.on('data',data=>{if(Buffer.byteLength(stderr)+data.length<=65536)stderr+=data;else failure??=Error('CATALOG_STAGE_STDERR_BOUND');});
 child.stdin.on('error',error=>{failure??=error;});
 onObservation?.({phase:'SOURCE_STAGE_STARTED',originalPid:child.pid});
 try{
  for(const entry of prepared.entries){
   if(failure)throw failure;
   const fd=fs.openSync(entry.file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW),hash=createHash('sha256');
   try{
    same(fs.fstatSync(fd,{bigint:true}),entry.identity);let remaining=entry.bytes;
    while(remaining){const data=Buffer.allocUnsafe(Math.min(262144,remaining));const count=fs.readSync(fd,data,0,data.length,null);assert.ok(count>0);const bytes=data.subarray(0,count);hash.update(bytes);remaining-=count;if(!child.stdin.write(bytes))await Promise.race([once(child.stdin,'drain'),closed.then(()=>{throw Error('CATALOG_STAGE_CLOSED_DURING_INPUT');})]);if(failure)throw failure;}
    assert.equal(hash.digest('hex'),entry.sha256);same(fs.fstatSync(fd,{bigint:true}),entry.identity);same(regular(entry.file),entry.identity);
   }finally{fs.closeSync(fd);}
  }
 }catch(error){failure??=error;}finally{child.stdin.end();}
 const completion=await closed;
 onObservation?.({phase:'SOURCE_STAGE_CLOSED',originalPid:child.pid,...completion,stderr});
 if(failure)throw failure;
 assert.equal(completion.code,0);assert.equal(completion.signal,null);
 const result=JSON.parse(stdout);assert.equal(result.format,'sabalan-original-full-catalog-stage/v1');
 assert.equal(result.operation,prepared.catalog.operation);assert.equal(result.manifestSha256,prepared.catalog.sourceManifestSha256);
 assert.equal(result.files,prepared.proof.files);assert.equal(result.bytes,prepared.proof.bytes);assert.equal(result.databaseExecuted,false);
 return {...completion,result,stderr};
}
