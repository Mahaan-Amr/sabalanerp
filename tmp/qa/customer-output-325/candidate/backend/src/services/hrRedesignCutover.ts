import type { PrismaClient } from '@prisma/client';
import { runHrRedesignBackfill } from './hrRedesignDataContracts';

type CutoverReport = Awaited<ReturnType<typeof runHrRedesignBackfill>>;

export const HR_REDESIGN_REQUIRED_ACCEPTANCE_GATES = [
  'design-system-check',
  'design-system-foundation',
  'design-system-adoption',
  'design-system-e2e',
  'frontend-build',
  'backend-build',
  'focused-behavior',
  'migrations',
  'docker-verify',
  'authorization-privacy-matrix',
  'visual-rtl-light-dark-desktop-laptop-mobile-200-zoom',
  'backlog-disposition',
  'recovery-rollback',
] as const;

type HrRedesignReleaseAcceptance = {
  issue: 245;
  sourceRevision: string;
  verifiedAt: string;
  checks: Record<typeof HR_REDESIGN_REQUIRED_ACCEPTANCE_GATES[number], 'PASSED'>;
};

export type HrRedesignCutoverBlocker = {
  code: 'PENDING_SAFE_BACKFILLS' | 'ACTIONABLE_CONFLICTS' | 'BLOCKING_FAILURES';
  count: number;
};

export class HrRedesignCutoverBlockedError extends Error {
  constructor(public readonly blockers: HrRedesignCutoverBlocker[]) {
    super(`HR redesign Cutover blocked: ${blockers.map(({ code, count }) => `${code}=${count}`).join(', ')}`);
    this.name = 'HrRedesignCutoverBlockedError';
  }
}

export const assertHrRedesignReleaseAcceptance = (
  input: unknown,
  expectedSourceRevision: string,
): HrRedesignReleaseAcceptance => {
  const attestation = input as Partial<HrRedesignReleaseAcceptance> | null;
  if (!attestation || attestation.issue !== 245) throw new Error('HR redesign Cutover acceptance must attest issue 245.');
  if (!expectedSourceRevision || attestation.sourceRevision !== expectedSourceRevision) {
    throw new Error('HR redesign Cutover acceptance source revision does not match the release.');
  }
  if (!attestation.verifiedAt || Number.isNaN(Date.parse(attestation.verifiedAt))) {
    throw new Error('HR redesign Cutover acceptance verifiedAt is invalid.');
  }
  const checks = attestation.checks as Record<string, unknown> | undefined;
  const failed = HR_REDESIGN_REQUIRED_ACCEPTANCE_GATES.filter((gate) => checks?.[gate] !== 'PASSED');
  if (failed.length > 0) throw new Error(`HR redesign Cutover acceptance gates not passed: ${failed.join(', ')}`);
  return attestation as HrRedesignReleaseAcceptance;
};

export const assertHrRedesignCutoverReady = <T extends Pick<CutoverReport, 'totals' | 'canCutOver'>>(report: T) => {
  const blockers: HrRedesignCutoverBlocker[] = [];
  if (report.totals.safeBackfills > 0) blockers.push({ code: 'PENDING_SAFE_BACKFILLS', count: report.totals.safeBackfills });
  if (report.totals.actionableConflicts > 0) blockers.push({ code: 'ACTIONABLE_CONFLICTS', count: report.totals.actionableConflicts });
  if (report.totals.blockingFailures > 0) blockers.push({ code: 'BLOCKING_FAILURES', count: report.totals.blockingFailures });
  if (!report.canCutOver && blockers.length === 0) blockers.push({ code: 'BLOCKING_FAILURES', count: 1 });
  if (blockers.length > 0) throw new HrRedesignCutoverBlockedError(blockers);
  return report;
};

export const assertHrRedesignCutoverDryRunDeterministic = <T extends CutoverReport>(first: T, retry: T) => {
  if (JSON.stringify(first) !== JSON.stringify(retry)) {
    throw new Error('HR redesign Cutover dry-run is not deterministic across an immediate retry.');
  }
  return retry;
};

export const verifyHrRedesignCutover = async (client: PrismaClient, options: {
  acceptanceAttestation: unknown;
  sourceRevision: string;
}) => {
  assertHrRedesignReleaseAcceptance(options.acceptanceAttestation, options.sourceRevision);
  const first = await runHrRedesignBackfill(client, { apply: false });
  const retry = await runHrRedesignBackfill(client, { apply: false });
  return assertHrRedesignCutoverReady(assertHrRedesignCutoverDryRunDeterministic(first, retry));
};
