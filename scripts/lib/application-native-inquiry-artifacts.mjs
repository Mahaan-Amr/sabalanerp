import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {gunzipSync} from 'node:zlib';

// Historical compiled input bytes belong to their original archive, not today's checkout.
export function verifyHistoricalInquirySources(archive,expectedArchiveSha256,sourceHashes) {
  const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
  assert.ok(Buffer.isBuffer(archive)&&archive.length<=16*1024**2);
  assert.equal(sha(archive),expectedArchiveSha256);
  const tar=gunzipSync(archive,{maxOutputLength:64*1024**2});
  const entries=new Map();let offset=0,longName=null,ended=false;
  const text=bytes=>{const end=bytes.indexOf(0);return bytes.subarray(0,end<0?bytes.length:end).toString('utf8');};
  const octal=bytes=>{const value=text(bytes).trim();assert.match(value,/^[0-7]+$/);return Number.parseInt(value,8);};
  while(offset+512<=tar.length){
    const header=tar.subarray(offset,offset+512);offset+=512;
    if(header.every(value=>value===0)){assert.ok(tar.subarray(offset).every(value=>value===0));ended=true;break;}
    let checksum=0;for(let i=0;i<512;i++)checksum+=i>=148&&i<156?32:header[i];
    assert.equal(checksum,octal(header.subarray(148,156)));
    const size=octal(header.subarray(124,136));assert.ok(Number.isSafeInteger(size)&&size<=32*1024**2);
    assert.ok(offset+Math.ceil(size/512)*512<=tar.length);
    const body=tar.subarray(offset,offset+size);offset+=Math.ceil(size/512)*512;
    const type=String.fromCharCode(header[156]);
    if(type==='L'){assert.equal(longName,null);assert.ok(size>0&&size<=4096);longName=text(body);continue;}
    const prefix=text(header.subarray(345,500));
    const rawName=longName??(prefix?prefix+'/':'')+text(header.subarray(0,100));longName=null;
    const name=rawName.replace(/^\.\//,'').replace(/\/$/,'');
    assert.ok(name.length>0&&!name.includes('\\')&&!name.includes('\0')&&!name.startsWith('/')&&!/^[A-Za-z]:/.test(name));
    assert.ok(name.split('/').every(part=>part&&part!=='.'&&part!=='..'));
    assert.ok(!entries.has(name),'DUPLICATE_HISTORICAL_INQUIRY_ENTRY:'+name);
    assert.ok(['0','\0','5','2'].includes(type));
    assert.ok(entries.size<4096);entries.set(name,{type,body});
  }
  assert.ok(ended&&longName===null);
  assert.ok(sourceHashes&&Object.keys(sourceHashes).length>0&&Object.keys(sourceHashes).length<=256);
  for(const[name,hash]of Object.entries(sourceHashes)){
    assert.match(hash,/^[a-f0-9]{64}$/);const entry=entries.get(name);
    assert.ok(entry&&(entry.type==='0'||entry.type==='\0'),'HISTORICAL_INQUIRY_SOURCE_NOT_REGULAR:'+name);
    assert.equal(sha(entry.body),hash,'HISTORICAL_INQUIRY_SOURCE_CHANGED:'+name);
  }
  return {archiveSha256:expectedArchiveSha256,sourceCount:Object.keys(sourceHashes).length};
}

// Pure artifact collection. The caller owns Docker targeting and staging.
export function collectInquiryArtifacts({repositoryRoot,captureSource}) {
  const read=name=>captureSource(name),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
  read('scripts/lib/application-native-inquiry-artifacts.mjs');
  const buildBytes=read('reports/qa/sabalan-inquiry-build-6845a85e262d24f606a8ee9eca510173.json'),build=JSON.parse(buildBytes);
  assert.deepEqual(build.result,{code:0,signal:null});
  const acceptedBytes=read('reports/qa/inquiry-coherent-61138945df5c6dfceba7b55726201e9c.json'),accepted=JSON.parse(acceptedBytes);
  assert.equal(accepted.pass,true);assert.equal(accepted.dependencyReuse.postRunInventoryVerified,true);
  const closureBytes=read('reports/qa/inquiry-restored-continuation-f86e6b783a3fb12f5079750e1b66d85e.json'),closure=JSON.parse(closureBytes);
  assert.equal(sha(closureBytes),accepted.dependencyReuse.originalClosureReportSha256);assert.equal(closure.pass,true);
  const receipt=JSON.parse(read('reports/qa/inquiry-native-next-image-20261018.json')).imageReceipt;
  assert.equal(sha(buildBytes),receipt.buildReportSha256);
  const archive=fs.readFileSync(path.join(receipt.directory,'inquiry-build.tar.gz'));
  assert.equal(sha(archive),receipt.archiveSha256);assert.equal(receipt.archiveSha256,accepted.codeArchiveSha256);
  const historicalSources=verifyHistoricalInquirySources(archive,receipt.archiveSha256,build.sourceHashes);
  const files={'inquiry-code.tar.gz':archive};
  files['online-inquiry-owner.py']=read('deploy/scripts/online-inquiry-owner.py');
  const changeRoot=(bytes,needle,replacement)=>{const text=bytes.toString('utf8');assert.equal(text.split(needle).length,2);return Buffer.from(text.replace(needle,replacement));};
  files['inquiry-client.cjs']=changeRoot(read('tests/online-deployment/inquiry-coherent-restore.client.cjs'),
    String.raw`/^\/app\/online-runtime-acceptance\/inquiry-coherent-[a-f0-9]{32}$/`,
    String.raw`/^\/app\/online-runtime-acceptance\/application-native-[a-f0-9]{32}\/inquiry$/`);
  files['inquiry-observer.cjs']=changeRoot(read('tests/online-deployment/inquiry-coherent-restore.observer.cjs'),
    String.raw`/^\/app\/online-runtime-acceptance\/inquiry-coherent-[a-f0-9]{32}$/`,
    String.raw`/^\/app\/online-runtime-acceptance\/application-native-[a-f0-9]{32}\/inquiry$/`);
  files['inquiry-requested-stop.py']=read('tests/online-deployment/inquiry-requested-stop.fixture.py');
  files['inquiry-dependency-inventory.cjs']=read('tests/online-deployment/inquiry-dependency-inventory.fixture.cjs');
  files['application-native-inquiry.fixture.py']=read('tests/online-deployment/application-native-inquiry.fixture.py');
  const ts=createRequire(path.join(repositoryRoot,'backend/package.json'))('typescript');
  for(const name of ['onlineInquiryWork','onlineRuntimeScope','onlineCaptureAdmission','kernelWriteAdmission','runtimeBoundaryJournal','runtimeTaskAdmission','runtimeWorkContext']){
    const source=read('backend/src/services/'+name+'.ts');
    files['inquiry-runtime-'+name+'.js']=Buffer.from(ts.transpileModule(source.toString('utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText);
  }
  const custody={format:'sabalan-joined-inquiry-artifact-custody/v1',codeArchiveSha256:receipt.archiveSha256,
    historicalBuildSources:{...historicalSources,buildReportSha256:sha(buildBytes)},
    qualifiedWholeReportSha256:sha(acceptedBytes),qualifiedWorkingRoot:accepted.workingRoot,
    originalDependencyClosure:{directory:closure.directory,nativeSha256:{...closure.originalClosureSha256,restored:closure.restoredClosureSha256}},
    dependency:accepted.dependencyReuse,sourceHashes:Object.fromEntries(Object.entries(files).map(([name,bytes])=>[name,sha(bytes)])),
    productionAdmission:false,immutableImageAdmission:false};
  files['inquiry-custody.json']=Buffer.from(JSON.stringify(custody)+'\n');
  return files;
}
