import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import {revalidateFrontendSourceProvenance,frontendPackageOutputs} from './lib/frontend-source-provenance.mjs';
import { imageInspectionIdentity } from './lib/image-inspection-identity.mjs';
import { qualifiedFrontendRuntimeBase } from './lib/production-frontend-base-artifacts.mjs';
import { frozenUiRepackagingFormat, assertFrozenUiRepackaging } from './lib/frozen-ui-repackaging.mjs';

// Diagnostic image construction only. The unique mutable base tag is a local
// BuildKit input, never a rollback/release identity. Nothing is pruned/replaced.
const repository = path.resolve(import.meta.dirname, '..');
const qaRoot = path.resolve('D:/sabalanerp-online-qa');
const args = process.argv.slice(2);
let mode = '--inspect', materialName = 'current-frontend-bundle-e1c4ea205818116fa0c550dae3328d39.json';
let modeSeen = false, materialSeen = false;
for (let index = 0; index < args.length; index++) {
  const key = args[index];
  if (key === '--inspect' || key === '--build') {
    assert.equal(modeSeen, false, 'Specify one mode'); modeSeen = true; mode = key;
  } else if (key === '--materialization-report') {
    assert.equal(materialSeen, false); materialSeen = true; materialName = args[++index];
    assert.match(materialName, /^current-frontend-bundle-[a-f0-9]{32}\.json$/);
  } else throw Error('Use --inspect|--build [--materialization-report current-frontend-bundle-<32hex>.json]');
}
const materialPath = path.join(repository, 'reports/qa', materialName);
const priorPath = path.join(repository, 'reports/qa/current-frontend-image-5817d0e5d6444c5aa800c8049e2f22e9.json');
const dockerfile = path.join(repository, 'tests/online-deployment/Dockerfile.retained-ui');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const safeIdentity = value => Object.fromEntries(['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'nlink', 'mode']
  .map(key => [key, String(value[key])]));
function fileHash(file) {
  assert.equal(fs.realpathSync(file), path.resolve(file));
  const named = fs.lstatSync(file, { bigint: true }); assert.ok(named.isFile() && !named.isSymbolicLink() && named.nlink === 1n);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const before = fs.fstatSync(fd, { bigint: true });
    const cross = value => Object.fromEntries(Object.entries(safeIdentity(value)).filter(([key]) => process.platform !== 'win32' || key !== 'dev'));
    assert.deepEqual(cross(before), cross(named)); assert.ok(before.size <= 256n * 1024n ** 2n);
    const digest = createHash('sha256'), buffer = Buffer.alloc(262144); let count = 0;
    for (;;) { const n = fs.readSync(fd, buffer, 0, buffer.length, null); if (!n) break;
      count += n; assert.ok(count <= Number(before.size)); digest.update(buffer.subarray(0, n)); }
    assert.equal(count, Number(before.size));
    assert.deepEqual(safeIdentity(fs.fstatSync(fd, { bigint: true })), safeIdentity(before));
    assert.deepEqual(safeIdentity(fs.lstatSync(file, { bigint: true })), safeIdentity(named));
    return digest.digest('hex');
  } finally { fs.closeSync(fd); }
}
function inputs() {
  const materialSha256 = fileHash(materialPath), priorSha256 = materialSeen ? null : fileHash(priorPath);
  if (!materialSeen) {
    assert.equal(materialSha256, '4c5129ba622670f1252adedb7f52648c44ea4f0177e8832f57a2778126a2ebf4');
    assert.equal(priorSha256, '80f8d1c44302a5d49f2c7cc65a75b47e61f1381046ec8d79fc5d9b6a4ff05dfe');
  }
  const material = JSON.parse(fs.readFileSync(materialPath)), prior = materialSeen ? null : JSON.parse(fs.readFileSync(priorPath));
  assert.ok(['sabalan-current-frontend-materialization/v1', frozenUiRepackagingFormat].includes(material.format));
  if (material.format === frozenUiRepackagingFormat) assertFrozenUiRepackaging(repository, material);
  if (materialSeen) {
    assert.equal(material.sourceUnchanged, true);
    assert.equal(material.contextInventorySha256, sha(Buffer.from(JSON.stringify(material.contextInventory))));
  }
  if(material.source.sourceCommit){const buildFile=path.join(repository,'reports/qa/frontend-final-build-'+material.source.operation+'.json'),buildRaw=fs.readFileSync(buildFile),build=JSON.parse(buildRaw);assert.equal(sha(buildRaw),material.source.buildReceipt.sha256);assert.equal(build.sourceCommit,material.source.sourceCommit);revalidateFrontendSourceProvenance(repository,build.sourceProvenance);assert.equal(sha(Buffer.from(JSON.stringify(build.sourceProvenance))),material.source.sourceProvenanceSha256);assert.deepEqual(frontendPackageOutputs(repository),build.packageBuild.outputs);}else assert.equal(mode,'--inspect','COMMITTED_FRONTEND_SOURCE_REQUIRED');
  assert.equal(material.phase, 'COMPLETE'); assert.equal(material.exactCopiedBytesVerified, true);
  if (material.source.runtimeBase) {
    assert.match(material.source.buildBaseImage, /^sha256:[a-f0-9]{64}$/);
    assert.deepEqual(qualifiedFrontendRuntimeBase(repository, material.source.runtimeBase.receipt), material.source.runtimeBase);
    assert.equal(material.source.baseImage, material.source.runtimeBase.baseImage);
  }
  if (prior) { assert.equal(prior.pass, false); assert.equal(prior.materializationReceiptSha256, materialSha256); }
  const context = path.resolve(material.context); assert.equal(fs.realpathSync(context), context);
  assert.equal(path.dirname(path.dirname(context)), qaRoot);
  const manifestSha256 = fileHash(path.join(context, 'online-runtime-manifest.json'));
  assert.equal(manifestSha256, material.bundle.manifestSha256);
  const manifest = JSON.parse(fs.readFileSync(path.join(context, 'online-runtime-manifest.json')));
  assert.equal(manifest.format, 'sabalan-diagnostic-ui-bundle/v1');
  assert.equal(manifest.baseImage, material.source.baseImage); assert.equal(manifest.buildId, material.bundle.buildId);
  const runtime = Object.fromEntries(material.source.files.map(file => [file.relative.startsWith(material.source.dist + '/')
    ? 'runtime/' + file.relative.slice(material.source.dist.length + 1) : file.relative, file.sha256]));
  const expected = { ...runtime, 'online-runtime-manifest.json': manifestSha256,
    'online-runtime-verify.cjs': (prior?.contextInventory ?? material.contextInventory)['online-runtime-verify.cjs'] };
  assert.deepEqual(expected, prior?.contextInventory ?? material.contextInventory, 'Exact independently prepared context custody is required');
  const actual = {}; let count = 0, bytes = 0;
  const visit = (directory, prefix = '') => {
    const before = fs.lstatSync(directory, { bigint: true });
    assert.ok(before.isDirectory() && !before.isSymbolicLink()); assert.equal(fs.realpathSync(directory), directory);
    for (const name of fs.readdirSync(directory).sort()) {
      const relative = prefix + name, target = path.join(directory, name), value = fs.lstatSync(target);
      assert.ok(!value.isSymbolicLink());
      if (value.isDirectory()) visit(target, relative + '/');
      else { assert.ok(value.isFile()); assert.ok(++count <= 20000); bytes += value.size; assert.ok(bytes <= 256 * 1024 ** 2); actual[relative] = fileHash(target); }
    }
    assert.deepEqual(safeIdentity(fs.lstatSync(directory, { bigint: true })), safeIdentity(before));
  };
  visit(context); assert.deepEqual(actual, expected);
  assert.equal(manifest.files.length, material.bundle.runtimeFiles);
  for (const file of manifest.files) {
    const relative = file.path.startsWith('.next-online-runtime/') ? 'runtime/' + file.path.slice('.next-online-runtime/'.length) : file.path;
    assert.equal(actual[relative], file.sha256); assert.equal(fs.statSync(path.join(context, relative)).size, file.bytes);
  }
  const dockerfileSha256 = fileHash(dockerfile);
  assert.equal(dockerfileSha256, 'e63bec05aa63d72e512c3e28a8243421d929869c29d0ddf80457737ed5610917');
  assert.equal(fileHash(materialPath), materialSha256); if (prior) assert.equal(fileHash(priorPath), priorSha256);
  return { sourceCommit:material.source.sourceCommit??null, context, contextInventory: actual, contextInventorySha256: sha(Buffer.from(JSON.stringify(actual))),
    materializationReceipt: materialName, materializationReceiptSha256: materialSha256, priorFailedReceiptSha256: priorSha256,
    dockerfile, dockerfileSha256, buildId: manifest.buildId, manifestSha256,
    baseImage: manifest.baseImage, baseLayers: prior?.base.layers ?? null, files: count, bytes,
    helperSha256: fileHash(import.meta.filename),
    imageInspectionParserSha256: fileHash(path.join(repository, 'scripts/lib/image-inspection-identity.mjs')) };
}

const before = inputs();
if (mode !== '--build') {
  console.log(JSON.stringify({ mode: 'inspect', ...Object.fromEntries(Object.entries(before).filter(([key]) => key !== 'contextInventory')),
    dockerExecuted: false, productionAdmission: false }));
} else {
  assert.equal(fs.realpathSync(qaRoot), qaRoot);
  const operation = randomBytes(16).toString('hex'), root = path.join(qaRoot, 'current-frontend-image-' + operation);
  const iidFile = path.join(root, 'image.iid'), baseTag = 'sabalan-online-build-base:' + operation;
  const outputTag = 'sabalan-online-diagnostic-current:' + operation;
  const evidence = path.join(repository, 'reports/qa/current-frontend-image-' + operation);
  fs.mkdirSync(root, { mode: 0o700 });
  const report = { format: 'sabalan-current-frontend-image-build/v2', operation, phase: 'INTENT', startedAt: new Date().toISOString(),
    ...before, root, iidFile, baseTag, outputTag, productionAdmission: false, wholeReleaseQualification: false,
    tagIsBuildInputOnly: true, imageQualified: false, outputImage: null };
  const publish = (suffix, value) => {
    const file = evidence + suffix + '.json', fd = fs.openSync(file, 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  };
  publish('-intent', report);
  const services = ['backend', 'backend-candidate', 'backend-retained', 'frontend', 'inquiry', 'postgres', 'redis', 'clamav', 'frontend-candidate', 'frontend-retained'];
  const compose = ['compose', '-f', 'D:/sabalanerp/docker-compose.local.yml'];
  function healthy() {
    const result = spawnSync('docker', [...compose, 'ps', '--format', 'json'], { encoding: 'utf8', maxBuffer: 8 * 1024 ** 2 });
    assert.equal(result.status, 0, 'Existing Compose identity check failed');
    let rows; try { const data = JSON.parse(result.stdout); rows = Array.isArray(data) ? data : [data]; }
    catch { rows = result.stdout.trim().split(/\r?\n/).flatMap(line => JSON.parse(line)); }
    for (const service of services) assert.ok(rows.some(row => row.Project === 'sabalanerp-local' && row.Service === service
      && row.State === 'running' && row.Health === 'healthy'), 'Existing service unhealthy: ' + service);
    return rows;
  }
  function docker(command) {
    healthy();
    return spawnSync('docker', command, { encoding: 'utf8', maxBuffer: 8 * 1024 ** 2 });
  }
  function inspectImage(name) {
    const result = docker(['image', 'inspect', name]);
    assert.equal(result.status, 0, 'Immutable image inspection failed');
    return imageInspectionIdentity(JSON.parse(result.stdout));
  }
  function absentImage(name) {
    const result = docker(['image', 'inspect', '--format', '{{json .Id}}', name]);
    assert.equal(result.status, 1); assert.match(result.stderr, /No such image:/i);
  }
  function identities() {
    const rows = healthy(), observed = {};
    for (const service of services) {
      const name = rows.find(row => row.Service === service).Name;
      const result = docker(['inspect', '--format', '{"id":{{json .Id}},"image":{{json .Image}},"startedAt":{{json .State.StartedAt}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},"service":{{json (index .Config.Labels "com.docker.compose.service")}}}', name]);
      assert.equal(result.status, 0); const value = JSON.parse(result.stdout);
      assert.equal(value.project, 'sabalanerp-local'); assert.equal(value.service, service); observed[service] = value;
    }
    return observed;
  }
  let failure;
  try {
    report.servicesBefore = identities(); report.base = inspectImage(before.baseImage);
    assert.equal(report.base.id, before.baseImage); if (before.baseLayers !== null) assert.deepEqual(report.base.layers, before.baseLayers);
    assert.deepEqual(Object.keys(report.base.volumes ?? {}), []);
    absentImage(baseTag); absentImage(outputTag);
    const tagged = docker(['tag', before.baseImage, baseTag]); assert.equal(tagged.status, 0);
    assert.deepEqual(inputs(), before); assert.equal(fs.existsSync(iidFile), false);
    assert.deepEqual(inspectImage(baseTag), report.base);
    healthy(); // The very next Docker action is the build; no state mutation between these checks.
    const stdoutPath = path.join(root, 'stdout.log'), stderrPath = path.join(root, 'stderr.log');
    const out = fs.openSync(stdoutPath, 'wx', 0o600), err = fs.openSync(stderrPath, 'wx', 0o600);
    let build;
    try {
      build = await new Promise(resolve => {
        const child = spawn('docker', ['build', '--pull=false', '--network=none', '--progress=plain', '--file', dockerfile,
          '--build-arg', 'DIAGNOSTIC_BASE=' + baseTag, '--label', 'io.sabalan.performance.source-commit='+before.sourceCommit, '--iidfile', iidFile, '--tag', outputTag, before.context], { stdio: ['ignore', out, err] });
        let spawnError; child.once('error', error => { spawnError = error.code || 'DOCKER_BUILD_SPAWN_FAILED'; });
        child.once('close', (code, signal) => resolve({ code, signal, spawnError }));
      });
    } finally { fs.fsyncSync(out); fs.fsyncSync(err); fs.closeSync(out); fs.closeSync(err); }
    report.build = { ...build, stdoutPath, stderrPath, stdoutSha256: fileHash(stdoutPath), stderrSha256: fileHash(stderrPath),
      iidFilePresent: fs.existsSync(iidFile), imageQualified: false, outputImage: null };
    publish('-build-result', report.build); // Preserve build outcome/log custody BEFORE any postcheck can fail.
    assert.deepEqual(inspectImage(baseTag), report.base);
    assert.deepEqual(inputs(), before);
    report.servicesAfter = identities(); assert.deepEqual(report.servicesAfter, report.servicesBefore);
    assert.equal(build.code, 0); assert.equal(build.signal, null); assert.equal(build.spawnError, undefined);
    const iidHash = fileHash(iidFile), iid = fs.readFileSync(iidFile, 'utf8').trim(); assert.match(iid, /^sha256:[a-f0-9]{64}$/);
    const image = inspectImage(iid); assert.equal(image.id, iid); assert.notEqual(image.id, before.baseImage);
    assert.deepEqual(inspectImage(outputTag), image);
    assert.deepEqual(image.layers.slice(0, report.base.layers.length), report.base.layers);
    assert.equal(image.labels?.['io.sabalan.online-acceptance'], 'retained-ui'); assert.deepEqual(Object.keys(image.volumes ?? {}), []);
    assert.equal(image.labels?.['io.sabalan.performance.source-commit'],before.sourceCommit);
    Object.assign(report, { phase: 'COMPLETE', pass: true, imageQualified: true, outputImage: image, iidSha256: iidHash });
  } catch (error) { failure = error; Object.assign(report, { phase: 'FAILED_HELD', pass: false,
    error: error instanceof Error ? error.message : 'IMAGE_BUILD_FAILED', imageQualified: false, outputImage: null }); }
  publish('', report);
  console.log(JSON.stringify({ phase: report.phase, evidence: evidence + '.json', operation, image: report.outputImage?.id ?? null,
    productionAdmission: false }));
  if (failure) throw failure;
}
