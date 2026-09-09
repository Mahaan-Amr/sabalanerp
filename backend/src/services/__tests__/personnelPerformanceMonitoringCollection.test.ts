import assert from 'node:assert/strict';
import test from 'node:test';
import type { PrismaClient } from '@prisma/client';
import { runPerformanceOperationalMonitoring } from '../personnelPerformanceMonitoringStore';

const now = new Date('2026-09-09T08:01:00Z');
const equal = (a: any, b: any) => a instanceof Date && b instanceof Date ? +a === +b : a === b;
const matches = (row: any, where: any) => Object.entries(where).every(([key, value]: [string, any]) =>
  value?.lt ? row[key] < value.lt : equal(row[key] ?? null, value ?? null));

const fixture = () => {
  const calls: string[] = [];
  const windows: any[] = [];
  const incidents: any[] = [];
  const pauses: any[] = [];
  const heartbeats = new Map<string, any>();
  const phases: any[] = [{ id: 'enabled', releaseEnabled: true, cohortVersionId: 'cohort-a',
    effectiveFrom: new Date('2026-08-01Z'), version: 1 }];
  const observations = [{ metricKey: 'BADGE_API_LATENCY', durationMs: 100, responseStatus: 200,
    authorizationDecision: 'ALLOWED', timedOut: false }];
  let failOutbox = false;
  const client: any = {
    $transaction: async (work: any) => work(client),
    $queryRaw: async () => { calls.push('fence'); return [{ revision: 1n }]; },
    $executeRaw: async () => 1,
    performanceFeaturePhaseVersion: { findFirst: async ({ where }: any) => {
      calls.push('phase');
      return phases.filter(p => p.effectiveFrom <= where.effectiveFrom.lte
        && (where.releaseEnabled === undefined || p.releaseEnabled === where.releaseEnabled))
        .sort((a, b) => +b.effectiveFrom - +a.effectiveFrom || b.version - a.version)[0] ?? null;
    } },
    performanceOperationalWindow: {
      deleteMany: async () => { calls.push('retention-windows'); return { count: 0 }; },
      findMany: async () => windows,
      findFirst: async ({ where }: any) => windows.find(row => matches(row, where)) ?? null,
      create: async ({ data }: any) => { const row = { id: `window-${windows.length}`, ...data }; windows.push(row); return row; },
      update: async () => { throw new Error('Closed samples must not be rewritten'); },
    },
    performanceOperationalRequestObservation: {
      deleteMany: async () => { calls.push('retention-observations'); return { count: 0 }; },
      findMany: async () => { calls.push('observations'); return observations; },
    },
    performanceOperationalHeartbeat: {
      findMany: async () => [...heartbeats.values()],
      findUnique: async ({ where }: any) => heartbeats.get(where.component) ?? null,
      upsert: async ({ where, create, update }: any) => {
        calls.push('heartbeat');
        const row = { ...(heartbeats.get(where.component) ?? create), ...update };
        heartbeats.set(where.component, row); return row;
      },
    },
    performanceOperationalRoute: { findMany: async () => [], findUnique: async () => null },
    performanceOperationalIncident: {
      findMany: async () => [],
      findFirst: async () => null,
      findUniqueOrThrow: async ({ where }: any) => incidents.find(row => row.id === where.id),
      create: async ({ data }: any) => { const row = { id: `incident-${incidents.length}`, ...data }; incidents.push(row); return row; },
      update: async ({ where, data }: any) => Object.assign(incidents.find(row => row.id === where.id), data),
    },
    performanceSafetyPause: {
      findMany: async () => pauses,
      findFirst: async () => pauses[0] ?? null,
      create: async ({ data }: any) => { const row = { id: `pause-${pauses.length}`, ...data }; pauses.push(row); return row; },
    },
    performanceAuditEvent: { create: async ({ data }: any) => data },
    performanceEvaluationSection: { findMany: async () => { calls.push('sections'); return []; } },
    performanceExportReceipt: { findMany: async () => { calls.push('exports'); return []; } },
    notificationOutbox: { count: async () => { calls.push('outbox'); if (failOutbox) throw new Error('outbox unavailable'); return 0; } },
  };
  return { client, calls, windows, incidents, pauses, phases, observations, heartbeats,
    failOutbox: (value: boolean) => { failOutbox = value; },
    run: (at = now) => runPerformanceOperationalMonitoring(client as PrismaClient, at),
  };
};

test('absent or disabled latest phase performs retention only, including disabled-after-enabled', async (t) => {
  for (const mode of ['absent', 'disabled', 'disabled-after-enabled']) await t.test(mode, async () => {
    const f = fixture();
    if (mode !== 'disabled-after-enabled') f.phases.length = 0;
    if (mode !== 'absent') f.phases.push({ id: 'disabled', releaseEnabled: false,
      effectiveFrom: new Date('2026-09-09T08:00:30Z'), version: 2 });
    // A future enable must not override today's disabled/absent state.
    f.phases.push({ id: 'future', releaseEnabled: true, effectiveFrom: new Date('2027-01-01Z'), version: 3 });
    const result = await f.run();
    assert.equal('skipped' in result && result.skipped, 'INACTIVE');
    assert.deepEqual(f.calls.sort(), ['phase', 'retention-observations', 'retention-windows']);
    assert.equal(f.windows.length + f.incidents.length + f.pauses.length + f.heartbeats.size, 0);
  });
});

test('a collected interval avoids repeated scans/writes; the next interval keeps the closed fifteen-minute sample', async () => {
  const f = fixture();
  f.heartbeats.set('METRIC', { component: 'METRIC', observedAt: now });
  await f.run();
  const initialCount = f.windows.length;
  assert.ok(initialCount > 0, 'provider heartbeat alone must not suppress collection');
  const initialHeartbeats = structuredClone([...f.heartbeats]);
  f.calls.length = 0;
  const result = await f.run(new Date('2026-09-09T08:02:00Z'));
  assert.equal('skipped' in result && result.skipped, 'WINDOW_ALREADY_COLLECTED');
  assert.equal(f.windows.length, initialCount);
  assert.deepEqual([...f.heartbeats], initialHeartbeats);
  for (const call of ['observations', 'sections', 'exports', 'outbox', 'heartbeat']) assert.ok(!f.calls.includes(call), call);
  await f.run(new Date('2026-09-09T08:06:00Z'));
  assert.ok(f.windows.length > initialCount);
  assert.equal(f.windows.filter(row => row.metricKey === 'PERMISSION_DENIAL_RATE').length, 1);
});

test('unscoped observations across a cohort transition create only global windows and pauses', async () => {
  const f = fixture();
  f.phases.push({ id: 'next', releaseEnabled: true, cohortVersionId: 'cohort-b',
    effectiveFrom: new Date('2026-09-09T07:58:00Z'), version: 2 });
  f.observations[0].responseStatus = 504;
  f.observations[0].timedOut = true;
  await f.run();
  assert.ok(f.pauses.length > 0);
  for (const row of [...f.windows, ...f.incidents, ...f.pauses]) {
    assert.equal(row.scope, 'ALL');
    assert.equal(row.cohortVersionId ?? null, null);
  }
});

test('partial-run retry preserves closed samples and retention still executes on failure', async () => {
  const f = fixture();
  f.observations[0].responseStatus = 504;
  f.observations[0].timedOut = true;
  f.failOutbox(true);
  await assert.rejects(f.run(), /outbox unavailable/);
  assert.ok(f.calls.includes('retention-windows') && f.calls.includes('retention-observations'));
  assert.equal(f.heartbeats.has('COLLECTOR_WINDOW'), false, 'failed collection must not be marked complete');
  const count = f.windows.length;
  const incidentCount = f.incidents.length;
  f.failOutbox(false);
  await f.run();
  assert.equal(f.windows.length, count, 'retry must not duplicate completed metric samples');
  assert.equal(f.incidents.length, incidentCount, 'retry must not reopen or count the same threshold breach again');
  assert.ok(f.heartbeats.has('COLLECTOR_WINDOW'));
});
