/** Read-only artifact inspection and inert installer inputs. These values carry
 * content identity only; the persistent coordinator owns native observation. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {assertCatalogCompilerOriginals} from './application-native-full-catalog-artifacts.mjs';
import {validatePrebuiltReleaseInputs, requirePrebuiltScannerSelection} from '../../deploy/scripts/prebuilt-release-plan.mjs';
import {revalidateFrontendSourceProvenance} from './frontend-source-provenance.mjs';

const digest = /^[a-f0-9]{64}$/;
const commit = /^[a-f0-9]{40}$/;
const trustSource = 'deploy/trust/online-qualification-public-key.pem';
const trustOutput = 'app/trust/online-qualification-public-key.pem';
export const immutableInputHash = raw => createHash('sha256').update(raw).digest('hex');
const sha = immutableInputHash;
const canonical = value => JSON.stringify(value, (_, v) => v && !Array.isArray(v) && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map(key => [key, v[key]])) : v);
const keys = (value, expected) => assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
function relative(name) {
  assert.ok(typeof name === 'string' && /^[A-Za-z0-9_@.+-]+(?:\/[A-Za-z0-9_@.+-]+)*$/.test(name)
    && name.split('/').every(part => part !== '.' && part !== '..'), 'INSTALL_UNSAFE_RELATIVE_PATH');
  return name;
}
function stableRead(file, maximum = 32 * 1024 ** 2) {
  assert.ok(path.isAbsolute(file), 'INSTALL_ABSOLUTE_PATH_REQUIRED');
  file = path.resolve(file);
  assert.equal(fs.realpathSync(file), file, 'INSTALL_LINK_REFUSED');
  const named = fs.lstatSync(file, {bigint: true});
  assert.ok(named.isFile() && !named.isSymbolicLink() && named.nlink === 1n && named.size <= BigInt(maximum));
  const pin = st => ['ino', 'size', 'mode', 'nlink', 'mtimeNs', 'ctimeNs'].map(key => String(st[key]));
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const opened = fs.fstatSync(fd, {bigint: true});
    assert.deepEqual(pin(opened), pin(named));
    if (process.platform !== 'win32') assert.equal(opened.dev, named.dev);
    const raw = fs.readFileSync(fd);
    assert.equal(BigInt(raw.length), named.size);
    const last = fs.fstatSync(fd, {bigint: true}), lastNamed = fs.lstatSync(file, {bigint: true});
    assert.deepEqual(pin(last), pin(opened)); assert.equal(last.dev, opened.dev);
    assert.deepEqual(pin(lastNamed), pin(named)); assert.equal(lastNamed.dev, named.dev);
    return raw;
  } finally {fs.closeSync(fd);}
}
function receipt(ref) {
  keys(ref, ['file', 'sha256']); assert.match(ref.sha256, digest);
  const raw = stableRead(ref.file);
  assert.equal(sha(raw), ref.sha256, 'INSTALL_RECEIPT_BYTES_CHANGED');
  return JSON.parse(raw.toString('utf8'));
}
function rows(value) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0, 'INSTALL_EMPTY_MAP');
  for (const [name, row] of Object.entries(value)) {
    relative(name); assert.match(row.sha256, digest);
    assert.ok(Number.isSafeInteger(row.bytes) && row.bytes >= 0);
  }
  return value;
}
function checkMap(root, map) {
  rows(map);
  for (const [name, row] of Object.entries(map)) {
    const raw = stableRead(path.join(root, name), Math.max(row.bytes, 1));
    assert.equal(raw.length, row.bytes, 'INSTALL_OUTPUT_SIZE_CHANGED:' + name);
    assert.equal(sha(raw), row.sha256, 'INSTALL_OUTPUT_BYTES_CHANGED:' + name);
  }
}
function filesBelow(root) {
  const result = [];
  function walk(folder, prefix = '') {
    for (const entry of fs.readdirSync(folder, {withFileTypes: true})) {
      assert.equal(entry.isSymbolicLink(), false);
      const name = relative(prefix + entry.name);
      if (entry.isDirectory()) walk(path.join(folder, entry.name), name + '/');
      else {assert.equal(entry.isFile(), true); result.push(name);}
    }
  }
  walk(root); return result.sort();
}
function gitReader(repository) {
  return (...args) => execFileSync('git', ['-c', 'core.fsmonitor=false', '-C', repository, ...args], {
    env: {...process.env, GIT_OPTIONAL_LOCKS: '0'}, encoding: 'utf8', maxBuffer: 32 * 1024 ** 2, stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/** Inspect existing approved compiler/material/image/host-pack outputs in place.
 * No build, Docker, SQL, transport, checkout, index or credential write occurs. */
export function inspectImmutableInstallArtifacts(input) {
  keys(input, ['repository', 'applicationCommit', 'hostCommit', 'compiled', 'material', 'backendImage', 'hostPack']);
  const {repository, applicationCommit, hostCommit} = input;
  assert.match(applicationCommit, commit); assert.match(hostCommit, commit);
  const git = gitReader(repository);
  assert.equal(git('rev-parse', 'HEAD'), hostCommit, 'INSTALL_HOST_SOURCE_STALE');
  git('merge-base', '--is-ancestor', applicationCommit, hostCommit);
  const applicationTree = git('rev-parse', applicationCommit + '^{tree}');
  const hostTree = git('rev-parse', hostCommit + '^{tree}');
  const inquiryCommit = git('rev-parse', hostCommit + ':apps/sabalan-inquiry');
  assert.match(inquiryCommit, commit);
  assert.equal(git('rev-parse', applicationCommit + ':apps/sabalan-inquiry'), inquiryCommit, 'INSTALL_INQUIRY_GITLINK_CHANGED');
  const changedPaths = git('diff', '--name-only', applicationCommit, hostCommit).split(/\r?\n/).filter(Boolean).sort();
  const compiled = receipt(input.compiled), material = receipt(input.material), image = receipt(input.backendImage), pack = receipt(input.hostPack);
  assertCatalogCompilerOriginals(compiled);
  assert.equal(compiled.commands.length, 2, 'INSTALL_TWO_FRESH_COMPILERS_AND_WORKSPACE_REUSE_REQUIRED');
  assert.equal(compiled.productionAdmission, false);
  assert.equal(material.format, 'sabalan-current-backend-material/v1');
  assert.equal(material.materialized, true); assert.equal(material.sourceUnchanged, true); assert.equal(material.productionAdmission, false);
  assert.equal(material.compiledReceiptSha256, input.compiled.sha256, 'INSTALL_COMPILED_RECEIPT_SWAPPED');
  assert.equal(path.resolve(material.compiledReceipt), path.resolve(input.compiled.file));
  assert.equal(image.format, 'sabalan-current-backend-image/v1');
  assert.equal(image.pass, true); assert.equal(image.sourceUnchanged, true); assert.equal(image.productionAdmission, false);
  assert.equal(image.originalChildren.allOriginalChildrenClosed, true); assert.equal(image.originalChildren.interrupted, false);
  assert.equal(image.materialReceiptSha256, input.material.sha256, 'INSTALL_MATERIAL_RECEIPT_SWAPPED');
  assert.equal(path.resolve(image.materialReceipt), path.resolve(input.material.file));
  assert.equal(image.sourceCommit, applicationCommit, 'INSTALL_APPLICATION_SOURCE_STALE');
  assert.match(image.performanceSourceHash, digest); assert.match(image.image.id, /^sha256:[a-f0-9]{64}$/);
  assert.equal(image.image.labels['io.sabalan.performance.source-commit'], applicationCommit);
  assert.equal(image.image.labels['io.sabalan.performance.source-hash'], image.performanceSourceHash);
  assert.equal(pack.format, 'sabalan-online-controller-host-pack/v1');
  for (const key of ['packagingComplete', 'hostControllerPackOnly', 'requiresReviewedOperationsCheckout']) assert.equal(pack[key], true);
  for (const key of ['productionAdmission', 'runtimeStarted', 'databaseConnected']) assert.equal(pack[key], false);

  const sourceBlobs = {};
  function checkSources(map, builtApplication) {
    assert.ok(map && !Array.isArray(map) && Object.keys(map).length > 0);
    for (const [name, row] of Object.entries(map)) {
      relative(name); const expected = typeof row === 'string' ? row : row.sha256;
      assert.match(expected, digest);
      const raw = stableRead(path.join(repository, name));
      assert.equal(sha(raw), expected, 'INSTALL_SOURCE_BYTES_CHANGED:' + name);
      if (typeof row !== 'string') assert.equal(raw.length, row.bytes);
      // Dependencies are byte-bound to the producer. Every other input must
      // belong to the committed source; no report-supplied owner is trusted.
      if (name.startsWith('backend/node_modules/')) continue;
      const hostBlob = git('rev-parse', hostCommit + ':' + name);
      assert.match(hostBlob, commit);
      assert.equal(git('hash-object', '--path=' + name, path.join(repository, name)), hostBlob, 'INSTALL_UNCOMMITTED_SOURCE:' + name);
      if (builtApplication) assert.equal(git('rev-parse', applicationCommit + ':' + name), hostBlob, 'INSTALL_APPLICATION_INPUT_CHANGED:' + name);
      if (sourceBlobs[name]) assert.equal(sourceBlobs[name], hostBlob);
      sourceBlobs[name] = hostBlob;
    }
  }
  checkSources(compiled.sources, true); checkSources(material.materialSources, true); checkSources(pack.sources, false);
  const compilerSourceFiles = git('ls-tree', '-r', '--name-only', hostCommit, '--', 'backend/src', 'packages/contract-product-graph/src', 'packages/partner-sales-contracts/src').split(/\r?\n/).filter(Boolean);
  assert.ok(compilerSourceFiles.length > 0);
  for (const name of compilerSourceFiles) assert.match(compiled.sources[name] ?? '', digest, 'INSTALL_PARTIAL_COMPILED_INPUT_MAP:' + name);
  assert.ok(pack.externalInputs && !Array.isArray(pack.externalInputs), 'INSTALL_EXTERNAL_INPUT_MAP_REQUIRED');
  for (const [file, row] of Object.entries(pack.externalInputs)) {
    assert.match(row.sha256, digest); assert.ok(Number.isSafeInteger(row.bytes) && row.bytes >= 0);
    const raw = stableRead(file, Math.max(row.bytes, 1)); assert.equal(raw.length, row.bytes); assert.equal(sha(raw), row.sha256, 'INSTALL_EXTERNAL_INPUT_CHANGED');
  }
  for (const [name, pin] of Object.entries(compiled.sources)) assert.equal(material.materialSources[name], pin, 'INSTALL_PARTIAL_MATERIAL_INPUT_MAP');
  assert.match(material.materialSources[trustSource] ?? '', digest, 'INSTALL_PUBLIC_TRUST_MISSING');
  assert.ok(Array.isArray(material.files) && material.files.length > 0);
  const materialFiles = Object.fromEntries(material.files.map(({path: name, bytes, sha256}) => [relative(name), {bytes, sha256}]));
  assert.equal(Object.keys(materialFiles).length, material.files.length, 'INSTALL_DUPLICATE_MATERIAL_OUTPUT');
  assert.equal(materialFiles[trustOutput]?.sha256, material.materialSources[trustSource], 'INSTALL_PUBLIC_TRUST_MISSING');
  checkMap(compiled.root, compiled.outputs); checkMap(material.context, materialFiles); checkMap(path.dirname(input.hostPack.file), pack.outputs);
  assert.deepEqual(filesBelow(material.context), Object.keys(materialFiles).sort(), 'INSTALL_PARTIAL_MATERIAL_OUTPUT_MAP');
  assert.deepEqual(filesBelow(path.dirname(input.hostPack.file)), [...Object.keys(pack.outputs), path.basename(input.hostPack.file)].sort(), 'INSTALL_PARTIAL_HOST_OUTPUT_MAP');
  const compilerDirectories = ['dist', 'dist-cutover', 'graph-dist', 'partner-dist'];
  const compilerFiles = compilerDirectories.flatMap(folder => fs.existsSync(path.join(compiled.root, folder))
    ? filesBelow(path.join(compiled.root, folder)).map(name => folder + '/' + name) : []).sort();
  assert.deepEqual(compilerFiles, Object.keys(compiled.outputs).sort(), 'INSTALL_PARTIAL_COMPILED_OUTPUT_MAP');
  // Every changed path is recorded, including operations files outside the image
  // input maps. A changed application input was rejected above.
  const hostChanges = Object.fromEntries(changedPaths.map(name => {
    assert.ok(Object.hasOwn(pack.sources, name) || /^(?:scripts\/|tests\/online-deployment\/|docs\/|reports\/qa\/)/.test(name), 'INSTALL_UNKNOWN_CHANGED_SOURCE_OWNER:' + name);
    return [relative(name), git('rev-parse', hostCommit + ':' + name)];
  }));
  assert.equal(git('rev-parse', 'HEAD'), hostCommit);
  for (const ref of [input.compiled, input.material, input.backendImage, input.hostPack]) receipt(ref);
  const result = {format: 'sabalan-immutable-install-artifacts/v1', application: {commit: applicationCommit, tree: applicationTree, sourceHash: image.performanceSourceHash, image: image.image.id},
    host: {commit: hostCommit, tree: hostTree, changedPaths: hostChanges}, inquiryCommit, receipts: structuredClone(input), compilerOriginals: compiled.commands.length,
    maps: {compiledSources: compiled.sources, materialSources: material.materialSources, hostSources: pack.sources, externalHostInputs: pack.externalInputs, sourceBlobs, compiledOutputs: compiled.outputs, materialOutputs: materialFiles, hostOutputs: pack.outputs},
    productionAdmission: false, runtimeStarted: false, imageRebuilt: false};
  return {...result, contentSha256: sha(canonical(result))};
}

/** Produce inspectable private-file mappings and the existing protected plan.
 * This intentionally does not render credentials, copy bytes or install images. */
export function prepareImmutablePrebuiltInputs(input) {
  keys(input, ['artifactInputs', 'imageReceipts', 'archiveGraphs', 'inquiryBrowser', 'preservedClamav', 'imageStore', 'controlRoot']);
  assert.match(input.controlRoot, /^\/opt\/sabalanerp\/\.deploy-state\/online-control-[a-f0-9]{32}$/);
  assert.ok(['classic', 'containerd'].includes(input.imageStore));
  keys(input.imageReceipts, ['backend', 'frontend', 'inquiry']); keys(input.archiveGraphs, ['backend', 'frontend', 'inquiry']);
  assert.deepEqual(input.imageReceipts.backend, input.artifactInputs.backendImage, 'INSTALL_BACKEND_RECEIPT_SWAPPED');
  const artifacts = inspectImmutableInstallArtifacts(input.artifactInputs);
  const frontendImage = receipt(input.imageReceipts.frontend);
  assert.match(frontendImage.materializationReceipt, /^current-frontend-bundle-[a-f0-9]{32}\.json$/);
  const frontendMaterialRef = {file: path.join(input.artifactInputs.repository, 'reports/qa', frontendImage.materializationReceipt), sha256: frontendImage.materializationReceiptSha256};
  const frontendMaterial = receipt(frontendMaterialRef), frontendSource = frontendMaterial.source;
  assert.equal(frontendSource.sourceCommit, frontendImage.sourceCommit);
  assert.match(frontendSource.operation, /^[a-f0-9]{16}$/);
  const frontendBuildRef = {file: path.join(input.artifactInputs.repository, 'reports/qa/frontend-final-build-' + frontendSource.operation + '.json'), sha256: frontendSource.buildReceipt.sha256};
  const frontendBuild = receipt(frontendBuildRef);
  assert.equal(frontendBuild.sourceCommit, frontendImage.sourceCommit);
  assert.equal(sha(JSON.stringify(frontendBuild.sourceProvenance)), frontendSource.sourceProvenanceSha256);
  revalidateFrontendSourceProvenance(input.artifactInputs.repository, frontendBuild.sourceProvenance);
  const inquiry = receipt(input.inquiryBrowser), compiled = inquiry.compiled ?? inquiry;
  assert.equal(sha(JSON.stringify(compiled.manifest)), compiled.manifestSha256, 'INSTALL_INQUIRY_MANIFEST_CHANGED');
  assert.equal(compiled.manifest.id, compiled.id); assert.equal(compiled.manifest.frameworkBuildId, compiled.frameworkBuildId);
  const plan = {format: 'sabalan-prebuilt-protected-release-plan/v1', applicationCommit: artifacts.application.commit,
    applicationTree: artifacts.application.tree, applicationSourceHash: artifacts.application.sourceHash,
    inquirySourceCommit: artifacts.inquiryCommit, imageStore: input.imageStore, preservedClamav: structuredClone(input.preservedClamav), images: {},
    operations: {receiptSha256: input.artifactInputs.hostPack.sha256, files: Object.fromEntries(Object.entries(artifacts.maps.hostOutputs).map(([name, row]) => [name, row.sha256]))}};
  requirePrebuiltScannerSelection(plan);
  const actual = {operations: plan.operations, buildReceipts: {}, archiveReceipts: {}}, privateFiles = [];
  for (const role of ['backend', 'frontend', 'inquiry']) {
    const build = receipt(input.imageReceipts[role]), graph = receipt(input.archiveGraphs[role]);
    actual.buildReceipts[role] = build; actual.archiveReceipts[role] = graph;
    if (role === 'backend') assert.deepEqual(build.image.layers, graph.rootfsDiffIds, 'INSTALL_BACKEND_ARCHIVE_LAYERS_CHANGED');
    const remote = kind => input.controlRoot + '/receipts/' + role + '-' + kind + '.json';
    const selected = {image: input.imageStore === 'containerd' ? graph.index : graph.config,
      sourceCommit: role === 'inquiry' ? artifacts.inquiryCommit : build.sourceCommit, archiveGraph: graph,
      archiveReceipt: {file: remote('archive-graph'), sha256: input.archiveGraphs[role].sha256},
      buildReceipt: {file: remote('image-receipt'), sha256: input.imageReceipts[role].sha256}};
    if (role === 'frontend') selected.browser = {id: build.buildId, nativeBuildId: build.buildId, manifestSha256: build.manifestSha256};
    if (role === 'inquiry') selected.browser = {id: compiled.id, nativeBuildId: compiled.frameworkBuildId, manifestSha256: compiled.manifestSha256};
    plan.images[role] = selected;
    for (const [local, remoteRef] of [[input.imageReceipts[role], selected.buildReceipt], [input.archiveGraphs[role], selected.archiveReceipt]])
      privateFiles.push({localFile: local.file, remoteFile: remoteRef.file, sha256: local.sha256, permissions: '0400'});
  }
  validatePrebuiltReleaseInputs(plan, actual);
  const planRaw = canonical(plan) + '\n';
  return {format: 'sabalan-immutable-prebuilt-inputs/v1', plan, planRaw, planSha256: sha(planRaw), privateFiles, sourceFreeze: artifacts,
    unchangedFrontend: {material: frontendMaterialRef, build: frontendBuildRef, sourceProvenance: frontendBuild.sourceProvenance},
    sourceOnly: true, finalPackagingReady: false, productionAdmission: false, runtimeStarted: false,
    pendingIntegration: ['09', '12', 'accepted-migration-fixes', 'accepted-browser-fixes']};
}

function validateObservation(observation) {
  assert.equal(observation.format, 'sabalan-original-owner-install-readonly-guard/v1');
  assert.equal(observation.readOnly, true); assert.equal(observation.productionAdmission, false);
  const {baseline} = observation;
  assert.equal(observation.baselineSha256, sha(canonical(baseline)), 'INSTALL_OBSERVATION_BYTES_CHANGED');
  assert.equal(baseline.creationOnly, true); assert.equal(baseline.activeLeaseCount, 0);
  for (const key of ['configurationSha256', 'operationsReceiptSha256', 'serviceConfigurationSha256', 'migrationLedgerSha256', 'machineUuidSha256', 'kernelBootIdSha256']) assert.match(baseline[key], digest);
  for (const key of ['applicationCommit', 'applicationTree', 'inquiryCommit']) assert.match(baseline[key], commit);
  for (const key of ['protectedFiles', 'cronFiles']) {
    assert.ok(Object.keys(baseline[key]).length > 0);
    for (const [name, row] of Object.entries(baseline[key])) {
      assert.ok(path.posix.isAbsolute(name)); assert.match(row.sha256, digest); assert.ok(Array.isArray(row.identity) && row.identity.length > 0);
    }
  }
  assert.ok(Array.isArray(baseline.lockIdentity) && baseline.lockIdentity.length > 0);
  assert.ok(Array.isArray(baseline.containers) && baseline.containers.length > 0);
  assert.ok(baseline.databaseIdentity && typeof baseline.databaseIdentity.system === 'string');
  assert.ok(Array.isArray(observation.originalChildren) && observation.originalChildren.length > 0);
  for (const child of observation.originalChildren) {
    assert.ok(Number.isSafeInteger(child.pid) && child.pid > 1); assert.equal(child.code, 0); assert.equal(child.signal, null);
  }
  const started = Date.parse(observation.observedAt), completed = Date.parse(observation.completedAt);
  assert.ok(Number.isFinite(started) && completed >= started && completed - started <= 600000
    && Date.now() >= completed && Date.now() - started <= 600000, 'INSTALL_FRESH_ORIGINAL_OBSERVATION_REQUIRED');
  return baseline;
}

/** The caller must obtain currentObservation from the genuine original guard
 * under its inherited FD9, never deserialize it as a runtime capability. */
export function assertImmutableInstallObservation(rendered, currentObservation) {
  const baseline = validateObservation(currentObservation);
  assert.equal(currentObservation.baselineSha256, rendered.guard.baselineSha256, 'INSTALL_CHANGED_INCARNATION_REQUIRES_FRESH_PLAN');
  assert.deepEqual(baseline, rendered.guard.baseline, 'INSTALL_BASELINE_CHANGED');
  return {contentMatched: true, productionAdmission: false};
}

/** Required ticket10 content port, after coordinator source integration. The
 * accepted freeze is a coordinator input, never inferred from old receipts. */
export function assertImmutableSourceFreeze(rendered, freeze) {
  keys(freeze, ['hostCommit', 'hostTree', 'hostPackReceiptSha256']);
  assert.match(freeze.hostCommit, commit); assert.match(freeze.hostTree, commit); assert.match(freeze.hostPackReceiptSha256, digest);
  assert.equal(rendered.sourceFreeze.host.commit, freeze.hostCommit, 'INSTALL_PACK_PREDATES_SOURCE_FREEZE');
  assert.equal(rendered.sourceFreeze.host.tree, freeze.hostTree, 'INSTALL_PACK_PREDATES_SOURCE_FREEZE');
  assert.equal(rendered.sourceFreeze.receipts.hostPack.sha256, freeze.hostPackReceiptSha256, 'INSTALL_PACK_PREDATES_SOURCE_FREEZE');
  return {contentMatched: true, productionAdmission: false};
}

/** Render data only. No executable installer, remote write or native authority
 * is produced. Offline bundle verification/packaging remains coordinator-owned. */
export function renderImmutableInstallInputs(input) {
  keys(input, ['selectionInputs', 'configuration', 'observation', 'operation']);
  assert.match(input.operation, /^[a-f0-9]{32}$/);
  const selection = prepareImmutablePrebuiltInputs(input.selectionInputs), configuration = receipt(input.configuration), observation = receipt(input.observation);
  const baseline = validateObservation(observation);
  assert.equal(configuration.format, 'sabalan-online-original-launcher/v1');
  assert.deepEqual(configuration.prebuiltReleasePlan, {file: input.selectionInputs.controlRoot + '/prebuilt-release-plan.json', sha256: selection.planSha256});
  assert.equal(configuration.hostPackReceiptSha256, selection.plan.operations.receiptSha256);
  assert.equal(baseline.configurationSha256, input.configuration.sha256);
  assert.equal(baseline.operationsReceiptSha256, configuration.hostPackReceiptSha256);
  assert.equal(baseline.applicationCommit, selection.plan.applicationCommit);
  assert.equal(baseline.applicationTree, selection.plan.applicationTree);
  assert.equal(baseline.inquiryCommit, selection.plan.inquirySourceCommit);
  const result = {format: 'sabalan-inert-immutable-install-inputs/v1', operation: input.operation, creationOnly: true,
    plan: selection.plan, planSha256: selection.planSha256, privateFiles: selection.privateFiles, sourceFreeze: selection.sourceFreeze, unchangedFrontend: selection.unchangedFrontend,
    configuration: structuredClone(input.configuration), observation: structuredClone(input.observation),
    guard: {baseline, baselineSha256: observation.baselineSha256, freshOriginalObservationRequired: true},
    offlineSource: {application: {installTarget: selection.sourceFreeze.application.commit, installTree: selection.sourceFreeze.application.tree,
      closureTip: selection.sourceFreeze.host.commit, closureTipTree: selection.sourceFreeze.host.tree}, inquiry: {installTarget: selection.sourceFreeze.inquiryCommit},
      bundleProductionRequired: true, remotePrerequisiteVerificationRequired: true},
    finalPackagingReady: false, pendingIntegration: selection.pendingIntegration, productionAdmission: false, runtimeStarted: false};
  return {...result, contentSha256: sha(canonical(result))};
}
