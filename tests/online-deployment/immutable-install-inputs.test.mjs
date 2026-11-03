import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {inspectImmutableInstallArtifacts, prepareImmutablePrebuiltInputs, renderImmutableInstallInputs, assertImmutableInstallObservation, assertImmutableSourceFreeze} from '../../scripts/lib/immutable-install-inputs.mjs';
import {readFrontendSourceCommit} from '../../scripts/lib/frontend-source-provenance.mjs';

const sha = raw => createHash('sha256').update(raw).digest('hex');
const hash = char => char.repeat(64);
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sabalan-install-inputs-'));
  const repository = path.join(directory, 'repository');
  fs.mkdirSync(repository);
  const git = (...args) => execFileSync('git', ['-c', 'core.autocrlf=false', '-C', repository, ...args], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  const put = (file, value) => {
    const raw = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value));
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, raw);
    return {file, sha256: sha(raw)};
  };
  const source = (name, value) => put(path.join(repository, name), Buffer.from(value));
  git('init'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  source('backend/src/application.ts', 'export const value = 1;\n');
  source('backend/package-lock.json', '{}\n');
  source('packages/contract-product-graph/src/index.ts', 'graph\n');
  source('packages/partner-sales-contracts/src/index.ts', 'partner\n');
  source('deploy/trust/online-qualification-public-key.pem', 'public test key\n');
  source('deploy/scripts/deploy.sh', 'protected\n');
  source('frontend/src/index.ts', 'frontend source\n');
  source('frontend/public/test.svg', '<svg/>\n');
  const inquiry = 'd'.repeat(40);
  git('add', '.'); git('update-index', '--add', '--cacheinfo', '160000,' + inquiry + ',apps/sabalan-inquiry');
  git('commit', '-m', 'Application fixture');
  const applicationCommit = git('rev-parse', 'HEAD');
  source('deploy/scripts/deploy.sh', 'protected host successor\n');
  git('add', 'deploy/scripts/deploy.sh'); git('commit', '-m', 'Host fixture');
  const hostCommit = git('rev-parse', 'HEAD');
  const sources = Object.fromEntries(['backend/src/application.ts', 'backend/package-lock.json', 'packages/contract-product-graph/src/index.ts', 'packages/partner-sales-contracts/src/index.ts'].map(name => [name, sha(fs.readFileSync(path.join(repository, name)))]));
  const closed = () => ({originalPid: 123, code: 0, signal: null, naturalChildClosure: true, outputBoundExceeded: false});
  const inventory = (root, values) => Object.fromEntries(Object.entries(values).map(([name, text]) => {
    const raw = Buffer.from(text); put(path.join(root, name), raw); return [name, {bytes: raw.length, sha256: sha(raw)}];
  }));
  const compiledRoot = path.join(directory, 'compiled');
  const outputs = inventory(compiledRoot, {'graph-dist/index.d.ts': 'graph declaration', 'partner-dist/index.d.ts': 'partner declaration', 'dist/application.js': 'compiled application'});
  const prior = {format: 'sabalan-current-backend-compiled/v1', pass: true, sourceUnchanged: true, productionAdmission: false, originalChildren: {allOriginalChildrenClosed: true, interrupted: false}, commands: Array.from({length: 4}, closed), qualifiedReceiptSha256: hash('c'), sources, outputs};
  const priorRef = put(path.join(directory, 'prior.json'), prior);
  const compiled = {...structuredClone(prior), root: compiledRoot, commands: [closed(), closed()], reusedComponents: {format: 'sabalan-original-workspace-components-reused/v1', priorReceipt: priorRef, recordedInputCount: 3, outputs: Object.entries(outputs).filter(([name]) => !name.startsWith('dist/')).map(([name, row]) => ({path: name, ...row})), newCompilerOriginalsClaimed: false, productionAdmission: false}};
  const compiledRef = put(path.join(compiledRoot, 'compiled-receipt.json'), compiled);
  const context = path.join(directory, 'context');
  const materialFiles = inventory(context, {'app/trust/online-qualification-public-key.pem': 'public test key\n', 'app/dist/application.js': 'compiled application'});
  const material = {format: 'sabalan-current-backend-material/v1', materialized: true, sourceUnchanged: true, productionAdmission: false, compiledReceipt: compiledRef.file, compiledReceiptSha256: compiledRef.sha256, materialSources: {...sources, 'deploy/trust/online-qualification-public-key.pem': sha(Buffer.from('public test key\n'))}, context, files: Object.entries(materialFiles).map(([name, row]) => ({path: name, ...row}))};
  const materialRef = put(path.join(directory, 'material.json'), material);
  const image = {format: 'sabalan-current-backend-image/v1', pass: true, sourceUnchanged: true, productionAdmission: false, materialReceipt: materialRef.file, materialReceiptSha256: materialRef.sha256, sourceCommit: applicationCommit, performanceSourceHash: hash('c'), image: {id: 'sha256:' + hash('a'), labels: {'io.sabalan.performance.source-commit': applicationCommit, 'io.sabalan.performance.source-hash': hash('c')}}, originalChildren: {allOriginalChildrenClosed: true, interrupted: false}};
  const imageRef = put(path.join(directory, 'image.json'), image);
  image.image.layers = ['sha256:' + hash('8')]; put(imageRef.file, image); imageRef.sha256 = sha(Buffer.from(JSON.stringify(image)));
  const packRoot = path.join(directory, 'pack');
  const packOutputs = inventory(packRoot, {'deploy/scripts/deploy.sh': 'protected host successor\n'});
  const pack = {format: 'sabalan-online-controller-host-pack/v1', packagingComplete: true, hostControllerPackOnly: true, productionAdmission: false, runtimeStarted: false, databaseConnected: false, requiresReviewedOperationsCheckout: true, sources: {'deploy/scripts/deploy.sh': {bytes: 25, sha256: sha(fs.readFileSync(path.join(repository, 'deploy/scripts/deploy.sh')))}}, outputs: packOutputs};
  for (const name of ['deploy/scripts/online-release-launcher.py', 'deploy/scripts/prebuilt-release-plan.mjs', 'deploy/scripts/storage-preflight.sh', 'deploy/scripts/storage-preflight.mjs', 'scripts/deployment-storage.mjs', 'scripts/deployment-capacity.mjs', 'deploy/scripts/preserved-clamav.mjs', 'backend/scripts/preserved-clamav-policy.mjs', 'scripts/clamav-release-readiness.mjs', 'scripts/clamav-source-migration.mjs', 'backend/scripts/clamav-checkpoint.mjs', 'backend/scripts/clamav-incident-policy.mjs']) {
    const raw = Buffer.from('fixture output ' + name); put(path.join(packRoot, name), raw); pack.outputs[name] = {bytes: raw.length, sha256: sha(raw)};
  }
  pack.sources['deploy/scripts/deploy.sh'].bytes = fs.statSync(path.join(repository, 'deploy/scripts/deploy.sh')).size;
  pack.externalInputs = {};
  const packRef = put(path.join(packRoot, 'host-pack-receipt.json'), pack);
  const input = {repository, applicationCommit, hostCommit, compiled: compiledRef, material: materialRef, backendImage: imageRef, hostPack: packRef};
  function refresh(name, value) {
    input[name] = put(input[name].file, value);
    if (name === 'compiled') {material.compiledReceiptSha256 = input.compiled.sha256; refresh('material', material);}
    if (name === 'material') {image.materialReceiptSha256 = input.material.sha256; refresh('backendImage', image);}
  }
  return {directory, repository, input, compiled, material, image, pack, put, source, git, refresh, cleanup() {fs.rmSync(directory, {recursive: true});}};
}

function prebuiltFixture(f) {
  const graphs = {}, images = {}, receipts = {};
  for (const [index, role] of ['backend', 'frontend', 'inquiry'].entries()) {
    const graph = {index: 'sha256:' + hash(String(index + 1)), platform: 'sha256:' + hash('4'), config: 'sha256:' + hash(String(index + 5)), rootfsDiffIds: ['sha256:' + hash('8')], archiveSha256: hash('9'), archiveBytes: 10240};
    if (role === 'backend') graph.index = f.image.image.id;
    graphs[role] = f.put(path.join(f.directory, role + '-graph.json'), graph);
    receipts[role] = role === 'backend' ? f.image : role === 'frontend'
      ? {format: 'sabalan-current-frontend-image-build/v2', pass: true, phase: 'COMPLETE', sourceCommit: 'e'.repeat(40), outputImage: {id: graph.index}, buildId: 'erp_actual_fixture123', manifestSha256: hash('c')}
      : {format: 'sabalan-inquiry-native-image-diagnostic/v1', image: graph.index, inquirySourceCommit: 'd'.repeat(40), browserDeploymentId: 'inquiry_actual_fixture123'};
    images[role] = role === 'backend' ? f.input.backendImage : f.put(path.join(f.directory, role + '-image.json'), receipts[role]);
  }
  const manifest = {id: 'inquiry_actual_fixture123', frameworkBuildId: 'native_next_fixture123'};
  const frontendFiles = f.git('ls-tree', '-r', '--name-only', f.input.applicationCommit, '--', 'frontend', 'packages/contract-product-graph', 'packages/partner-sales-contracts').split('\n');
  const sourceProvenance = {format: 'sabalan-committed-frontend-source/v1', sourceCommit: f.input.applicationCommit, inputs: readFrontendSourceCommit(f.repository, f.input.applicationCommit, frontendFiles)};
  const build = f.put(path.join(f.repository, 'reports/qa/frontend-final-build-' + 'a'.repeat(16) + '.json'), {sourceCommit: f.input.applicationCommit, sourceProvenance});
  const material = f.put(path.join(f.repository, 'reports/qa/current-frontend-bundle-' + 'b'.repeat(32) + '.json'), {source: {sourceCommit: f.input.applicationCommit, operation: 'a'.repeat(16), buildReceipt: {sha256: build.sha256}, sourceProvenanceSha256: sha(JSON.stringify(sourceProvenance))}});
  receipts.frontend.sourceCommit = f.input.applicationCommit;
  receipts.frontend.materializationReceipt = path.basename(material.file); receipts.frontend.materializationReceiptSha256 = material.sha256;
  images.frontend = f.put(images.frontend.file, receipts.frontend);
  const inquiryBrowser = f.put(path.join(f.directory, 'inquiry-browser.json'), {id: manifest.id, frameworkBuildId: manifest.frameworkBuildId, manifest, manifestSha256: sha(JSON.stringify(manifest))});
  const preservedClamav = {format: 'sabalan-preserved-clamav/v1', containerId: hash('a'), image: 'sha256:' + hash('b'), startedAt: '2026-10-25T00:00:00Z', hostPid: 123, stableConfigurationSha256: hash('c'), initialIdentitySha256: hash('d'), initialHealthSha256: hash('e')};
  return {artifactInputs: f.input, imageReceipts: images, archiveGraphs: graphs, inquiryBrowser, preservedClamav, imageStore: 'classic', controlRoot: '/opt/sabalanerp/.deploy-state/online-control-' + 'a'.repeat(32)};
}

test('inspect preserves actual application and host identities and authentic two-child workspace reuse', () => {
  const f = fixture();
  try {
    const result = inspectImmutableInstallArtifacts(f.input);
    assert.equal(result.application.commit, f.input.applicationCommit);
    assert.equal(result.host.commit, f.input.hostCommit);
    assert.notEqual(result.host.commit, result.application.commit);
    assert.equal(result.inquiryCommit, 'd'.repeat(40));
    assert.equal(result.compilerOriginals, 2);
    assert.equal(result.productionAdmission, false);
    assert.equal(result.imageRebuilt, false);
    assert.deepEqual(result.maps.compiledOutputs, f.compiled.outputs);
    assert.deepEqual(result.maps.hostOutputs, f.pack.outputs);
  } finally {f.cleanup();}
});

test('prepare refuses receipt swaps, missing public trust, stale source and partial output maps', () => {
  for (const mutate of [
    f => {f.input.material.sha256 = hash('0');},
    f => {delete f.material.materialSources['deploy/trust/online-qualification-public-key.pem']; f.refresh('material', f.material);},
    f => {f.input.hostCommit = f.input.applicationCommit;},
    f => {f.source('backend/src/application.ts', 'changed application');},
    f => {delete f.compiled.outputs['dist/application.js']; f.refresh('compiled', f.compiled);},
    f => {delete f.pack.outputs['deploy/scripts/deploy.sh']; f.refresh('hostPack', f.pack);},
    f => {delete f.compiled.sources['backend/src/application.ts']; delete f.material.materialSources['backend/src/application.ts']; f.refresh('compiled', f.compiled);},
    f => {delete f.compiled.reusedComponents; f.compiled.commands.push(...structuredClone(f.compiled.commands)); f.refresh('compiled', f.compiled);},
    f => {f.source('unowned.txt', 'unknown'); f.pack.sources['unowned.txt'] = {bytes: 7, sha256: sha(Buffer.from('unknown'))}; f.refresh('hostPack', f.pack);},
  ]) {
    const f = fixture();
    try {mutate(f); assert.throws(() => inspectImmutableInstallArtifacts(f.input));} finally {f.cleanup();}
  }
});

test('selection rejects stale frontend provenance, substituted archive layers and missing scanner selection without rebuilding', () => {
  for (const mutate of [
    (f, input) => {f.source('frontend/src/index.ts', 'changed frontend source\n');},
    (f, input) => {delete input.preservedClamav;},
    (f, input) => {
      const graph = JSON.parse(fs.readFileSync(input.archiveGraphs.backend.file)); graph.rootfsDiffIds = ['sha256:' + hash('f')];
      input.archiveGraphs.backend = f.put(input.archiveGraphs.backend.file, graph);
    },
    (f, input) => {input.imageReceipts.backend = input.imageReceipts.frontend;},
  ]) {
    const f = fixture();
    try {const input = prebuiltFixture(f); mutate(f, input); assert.throws(() => prepareImmutablePrebuiltInputs(input));} finally {f.cleanup();}
  }
});

test('prebuilt preparation uses actual receipts and preserves scanner and config/index namespaces without claiming installed observations', () => {
  const f = fixture();
  try {
    const input = prebuiltFixture(f), result = prepareImmutablePrebuiltInputs(input);
    assert.equal(result.plan.applicationCommit, f.input.applicationCommit);
    assert.deepEqual(result.plan.preservedClamav, input.preservedClamav);
    assert.equal(result.plan.images.backend.image, 'sha256:' + hash('5'));
    assert.equal(result.plan.images.backend.archiveGraph.index, f.image.image.id);
    assert.equal(result.privateFiles.length, 6);
    assert.equal(result.productionAdmission, false);
    assert.equal(result.finalPackagingReady, false);
    assert.equal(result.sourceFreeze.host.commit, f.input.hostCommit);
    assert.deepEqual(Object.keys(result.plan.operations.files).sort(), Object.keys(f.pack.outputs).sort());
    input.imageStore = 'containerd';
    assert.equal(prepareImmutablePrebuiltInputs(input).plan.images.backend.image, f.image.image.id);
  } finally {f.cleanup();}
});

test('inert install rendering binds source, configuration, protected files, cron and lease; changed incarnations need new original observations', () => {
  const f = fixture();
  try {
    const selectionInputs = prebuiltFixture(f), selection = prepareImmutablePrebuiltInputs(selectionInputs);
    const configuration = f.put(path.join(f.directory, 'launcher-config.json'), {format: 'sabalan-online-original-launcher/v1', prebuiltReleasePlan: {file: selectionInputs.controlRoot + '/prebuilt-release-plan.json', sha256: selection.planSha256}, hostPackReceiptSha256: f.input.hostPack.sha256});
    const baseline = {configurationSha256: configuration.sha256, operationsReceiptSha256: f.input.hostPack.sha256, applicationCommit: f.input.applicationCommit, applicationTree: f.git('rev-parse', f.input.applicationCommit + '^{tree}'), inquiryCommit: 'd'.repeat(40), serviceConfigurationSha256: hash('a'), protectedFiles: {'/protected': {identity: ['1'], sha256: hash('b')}}, cronFiles: {'/cron': {identity: ['2'], sha256: hash('c')}}, activeLeaseCount: 0, creationOnly: true, containers: [{id: hash('d'), startedAt: '2026-10-25T00:00:00Z'}], lockIdentity: ['original-lock'], databaseIdentity: {name: 'fixture', system: '123'}, migrationLedgerSha256: hash('e'), machineUuidSha256: hash('f'), kernelBootIdSha256: hash('0')};
    const observation = {format: 'sabalan-original-owner-install-readonly-guard/v1', baseline, baselineSha256: sha(JSON.stringify(baseline, (_, v) => v && !Array.isArray(v) && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v)), readOnly: true, productionAdmission: false, originalChildren: [{pid: 123, code: 0, signal: null}]};
    observation.observedAt = observation.completedAt = new Date().toISOString();
    const observationRef = f.put(path.join(f.directory, 'guard.json'), observation);
    const rendered = renderImmutableInstallInputs({selectionInputs, configuration, observation: observationRef, operation: 'a'.repeat(32)});
    assert.equal(rendered.creationOnly, true); assert.equal(rendered.productionAdmission, false);
    assert.equal(rendered.finalPackagingReady, false);
    assert.equal(rendered.guard.baselineSha256, observation.baselineSha256);
    assert.equal(rendered.offlineSource.application.installTarget, f.input.applicationCommit);
    assert.equal(rendered.offlineSource.application.closureTip, f.input.hostCommit);
    assert.doesNotThrow(() => assertImmutableInstallObservation(rendered, observation));
    for (const mutate of [v => {v.baseline.containers[0].startedAt = 'later';}, v => {v.baseline.activeLeaseCount = 1;}, v => {v.baseline.protectedFiles['/protected'].sha256 = hash('0');}, v => {v.baseline.cronFiles['/cron'].identity = ['replacement'];}, v => {v.originalChildren[0].code = 1;}, v => {v.observedAt = new Date(Date.now() - 601000).toISOString();}]) {
      const changed = structuredClone(observation); mutate(changed);
      assert.throws(() => assertImmutableInstallObservation(rendered, changed));
    }
    const freeze = {hostCommit: f.input.hostCommit, hostTree: f.git('rev-parse', 'HEAD^{tree}'), hostPackReceiptSha256: f.input.hostPack.sha256};
    assert.doesNotThrow(() => assertImmutableSourceFreeze(rendered, freeze));
    assert.throws(() => assertImmutableSourceFreeze(rendered, {...freeze, hostCommit: f.input.applicationCommit}));
    assert.throws(() => assertImmutableSourceFreeze(rendered, {...freeze, hostPackReceiptSha256: hash('0')}));
  } finally {f.cleanup();}
});
