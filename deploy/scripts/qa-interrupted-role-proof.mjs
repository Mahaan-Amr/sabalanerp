import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const expectedPhases = [
  'PREFLIGHT', 'LEASE_ACQUIRED', 'MAINTENANCE_REQUESTED', 'TRAFFIC_BLOCKED',
  'SERVICES_DRAINED', 'LOCAL_CHECKPOINT_VERIFIED', 'REMOTE_CHECKPOINT_VERIFIED', 'MUTATION_STARTED',
];
const recoveryActions = [
  ['stage-predecessor-role-grants', 0, 'CLOSED'],
  ['activate-predecessor-runtime-login', 0, 'CLOSED'],
  ['recreate-backend', 1, 'HELD'],
];

function readJournal(journalBytes, deploymentId) {
  const entries = journalBytes.toString('utf8').trimEnd().split('\n').map(line => JSON.parse(line));
  let head = null;
  entries.forEach(({ hash, ...entry }, index) => {
    assert.ok(entry.deploymentId === deploymentId && entry.sequence === index + 1);
    assert.equal(entry.previousHash, head);
    assert.equal(hash, sha(JSON.stringify(entry)));
    head = hash;
  });
  return entries;
}

function assertDeadline(deadline, kind, clock, monotonicNs, session) {
  assert.ok(deadline.format === 'sabalan-predecessor-role-deadline-v1' && deadline.kind === kind);
  assert.deepEqual(deadline.clock, clock);
  assert.ok(deadline.deploymentId === session.deploymentId && deadline.releaseId === session.releaseId
    && deadline.targetCommit === session.targetCommit && deadline.leaseTokenSha256 === sha(session.leaseToken));
  assert.equal(deadline.budgetSeconds, 900);
  assert.ok(BigInt(deadline.deadlineNs) - BigInt(deadline.startedNs) === 900_000_000_000n);
  return BigInt(deadline.deadlineNs) <= monotonicNs;
}

function assertNativeChild({ intentBytes, result: child }, action, returnCode, outcome, phase, binding) {
  const intent = JSON.parse(intentBytes);
  assert.equal(child.intentSha256, sha(intentBytes));
  for (const field of ['action', 'attemptId', 'deploymentId', 'releaseId', 'phase',
    'checkpointSha256', 'checkpointMetadataSha256', 'canOpenTraffic']) {
    assert.equal(intent[field], child[field]);
  }
  assert.equal(child.action, action);
  assert.equal(child.canOpenTraffic, false);
  assert.equal(child.phase, phase);
  for (const field of ['deploymentId', 'releaseId', 'checkpointSha256', 'checkpointMetadataSha256']) {
    assert.equal(child[field], binding[field]);
  }
  assert.ok(child.childClosed && child.stdoutClosed && child.stderrClosed && child.intentUnchanged);
  assert.ok(!child.credentialEchoed && !child.deadlineExceeded && !child.heartbeatFailed
    && !child.inputFailed && !child.outputOverflow && !child.streamFailed && child.interruptSignals.length === 0);
  assert.equal(child.returnCode, returnCode);
  assert.equal(child.outcome, outcome);
}

/** Only accepts the observed interrupted cutover shape. This proof cannot claim or renew a lease. */
export function proveInterruptedRoleCutover({
  session, journalBytes, checkpoint, configuration, currentEnvironment, nativeChildren,
  deadlines, clock, monotonicNs, database, openingIntentExists,
}) {
  const { deploymentId, releaseId, targetCommit, leaseToken, phase } = session;
  assert.ok(session.purpose === 'predecessor-role-cutover' && session.bootstrap === false);
  assert.equal(phase, 'MUTATION_STARTED');
  assert.ok(/^[a-f0-9]{64}$/.test(leaseToken));
  assert.equal(openingIntentExists, false);
  assert.ok(database.active && database.expired && !database.completed && database.phase === phase);
  assert.ok(database.deploymentId === deploymentId && database.leaseToken === leaseToken);
  assert.equal(database.runtimeSessions, 0);
  assert.equal(database.advisoryHolders, 0);

  const entries = readJournal(journalBytes, deploymentId);
  const phases = [];
  for (const entry of entries) {
    if (entry.phase !== phases.at(-1)) phases.push(entry.phase);
  }
  assert.deepEqual(phases, expectedPhases);
  assert.ok(entries.slice(entries.findIndex(entry => entry.phase === phase) + 1)
    .every(entry => entry.event === 'lease-heartbeat'));

  for (const kind of ['mutation', 'rollback']) {
    assert.ok(assertDeadline(deadlines[kind], kind, clock, monotonicNs, session));
  }

  const identity = { deploymentId, releaseId, targetCommit };
  for (const [name, value] of Object.entries(identity)) assert.equal(checkpoint[name], value);
  assert.deepEqual(checkpoint.rollbackReleaseSet, session.rollbackReleaseSet);
  assert.ok(checkpoint.localVerified && checkpoint.remoteVerified && checkpoint.localRestoreVerified);
  const checkpointSha256 = checkpoint.checksum;
  const checkpointMetadataSha256 = checkpoint.canonicalMetadataSha256;
  assert.ok([checkpointSha256, checkpointMetadataSha256].every(value => /^[a-f0-9]{64}$/.test(value)));
  const prior = Buffer.from(configuration.previous, 'base64');
  assert.ok(prior.length > 0 && sha(prior) === configuration.previousSha256);
  assert.equal(sha(currentEnvironment), configuration.targetSha256);
  assert.ok(configuration.targetSha256 !== configuration.previousSha256);
  for (const [name, value] of Object.entries({ ...identity, checkpointSha256, checkpointMetadataSha256 })) {
    assert.equal(configuration.binding[name], value);
  }
  assert.deepEqual(configuration.binding.rollbackReleaseSet, session.rollbackReleaseSet);

  assert.equal(nativeChildren.length, recoveryActions.length);
  for (const [action, returnCode, outcome] of recoveryActions) {
    const matches = nativeChildren.filter(child => child.result.action === action);
    assert.equal(matches.length, 1);
    assertNativeChild(matches[0], action, returnCode, outcome, phase, configuration.binding);
  }

  return { deploymentId, releaseId, targetCommit, checkpointSha256, checkpointMetadataSha256,
    journalSha256: sha(journalBytes), journalHead: entries.at(-1).hash, journalEntries: entries.length };
}

function proveInterruptedRollback({ session, journalBytes, checkpoint, configuration, currentEnvironment,
  nativeChildren, deadlines, clock, monotonicNs, database, openingIntentExists }, evidenceSha, recordedAttemptSha, read, get, transaction) {
  const { deploymentId, releaseId, targetCommit, phase } = session;
  assert.equal(phase, 'ROLLBACK_STARTED');
  assert.ok(session.purpose === 'predecessor-role-cutover' && session.bootstrap === false && !openingIntentExists);
  assert.ok(database.active && !database.completed && database.phase === phase && database.deploymentId === deploymentId
    && database.leaseToken === session.leaseToken && database.runtimeSessions === 0 && database.advisoryHolders === 0
    && database.restrictedLogins === 0);
  const attemptBytes = read(transaction + '/interrupted-recovery-attempt.json');
  const attempt = JSON.parse(attemptBytes);
  const prior = attempt.evidence;
  const priorBytes = JSON.stringify(prior, Object.keys(prior).sort()) + '\n';
  assert.ok(attempt.format === 'sabalan-qa-interrupted-role-recovery-attempt/v1'
    && attempt.evidenceSha256 === evidenceSha && sha(priorBytes) === evidenceSha
    && prior.format === 'sabalan-qa-interrupted-role-evidence/v1');
  const entries = readJournal(journalBytes, deploymentId);
  const originalLines = journalBytes.toString('utf8').split('\n').slice(0, prior.journalEntries);
  assert.equal(sha(originalLines.join('\n') + '\n'), prior.journalSha256);
  assert.equal(entries[prior.journalEntries - 1].hash, prior.journalHead);
  const advance = entries.slice(prior.journalEntries);
  assert.ok(advance.length >= 3);
  assert.ok(advance[0].phase === 'MUTATION_STARTED' && advance[0].event === 'lease-heartbeat');
  assert.ok(advance[1].phase === phase && advance[1].event === 'phase-transition');
  assert.ok(advance.slice(2).every(entry => entry.phase === phase && entry.event === 'lease-heartbeat'));

  const historicalClock = read(transaction + '/interrupted-recovery-original-rollback-deadline.json');
  assert.equal(sha(historicalClock), attempt.originalRollbackDeadlineSha256);
  assert.ok(assertDeadline(JSON.parse(historicalClock), 'rollback', clock, monotonicNs, session));
  assert.ok(assertDeadline(deadlines.mutation, 'mutation', clock, monotonicNs, session));
  const activeDeadlineExpired = assertDeadline(deadlines.rollback, 'rollback', clock, monotonicNs, session);
  const rollbackArchive = recordedAttemptSha
    ? read(transaction + '/interrupted-recovery-resume-previous-rollback-deadline.json') : null;
  const rollbackDeadline = rollbackArchive ? JSON.parse(rollbackArchive) : deadlines.rollback;
  const rollbackDeadlineExpired = assertDeadline(rollbackDeadline, 'rollback', clock, monotonicNs, session);
  const originalBinding = { deploymentId, releaseId, targetCommit, checkpointSha256: checkpoint.checksum,
    checkpointMetadataSha256: checkpoint.canonicalMetadataSha256 };
  for (const [key, value] of Object.entries(originalBinding)) {
    assert.equal(prior[key], value);
    assert.equal(configuration.binding[key], value);
  }
  assert.ok(checkpoint.localVerified && checkpoint.remoteVerified && checkpoint.localRestoreVerified);
  assert.deepEqual(checkpoint.rollbackReleaseSet, session.rollbackReleaseSet);
  assert.deepEqual(configuration.binding.rollbackReleaseSet, session.rollbackReleaseSet);
  const previous = Buffer.from(configuration.previous, 'base64');
  assert.ok(previous.length > 0 && sha(previous) === configuration.previousSha256 && previous.equals(currentEnvironment));
  const receipt = get(transaction + '/receipt.json');
  assert.deepEqual(receipt, { format: 'sabalan-predecessor-role-host-config-v1', ...configuration.binding,
    stageReceiptSha256: configuration.stageReceiptSha256, state: 'RESTORED' });

  assert.equal(nativeChildren.length, 4);
  assert.equal(fs.readdirSync(transaction).filter(name => /^native-.+-intent\.json$/.test(name)).length, 4);
  for (const [action, status, outcome] of recoveryActions) {
    const matches = nativeChildren.filter(child => child.result.action === action);
    assert.equal(matches.length, 1);
    assertNativeChild(matches[0], action, status, outcome, 'MUTATION_STARTED', originalBinding);
  }
  const restoration = nativeChildren.find(child => child.result.action === 'restore-predecessor-role-grants');
  assertNativeChild(restoration, 'restore-predecessor-role-grants', 0, 'CLOSED', phase, originalBinding);
  const resumedFiles = fs.readdirSync(transaction).filter(name => name.startsWith('interrupted-recovery-resume'));
  assert.ok(!fs.readdirSync(transaction).some(name => /restored-(?:intent|proof)\.json$/.test(name)));
  const proof = {
    format: 'sabalan-qa-interrupted-role-rollback-evidence/v1', ...originalBinding,
    priorAttemptSha256: sha(attemptBytes), journalSha256: sha(journalBytes), journalHead: entries.at(-1).hash,
    journalEntries: entries.length, restoredEnvironmentSha256: configuration.previousSha256,
    restoreGrantsChildIntentSha256: restoration.result.intentSha256,
    receiptSha256: sha(read(transaction + '/receipt.json')), leaseExpiresAt: database.leaseExpiresAt,
    rollbackDeadline: rollbackDeadline.deadlineNs,
    ready: database.expired && rollbackDeadlineExpired,
  };
  if (!recordedAttemptSha) {
    assert.equal(resumedFiles.length, 0);
    return proof;
  }
  assert.deepEqual(resumedFiles.sort(), ['interrupted-recovery-resume-attempt.json',
    'interrupted-recovery-resume-previous-rollback-deadline.json']);
  const resumedRaw = read(transaction + '/interrupted-recovery-resume-attempt.json');
  const resumed = JSON.parse(resumedRaw);
  assert.ok(sha(resumedRaw) === recordedAttemptSha && resumed.format === 'sabalan-qa-interrupted-role-recovery-resume-attempt/v1');
  assert.equal(resumed.originalRollbackDeadlineSha256, sha(rollbackArchive));
  assert.deepEqual(resumed.evidence, proof);
  assert.equal(resumed.evidenceSha256, sha(JSON.stringify(proof, Object.keys(proof).sort()) + '\n'));
  assert.ok(BigInt(deadlines.rollback.startedNs) >= BigInt(rollbackDeadline.deadlineNs));
  return { ...proof, format: 'sabalan-qa-recorded-role-resume-evidence/v1', recordedAttemptSha,
    rollbackDeadline: deadlines.rollback.deadlineNs, ready: proof.ready && !activeDeadlineExpired };
}

function inspect() {
  const [plan, planSha, originalEnv, evidenceSha, recordedAttemptSha] = process.argv.slice(2);
  assert.ok(process.argv.length === 5 || ((process.argv.length === 6 || process.argv.length === 7)
    && /^[a-f0-9]{64}$/.test(evidenceSha) && (!recordedAttemptSha || /^[a-f0-9]{64}$/.test(recordedAttemptSha))));
  const root = '/opt/sabalanerp';
  const qa = '/srv/sabalanerp-qa';
  const reports = qa + '/reports';
  const operation = 'deploy-20261119T121323Z-54074c54f196-configuration';
  const transaction = root + '/.deploy-state/predecessor-role-host-' + operation;
  assert.ok(process.platform === 'linux' && process.getuid() === 0 && process.cwd() === root);
  const lock = fs.lstatSync(root + '/.deploy-state/deployment.lock', { bigint: true });
  const descriptor = fs.fstatSync(9, { bigint: true });
  assert.ok(lock.isFile() && lock.uid === 0n && lock.nlink === 1n && !(lock.mode & 0o022n)
    && lock.dev === descriptor.dev && lock.ino === descriptor.ino);
  const fdinfo = fs.readFileSync('/proc/self/fdinfo/9', 'utf8');
  assert.match(fdinfo, new RegExp('^lock:\\s+\\d+:\\s+FLOCK\\s+ADVISORY\\s+WRITE\\s+\\S+\\s+[0-9a-f]+:[0-9a-f]+:' + lock.ino + '\\s+0\\s+EOF\\s*$', 'm'));

  const run = (command, args, input) => execFileSync(command, args, {
    input, encoding: 'utf8', timeout: 30_000, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'ignore'],
  }).trim();
  const selector = fileURLToPath(new URL('./qa-rehearsal-target.mjs', import.meta.url));
  assert.equal(run(process.execPath, [selector, plan, planSha, root, originalEnv]), 'docker-compose.rehearsal.yml');

  const read = file => {
    const st = fs.lstatSync(file);
    assert.ok(fs.realpathSync(file) === file && st.isFile() && st.uid === 0 && st.nlink === 1
      && !(st.mode & 0o077) && st.size > 0 && st.size <= 4 * 1024 * 1024);
    return fs.readFileSync(file);
  };
  const get = file => JSON.parse(read(file));
  const session = get(reports + '/active-deployment-session.json');
  assert.equal(session.deploymentId, operation);
  const configuration = get(transaction + '/configuration-private.json');
  assert.equal(sha(read(originalEnv)), configuration.previousSha256);
  assert.ok(configuration.environment.startsWith(qa + '/private/'));

  const services = Object.entries(session.rollbackReleaseSet);
  assert.equal(services.length, 6);
  for (const [service, image] of services) {
    assert.ok(['backend', 'frontend', 'inquiry', 'nginx', 'postgres', 'clamav'].includes(service));
    const actual = run('docker', ['inspect', '--format', '{{.Image}} {{.State.Running}}', 'sabalanerp-' + service + '-1']);
    assert.equal(actual, image + ' ' + String(['nginx', 'postgres', 'clamav'].includes(service)));
  }
  for (const domain of ['erp.qa.test', 'inquiry.qa.test']) {
    assert.equal(run('curl', ['-sS', '--cacert', qa + '/tls-stage/ca.crt', '--max-time', '10',
      '-o', '/dev/null', '-w', '%{http_code}', 'https://' + domain + '/']), '503');
  }
  const coordination = run('docker', ['volume', 'inspect', 'sabalanerp_recovery_coordination', '--format', '{{.Mountpoint}}']);
  const marker = get(coordination + '/deployment-maintenance.json');
  assert.ok(marker.deploymentId === operation && marker.releaseId === session.releaseId);
  const db = run('docker', ['exec', '-i', 'sabalanerp-postgres-1', 'sh', '-c',
    'exec psql -XAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d sabalanerp_qa_432'], 'BEGIN READ ONLY;\n' +
    "SELECT json_build_object('deploymentId',id,'leaseToken',\"leaseToken\",'phase',phase," +
    "'active',\"activeKey\" IS NOT NULL,'expired',\"leaseExpiresAt\"<clock_timestamp()," +
    "'completed',\"completedAt\" IS NOT NULL,'leaseExpiresAt',\"leaseExpiresAt\"," +
    "'restrictedLogins',(SELECT count(*) FROM pg_roles WHERE rolcanlogin AND rolname IN " +
    "('sabalan_application_runtime','sabalan_allocation_controller')),'advisoryHolders',(SELECT count(*) FROM pg_locks" +
    " WHERE locktype='advisory' AND classid=0 AND objid=741936425 AND objsubid=1),'runtimeSessions'," +
    "(SELECT count(*) FROM pg_stat_activity WHERE usename IN ('sabalan_application_runtime','sabalan_allocation_controller')))" +
    " FROM deployment_operations WHERE id='" + operation + "';\nROLLBACK;\n");
  const input = {
    session, journalBytes: read(reports + '/active-deployment.jsonl'),
    checkpoint: get(coordination + '/deployment-checkpoint.json'),
    configuration, currentEnvironment: read(configuration.environment),
    nativeChildren: fs.readdirSync(transaction).filter(name => /^native-.+-result\.json$/.test(name)).map(name => ({
      result: get(transaction + '/' + name), intentBytes: read(transaction + '/' + name.replace('-result.json', '-intent.json')),
    })),
    deadlines: Object.fromEntries(['mutation', 'rollback'].map(kind =>
      [kind, get(reports + '/predecessor-role-' + operation + '-' + kind + '-deadline.json')])),
    clock: { bootId: fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(), timeNamespace: fs.readlinkSync('/proc/self/ns/time') },
    monotonicNs: process.hrtime.bigint(), database: JSON.parse(db.split('\n').find(line => line.startsWith('{'))),
    openingIntentExists: fs.existsSync(reports + '/predecessor-role-cutover-open-intent.json'),
  };
  const result = evidenceSha ? proveInterruptedRollback(input, evidenceSha, recordedAttemptSha, read, get, transaction)
    : { format: 'sabalan-qa-interrupted-role-evidence/v1', ...proveInterruptedRoleCutover(input) };
  console.log(JSON.stringify(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    inspect();
  } catch {
    process.stderr.write('QA_INTERRUPTED_ROLE_EVIDENCE_UNPROVEN\n');
    process.exitCode = 1;
  }
}
