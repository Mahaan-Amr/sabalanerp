import { createHash, sign, verify } from 'node:crypto';
import { appendFile, mkdir, open, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  PERFORMANCE_ACCEPTANCE_DEFERRALS,
  PERFORMANCE_ACCEPTANCE_LANES,
  validPerformanceCandidateIdentityShape,
  validatePerformanceAcceptanceLane,
} from './performance-acceptance-contract.mjs';
import { canonicalPerformanceEvidence as canonical } from './performance-evidence-canonical.mjs';
import { runProcessGroup } from './performance-local-verification.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const MAX_EVIDENCE_AGE_MS = 24 * 60 * 60 * 1000;
const trustedKeyId = (value) => typeof value === 'string' && Boolean(value.trim())
  && !/^(change|replace|example|placeholder|local|test|fixture)/i.test(value);

const verifyCandidateIdentity = (identity, candidatePublicKey) => {
  if (!validPerformanceCandidateIdentityShape(identity)
    || !trustedKeyId(candidatePublicKey?.keyId)
    || candidatePublicKey?.publicKey?.asymmetricKeyType !== 'ed25519'
    || identity.runtimeSourceBinding.keyId !== candidatePublicKey.keyId) return false;
  try {
    const { runtimeSourceBinding, ...release } = identity;
    const { signature, ...binding } = runtimeSourceBinding;
    return verify(null, Buffer.from(canonical({ release, binding })), candidatePublicKey.publicKey,
      Buffer.from(signature, 'base64'));
  } catch {
    return false;
  }
};

const verifyLaneResult = (laneResult, lane, identity, measurementPublicKey) => {
  try {
    const { measurementAttestation, ...unsigned } = laneResult;
    const observedAt = Date.parse(laneResult.observedAt);
    return laneResult.schemaVersion === 1
      && laneResult.contract === 'PERSONNEL_PERFORMANCE_ACCEPTANCE_LANE_V1'
      && laneResult.lane === lane
      && laneResult.status === 'PASS'
      && laneResult.productionActivationAuthorized === false
      && laneResult.candidateIdentityHash === hash(canonical(identity))
      && typeof laneResult.command === 'string' && Boolean(laneResult.command.trim())
      && Number.isFinite(laneResult.durationMs) && laneResult.durationMs >= 0
      && /^[a-f0-9]{64}$/.test(laneResult.rawEvidenceHash)
      && Number.isFinite(observedAt) && observedAt <= Date.now() && Date.now() - observedAt <= MAX_EVIDENCE_AGE_MS
      && validatePerformanceAcceptanceLane(lane, laneResult.measurements, laneResult.observedAt, identity.infrastructureHash)
      && trustedKeyId(measurementPublicKey?.keyId)
      && measurementPublicKey?.publicKey?.asymmetricKeyType === 'ed25519'
      && measurementAttestation?.keyId === measurementPublicKey?.keyId
      && measurementAttestation?.algorithm === 'Ed25519'
      && verify(null, Buffer.from(canonical(unsigned)), measurementPublicKey.publicKey,
        Buffer.from(measurementAttestation.signature, 'base64'));
  } catch {
    return false;
  }
};

const appendEvent = (eventsPath, event) => appendFile(eventsPath, `${canonical(event)}\n`, { mode: 0o600 });

export async function runPerformanceAcceptance({
  directory, checks, identity, measurementPublicKey, candidatePublicKey, handoffSigner,
}) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const runningPath = path.join(directory, 'running.json');
  const reportPath = path.join(directory, 'report.json');
  const eventsPath = path.join(directory, 'events.ndjson');
  const supplied = Array.isArray(checks) ? checks : [];
  const suppliedNames = supplied.map(({ name }) => name);
  const exactLanes = suppliedNames.length === PERFORMANCE_ACCEPTANCE_LANES.length
    && new Set(suppliedNames).size === suppliedNames.length
    && PERFORMANCE_ACCEPTANCE_LANES.every((name) => suppliedNames.includes(name));
  let initialIdentity = null;
  let initialIdentityUnavailable = false;
  try {
    initialIdentity = await identity();
  } catch {
    initialIdentityUnavailable = true;
  }
  const report = {
    schemaVersion: 1,
    contract: 'PERSONNEL_PERFORMANCE_CANDIDATE_HANDOFF_V1',
    startedAt: new Date().toISOString(),
    status: 'RUNNING',
    candidateHandoffReady: false,
    independentQaAuthorized: false,
    promotionDecision: 'NOT_EVALUATED',
    productionActivationAuthorized: false,
    identity: initialIdentity,
    deferrals: PERFORMANCE_ACCEPTANCE_DEFERRALS,
    checks: [],
    blockers: [],
  };
  if (initialIdentityUnavailable) report.blockers.push('CANDIDATE_IDENTITY_UNAVAILABLE');
  if (!exactLanes) report.blockers.push('ACCEPTANCE_LANES_INCOMPLETE');
  if (!verifyCandidateIdentity(initialIdentity, candidatePublicKey)) report.blockers.push('CANDIDATE_IDENTITY_UNATTESTED');
  const validHandoffSigner = trustedKeyId(handoffSigner?.keyId)
    && handoffSigner?.privateKey?.asymmetricKeyType === 'ed25519';
  if (!validHandoffSigner) report.blockers.push('HANDOFF_SIGNER_UNAVAILABLE');
  await writeFile(runningPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  await appendEvent(eventsPath, { type: 'RUN_STARTED', at: report.startedAt, identityHash: hash(canonical(initialIdentity)) });

  for (const lane of PERFORMANCE_ACCEPTANCE_LANES) {
    const matches = supplied.filter(({ name }) => name === lane);
    if (matches.length !== 1) {
      const entry = { name: lane, status: 'ABSENT', reason: 'MISSING_OR_DUPLICATE_LANE' };
      report.checks.push(entry);
      await appendEvent(eventsPath, { type: 'LANE_RECORDED', at: new Date().toISOString(), ...entry });
      continue;
    }
    const check = matches[0];
    const output = `${String(report.checks.length).padStart(2, '0')}-${lane}.log`;
    const handle = await open(path.join(directory, output), 'wx', 0o600);
    const started = performance.now();
    let result;
    try {
      result = await runProcessGroup(check, handle.fd);
    } catch {
      result = { exitCode: null, signal: null, timedOut: false, interrupted: false, executionFailed: true };
    } finally {
      await handle.close();
    }
    const outputBytes = await readFile(path.join(directory, output));
    let laneResult;
    try {
      laneResult = JSON.parse(outputBytes.toString('utf8').trim().split('\n').filter(Boolean).at(-1));
    } catch {
      laneResult = null;
    }
    const validLaneResult = verifyLaneResult(laneResult, lane, initialIdentity, measurementPublicKey);
    const passed = result.exitCode === 0 && !result.timedOut && !result.interrupted && validLaneResult;
    const entry = {
      name: lane,
      command: [check.command, ...(check.args ?? [])],
      status: passed ? 'PASS' : 'FAIL',
      ...(!validLaneResult ? { reason: 'INVALID_LANE_RESULT' } : {}),
      ...result,
      durationMs: performance.now() - started,
      observedAt: new Date().toISOString(),
      output,
      outputHash: hash(outputBytes),
      laneEvidenceHash: validLaneResult ? hash(canonical(laneResult)) : null,
    };
    report.checks.push(entry);
    await appendEvent(eventsPath, { type: 'LANE_RECORDED', at: entry.observedAt, name: lane,
      status: entry.status, outputHash: entry.outputHash, laneEvidenceHash: entry.laneEvidenceHash });
    await writeFile(runningPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    if (result.interrupted) break;
  }

  try {
    report.finalIdentity = await identity();
    if (!verifyCandidateIdentity(report.finalIdentity, candidatePublicKey)
      && !report.blockers.includes('CANDIDATE_IDENTITY_UNATTESTED')) report.blockers.push('CANDIDATE_IDENTITY_UNATTESTED');
    if (canonical(report.identity) !== canonical(report.finalIdentity)) report.blockers.push('CANDIDATE_CHANGED');
  } catch {
    report.blockers.push('CANDIDATE_IDENTITY_UNAVAILABLE');
  }
  const checksPassed = report.checks.length === PERFORMANCE_ACCEPTANCE_LANES.length
    && report.checks.every(({ status }) => status === 'PASS');
  if (report.blockers.length) report.status = 'BLOCKED';
  else if (!checksPassed) report.status = 'FAIL';
  else {
    report.status = 'PASS_WITH_DEFERRALS';
    report.candidateHandoffReady = true;
    report.independentQaAuthorized = true;
    report.promotionDecision = 'BLOCKED_DEFERRED_INPUTS';
  }
  report.finishedAt = new Date().toISOString();
  await appendEvent(eventsPath, { type: 'RUN_READY_FOR_FINALIZATION', at: report.finishedAt, status: report.status });
  const unsignedReport = { ...report, evidenceJournalHash: hash(await readFile(eventsPath)) };
  const finalReport = validHandoffSigner ? { ...unsignedReport, handoffAttestation: {
    keyId: handoffSigner.keyId,
    algorithm: 'Ed25519',
    signature: sign(null, Buffer.from(canonical(unsignedReport)), handoffSigner.privateKey).toString('base64'),
  } } : unsignedReport;
  await writeFile(reportPath, `${JSON.stringify(finalReport, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  await writeFile(runningPath, `${JSON.stringify({ ...report, finalReport: path.basename(reportPath) }, null, 2)}\n`, { mode: 0o600 });
  return finalReport;
}
