import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';

// Pure artifact collection. The caller owns Docker targeting and staging.
export function collectInquiryArtifacts({repositoryRoot,captureSource}) {
  const read=name=>captureSource(name),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
  read('scripts/lib/application-native-inquiry-artifacts.mjs');
  const build=JSON.parse(read('reports/qa/sabalan-inquiry-build-6845a85e262d24f606a8ee9eca510173.json'));
  assert.deepEqual(build.result,{code:0,signal:null});
  for(const[name,hash]of Object.entries(build.sourceHashes))assert.equal(sha(read('apps/sabalan-inquiry/'+name)),hash);
  const acceptedBytes=read('reports/qa/inquiry-coherent-61138945df5c6dfceba7b55726201e9c.json'),accepted=JSON.parse(acceptedBytes);
  assert.equal(accepted.pass,true);assert.equal(accepted.dependencyReuse.postRunInventoryVerified,true);
  const closureBytes=read('reports/qa/inquiry-restored-continuation-f86e6b783a3fb12f5079750e1b66d85e.json'),closure=JSON.parse(closureBytes);
  assert.equal(sha(closureBytes),accepted.dependencyReuse.originalClosureReportSha256);assert.equal(closure.pass,true);
  const receipt=JSON.parse(read('reports/qa/inquiry-native-next-image-20261018.json')).imageReceipt;
  const archive=fs.readFileSync(path.join(receipt.directory,'inquiry-build.tar.gz'));
  assert.equal(sha(archive),receipt.archiveSha256);assert.equal(receipt.archiveSha256,accepted.codeArchiveSha256);
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
    qualifiedWholeReportSha256:sha(acceptedBytes),qualifiedWorkingRoot:accepted.workingRoot,
    originalDependencyClosure:{directory:closure.directory,nativeSha256:{...closure.originalClosureSha256,restored:closure.restoredClosureSha256}},
    dependency:accepted.dependencyReuse,sourceHashes:Object.fromEntries(Object.entries(files).map(([name,bytes])=>[name,sha(bytes)])),
    productionAdmission:false,immutableImageAdmission:false};
  files['inquiry-custody.json']=Buffer.from(JSON.stringify(custody)+'\n');
  return files;
}
