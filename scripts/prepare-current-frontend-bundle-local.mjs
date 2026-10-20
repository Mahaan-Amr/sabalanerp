import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { prepareRetainedUiBundle } from '../tests/online-deployment/retained-ui-bundle.fixture.mjs';
import {revalidateFrontendSourceProvenance,frontendPackageOutputs} from './lib/frontend-source-provenance.mjs';
import { qualifiedFrontendRuntimeBase } from './lib/production-frontend-base-artifacts.mjs';

// Local, diagnostic custody of this completed build only. No Docker, rebuild,
// service startup, release attestation or retry/adoption of a partial context.
const repository = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
let mode = '--inspect', operation = '5b4cc688a771e5a9', cleanupName = 'frontend-final-build-generated-config-cleanup-20261019.json';
let modeSeen = false, operationSeen = false, cleanupSeen = false;
let runtimeBaseReceipt = null;
for (let index = 0; index < args.length; index++) {
  const key = args[index];
  if (key === '--inspect' || key === '--materialize') {
    assert.equal(modeSeen, false, 'Specify one mode'); modeSeen = true; mode = key;
  } else if (key === '--operation') {
    assert.equal(operationSeen, false); operationSeen = true; operation = args[++index];
    assert.match(operation, /^[a-f0-9]{16}$/);
  } else if (key === '--cleanup-report') {
    assert.equal(cleanupSeen, false); cleanupSeen = true; cleanupName = args[++index];
    assert.match(cleanupName, /^[a-z0-9][a-z0-9.-]{1,150}\.json$/); assert.equal(path.basename(cleanupName), cleanupName);
  } else if (key === '--runtime-base-report') {
    assert.equal(runtimeBaseReceipt, null); runtimeBaseReceipt = args[++index];
    assert.match(runtimeBaseReceipt, /^production-frontend-base-local-[a-f0-9]{32}\.json$/);
  } else throw Error('Use --inspect|--materialize [--operation <16hex> --cleanup-report <receipt.json>]');
}
if (operationSeen || cleanupSeen) assert.ok(operationSeen && cleanupSeen, 'A fresh build requires its exact generated-selector cleanup receipt');
const qaRoot = path.resolve('D:/sabalanerp-online-qa');
const reportPath = path.join(repository, 'reports/qa/frontend-final-build-' + operation + '.json');
const cleanupPath = path.join(repository, 'reports/qa/' + cleanupName);
const fixturePath = path.join(repository, 'tests/online-deployment/retained-ui-bundle.fixture.mjs');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const identity = value => Object.fromEntries(['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'mode', 'nlink']
  .map(key => [key, String(value[key])]));
const limit = 256 * 1024 * 1024;

function stableFile(file) {
  assert.equal(fs.realpathSync(file), path.resolve(file));
  const namedBefore = fs.lstatSync(file, { bigint: true });
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const before = fs.fstatSync(fd, { bigint: true });
    assert.ok(before.isFile() && before.nlink === 1n && before.size <= BigInt(limit));
    // Windows reports a volume serial for fstat.dev but zero for lstat.dev.
    // Pin both independently; compare all remaining incarnation fields across
    // the named file and open handle instead of discarding either device fact.
    const namedIdentity = identity(namedBefore), handleIdentity = identity(before);
    const crossIdentity = value => Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'dev'));
    if (process.platform === 'win32') assert.deepEqual(crossIdentity(handleIdentity), crossIdentity(namedIdentity));
    else assert.deepEqual(handleIdentity, namedIdentity);
    const hash = createHash('sha256'), buffer = Buffer.alloc(262144); let bytes = 0;
    for (;;) {
      const count = fs.readSync(fd, buffer, 0, buffer.length, null); if (!count) break;
      bytes += count; assert.ok(bytes <= Number(before.size)); hash.update(buffer.subarray(0, count));
    }
    assert.equal(bytes, Number(before.size));
    assert.deepEqual(identity(fs.fstatSync(fd, { bigint: true })), identity(before));
    assert.deepEqual(identity(fs.lstatSync(file, { bigint: true })), namedIdentity);
    return { bytes, sha256: hash.digest('hex'), identity: { ...namedIdentity, descriptorDevice: handleIdentity.dev } };
  } finally { fs.closeSync(fd); }
}

function capture() {
  const reportIdentity = stableFile(reportPath), cleanupIdentity = stableFile(cleanupPath);
  const build = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const cleanup = JSON.parse(fs.readFileSync(cleanupPath, 'utf8'));
  assert.equal(build.format, 'sabalan-final-frontend-build/v1'); assert.equal(build.operation, operation);
  if(build.sourceCommit){assert.match(build.sourceCommit,/^[a-f0-9]{40}$/);assert.equal(build.sourceProvenance.sourceCommit,build.sourceCommit);revalidateFrontendSourceProvenance(repository,build.sourceProvenance);assert.equal(build.packageBuild.original.code,0);assert.equal(build.packageBuild.original.signal,null);assert.deepEqual(frontendPackageOutputs(repository),build.packageBuild.outputs);}else assert.equal(mode,'--inspect','COMMITTED_FRONTEND_SOURCE_REQUIRED');
  assert.equal(build.pass, true); assert.equal(build.code, 0); assert.equal(build.naturalChildClosure, true);
  assert.equal(cleanup.pass, true); assert.equal(cleanup.originalBuildReport, path.basename(reportPath));
  const frontend = path.join(repository, 'frontend');
  const sourceGuards = Object.fromEntries(Object.entries(build.sources).map(([name, expected]) => {
    assert.ok(['frontend/', 'packages/contract-product-graph/', 'packages/partner-sales-contracts/'].some(prefix => name.startsWith(prefix)) && !name.split('/').includes('..'));
    const current = stableFile(path.join(repository, name));
    if (name === 'frontend/tsconfig.json' && current.sha256 !== expected) {
      assert.equal(cleanup.files[name].afterSha256, current.sha256);
      assert.equal(cleanup.authoredCanonicalSelectorsRestored, true);
    } else assert.equal(current.sha256, expected, 'Successful build input changed: ' + name);
    return [name, current];
  }));
  const artifact = path.resolve(build.physicalTarget), artifactStat = fs.lstatSync(artifact, { bigint: true });
  assert.equal(artifact, path.join(qaRoot, 'frontend-build-workspace-' + operation, 'dist'));
  assert.equal(fs.realpathSync(artifact), artifact); assert.ok(artifactStat.isDirectory() && !artifactStat.isSymbolicLink());
  assert.equal(String(artifactStat.dev), build.targetIdentity.device); assert.equal(String(artifactStat.ino), build.targetIdentity.inode);
  assert.equal(path.resolve(build.logicalTarget), path.join(frontend, build.dist));
  assert.equal(fs.realpathSync(build.logicalTarget), artifact);
  assert.equal(fs.readFileSync(path.join(artifact, 'BUILD_ID'), 'utf8').trim(), build.buildId);
  const browser = JSON.parse(fs.readFileSync(path.join(artifact, 'browser-build-identity.json'), 'utf8'));
  assert.equal(browser.format, 'sabalan-browser-build/v1');
  assert.equal(browser.browserBuildId, build.buildId); assert.equal(browser.nativeBuildId, build.buildId);
  assert.match(build.dist, /^\.next-[a-zA-Z0-9_-]+$/);
  assert.equal(build.canonicalBefore.frontend.image, build.canonicalAfter.frontend.image);
  const files = [], directories = []; let total = 0;
  function visit(source, relative) {
    const before = fs.lstatSync(source, { bigint: true });
    assert.equal(fs.realpathSync(source), path.resolve(source)); assert.ok(!before.isSymbolicLink());
    if (before.isDirectory()) {
      directories.push({ source, relative }); assert.ok(directories.length <= 10000);
      for (const name of fs.readdirSync(source).sort()) visit(path.join(source, name), relative + '/' + name);
      assert.deepEqual(identity(fs.lstatSync(source, { bigint: true })), identity(before));
    } else {
      const observed = stableFile(source); total += observed.bytes;
      assert.ok(total <= limit && files.length < 20000);
      files.push({ source, relative, ...observed });
    }
  }
  directories.push({ source: artifact, relative: build.dist });
  const selected = fs.readdirSync(artifact).filter(name => ['server', 'static', 'BUILD_ID'].includes(name) || name.endsWith('.json')).sort();
  for (const required of ['server', 'static', 'BUILD_ID', 'browser-build-identity.json', 'required-server-files.json']) assert.ok(selected.includes(required));
  for (const name of selected) visit(path.join(artifact, name), build.dist + '/' + name);
  visit(path.join(frontend, 'public'), 'public');
  for (const name of ['next.config.js', 'browser-build-identity.cjs']) visit(path.join(frontend, name), name);
  assert.deepEqual(stableFile(reportPath), reportIdentity); assert.deepEqual(stableFile(cleanupPath), cleanupIdentity);
  const buildBaseImage = build.canonicalBefore.frontend.image;
  const runtimeBase = runtimeBaseReceipt ? qualifiedFrontendRuntimeBase(repository, runtimeBaseReceipt) : null;
  return { operation, sourceCommit:build.sourceCommit??null, sourceProvenanceSha256:build.sourceProvenance?sha(Buffer.from(JSON.stringify(build.sourceProvenance))):null, buildId: build.buildId, dist: build.dist, baseImage: runtimeBase?.baseImage ?? buildBaseImage,
    buildBaseImage, runtimeBase,
    logicalArtifact: build.logicalTarget, physicalArtifact: artifact, artifactIdentity: identity(artifactStat),
    buildReceipt: reportIdentity, cleanupReceipt: cleanupIdentity, sourceGuards,
    fixtureIdentity: stableFile(fixturePath), helperIdentity: stableFile(import.meta.filename),
    files, directories, runtimeBytes: total };
}

const before = capture();
if (mode !== '--materialize') {
  console.log(JSON.stringify({ mode: 'inspect', buildId: before.buildId, files: before.files.length,
    runtimeBytes: before.runtimeBytes, twoCopiesBytes: 2 * before.runtimeBytes,
    baseImage: before.baseImage, physicalArtifact: before.physicalArtifact, productionAdmission: false }));
} else {
  assert.equal(fs.realpathSync(qaRoot), qaRoot);
  const available = fs.statfsSync(qaRoot, { bigint: true });
  assert.ok(available.bavail * available.bsize >= BigInt(before.runtimeBytes * 3 + 64 * 1024 * 1024));
  const id = randomBytes(16).toString('hex'), root = path.join(qaRoot, 'current-frontend-bundle-' + id);
  const frontend = path.join(root, 'frontend'), context = path.join(root, 'context');
  const evidence = path.join(repository, 'reports/qa/current-frontend-bundle-' + id + '.json');
  const result = { format: 'sabalan-current-frontend-materialization/v1', id, phase: 'INTENT', root, frontend, context,
    source: before, sourceInventorySha256: sha(Buffer.from(JSON.stringify(before))), productionAdmission: false,
    dockerExecuted: false, serviceStarted: false, imageCustodyQualified: false };
  fs.writeFileSync(evidence.replace('.json', '-intent.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  fs.mkdirSync(root, { mode: 0o700 }); fs.mkdirSync(frontend, { mode: 0o700 });
  try {
    for (const directory of before.directories) fs.mkdirSync(path.join(frontend, directory.relative), { recursive: true, mode: 0o700 });
    for (const file of before.files) {
      assert.deepEqual(stableFile(file.source), { bytes: file.bytes, sha256: file.sha256, identity: file.identity });
      const target = path.join(frontend, file.relative);
      fs.copyFileSync(file.source, target, fs.constants.COPYFILE_EXCL);
      const copied = stableFile(target); assert.equal(copied.sha256, file.sha256); assert.equal(copied.bytes, file.bytes);
      assert.deepEqual(stableFile(file.source), { bytes: file.bytes, sha256: file.sha256, identity: file.identity });
    }
    const bundle = await prepareRetainedUiBundle({ frontend, artifact: path.join(frontend, before.dist), directory: context, baseImage: before.baseImage });
    assert.equal(bundle.buildId, before.buildId); assert.equal(bundle.runtimeBytes, before.runtimeBytes);
    assert.equal(bundle.runtimeFiles, before.files.length);
    assert.deepEqual(capture(), before, 'Original build/runtime inputs changed during materialization');
    const manifest = stableFile(path.join(context, 'online-runtime-manifest.json'));
    assert.equal(manifest.sha256, bundle.manifestSha256);
    const recorded = JSON.parse(fs.readFileSync(path.join(context, 'online-runtime-manifest.json'), 'utf8'));
    for (const file of recorded.files) {
      const relative = file.path.startsWith('.next-online-runtime/') ? 'runtime/' + file.path.slice('.next-online-runtime/'.length) : file.path;
      const actual = stableFile(path.join(context, relative)); assert.equal(actual.sha256, file.sha256); assert.equal(actual.bytes, file.bytes);
    }
    const contextInventory = {}; let contextBytes = 0;
    const walkContext = (directory, prefix = '') => {
      const original = fs.lstatSync(directory, { bigint: true });
      assert.ok(original.isDirectory() && !original.isSymbolicLink()); assert.equal(fs.realpathSync(directory), directory);
      for (const name of fs.readdirSync(directory).sort()) {
        const file = path.join(directory, name), relative = prefix + name, value = fs.lstatSync(file);
        assert.ok(!value.isSymbolicLink());
        if (value.isDirectory()) walkContext(file, relative + '/');
        else {
          const checked = stableFile(file); contextBytes += checked.bytes;
          assert.ok(Object.keys(contextInventory).length < 20000 && contextBytes <= limit);
          contextInventory[relative] = checked.sha256;
        }
      }
      assert.deepEqual(identity(fs.lstatSync(directory, { bigint: true })), identity(original));
    };
    walkContext(context);
    Object.assign(result, { phase: 'COMPLETE', bundle, manifest, sourceUnchanged: true, exactCopiedBytesVerified: true,
      contextInventory, contextInventorySha256: sha(Buffer.from(JSON.stringify(contextInventory))), contextBytes });
    fs.writeFileSync(evidence, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ phase: result.phase, evidence, context, ...bundle, assets: bundle.assets.length, productionAdmission: false }));
  } catch (error) {
    Object.assign(result, { phase: 'FAILED_HELD', error: error instanceof Error ? error.message : 'MATERIALIZATION_FAILED' });
    fs.writeFileSync(evidence, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
    throw error;
  }
}
