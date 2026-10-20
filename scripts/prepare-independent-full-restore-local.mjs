/** Source-only preparation. No Docker, SSH, signing, health or admission. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
const repository=path.resolve(import.meta.dirname,'..'),qa='D:/sabalanerp-online-qa';
assert.equal(process.platform,'win32');assert.equal(fs.realpathSync(qa).toLowerCase(),path.resolve(qa).toLowerCase());
const argumentsList=process.argv.slice(2);assert.equal(argumentsList.length,8);
const argumentNames=['--inquiry-image-receipt','--inquiry-image-receipt-sha256','--inquiry-archive-receipt','--inquiry-archive-receipt-sha256'];
for(let index=0;index<4;index++)assert.equal(argumentsList[index*2],argumentNames[index]);
const externalInputInventory={};
function pinnedReceipt(file,expected){
 assert.match(expected,/^[a-f0-9]{64}$/);assert.ok(path.isAbsolute(file));
 const actual=fs.realpathSync(file);assert.equal(actual.toLowerCase(),path.resolve(file).toLowerCase());
 assert.ok(path.relative(qa,actual)&&!path.relative(qa,actual).startsWith('..')&&!path.isAbsolute(path.relative(qa,actual)));
 const before=fs.lstatSync(actual,{bigint:true});assert.ok(before.isFile()&&!before.isSymbolicLink()&&before.nlink===1n&&before.size>0n&&before.size<=1048576n);
 const raw=fs.readFileSync(actual);assert.equal(createHash('sha256').update(raw).digest('hex'),expected);
 const after=fs.lstatSync(actual,{bigint:true});for(const key of ['dev','ino','size','mtimeNs','ctimeNs','birthtimeNs','mode','nlink'])assert.equal(after[key],before[key]);externalInputInventory[actual]=expected;
 return {raw,value:JSON.parse(raw),file:actual,sha256:expected};
}
const selectedInquiry=pinnedReceipt(argumentsList[1],argumentsList[3]),selectedInquiryArchive=pinnedReceipt(argumentsList[5],argumentsList[7]);
assert.equal(selectedInquiry.value.format,'sabalan-inquiry-native-image-diagnostic/v1');
assert.equal(selectedInquiryArchive.value.format,'sabalan-native-inquiry-image-archive/v1');
assert.equal(path.resolve(selectedInquiryArchive.value.imageReceipt).toLowerCase(),selectedInquiry.file.toLowerCase());
assert.equal(selectedInquiryArchive.value.imageReceiptSha256,selectedInquiry.sha256);
assert.equal(selectedInquiryArchive.value.index,selectedInquiry.value.image);
const destination=path.join(qa,'independent-full-restore-source-'+randomBytes(16).toString('hex'));
fs.mkdirSync(destination,{mode:0o700});
const sha=raw=>createHash('sha256').update(raw).digest('hex'),sourceInventory={},outputInventory={},sourcePins={};
function source(name){const file=path.join(repository,name),raw=fs.readFileSync(file);sourceInventory[name]=sha(raw);return raw;}
function output(name,raw){const file=path.join(destination,name);assert.ok(path.relative(destination,file)&&!path.relative(destination,file).startsWith('..'));
  fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,raw,{flag:'wx',mode:0o400});outputInventory[name]=sha(raw);}
const controllers=['scripts/run-independent-full-restore-controller.mjs','scripts/lib/independent-private-qualification-controller.mjs','scripts/lib/independent-private-qualification-material.mjs','scripts/lib/independent-checkpoint-transport.mjs','scripts/lib/independent-physical-replay.mjs'];
const controllerFiles={};for(const name of controllers){const raw=source(name);controllerFiles[name]=sha(raw);output(name,raw);}
for(const name of ['deploy/scripts/run-independent-full-restore-controller.py','scripts/lib/independent-full-restore-ssh.mjs','scripts/lib/independent-wal-window-ssh.mjs','tests/online-deployment/independent-full-restore-ssh.fixture.py','tests/online-deployment/independent-image-transfer.fixture.py'])output(name,source(name));
const workers={
  'online-qualification-public-key.pem':'deploy/trust/online-qualification-public-key.pem',
  'independent-wal-window.worker.cjs':'tests/online-deployment/independent-wal-window.worker.cjs',
  'independent-wal-window-controller.py':'tests/online-deployment/independent-wal-window-controller.fixture.py',
  'postgres-recovery-coverage.mjs':'scripts/postgres-recovery-coverage.mjs',
  'independent-image-transfer.py':'tests/online-deployment/independent-image-transfer.fixture.py',
  'online-runtime-owner.py':'deploy/scripts/online-runtime-owner.py','online-runtime-scope.py':'deploy/scripts/online-runtime-scope.py',
  'backend-runtime-owner.py':'deploy/scripts/backend-runtime-owner.py','online-capture-admission.py':'deploy/scripts/online-capture-admission.py',
  'original-host-controller-channel.py':'tests/online-deployment/original-host-controller-channel.fixture.py',
  'private-qualification-observer.py':'tests/online-deployment/independent-private-qualification-observer.fixture.py',
  'private-qualification-materialize.py':'tests/online-deployment/independent-private-qualification-materialize.fixture.py',
  'independent-image-stage.py':'tests/online-deployment/independent-image-stage.fixture.py',
  'independent-image-decrypt.worker.cjs':'tests/online-deployment/independent-image-decrypt.worker.cjs',
  'independent-online-components.worker.cjs':'tests/online-deployment/independent-online-components.worker.cjs',
  'independent-online-layout.py':'tests/online-deployment/independent-online-layout.fixture.py',
  'online-checkpoint-coverage.py':'deploy/scripts/online-checkpoint-coverage.py',
  'recovery-versioned-files.py':'deploy/scripts/recovery-versioned-files.py',
  'capture-coordination-history.py':'deploy/scripts/capture-coordination-history.py',
  'materialize-private-image.py':'deploy/scripts/materialize-private-image.py',
  'private-qualification-bootstrap.sql':'tests/online-deployment/private-qualification-bootstrap.fixture.sql',
  'independent-private-runtime.py':'tests/online-deployment/independent-private-runtime.fixture.py',
  'independent-restored-baseline.worker.cjs':'tests/online-deployment/independent-restored-baseline.worker.cjs',
  'independent-next-runtime.py':'tests/online-deployment/independent-next-runtime.fixture.py',
  'online-inquiry-owner.py':'deploy/scripts/online-inquiry-owner.py','inquiry-requested-stop.py':'tests/online-deployment/inquiry-requested-stop.fixture.py',
  'verify-inquiry-database.cjs':'deploy/scripts/verify-inquiry-database.cjs','inquiry-baseline.json':'backend/src/services/inquiryBaseline.json',
};
for(const [name,origin]of Object.entries(workers)){const raw=source(origin);sourcePins[name]=sha(raw);output('bundle/'+name,raw);}
const require=createRequire(path.join(repository,'backend/package.json')),esbuild=require('esbuild');
const codecName='backend/src/services/recoveryCrypto.ts';source(codecName);
const codecBuild=await esbuild.build({absWorkingDir:repository,entryPoints:[codecName],bundle:true,platform:'node',packages:'external',format:'cjs',target:'node18',write:false,metafile:true,logLevel:'silent'});
assert.deepEqual(Object.keys(codecBuild.metafile.inputs),[codecName]);
const codec=Buffer.from(codecBuild.outputFiles[0].contents);output('bundle/recoveryCrypto.cjs',codec);sourcePins['recoveryCrypto.cjs']=sha(codec);
const inputs=['tests/online-deployment/online-private-qualification-native.worker.ts','tests/online-deployment/online-private-qualification-control.fixture.ts'];
const built=await esbuild.build({absWorkingDir:repository,entryPoints:[inputs[0]],bundle:true,platform:'node',packages:'external',format:'cjs',target:'node18',write:false,metafile:true,logLevel:'silent',
  plugins:[{name:'fixed-two-input-wrapper',setup(build){build.onLoad({filter:/.*/,namespace:'file'},args=>{
    const name=path.relative(repository,args.path).split(path.sep).join('/');assert.ok(inputs.includes(name));
    return {contents:source(name),loader:'ts',resolveDir:path.dirname(args.path)};
  });}}]});
assert.deepEqual(Object.keys(built.metafile.inputs).sort(),inputs.slice().sort());
const compiled=Buffer.from(built.outputFiles[0].contents);output('bundle/online-private-qualification-worker.cjs',compiled);sourcePins['online-private-qualification-worker.cjs']=sha(compiled);
// A source-side reference inventory helps the ORIGINAL remote worker compare
// the installed immutable image. It does not prove what is installed remotely.
const inquiryReceipt=selectedInquiry.value;
const runtimeRoot=path.join(inquiryReceipt.directory,'online-runtime'),runtimeFiles={};
function walk(directory,prefix=''){assert.equal(fs.realpathSync(directory),directory);for(const name of fs.readdirSync(directory).sort()){
  const file=path.join(directory,name),stat=fs.lstatSync(file);assert.ok(!stat.isSymbolicLink());
  if(stat.isDirectory())walk(file,prefix+name+'/');else{assert.ok(stat.isFile()&&stat.nlink===1);runtimeFiles[prefix+name]=sha(fs.readFileSync(file));}}}
walk(fs.realpathSync(runtimeRoot));
const canonical=Object.fromEntries(Object.keys(runtimeFiles).sort().map(name=>[name,runtimeFiles[name]]));
output('inquiry-runtime-reference.json',Buffer.from(JSON.stringify({format:'sabalan-independent-inquiry-runtime-reference/v1',installedVerification:false,image:inquiryReceipt.image,
  archiveSha256:inquiryReceipt.archiveSha256,runtimeSourceHashes:inquiryReceipt.runtimeSourceHashes,runtimeFiles:canonical,runtimeBundleSha256:sha(Buffer.from(JSON.stringify(canonical)+'\n')),
  imageReceiptSha256:selectedInquiry.sha256,nativeImageArchiveReceiptSha256:selectedInquiryArchive.sha256,nativeImageArchive:selectedInquiryArchive.value},null,2)+'\n'));
output('inquiry-image-receipt.json',selectedInquiry.raw);output('inquiry-native-image-archive-receipt.json',selectedInquiryArchive.raw);
for(const [name,digest]of Object.entries(sourceInventory))assert.equal(sha(fs.readFileSync(path.join(repository,name))),digest);
for(const [file,digest]of Object.entries(externalInputInventory))assert.equal(sha(fs.readFileSync(file)),digest);
const manifest={format:'sabalan-independent-full-restore-source-preparation/v1',destination,productionAdmission:false,remoteExecuted:false,esbuildVersion:esbuild.version,
  controllerFiles,sourcePins,sourceInventory,externalInputInventory,outputInventory};
output('preparation.json',Buffer.from(JSON.stringify(manifest,null,2)+'\n'));
console.log(JSON.stringify({destination,preparationSha256:outputInventory['preparation.json'],files:Object.keys(outputInventory).length,remoteExecuted:false,productionAdmission:false}));
