import { PerformanceArtifactLifecycle, PerformanceResultStatus, type PrismaClient } from '@prisma/client';
import {
  activateDuePerformanceArtifacts,
  activateDuePerformancePolicies,
  reconcilePerformanceProjectionSubjects,
} from './personnelPerformancePolicyStore';
import { expirePerformanceResults } from './personnelPerformanceResultStore';
import { resolvePersonnelPerformanceWriteGate } from './personnelPerformanceRolloutPolicy';
import { cleanupExpiredPerformanceExports, processQueuedPerformanceExports } from './personnelPerformanceDisclosureStore';
import { activateDuePerformanceCohorts } from './personnelPerformanceRolloutStore';
import { runPerformancePrivacyDeadlineNotifications } from './personnelPerformancePrivacyStore';

const SYSTEM_ACTOR = null;

export const runPersonnelPerformanceMaintenance = async (client: PrismaClient, now = new Date()) => {
  const minuteKey = now.toISOString().slice(0, 16);
  const policyGate = await resolvePersonnelPerformanceWriteGate(client, 'MANAGE_POLICY', now);
  const [duePolicies, dueCriteria, dueTemplates, dueResults] = await Promise.all([
    client.performancePolicyVersion.count({ where: { lifecycle: PerformanceArtifactLifecycle.SCHEDULED, effectiveFrom: { lte: now } } }),
    client.performanceCriterionVersion.count({ where: { lifecycle: PerformanceArtifactLifecycle.SCHEDULED, effectiveFrom: { lte: now } } }),
    client.performanceTemplateVersion.count({ where: { lifecycle: PerformanceArtifactLifecycle.SCHEDULED, effectiveFrom: { lte: now } } }),
    client.performanceAcceptedResult.count({ where: { status: PerformanceResultStatus.EFFECTIVE, expiresAt: { lte: now } } }),
  ]);
  const isolate = async <T>(operation: string, work: () => Promise<T>) => {
    try {
      return { ok: true as const, value: await work() };
    } catch (error) {
      const candidate = error && typeof error === 'object' && 'code' in error ? error.code : null;
      const code = typeof candidate === 'string' && /^PERFORMANCE_[A-Z_]{1,80}$/.test(candidate) ? candidate : 'PERFORMANCE_MAINTENANCE_FAILED';
      console.error(`Personnel performance maintenance ${operation} failed closed: ${code}`);
      return { ok: false as const, error: code };
    }
  };
  const policies = policyGate.allowed && duePolicies > 0
    ? await isolate('policy activation', () => activateDuePerformancePolicies(client, {
      actorUserId: SYSTEM_ACTOR, idempotencyKey: `scheduled-policy:${minuteKey}`, now,
    }))
    : null;
  const artifacts = policyGate.allowed && dueCriteria + dueTemplates > 0
    ? await isolate('artifact activation', () => activateDuePerformanceArtifacts(client, {
      actorUserId: SYSTEM_ACTOR, idempotencyKey: `scheduled-artifacts:${minuteKey}`, now,
    }))
    : null;
  const expiry = dueResults > 0
    ? await isolate('result expiry', () => expirePerformanceResults(client, { actorUserId: SYSTEM_ACTOR, now }))
    : null;
  const relationshipReconciliation = await isolate('relationship reconciliation', () => (
    reconcilePerformanceProjectionSubjects(client, { actorUserId: SYSTEM_ACTOR, now })
  ));
  const exportCleanup = await isolate('export cleanup', () => cleanupExpiredPerformanceExports(client, now));
  const exportQueue = await isolate('export queue', () => processQueuedPerformanceExports(client));
  const cohorts = await isolate('cohort activation', () => activateDuePerformanceCohorts(client, now));
  const privacyDeadlines = await isolate('privacy deadlines', () => runPerformancePrivacyDeadlineNotifications(client, now));
  return { policyGate, policies, artifacts, cohorts, privacyDeadlines, expiry, relationshipReconciliation, exportCleanup, exportQueue };
};

export const startPersonnelPerformanceMaintenance = (client: PrismaClient) => {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { await runPersonnelPerformanceMaintenance(client); }
    catch { console.error('Personnel performance maintenance failed closed: PERFORMANCE_MAINTENANCE_FAILED'); }
    finally { running = false; }
  };
  const initial = setTimeout(run, 5_000);
  initial.unref();
  const interval = setInterval(run, 60_000);
  interval.unref();
  return interval;
};
