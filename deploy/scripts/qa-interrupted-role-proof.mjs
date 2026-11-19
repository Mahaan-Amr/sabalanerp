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

  const entries = journalBytes.toString('utf8').trimEnd().split('\n').map(line => JSON.parse(line));
  const phases = [];
  let journalHead = null;
  entries.forEach(({ hash, ...entry }, index) => {
    assert.ok(entry.deploymentId === deploymentId && entry.sequence === index + 1);
    assert.equal(entry.previousHash, journalHead);
    assert.equal(hash, sha(JSON.stringify(entry)));
    if (entry.phase !== phases.at(-1)) phases.push(entry.phase);
    journalHead = hash;
  });
  assert.deepEqual(phases, expectedPhases);
  assert.ok(entries.slice(entries.findIndex(entry => entry.phase === phase) + 1)
    .every(entry => entry.event === 'lease-heartbeat'));

  const leaseTokenSha256 = sha(leaseToken);
  for (const kind of ['mutation', 'rollback']) {
    const deadline = deadlines[kind];
    assert.ok(deadline.format === 'sabalan-predecessor-role-deadline-v1' && deadline.kind === kind);
    assert.deepEqual(deadline.clock, clock);
    assert.ok(deadline.deploymentId === deploymentId && deadline.releaseId === releaseId
      && deadline.targetCommit === targetCommit && deadline.leaseTokenSha256 === leaseTokenSha256);
    assert.equal(deadline.budgetSeconds, 900);
    assert.ok(BigInt(deadline.deadlineNs) - BigInt(deadline.startedNs) === 900_000_000_000n
      && BigInt(deadline.deadlineNs) <= monotonicNs);
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
    const [{ intentBytes, result: child }] = matches;
    const intent = JSON.parse(intentBytes);
    assert.equal(child.intentSha256, sha(intentBytes));
    for (const field of ['action', 'attemptId', 'deploymentId', 'releaseId', 'phase',
      'checkpointSha256', 'checkpointMetadataSha256', 'canOpenTraffic']) {
      assert.equal(intent[field], child[field]);
    }
    assert.equal(child.canOpenTraffic, false);
    assert.ok(child.deploymentId === deploymentId && child.releaseId === releaseId && child.phase === phase);
    assert.ok(child.checkpointSha256 === checkpointSha256 && child.checkpointMetadataSha256 === checkpointMetadataSha256);
    assert.ok(child.childClosed && child.stdoutClosed && child.stderrClosed && child.intentUnchanged);
    assert.ok(!child.credentialEchoed && !child.deadlineExceeded && !child.heartbeatFailed
      && !child.inputFailed && !child.outputOverflow && !child.streamFailed && child.interruptSignals.length === 0);
    assert.equal(child.returnCode, returnCode);
    assert.equal(child.outcome, outcome);
  }

  return { deploymentId, releaseId, targetCommit, checkpointSha256, checkpointMetadataSha256,
    journalSha256: sha(journalBytes), journalHead, journalEntries: entries.length };
}

function inspect() {
  const [plan, planSha, originalEnv] = process.argv.slice(2);
  assert.equal(process.argv.length, 5);
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
    "'completed',\"completedAt\" IS NOT NULL,'advisoryHolders',(SELECT count(*) FROM pg_locks" +
    " WHERE locktype='advisory' AND classid=0 AND objid=741936425 AND objsubid=1),'runtimeSessions'," +
    "(SELECT count(*) FROM pg_stat_activity WHERE usename IN ('sabalan_application_runtime','sabalan_allocation_controller')))" +
    " FROM deployment_operations WHERE id='" + operation + "';\nROLLBACK;\n");
  const result = proveInterruptedRoleCutover({
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
  });
  console.log(JSON.stringify({ format: 'sabalan-qa-interrupted-role-evidence/v1', ...result }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    inspect();
  } catch {
    process.stderr.write('QA_INTERRUPTED_ROLE_EVIDENCE_UNPROVEN\n');
    process.exitCode = 1;
  }
}
