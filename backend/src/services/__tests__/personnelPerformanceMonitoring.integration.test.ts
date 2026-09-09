import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { createDispatchDocumentsTemporaryDatabase } from './dispatchDocumentsTemporaryDatabase';
import { deliverPendingNotificationOutbox } from '../notificationService';
import {
  acknowledgePerformanceOperationalIncident,
  configurePerformanceOperationalRoute,
  detectMissingPerformanceOperationalHeartbeats,
  escalateOverduePerformanceOperationalIncidents,
  getPerformanceOperationalDashboard,
  recordPerformanceIntegrityFailure,
  recordPerformanceOperationalHeartbeat,
  recordPerformanceOperationalWindow,
} from '../personnelPerformanceMonitoringStore';
import { raceEvidenceMarker, runOrderedPerformanceRace } from './performanceAcceptanceRaceHarness';

const rollback = Symbol('rollback-performance-monitoring');

const exerciseMonitoring = async (client: PrismaClient) => {
  try {
    await client.$transaction(async (tx) => {
      await tx.$executeRaw`INSERT INTO performance_disclosure_revision(id,revision) VALUES (1,0)`;
      const suffix = randomUUID();
      const now = new Date('2026-09-09T08:00:00.000Z');
      const operator = await tx.user.create({ data: {
        email: `performance-monitor-${suffix}@example.invalid`, username: `performance-monitor-${suffix}`,
        password: 'not-used', firstName: 'عامل', lastName: 'پایش',
      } });
      const phase = await tx.performanceFeaturePhaseVersion.create({ data: {
        version: 1, phase: 'SUPERVISOR_HR_PILOT', releaseEnabled: true,
        effectiveFrom: new Date('2026-09-08T08:00:00.000Z'), recordedByUserId: operator.id,
        reason: 'Isolated operational monitoring acceptance',
      }, select: { id: true, effectiveFrom: true } });
      const cohort = await tx.performanceCohortVersion.create({ data: {
        cohortKey: `monitoring-${suffix}`, version: 1, lifecycle: 'DRAFT', membershipHash: '0'.repeat(64),
        stage: 'PILOT', targetPercent: 10, effectiveFrom: phase.effectiveFrom,
        activationReason: 'Isolated operational monitoring acceptance', activatedByUserId: operator.id,
        createdByUserId: operator.id,
      }, select: { id: true } });
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await tx.performanceCohortVersion.update({ where: { id: cohort.id }, data: { lifecycle: 'ACTIVE',
        activationReason: 'Isolated operational monitoring acceptance', activatedByUserId: operator.id }, select: { id: true } });
      await tx.performanceFeaturePhaseVersion.update({ where: { id: phase.id }, data: { cohortVersionId: cohort.id } });
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'origin'");
      await tx.hrWorkspaceCatalog.create({ data: { code: 'HUMAN_RESOURCES', displayName: 'آزمون منابع انسانی' } });
      await tx.hrFeatureCatalog.create({ data: { code: 'MANAGE_PERFORMANCE_ROLLOUT', workspaceCode: 'HUMAN_RESOURCES',
        displayName: 'MANAGE_PERFORMANCE_ROLLOUT' } });
      await tx.hrFeatureAccessGrant.create({ data: {
        stableKey: `${suffix}:monitoring-routes`, userId: operator.id, featureCode: 'MANAGE_PERFORMANCE_ROLLOUT',
        level: 'ADMIN', effectiveFrom: new Date('2020-01-01T00:00:00.000Z'), grantedByUserId: operator.id,
        reason: 'Isolated operational route configuration',
      } });

      for (const routeKey of ['SYSTEM_OWNER', 'HUMAN_RESOURCES', 'SECURITY_PRIVACY'] as const) {
        await configurePerformanceOperationalRoute(tx, {
          actorUserId: operator.id, routeKey, recipientUserId: operator.id,
          verifiedAt: now, reason: 'Explicit isolated route assignment',
        });
      }
      for (const component of ['METRIC', 'DASHBOARD', 'ALERT'] as const) {
        await recordPerformanceOperationalHeartbeat(tx, { component, observedAt: now });
      }

      for (let index = 2; index >= 0; index -= 1) {
        const windowEnd = new Date(now.getTime() - index * 5 * 60_000);
        const result = await recordPerformanceOperationalWindow(tx, {
          metricKey: 'BADGE_API_LATENCY', scope: 'COHORT', cohortVersionId: cohort.id,
          windowStart: new Date(windowEnd.getTime() - 5 * 60_000), windowEnd,
          numerator: 100, denominator: 100, p95Ms: 201, p99Ms: 400,
        });
        assert.equal(Boolean(result.incident), index === 0, 'p95 requires three consecutive five-minute breaches');
      }
      const repeated = await recordPerformanceOperationalWindow(tx, {
        metricKey: 'BADGE_API_LATENCY', scope: 'COHORT', cohortVersionId: cohort.id,
        windowStart: new Date(now.getTime() - 5 * 60_000), windowEnd: now,
        numerator: 100, denominator: 100, p95Ms: 250, p99Ms: 450,
      });
      assert.equal(repeated.incident?.occurrenceCount, 2, 'a repeated window updates the open incident rather than duplicating it');
      assert.equal(await tx.performanceOperationalIncident.count({ where: { metricKey: 'BADGE_API_LATENCY', status: 'OPEN' } }), 1);

      const exactErrorBudget = await recordPerformanceOperationalWindow(tx, {
        metricKey: 'HTTP_5XX_RATE', scope: 'COHORT', cohortVersionId: cohort.id,
        windowStart: new Date(now.getTime() - 15 * 60_000), windowEnd: new Date(now.getTime() - 10 * 60_000),
        numerator: 1, denominator: 1_000,
      });
      assert.equal(exactErrorBudget.incident, null, 'the 0.1 percent boundary is allowed; only a value above it is High');

      const paused = await recordPerformanceOperationalWindow(tx, {
        metricKey: 'HTTP_5XX_RATE', scope: 'COHORT', cohortVersionId: cohort.id,
        windowStart: new Date(now.getTime() - 5 * 60_000), windowEnd: now,
        numerator: 11, denominator: 1_000,
      });
      assert.equal(paused.incident?.severity, 'CRITICAL');
      assert.ok(paused.incident?.safetyPauseId, 'a five-minute 5xx rate above one percent pauses the affected cohort');
      assert.equal(await tx.performanceSafetyPause.count({ where: { cohortVersionId: cohort.id, status: 'ACTIVE' } }), 1);
      assert.equal(await tx.notificationEvent.count({ where: { type: 'PERFORMANCE_OPERATIONAL_ALERT' } }), 2,
        'each incident publishes one minimal canonical notification event');
      const secondPauseThreshold = await recordPerformanceOperationalWindow(tx, {
        metricKey: 'TIMEOUT_RATE', scope: 'COHORT', cohortVersionId: cohort.id,
        windowStart: new Date(now.getTime() - 5 * 60_000), windowEnd: now,
        numerator: 6, denominator: 1_000,
      });
      assert.equal(secondPauseThreshold.incident?.safetyPauseId, paused.incident?.safetyPauseId,
        'multiple critical signals in one scope share the already-active pause while keeping separate incidents');
      assert.equal(await tx.performanceSafetyPause.count({ where: { cohortVersionId: cohort.id, status: 'ACTIVE' } }), 1);

      const acknowledged = await acknowledgePerformanceOperationalIncident(tx, {
        actorUserId: operator.id, incidentId: paused.incident!.id, action: 'ACKNOWLEDGE',
        reasonCode: 'ON_CALL_ACKNOWLEDGED', evidenceHash: 'a'.repeat(64), now: new Date(now.getTime() + 60_000),
      });
      assert.equal(acknowledged.status, 'ACKNOWLEDGED');
      assert.equal(await tx.performanceOperationalIncidentEvidence.count({ where: { incidentId: acknowledged.id } }), 1);

      const dashboard = await getPerformanceOperationalDashboard(tx, new Date(now.getTime() + 6 * 60_000));
      assert.deepEqual(dashboard.missingHeartbeats.sort(), ['ALERT', 'DASHBOARD', 'METRIC']);
      assert.equal(dashboard.expansionAllowed, false);
      assert.ok(dashboard.expansionBlockers.includes('PERFORMANCE_OPERATIONAL_HEARTBEAT_MISSING'));
      assert.ok(dashboard.metricDefinitions.every((definition) => definition.denominator && definition.samplingSeconds
        && definition.retentionDays && definition.dashboardKey && definition.routeKey));
      assert.equal(dashboard.routeConfiguration.every((route) => route.configured), true);
      const heartbeatIncidents = await detectMissingPerformanceOperationalHeartbeats(tx, new Date(now.getTime() + 6 * 60_000));
      assert.equal(heartbeatIncidents.incidents.length, 3, 'each missing hypercare heartbeat becomes durable incident evidence');
      const escalated = await escalateOverduePerformanceOperationalIncidents(tx, new Date(now.getTime() + 22 * 60_000));
      assert.ok(escalated.escalated >= 3, 'unacknowledged High incidents are escalated after their response deadline');
      assert.equal(await tx.performanceOperationalIncidentEvidence.count({ where: { action: 'ESCALATE' } }), escalated.escalated,
        'automatic deadline escalation persists incident evidence');
      assert.equal(await tx.performanceAuditEvent.count({ where: { eventType: 'PERFORMANCE_OPERATIONAL_INCIDENT_ESCALATE' } }), escalated.escalated,
        'automatic deadline escalation persists immutable audit evidence');

      const integrityIncident = await recordPerformanceIntegrityFailure(tx, {
        code: 'PERFORMANCE_EXPORT_LINEAGE_UNVERIFIED',
      }, new Date(now.getTime() + 23 * 60_000));
      assert.equal(integrityIncident?.thresholdCode, 'INTEGRITY_LINEAGE');
      assert.ok(integrityIncident?.safetyPauseId, 'a detected lineage failure creates an automatic global safety pause');
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
};

const pauseRace = async (first: PrismaClient, second: PrismaClient, runId: string) => {
    await first.$executeRaw`INSERT INTO performance_disclosure_revision(id,revision) VALUES (1,0)`;
    const { actor, cohort } = await first.$transaction(async (tx) => {
      const actor = await tx.user.create({ data: { email: `${runId}@example.invalid`, username: runId,
        password: 'not-used', firstName: 'عامل', lastName: 'رقابت', role: 'ADMIN' } });
      const cohort = await tx.performanceCohortVersion.create({ data: { cohortKey: runId, version: 1,
        membershipHash: '0'.repeat(64), stage: 'PILOT', targetPercent: 10,
        effectiveFrom: new Date('2026-09-09T00:00:00.000Z'), createdByUserId: actor.id }, select: { id: true } });
      const phase = await tx.performanceFeaturePhaseVersion.create({ data: { version: 1, phase: 'SUPERVISOR_HR_PILOT', releaseEnabled: true,
        effectiveFrom: new Date('2026-09-09T00:00:00.000Z'), recordedByUserId: actor.id,
        reason: 'Isolated monitoring pause race' }, select: { id: true } });
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await tx.performanceCohortVersion.update({ where: { id: cohort.id }, data: { lifecycle: 'ACTIVE',
        activationReason: 'Isolated monitoring pause race', activatedByUserId: actor.id }, select: { id: true } });
      await tx.performanceFeaturePhaseVersion.update({ where: { id: phase.id }, data: { cohortVersionId: cohort.id }, select: { id: true } });
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'origin'");
      await tx.performanceOperationalRoute.create({ data: { routeKey: 'SYSTEM_OWNER', recipientUserId: actor.id,
        verifiedAt: new Date('2026-09-09T07:00:00.000Z'), configuredById: actor.id, reason: 'Isolated queue retry route' } });
      return { actor, cohort };
    });
    const input = { metricKey: 'TIMEOUT_RATE', scope: 'COHORT' as const, cohortVersionId: cohort.id,
      windowStart: new Date('2026-09-09T07:55:00.000Z'), windowEnd: new Date('2026-09-09T08:00:00.000Z'),
      numerator: 6, denominator: 1_000 };
    const results = await Promise.all([recordPerformanceOperationalWindow(first, input), recordPerformanceOperationalWindow(second, input)]);
    assert.equal(new Set(results.map(({ incident }) => incident?.id)).size, 1, 'concurrent evaluators converge on one incident');
    assert.equal(await first.performanceOperationalWindow.count(), 1);
    assert.equal(await first.performanceOperationalIncident.count(), 1);
    assert.equal(await first.performanceSafetyPause.count({ where: { status: 'ACTIVE' } }), 1,
      'concurrent threshold evaluation creates one durable pause');
    const pendingOutbox = await first.notificationOutbox.findFirstOrThrow();
    const firstAttemptAt = new Date(pendingOutbox.availableAt.getTime() + 1);
    const failedDelivery = await deliverPendingNotificationOutbox(first, async () => { throw new Error('injected route failure'); },
      firstAttemptAt);
    assert.equal(failedDelivery.failed, 1);
    const outbox = await first.notificationOutbox.findFirstOrThrow();
    assert.equal(outbox.status, 'PENDING');
    assert.equal(outbox.attempts, 1);
    const retryAt = new Date(firstAttemptAt.getTime() + 60_000);
    await first.notificationOutbox.update({ where: { id: outbox.id }, data: { availableAt: retryAt } });
    const retriedDelivery = await deliverPendingNotificationOutbox(first, async () => undefined,
      retryAt);
    assert.equal(retriedDelivery.delivered, 1);
    assert.deepEqual(await first.notificationOutbox.findUnique({ where: { id: outbox.id }, select: { status: true, attempts: true } }),
      { status: 'PROCESSED', attempts: 2 }, 'the canonical alert outbox retries without duplicating the incident');
    await first.notificationOutbox.update({ where: { id: outbox.id }, data: {
      status: 'PENDING', availableAt: retryAt, processedAt: null, claimedAt: null,
    } });
    const attemptsBeforeRace = await first.notificationDeliveryAttempt.count({ where: { notification: { eventId: outbox.eventId } } });
    const deliveryRace = await runOrderedPerformanceRace(first, first, second,
      (tx) => deliverPendingNotificationOutbox(tx as unknown as PrismaClient, async () => undefined, retryAt),
      (tx) => deliverPendingNotificationOutbox(tx as unknown as PrismaClient, async () => undefined, retryAt));
    assert.equal(deliveryRace.winner.businessCode, 'PERFORMANCE_NOTIFICATION_OUTBOX_DELIVERY_COMPLETED');
    assert.equal(deliveryRace.loser.status, 'fulfilled');
    const losingDelivery = deliveryRace.loser.status === 'fulfilled' ? deliveryRace.loser.value : null;
    assert.equal(losingDelivery?.businessCode, 'PERFORMANCE_NOTIFICATION_OUTBOX_ALREADY_CLAIMED');
    assert.equal(await first.notificationDeliveryAttempt.count({ where: { notification: { eventId: outbox.eventId } } }), attemptsBeforeRace,
      'concurrent retry cannot duplicate an already delivered notification');
    if (process.env.PERFORMANCE_ACCEPTANCE_RACE_SCENARIOS === 'notification-export-retry') {
      console.log(raceEvidenceMarker([{
        name: 'notification-export-retry', loserCode: losingDelivery!.businessCode,
        validTruths: 1, duplicateEvents: 0, lostWrites: 0, additionalDisclosures: 0,
      }]));
    }
};

const main = async () => {
  const repositoryRoot = path.resolve(process.cwd(), '..');
  const database = await createDispatchDocumentsTemporaryDatabase({ repositoryRoot,
    sourceDatabaseUrl: process.env.DATABASE_URL ?? 'postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp?connection_limit=2&pool_timeout=10',
    schemaOnly: true });
  const first = database.client();
  const second = database.client();
  try {
    const applySql = (migration: string) => execFileSync('docker', ['compose', '-f', path.join(repositoryRoot, 'docker-compose.local.yml'), 'exec', '-T', 'postgres',
      'psql', '-X', '-v', 'ON_ERROR_STOP=1', '--username', 'postgres', '--dbname', database.databaseName], {
      cwd: repositoryRoot, input: readFileSync(path.join(repositoryRoot, `backend/prisma/migrations/${migration}/migration.sql`)),
      stdio: ['pipe', 'pipe', 'pipe'], timeout: 120_000,
    });
    const [schema] = await first.$queryRaw<Array<{ present: string | null }>>`SELECT to_regclass('performance_operational_incidents')::text AS present`;
    if (!schema.present) applySql('20260909090000_performance_operational_monitoring');
    const [starter] = await first.$queryRaw<Array<{ nullable: string }>>`SELECT is_nullable AS nullable FROM information_schema.columns
      WHERE table_name = 'performance_safety_pauses' AND column_name = 'startedByUserId'`;
    if (starter.nullable === 'NO') applySql('20260909110000_performance_automatic_pause_actor');
    const [pauseIndex] = await first.$queryRaw<Array<{ present: boolean }>>`SELECT EXISTS (
      SELECT 1 FROM pg_indexes WHERE indexname = 'performance_operational_incidents_safetyPauseId_key'
    ) AS present`;
    if (pauseIndex.present) applySql('20260909111000_performance_shared_operational_pause');
    const [evidenceActor] = await first.$queryRaw<Array<{ nullable: string }>>`SELECT is_nullable AS nullable FROM information_schema.columns
      WHERE table_name = 'performance_operational_incident_evidence' AND column_name = 'actorUserId'`;
    if (evidenceActor.nullable === 'NO') applySql('20260909112000_performance_automatic_incident_evidence_actor');
    await exerciseMonitoring(first);
    await pauseRace(first, second, database.runId);
    execFileSync(process.execPath, ['--import', 'tsx', 'src/services/__tests__/performanceOperationalInbox.integration.test.ts', database.databaseName], {
      cwd: path.join(repositoryRoot, 'backend'), env: { ...process.env, DATABASE_URL: database.databaseUrl },
      stdio: 'inherit', timeout: 120_000,
    });
  } finally {
    await Promise.allSettled([first.$disconnect(), second.$disconnect()]);
    await database.cleanup();
  }
};

void main();
