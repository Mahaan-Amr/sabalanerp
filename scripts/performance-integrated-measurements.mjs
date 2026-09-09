import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PERFORMANCE_ACCEPTANCE_INTEGRATED_CHECKS } from './performance-acceptance-contract.mjs';
import { canonicalPerformanceEvidence as canonical } from './performance-evidence-canonical.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const wrapperChecks = new Map([
  ['performance-foundation-database', 'personnelPerformanceFoundation'],
  ['performance-disclosure-database', 'personnelPerformanceDisclosure'],
  ['performance-operations-database', 'personnelPerformanceOperations'],
]);

export const collectIntegratedRegressionMeasurements = async ({ report, review, directory }) => {
  if (report?.status !== 'PASS' || report.blockers?.length
    || canonical(report.identity) !== canonical(report.finalIdentity)) {
    throw new Error('INTEGRATED_REPORT_NOT_STABLE_PASS');
  }
  if (review?.schemaVersion !== 1 || review.contract !== 'PERSONNEL_PERFORMANCE_CODE_REVIEW_V1'
    || review.commit !== report.identity?.commit) throw new Error('INTEGRATED_REVIEW_CANDIDATE_MISMATCH');
  for (const axis of ['standards', 'spec']) {
    if (review[axis]?.status !== 'PASS' || !Array.isArray(review[axis]?.findings)) {
      throw new Error('INTEGRATED_REVIEW_INCOMPLETE');
    }
  }
  const shared = report.checks?.find(({ name }) => name === 'performance-shared-client-database');
  let sharedLog = '';
  if (shared?.status === 'PASS' && typeof shared.log === 'string' && path.basename(shared.log) === shared.log) {
    const bytes = await readFile(path.join(directory, shared.log));
    if (hash(bytes) !== shared.logHash) throw new Error('INTEGRATED_SHARED_LOG_HASH_MISMATCH');
    sharedLog = bytes.toString('utf8');
  }
  const checks = PERFORMANCE_ACCEPTANCE_INTEGRATED_CHECKS.map((name) => {
    const direct = report.checks?.filter((check) => check.name === name && check.status === 'PASS') ?? [];
    const wrapped = wrapperChecks.get(name);
    const passed = direct.length === 1 || Boolean(wrapped
      && shared?.status === 'PASS'
      && sharedLog.split(/\r?\n/).filter(Boolean).filter((line) => line === `PASS ${wrapped}`).length === 1);
    if (!passed) throw new Error(`INTEGRATED_CHECK_MISSING:${name}`);
    return { name, status: 'PASS' };
  });
  const findings = [...review.standards.findings, ...review.spec.findings];
  const severity = (finding) => String(finding?.severity ?? finding?.priority ?? '').toUpperCase();
  return {
    checks,
    openP0: findings.filter((finding) => severity(finding) === 'P0').length,
    openP1: findings.filter((finding) => severity(finding) === 'P1').length,
    skipped: (report.checks ?? []).filter(({ status }) => status === 'SKIP' || status === 'ABSENT').length,
  };
};
