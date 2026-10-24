/** Observe one failed local QA rotation without adopting or completing it. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {
  postUpBaselineFormat, postUpFailureContext as context, postUpServices,
  postUpSql, postUpReadReference, readPostUpFailure, postUpAcceptanceExpectation,
  validatePostUpContainers, validatePostUpMemorySamples, postUpStableContainers,
  postUpAuthorityBootstrap, postUpAcceptanceBootstrap,
} from './lib/application-native-post-up-memory-baseline.mjs';
import {authorityWriterRoot} from './lib/application-native-authority-cohort.mjs';
import {qualifiedCandidateNativeQuietProbe} from './replace-qualified-application-native-candidate-local.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const cliFile = fileURLToPath(import.meta.url);
const repository = path.dirname(path.dirname(context.originalSource.file));
const qa = path.resolve('D:/sabalanerp-online-qa');
const compose = ['docker', 'compose', '-f', 'D:/sabalanerp/docker-compose.local.yml', 'ps', '--format', 'json'];
let interrupted = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { interrupted = true; });

function exclusive(file, bytes) {
  const fd = fs.openSync(file, 'wx', 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  return {file, sha256: sha(bytes)};
}
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');

export async function observePostUpBaseline(argv) {
  assert.deepEqual(argv.slice(0, 2), ['--observe', '--output']);
  assert.equal(argv.length, 3);
  const output = path.resolve(argv[2]);
  assert.ok(path.isAbsolute(argv[2]));
  assert.equal(path.dirname(output), qa);
  assert.equal(fs.realpathSync(qa), qa);
  assert.equal(fs.existsSync(output), false);
  const inputs = new Map();
  const failed = readPostUpFailure(inputs);
  const acceptance = postUpAcceptanceExpectation(inputs);
  const quietProbe = qualifiedCandidateNativeQuietProbe(null);
  assert.equal(sha(Buffer.from(quietProbe)), context.nativeQuietProbeSha256);
  const sourceFiles = {
    observer: cliFile,
    reader: fileURLToPath(new URL('./lib/application-native-post-up-memory-baseline.mjs', import.meta.url)),
    installedProbe: context.installedProbe.originalPath,
    authorityProbe: context.authorityProbe.originalPath,
    acceptanceProbe: context.acceptanceProbe.originalPath,
  };
  const sourceRaw = {};
  for (const [key, file] of Object.entries(sourceFiles)) {
    const raw = fs.readFileSync(file);
    const reference = {file, sha256: sha(raw)};
    postUpReadReference(reference, inputs);
    if (context[key]?.sha256) assert.equal(reference.sha256, context[key].sha256);
    sourceRaw[key] = raw;
  }
  fs.mkdirSync(output);
  const sourceDirectory = path.join(output, 'evidence-source');
  fs.mkdirSync(sourceDirectory);
  const sourcePins = Object.fromEntries(Object.entries(sourceRaw).map(([key, raw]) =>
    [key, exclusive(path.join(sourceDirectory, key + (key.endsWith('Probe') && key !== 'installedProbe' ? '.py' : '.mjs')), raw)]));
  const children = [];
  const observations = {};
  const record = {format: postUpBaselineFormat, classification: 'POST_UP_MEMORY_FAILURE_REOBSERVED',
    qualificationSucceeded: false, productionAdmission: false, adoptsOriginalPopen: false,
    nativeCompletionClaimed: false, rotationPerformed: false, failedReportRemainsFailed: true,
    failed: context.failed, originalFailureClosure: context.closure, sourcePins};
  let gitChild;
  const run = async (key, argv, input = null, docker = true) => {
    assert.equal(interrupted, false, 'OBSERVER_INTERRUPTED');
    if (docker) {
      const status = await run('ps-' + key, compose, null, false);
      const rows = status.stdout.toString().trim().split(/\r?\n/).map(JSON.parse);
      assert.equal(rows.length, postUpServices.length);
      assert.deepEqual(rows.map(row => row.Service).sort(), [...postUpServices].sort());
      for (const row of rows) {
        assert.equal(row.Project, 'sabalanerp-local');
        assert.equal(row.State, 'running');
        assert.equal(row.Health, 'healthy');
      }
    }
    const child = spawn(argv[0], argv.slice(1), {cwd: repository, windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']});
    const chunks = {stdout: [], stderr: []};
    const lengths = {stdout: 0, stderr: 0};
    const digests = {stdout: createHash('sha256'), stderr: createHash('sha256')};
    let fault = null;
    for (const stream of ['stdout', 'stderr']) child[stream].on('data', bytes => {
      digests[stream].update(bytes); lengths[stream] += bytes.length;
      if (lengths[stream] <= (stream === 'stdout' ? 8 * 1024 ** 2 : 65536)) chunks[stream].push(bytes);
      else fault ??= stream.toUpperCase() + '_BOUND';
    });
    child.stdin.on('error', error => { fault ??= error.code; });
    child.on('error', error => { fault ??= error.code; });
    const closed = new Promise(resolve => child.on('close', (code, signal) => resolve({code, signal})));
    child.stdin.end(input ?? undefined);
    const result = await closed;
    const stdout = Buffer.concat(chunks.stdout), stderr = Buffer.concat(chunks.stderr);
    const evidence = {format: 'sabalan-post-up-memory-original-readback/v1', argv,
      originalPid: child.pid ?? null, ...result,
      stdoutEof: child.stdout.readableEnded, stderrEof: child.stderr.readableEnded,
      interrupted, observationFault: fault,
      inputBase64: input === null ? null : input.toString('base64'),
      inputSha256: input === null ? null : sha(input),
      stdoutBase64: stdout.toString('base64'), stdoutSha256: digests.stdout.digest('hex'), stdoutBytes: lengths.stdout,
      stderrBase64: stderr.toString('base64'), stderrSha256: digests.stderr.digest('hex'), stderrBytes: lengths.stderr};
    const ref = exclusive(path.join(output, String(children.length).padStart(3, '0') + '-' + key + '.json'), jsonBytes(evidence));
    children.push({ordinal: children.length + 1, key, ref});
    if (docker) observations[key] = ref;
    if (argv[0] === 'git') gitChild = ref;
    assert.equal(result.code, 0, key + ': CHILD_FAILED');
    assert.equal(result.signal, null);
    assert.equal(fault, null);
    assert.equal(evidence.stdoutEof, true);
    assert.equal(evidence.stderrEof, true);
    assert.equal(interrupted, false);
    return {stdout, stderr, ref};
  };
  try {
    const head = (await run('source-head', ['git', 'rev-parse', 'HEAD'], null, false)).stdout.toString().trim();
    assert.match(head, /^[a-f0-9]{40}$/);
    record.sourceCommit = head;
    const sourceHeadOriginal = gitChild;
    const inspectArgs = ['docker', 'inspect', ...postUpServices.map(service => 'sabalanerp-local-' + service + '-1')];
    const before = Object.fromEntries(JSON.parse((await run('inspectBefore', inspectArgs)).stdout).map(c =>
      [c.Config.Labels['com.docker.compose.service'], c]));
    const facts = validatePostUpContainers(before, failed);
    record.identities = facts.identities;
    record.protectedEight = facts.protectedEight;
    record.components = {
      candidate: {image: context.image, material: context.material},
      retained: {image: context.retainedImage, material: context.retainedMaterial},
    };
    const sqlArgs = ['docker', 'exec', before.postgres.Id, 'psql', '-X', '-qAt', '-U', 'postgres', '-d', 'postgres',
      '-v', 'ON_ERROR_STOP=1', '-c', postUpSql];
    await run('sqlBefore', sqlArgs);
    for (const role of ['candidate', 'retained']) {
      const service = 'backend-' + role;
      const cid = before[service].Id;
      await run('image-' + role, ['docker', 'image', 'inspect', before[service].Image]);
      await run('quiet-' + role, ['docker', 'exec', cid, '/usr/bin/python3', '-I', '-B', '-c', quietProbe]);
      await run('installed-' + role, ['docker', 'exec', '-i', cid, 'node', '--input-type=module'], sourceRaw.installedProbe);
      const writer = authorityWriterRoot(before[service], service);
      const peer = 'backend-' + (role === 'candidate' ? 'retained' : 'candidate');
      const authorityInput = jsonBytes({source: sourceRaw.authorityProbe.toString('base64'), spec: {
        mode: 'verify', kind: writer.kind, nonce: failed.authorityCohort.nonce, root: writer.target,
        expected: failed.authorityCohort.verified[service].result.namespace,
        peerExpected: failed.authorityCohort.verified[peer].result.namespace,
      }});
      await run('authority-' + role, ['docker', 'exec', '-i', cid, '/usr/bin/python3', '-I', '-B', '-c', postUpAuthorityBootstrap()], authorityInput);
      const acceptanceInput = jsonBytes({source: sourceRaw.acceptanceProbe.toString('base64'), spec: {
        nonce: acceptance.nonce, expected: acceptance.namespace,
      }});
      await run('acceptance-' + role, ['docker', 'exec', '-i', cid, '/usr/bin/python3', '-I', '-B', '-c', postUpAcceptanceBootstrap()], acceptanceInput);
    }
    const samples = [], history = [];
    const started = performance.now();
    while (performance.now() - started < 60000 && samples.length < 16) {
      assert.equal(interrupted, false);
      const sample = {platform: process.platform, availableBytes: os.freemem(), observedAt: new Date().toISOString()};
      history.push(sample);
      if (sample.platform === 'win32' && sample.availableBytes >= 2 * 1024 ** 3) samples.push(sample);
      else samples.length = 0;
      exclusive(path.join(output, 'memory-sample-' + String(history.length).padStart(3, '0') + '.json'), jsonBytes(sample));
      if (samples.length < 16) await new Promise(resolve => setTimeout(resolve, 2000));
    }
    validatePostUpMemorySamples(samples);
    record.memorySamples = samples;
    await run('sqlAfter', sqlArgs);
    const after = Object.fromEntries(JSON.parse((await run('inspectAfter', inspectArgs)).stdout).map(c =>
      [c.Config.Labels['com.docker.compose.service'], c]));
    const afterFacts = validatePostUpContainers(after, failed);
    assert.deepEqual(afterFacts, facts);
    assert.deepEqual(postUpStableContainers(after), postUpStableContainers(before));
    const headAfter = (await run('source-head-after', ['git', 'rev-parse', 'HEAD'], null, false)).stdout.toString().trim();
    assert.equal(headAfter, head, 'SOURCE_HEAD_CHANGED');
    for (const [file, pin] of inputs) assert.deepEqual(postUpReadReference({file, sha256: pin.sha256}), pin.raw);
    assert.equal(interrupted, false);
    const finalWait = Math.max(0, 2000 - (Date.now() - Date.parse(samples.at(-1).observedAt)));
    if (finalWait) await new Promise(resolve => setTimeout(resolve, finalWait));
    const finalMemory = {platform: process.platform, availableBytes: os.freemem(), observedAt: new Date().toISOString()};
    assert.ok(finalMemory.availableBytes >= 2 * 1024 ** 3, 'FINAL_HOST_MEMORY_FLOOR_REFUSED');
    samples.push(finalMemory);
    validatePostUpMemorySamples(samples);
    exclusive(path.join(output, 'memory-final.json'), jsonBytes(finalMemory));
    for (const [file, pin] of inputs) assert.deepEqual(postUpReadReference({file, sha256: pin.sha256}), pin.raw);
    assert.equal(interrupted, false);
    record.observations = observations;
    record.originalInventory = exclusive(path.join(output, 'original-inventory.json'), jsonBytes({
      format: 'sabalan-post-up-memory-owned-readbacks/v1', children,
    }));
    record.originalChildren = {allOriginalChildrenClosed: true, interrupted: false};
    record.observedAt = new Date().toISOString();
    exclusive(path.join(output, 'observer-diagnostics.json'), jsonBytes({sourceHeadOriginal, sourceHeadAfterOriginal: gitChild,
      memorySampling: {totalSamples: history.length + 1, discardedBeforeStableWindow: history.length + 1 - samples.length},
      qualificationClaimed: false}));
    const ref = exclusive(path.join(output, 'baseline.json'), jsonBytes(record));
    console.log(JSON.stringify({file: ref.file, sha256: ref.sha256, classification: record.classification,
      originalReadbacks: children.length, qualificationSucceeded: false, rotationPerformed: false, productionAdmission: false}));
  } catch (error) {
    exclusive(path.join(output, 'negative-observation.json'), jsonBytes({...record, observations, children,
      observedAt: new Date().toISOString(), originalChildren: {allOriginalChildrenClosed: true, interrupted},
      failure: {name: error.name, message: error.message}}));
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === cliFile) {
  await observePostUpBaseline(process.argv.slice(2));
}
