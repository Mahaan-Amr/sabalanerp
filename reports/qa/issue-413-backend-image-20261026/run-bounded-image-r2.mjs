/** One bounded image/archive producer. No compiler, materializer or service action. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash, randomUUID} from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import {createGzip} from 'node:zlib';
const repo = path.resolve(import.meta.dirname, '../../..');
const evidence = import.meta.dirname;
const resultFile = path.join(evidence,'BOUNDED-IMAGE-RESULT-R2.json');
assert.ok(!fs.existsSync(resultFile),'IMMUTABLE_IMAGE_ATTEMPT_ALREADY_EXISTS');
const qa = 'D:/sabalanerp-online-qa';
const python = 'C:/Users/mahan/AppData/Local/Programs/Python/Python314/python.exe';
const source = 'c3b7e4fcf88f5e2c3c54ae71dc5c593844d59b14';
const load = relative => import(pathToFileURL(path.join(repo, relative)));
const {acquireSerialHostLease} = await load('scripts/lib/serial-physical/host-lease.mjs');
const {originalBackendBaseCommands} = await load('scripts/lib/production-backend-base-process.mjs');
const {backendBaseLocalGuards, backendBaseLocalCapacity} = await load('scripts/lib/production-backend-base-local-guard.mjs');
const {stableBackendBaseFile} = await load('scripts/lib/production-backend-base-artifacts.mjs');
const {inspectPrivateDockerArchive} = await load('scripts/lib/private-docker-image-archive.mjs');
const {imageInspectionIdentity} = await load('scripts/lib/image-inspection-identity.mjs');
const sha = raw => createHash('sha256').update(raw).digest('hex');
const ref = file => ({file, ...(({bytes, sha256}) => ({bytes, sha256}))(stableBackendBaseFile(file))});
const save = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2)+'\n', {flag:'wx', mode:0o600});
const commands = originalBackendBaseCommands();
const guards = backendBaseLocalGuards(commands);
const history = [];
async function run(executable, args) {
  const result = await commands.run(executable, args, {cwd:repo});
  history.push({executable, args, ...result});
  commands.assertSuccessful(result);
  return result.stdout;
}
const report = {format:'sabalan-413-bounded-image-archive/v1', pass:false, sourceCommit:source,
  productionAdmission:false, install:false, deploy:false, FULL:false, master10:false, push:false};
let lease, failure;
try {
  lease = await acquireSerialHostLease(qa+'/deployment.lock');
  report.lease = {file:qa+'/deployment.lock', originalPid:lease.originalPid, competingOriginalRefused:false};
  lease.assertHeld();
  await assert.rejects(acquireSerialHostLease(qa+'/deployment.lock'), /SERIAL_LEASE_BUSY_OR_UNAVAILABLE/);
  report.lease.competingOriginalRefused = true;
  report.servicesBefore = await guards.protectedIdentities();
  report.capacityBefore = backendBaseLocalCapacity({rawBytes:540220928});
  const previous = JSON.parse(fs.readFileSync(path.join(repo,'reports/qa/issue-413-build-repair-20261025/RECEIPT.json')));
  const priorReceipt = ref(path.join(repo,'reports/qa/issue-413-build-repair-20261025/RECEIPT.json'));
  assert.equal(priorReceipt.sha256,'8a2d78d638ed804298ca32605239ab46293ea1129c0aecbe79cfa78105b3077d');
  assert.deepEqual(ref(previous.compiler.receipt.file), previous.compiler.receipt);
  assert.deepEqual(ref(previous.material.receipt.file), previous.material.receipt);
  report.reusedCompiler = previous.compiler.receipt;
  report.reusedMaterial = previous.material.receipt;
  const preflightProducer = JSON.parse(fs.readFileSync(path.join(evidence,'preflight-producer-r2-reference.json')));
  assert.equal(ref(preflightProducer.file).sha256,preflightProducer.sha256,'PREFLIGHT_PRODUCER_CHANGED');
  report.preflightProducer = preflightProducer;
  const r8Review = qa+'/C30-source-a-fixed-existing-gzip-stream-source-r8-third-restart-20261025/source-review.json';
  assert.equal(ref(r8Review).sha256,'ab3288dcdc1b241fd3fad38bed0d49a57d83993d1235a5c35b0dd6a59cc85023');
  for (const row of Object.values(JSON.parse(fs.readFileSync(r8Review)).files)) assert.equal(ref(row.file).sha256,row.sha256);
  report.reviewedR8Inputs = ref(r8Review);
  // Observe actual current production state with the existing finite read-only owner.
  const baseline = JSON.parse((await run(python, ['-I','-B',qa+'/C29-installed45cab-healthy-baseline-source-r2-exact-bytes-20261024/run-baseline-observer.py',
    '--observe-reviewed','--installation',qa+'/offline-source-install-original-20261024T161731966906Z.json',
    '--installation-sha256','4ce668432ad3a82b3b1224ecc7305c1c734e9862d2bc64d1040c9073940676f3',
    '--installation-original-sha256','77f249b57bee1e92799e5b2a2b9d0bc4419f5a73ab0b76efd540dc54f026eb19'])).trim());
  assert.equal(baseline.qualified,true);
  report.freshBaseline = baseline;
  lease.assertHeld();
  const preparation = JSON.parse((await run(python, ['-I','-B',preflightProducer.file,baseline.file,baseline.sha256])).trim());
  assert.equal(ref(preparation.source.file).sha256, preparation.source.sha256);
  report.preflightPreparation = preparation;
  const preflightResult = JSON.parse((await run(python, ['-I','-B',preparation.source.file,'--execute-reviewed'])).trim());
  // This producer prints its new report path; no old report grants freshness.
  const preflightPath = preflightResult.report ?? preflightResult.file;
  assert.ok(typeof preflightPath === 'string', 'ACTUAL_PREFLIGHT_PATH_REQUIRED');
  report.freshPreflight = ref(preflightPath);
  lease.assertHeld();
  const built = JSON.parse((await run(process.execPath, [path.join(evidence,'build-backend-image.mjs'),'--build',previous.material.receipt.file,
    'production-backend-base-local-552130ef718c951043eec3d57aad761b.json',preflightPath])).trim());
  assert.equal(built.pass,true);
  report.imageReceipt = ref(built.receipt);
  const image = JSON.parse(fs.readFileSync(built.receipt));
  assert.equal(image.sourceCommit,source); assert.equal(image.materialReceiptSha256,previous.material.receipt.sha256);
  report.image = image.image;
  report.imageStore = JSON.parse(await guards.docker(['info','--format','{"driver":{{json .Driver}},"driverStatus":{{json .DriverStatus}},"id":{{json .ID}}}']));
  const inspected = JSON.parse(await guards.docker(['image','inspect',image.image.id]));
  assert.deepEqual(imageInspectionIdentity(inspected),image.image);
  const size = inspected[0].Size;
  assert.ok(Number.isSafeInteger(size) && size>0);
  const required = 4*(size+32*1024**2)+128*1024**2;
  const space = fs.statfsSync(qa,{bigint:true}), available = space.bavail*space.bsize;
  assert.ok(available>=BigInt(required),'LOCAL_EXPORT_MEASURED_SCRATCH_SPACE');
  report.archiveCapacity = {imageSizeBytes:size, requiredBytes:required, availableBytes:String(available)};
  const directory = path.join(qa,'ticket413-backend-image-archive-'+randomUUID().replaceAll('-',''));
  fs.mkdirSync(directory,{mode:0o700});
  report.archiveDirectory = directory;
  const raw = path.join(directory,'backend.oci.tar'), gzip = path.join(directory,'backend.docker.tar.gz');
  assert.ok(!fs.existsSync(raw) && !fs.existsSync(gzip));
  lease.assertHeld();
  await guards.docker(['image','save','--output',raw,image.image.id]);
  let fd = fs.openSync(raw,'r+'); try {fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
  const graph = inspectPrivateDockerArchive(raw,image.image.id);
  assert.deepEqual(graph.rootfsDiffIds,image.image.layers);
  await pipeline(fs.createReadStream(raw),createGzip({level:6}),fs.createWriteStream(gzip,{flags:'wx',mode:0o600}));
  fd = fs.openSync(gzip,'r+'); try {fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
  report.rawArchive = ref(raw); report.compressedArchive = ref(gzip); report.archiveGraph = graph;
  const measureFile = path.join(repo,'deploy/scripts/materialize-private-image.py');
  report.graphMeasurer = ref(measureFile);
  const probe = "import hashlib,importlib.util,json,sys;p=sys.argv[1];assert hashlib.sha256(open(p,'rb').read()).hexdigest()==sys.argv[2];s=importlib.util.spec_from_file_location('fixed_original_measure',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);print(json.dumps(m.measure(*sys.argv[3:8],maximum_layer_bytes=int(sys.argv[8]),maximum_image_bytes=int(sys.argv[9]))))";
  const measured = JSON.parse(await run(python,['-I','-B','-c',probe,measureFile,report.graphMeasurer.sha256,
    gzip,report.compressedArchive.sha256,graph.index,graph.platform,graph.config,String(size),String(size)]));
  assert.equal(measured.expandedLayerIdentityVerified,true);
  assert.deepEqual(measured.layers.map(row=>row.diffId),graph.rootfsDiffIds);
  save(path.join(directory,'expanded-graph-proof.json'),measured);
  report.expandedGraphProof = ref(path.join(directory,'expanded-graph-proof.json'));
  report.servicesAfter = await guards.protectedIdentities();
  assert.deepEqual(report.servicesAfter,report.servicesBefore);
  assert.deepEqual(imageInspectionIdentity(JSON.parse(await guards.docker(['image','inspect',image.image.id]))),image.image);
  assert.deepEqual(ref(previous.compiler.receipt.file),previous.compiler.receipt);
  assert.deepEqual(ref(previous.material.receipt.file),previous.material.receipt);
  report.capacityAfter = backendBaseLocalCapacity({rawBytes:540220928});
  lease.assertHeld(); report.pass = true;
} catch (error) { failure=error; report.error={name:error.name,message:String(error.message).slice(0,2000)}; }
finally {
  report.commands = history;
  report.originalChildren = await commands.close();
  if (report.originalChildren.interrupted) {report.pass=false; failure??=Error('ORIGINAL_INTERRUPTED');}
  try {
    if (lease) {await lease.release(); report.lease.closed=true; report.lease.acknowledgement='LEASE_CLOSED';}
  } catch (error) {
    report.pass=false; failure??=error;
    report.lease.closed=false; report.lease.acknowledgement='UNKNOWN';
    report.lease.closureError={name:error.name,message:String(error.message).slice(0,1000)};
  } finally {
    report.producer = ref(import.meta.filename);
    save(resultFile,report);
  }
}
console.log(JSON.stringify({pass:report.pass,receipt:path.join(evidence,'BOUNDED-IMAGE-RESULT-R2.json'),image:report.image?.id}));
if (failure) throw failure;
