import { createHash, verify } from 'node:crypto';
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  PERFORMANCE_ACCEPTANCE_DEFERRALS,
  PERFORMANCE_ACCEPTANCE_LANES,
  validPerformanceCandidateIdentity,
} from './performance-acceptance-contract.mjs';
import { runProcessGroup } from './performance-local-verification.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const canonical = (value) => JSON.stringify(value, function (_key, item) {
  return item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item;
});

const hasValidAttestation = (laneResult, measurementPublicKey) => {
  try {
    const { measurementAttestation, ...unsigned } = laneResult;
    return measurementAttestation?.keyId === measurementPublicKey?.keyId
      && measurementAttestation?.algorithm === 'Ed25519'
      && verify(null, Buffer.from(canonical(unsigned)), measurementPublicKey.publicKey,
        Buffer.from(measurementAttestation.signature, 'base64'));
  } catch {
    return false;
  }
};

export async function runPerformanceAcceptance({ directory, checks, identity, measurementPublicKey }) {
  const names = Array.isArray(checks) ? checks.map(({ name }) => name) : [];
  if (names.length !== PERFORMANCE_ACCEPTANCE_LANES.length
    || new Set(names).size !== names.length
    || !PERFORMANCE_ACCEPTANCE_LANES.every((name) => names.includes(name))) {
    throw new Error('Candidate handoff requires the exact acceptance lanes');
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const reportPath = path.join(directory, 'report.json');
  const report = {
    schemaVersion: 1,
    contract: 'PERSONNEL_PERFORMANCE_CANDIDATE_HANDOFF_V1',
    startedAt: new Date().toISOString(),
    status: 'RUNNING',
    candidateHandoffReady: false,
    independentQaAuthorized: false,
    promotionDecision: 'NOT_EVALUATED',
    productionActivationAuthorized: false,
    identity: await identity(),
    deferrals: PERFORMANCE_ACCEPTANCE_DEFERRALS,
    checks: [],
    blockers: [],
  };
  if (!validPerformanceCandidateIdentity(report.identity)) report.blockers.push('CANDIDATE_IDENTITY_UNATTESTED');
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });

  for (const [index, check] of checks.entries()) {
    const output = `${index}-${check.name}.log`;
    const handle = await open(path.join(directory, output), 'wx', 0o600);
    const started = performance.now();
    let result;
    try {
      result = await runProcessGroup(check, handle.fd);
    } finally {
      await handle.close();
    }
    const outputBytes = await readFile(path.join(directory, output));
    let laneResult;
    try {
      const lines = outputBytes.toString('utf8').trim().split('\n').filter(Boolean);
      laneResult = JSON.parse(lines.at(-1));
    } catch {
      laneResult = null;
    }
    const validLaneResult = laneResult?.schemaVersion === 1
      && laneResult.contract === 'PERSONNEL_PERFORMANCE_ACCEPTANCE_LANE_V1'
      && laneResult.lane === check.name
      && laneResult.status === 'PASS'
      && laneResult.productionActivationAuthorized === false
      && laneResult.candidateIdentityHash === hash(canonical(report.identity))
      && hasValidAttestation(laneResult, measurementPublicKey);
    const passed = result.exitCode === 0 && !result.timedOut && !result.interrupted && validLaneResult;
    report.checks.push({
      name: check.name,
      command: [check.command, ...(check.args ?? [])],
      status: passed ? 'PASS' : 'FAIL',
      ...(!validLaneResult ? { reason: 'INVALID_LANE_RESULT' } : {}),
      ...result,
      durationMs: performance.now() - started,
      observedAt: new Date().toISOString(),
      output,
      outputHash: hash(outputBytes),
    });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    if (result.interrupted) break;
  }

  try {
    report.finalIdentity = await identity();
    if (!validPerformanceCandidateIdentity(report.finalIdentity)
      && !report.blockers.includes('CANDIDATE_IDENTITY_UNATTESTED')) report.blockers.push('CANDIDATE_IDENTITY_UNATTESTED');
    if (JSON.stringify(report.identity) !== JSON.stringify(report.finalIdentity)) report.blockers.push('CANDIDATE_CHANGED');
  } catch {
    report.blockers.push('CANDIDATE_IDENTITY_UNAVAILABLE');
  }
  const checksPassed = report.checks.length === checks.length && report.checks.every(({ status }) => status === 'PASS');
  if (report.blockers.length) report.status = 'BLOCKED';
  else if (!checksPassed) report.status = 'FAIL';
  else {
    report.status = 'PASS_WITH_DEFERRALS';
    report.candidateHandoffReady = true;
    report.independentQaAuthorized = true;
    report.promotionDecision = 'BLOCKED_DEFERRED_INPUTS';
  }
  report.finishedAt = new Date().toISOString();
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  return report;
}
