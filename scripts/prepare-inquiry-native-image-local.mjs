import assert from 'node:assert/strict';
import { inspectPrivateDockerArchive } from './lib/private-docker-image-archive.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';

const root = path.resolve(import.meta.dirname, '..');
assert.equal(process.argv.length, 3, 'Supply the successful private Inquiry build report');
const reportFile = fs.realpathSync(process.argv[2]), build = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
assert.equal(path.dirname(reportFile), path.join(root, 'reports/qa'));
assert.equal(build.format, 'sabalan-private-inquiry-build/v1');
assert.deepEqual(build.result, { code: 0, signal: null });
assert.match(build.directory, /^\/tmp\/sabalan-inquiry-build-[a-f0-9]{32}$/);
const canonical = process.env.SABALAN_LOCAL_REPOSITORY_ROOT || 'D:/sabalanerp';
const protectedServices = ['backend','frontend','postgres','inquiry','redis','clamav','backend-candidate','backend-retained','frontend-candidate','frontend-retained'];
function verify() {
  const output = execFileSync('docker', ['compose', '-f', path.join(canonical, 'docker-compose.local.yml'), 'ps', '--format', 'json'], { encoding: 'utf8' });
  let rows;
  try { const value = JSON.parse(output); rows = Array.isArray(value) ? value : [value]; }
  catch { rows = output.trim().split(/\r?\n/).map(line => JSON.parse(line)); }
  assert.equal(rows.length,protectedServices.length);
  for (const service of protectedServices) assert.ok(rows.some(row => row.Project === 'sabalanerp-local'
    && row.Service === service && row.State === 'running' && row.Health === 'healthy'));
  return rows;
}
function inspect(service) {
  const name = verify().find(row => row.Service === service).Name;
  return JSON.parse(execFileSync('docker', ['inspect', name], { encoding: 'utf8' }))[0];
}
const backend = inspect('backend'), inquiry = inspect('inquiry');
const before = Object.fromEntries(protectedServices.map(service=>{const value=inspect(service);return[service,{id:value.Id,image:value.Image,startedAt:value.State.StartedAt}];}));
assert.deepEqual(before,build.canonicalUnchanged);
for (const [service, value] of [['backend', backend], ['inquiry', inquiry]]) assert.deepEqual({ id: value.Id, image: value.Image, startedAt: value.State.StartedAt }, build.canonicalUnchanged[service]);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const materialSources=Object.fromEntries([
  'scripts/prepare-inquiry-native-image-local.mjs','scripts/build-inquiry-runtime-bundle.mjs',
  'scripts/lib/inquiry-dependency-identity.cjs','scripts/lib/private-docker-image-archive.mjs',
  'deploy/docker/inquiry-native.acceptance.Dockerfile','tests/online-deployment/inquiry-http-observer.fixture.cjs',
  ...['online-inquiry-owner.py','online-runtime-scope.py','backend-runtime-owner.py','online-capture-admission.py'].map(name=>'deploy/scripts/'+name),
  ...['onlineInquiryWork','onlineRuntimeScope','onlineCaptureAdmission','kernelWriteAdmission','runtimeBoundaryJournal','runtimeTaskAdmission','runtimeWorkContext'].map(name=>'backend/src/services/'+name+'.ts'),
].map(name=>[name,sha(fs.readFileSync(path.join(root,name)))]));
const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const inquiryCommit=execFileSync('git',['-C','apps/sabalan-inquiry','rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
assert.equal(execFileSync('git',['rev-parse','HEAD:apps/sabalan-inquiry'],{cwd:root,encoding:'utf8'}).trim(),inquiryCommit);
assert.equal(execFileSync('git',['-C','apps/sabalan-inquiry','status','--porcelain'],{cwd:root,encoding:'utf8'}).trim(),'');
for (const [file, hash] of Object.entries(build.sourceHashes)) assert.equal(sha(fs.readFileSync(path.join(root, 'apps/sabalan-inquiry', file))), hash, 'Source differs from the successful native build: ' + file);
const parent = 'D:/sabalanerp-online-qa'; fs.mkdirSync(parent, { recursive: true });
assert.equal(fs.realpathSync(parent).replaceAll('\\', '/').toLowerCase(), parent.toLowerCase());
const capacity = fs.statfsSync(parent, { bigint: true }); assert.ok(capacity.bavail * capacity.bsize > 2n * 1024n ** 3n);
verify();
const linuxFree = execFileSync('docker', ['exec', backend.Id, 'node', '-e',
  "const fs=require('fs'),s=fs.statfsSync('/',{bigint:true});console.log(String(s.bavail*s.bsize));"], { encoding: 'utf8', timeout: 10000 }).trim();
assert.ok(BigInt(linuxFree) > 2n * 1024n ** 3n);
const directory = path.join(parent, 'inquiry-native-image-' + randomBytes(16).toString('hex'));
fs.mkdirSync(directory);
fs.writeFileSync(path.join(directory, '.dockerignore'), 'base-image.docker.tar\nruntime-source\nbuild.log\nimage.json\n', { flag: 'wx' });
fs.copyFileSync(path.join(root, 'deploy/docker/inquiry-native.acceptance.Dockerfile'), path.join(directory, 'Dockerfile'));
const dependencyVerifier=fs.readFileSync(path.join(root,'scripts/lib/inquiry-dependency-identity.cjs'));
fs.writeFileSync(path.join(directory,'inquiry-dependency-identity.cjs'),dependencyVerifier,{flag:'wx'});
verify();
const dependencyIdentity=JSON.parse(execFileSync('docker',['exec',backend.Id,'node','-e',dependencyVerifier.toString('utf8')+'\nconsole.log(JSON.stringify(inquiryDependencyIdentity(process.argv[1])));',build.directory+'/node_modules'],{encoding:'utf8',timeout:120000,maxBuffer:16384}));
fs.writeFileSync(path.join(directory,'inquiry-dependency-identity.json'),JSON.stringify(dependencyIdentity),{flag:'wx'});
fs.copyFileSync(path.join(root, 'tests/online-deployment/inquiry-http-observer.fixture.cjs'), path.join(directory, 'native-http-observer.cjs'));
const source = path.join(directory, 'runtime-source'); fs.mkdirSync(source);
for (const name of ['onlineInquiryWork', 'onlineRuntimeScope', 'onlineCaptureAdmission', 'kernelWriteAdmission', 'runtimeBoundaryJournal', 'runtimeTaskAdmission', 'runtimeWorkContext']) fs.copyFileSync(path.join(root, 'backend/src/services', name + '.ts'), path.join(source, name + '.ts'));
fs.copyFileSync(path.join(root, 'deploy/scripts/online-runtime-scope.py'), path.join(source, 'online-runtime-scope.py'));
execFileSync(process.execPath, [path.join(root, 'scripts/build-inquiry-runtime-bundle.mjs'), source, path.join(directory, 'online-runtime')], { cwd: path.join(root, 'apps/sabalan-inquiry'), encoding: 'utf8' });
const scripts = path.join(directory, 'online-runtime/scripts'); fs.mkdirSync(scripts);
for (const file of ['online-inquiry-owner.py', 'online-runtime-scope.py', 'backend-runtime-owner.py', 'online-capture-admission.py']) fs.copyFileSync(path.join(root, 'deploy/scripts', file), path.join(scripts, file));
const names = [...new Set(['.next', ...Object.keys(build.sourceHashes).map(file => file.split('/')[0])])];
for (const name of names) assert.ok(/^[A-Za-z0-9_.-]+$/.test(name) && !name.startsWith('.env') && name !== 'node_modules');
verify();
const archiveFile = path.join(directory, 'inquiry-build.tar.gz');
const archive = fs.createWriteStream(archiveFile, { flags: 'wx' });
const archiveComplete = new Promise((resolve, reject) => { archive.once('error', reject); archive.once('finish', resolve); });
const reader = spawn('docker', ['exec', backend.Id, 'tar', '-C', build.directory, '--exclude=.next/cache', '-czf', '-', ...names], { stdio: ['ignore', 'pipe', 'pipe'] });
const readerComplete = new Promise((resolve, reject) => { reader.once('error', reject); reader.once('close', (code, signal) => resolve({ code, signal })); });
const hash = createHash('sha256'); let bytes = 0, errors = '';
reader.stdout.on('data', value => { hash.update(value); bytes += value.length; });
reader.stderr.on('data', value => { if (errors.length < 16384) errors += value.toString(); });
reader.stdout.pipe(archive);
const [readResult] = await Promise.all([readerComplete, archiveComplete]);
assert.deepEqual(readResult, { code: 0, signal: null }, errors);
assert.ok(bytes > 1024 && bytes < 256 * 1024 * 1024);
const archiveSha256 = hash.digest('hex');
verify();
const baseReference = 'sabalanerp-local-inquiry-base-qa:20261015-r1';
const base = JSON.parse(execFileSync('docker', ['image', 'inspect', baseReference], { encoding: 'utf8' }))[0];
const baseDigest = base.RepoDigests.find(value => value.startsWith('sabalanerp-local-inquiry-base-qa@sha256:')); assert.ok(baseDigest);
assert.equal(baseDigest.split('@')[1], base.Id);
verify();
const baseArchive = path.join(directory, 'base-image.docker.tar');
execFileSync('docker', ['image', 'save', '--output', baseArchive, base.Id], { encoding: 'utf8', timeout: 120000, maxBuffer: 16384 });
// The retained QA dependency image is a separate base from the still-running
// canonical Inquiry. Validate the actual saved OCI index/platform/config graph;
// neither a mutable canonical tag nor a same-version claim proves equivalence.
const verifiedBase = inspectPrivateDockerArchive(fs.realpathSync(baseArchive), base.Id);
const baseConfigId = verifiedBase.config, baseArchiveSha256 = verifiedBase.archiveSha256;
assert.deepEqual(verifiedBase.rootfsDiffIds, base.RootFS.Layers);
const tag = 'sabalanerp-online-inquiry-native:' + randomBytes(12).toString('hex');
verify();
const builder = spawn('docker', ['build', '--pull=false', '--build-arg', 'INQUIRY_NATIVE_ACCEPTANCE_BASE_IMAGE=' + baseDigest,
  '--label', 'io.sabalan.online-qa.archive-sha256=' + archiveSha256, '--tag', tag, directory], { stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
for (const stream of [builder.stdout, builder.stderr]) stream.on('data', value => {
  if (output.length < 2 * 1024 * 1024) { output += value.toString(); process.stdout.write(value); }
});
const built = await new Promise((resolve, reject) => { builder.once('error', reject); builder.once('close', (code, signal) => resolve({ code, signal })); });
fs.writeFileSync(path.join(directory, 'build.log'), output, { flag: 'wx' });
assert.deepEqual(built, { code: 0, signal: null });
verify();
const image = JSON.parse(execFileSync('docker', ['image', 'inspect', tag], { encoding: 'utf8' }))[0];
assert.equal(image.Config.Labels['io.sabalan.online-qa.archive-sha256'], archiveSha256);
assert.equal(image.Config.Labels['io.sabalan.online-qa'], 'inquiry-native-actions');
const receipt = { format: 'sabalan-inquiry-native-image-diagnostic/v1', directory, tag, image: image.Id,
  sourceCommit,inquirySourceCommit:inquiryCommit,browserDeploymentId:build.browserBuildId,
  dependencyIdentity,dependencyVerifierSha256:sha(dependencyVerifier),materialSources,
  diagnosticObserverSha256: sha(fs.readFileSync(path.join(directory, 'native-http-observer.cjs'))),
  runtimeSourceHashes: JSON.parse(fs.readFileSync(path.join(directory, 'online-runtime/source-hashes.json'), 'utf8')),
  sourceBuildDependencyImage: inquiry.Image, baseReference, baseIndexId: base.Id, baseConfigId, baseArchive, baseArchiveSha256,
  baseEquivalentToSourceBuildDependencies: true,
  buildReport: reportFile, buildReportSha256: sha(fs.readFileSync(reportFile)), archiveSha256,
  archiveBytes: bytes, productionReleaseAdmission: false, actualNativeActionAcceptance: false };
fs.writeFileSync(path.join(directory, 'image.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
const nativeArchive = path.join(directory, 'native-image.docker.tar');
verify();
execFileSync('docker', ['image', 'save', '--output', nativeArchive, image.Id], { encoding: 'utf8', timeout: 120000, maxBuffer: 16384 });
const verified = inspectPrivateDockerArchive(fs.realpathSync(nativeArchive), image.Id);
assert.deepEqual(verified.rootfsDiffIds, image.RootFS.Layers);
const imageReceipt = path.join(directory, 'image.json');
fs.writeFileSync(path.join(directory, 'native-image-archive.json'), JSON.stringify({
  format: 'sabalan-native-inquiry-image-archive/v1', imageReceipt, imageReceiptSha256: sha(fs.readFileSync(imageReceipt)),
  archive: nativeArchive, ...verified, blobsVerified: verified.blobs, productionAdmission: false, nativeActionAcceptance: false,
}, null, 2) + '\n', { flag: 'wx' });
const after=Object.fromEntries(protectedServices.map(service=>{const value=inspect(service);return[service,{id:value.Id,image:value.Image,startedAt:value.State.StartedAt}];}));
assert.deepEqual(after,before);
for(const[name,hash]of Object.entries(build.sourceHashes))assert.equal(sha(fs.readFileSync(path.join(root,'apps/sabalan-inquiry',name))),hash);
for(const[name,hash]of Object.entries(materialSources))assert.equal(sha(fs.readFileSync(path.join(root,name))),hash,'INQUIRY_MATERIAL_SOURCE_CHANGED: '+name);
assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),sourceCommit);
console.log(JSON.stringify(receipt));
