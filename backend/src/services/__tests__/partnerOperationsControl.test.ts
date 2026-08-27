import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as contract from '../../../../packages/partner-sales-contracts';
import { createOperationsService } from '../partnerSales/operations/service';
import { initialOperationsState } from '../partnerSales/operations/policy';
import type { OperationsStore, OperationsTransaction } from '../partnerSales/operations/service';
import { acceptanceResponsibilities, readinessGates } from '../partnerSales/operations/readiness';
import { createPartnerTelemetry } from '../partnerSales/operations/telemetry';
import { createOperationsMonitor } from '../partnerSales/operations/monitor';
import { runGuardedOperation } from '../partnerSales/operations/guard';

// Transaction boundary fixture only: serializes contenders and rolls back on error.
function harness(options: { ready?: boolean; fixture?: boolean; deny?: boolean; failAudit?: boolean; open?: boolean; remediated?: boolean; readinessUnavailable?: boolean; grantExpiresAt?: string; adminWithoutGrant?: boolean } = {}) {
  let data: any = { state: { ...initialOperationsState(), operationalPaused: !options.open }, commands: [], audit: [], incidents: [], telemetry: [] };
  let tail = Promise.resolve();
  const store: OperationsStore = {
    transaction: async work => {
      const previous = tail;
      let unlock!: () => void;
      tail = new Promise<void>(resolve => { unlock = resolve; });
      await previous;
      const next = structuredClone(data);
      const tx: OperationsTransaction = {
        now: () => '2026-08-27T08:00:00.000Z',
        authorize: async () => options.deny ? { ok: false, error: contract.partnerError('FORBIDDEN') } : ({ ok: true, value: { actorId: 'operator-333', persona: 'INTERNAL', isAdmin: !!options.adminWithoutGrant,
          partnerSellerId: 'partner-333', partnerStatus: 'ACTIVE', root: { kind: 'PROFILE', id: 'operations-333' },
          purpose: 'OPERATIONS', channel: 'API', scope: 'COMPANY', resourceVisible: true, actionGranted: !options.adminWithoutGrant, grantExpiresAt: options.grantExpiresAt,
          authorizationRevision: 1, lifecycleRevision: 1, evaluatedAt: '2026-08-27T08:00:00.000Z' } }),
        readState: async () => next.state,
        writeState: async value => { next.state = value; },
        findCommand: async key => next.commands.find((entry: any) => entry.key === key) ?? null,
        appendCommand: async entry => { next.commands.push(entry); },
        appendAudit: async entry => { if (options.failAudit) throw new Error('audit unavailable'); next.audit.push(entry); },
        readiness: async () => { if (options.readinessUnavailable) throw new Error('readiness unavailable'); return ({ evidence: options.ready ? { source: options.fixture ? 'FIXTURE' : 'DATABASE_VERIFIED',
          evidenceId: 'evidence-333', releaseId: 'release-333', schemaId: 'schema-333', checkedAt: '2026-08-27T08:00:00.000Z', expiresAt: '2026-08-27T09:00:00.000Z',
          gates: Object.fromEntries(readinessGates.map(gate => [gate, true])), acceptedBy: Object.fromEntries(acceptanceResponsibilities.map(role => [role, 'approval-333'])) } : null,
          current: { now: '2026-08-27T08:00:00.000Z', releaseId: 'release-333', schemaId: 'schema-333' } }); },
        enrollmentCandidate: async sellerId => ({ sellerId, profileId: 'profile-333', eligible: true }),
        listOpenIncidents: async () => next.incidents.filter((incident: any) => !incident.resolution),
        findIncident: async key => next.incidents.find((incident: any) => incident.key === key) ?? null,
        saveIncident: async incident => { next.incidents = next.incidents.filter((entry: any) => entry.key !== incident.key).concat(incident); },
        enqueueTelemetry: async record => { next.telemetry.push(record); },
        remediationEvidence: async incidentKey => options.remediated ? { incidentKey, source: options.fixture ? 'FIXTURE' : 'DATABASE_VERIFIED',
          evidenceId: 'remediation-333', causeCorrected: true, reconciliationPassed: true, failedTestPassed: true, checkedAt: '2026-08-27T08:00:00.000Z' } : null,
      };
      try { const result = await work(tx); data = next; return result; } finally { unlock(); }
    },
  };
  return { store, service: createOperationsService(contract, store), monitor: createOperationsMonitor(contract, store,
    createPartnerTelemetry(contract, 'test-only-333-key-material-32-bytes-minimum')) };
}

async function pause(key = 'pause-333', paused = true, revision = 1) {
  const intent = { kind: 'ENROLLMENT' as const, paused, expectedRevision: revision, reason: 'توقف برای بررسی آمادگی' };
  return { schemaVersion: 1 as const, type: 'OPERATIONS_PAUSE' as const, commandId: key, correlationId: 'correlation-333', ...intent,
    idempotency: { actorId: 'operator-333', operation: 'OPERATIONS_PAUSE', targetId: 'partner-operations', key,
      payloadHash: await contract.canonicalHash(intent) } };
}

test('pause retries return the recorded outcome and conflicting intents cannot reuse the identity', async () => {
  const { service } = harness();
  const command = await pause();
  const [first, replay] = await Promise.all([service.pause(command), service.pause(command)]);
  assert.deepEqual(first, replay);
  assert.equal(first.ok && first.value.revision, 2);
  const conflict = await service.pause(await pause('pause-333', false));
  assert.equal(!conflict.ok && conflict.error.code, 'IDEMPOTENCY_CONFLICT');
  const status = await service.status();
  assert.equal(status.ok && status.value.revision, 2);
});

test('a named cohort enrolls only dedicated eligible profiles after release readiness; fixtures stay closed', async () => {
  for (const fixture of [true, false]) {
    const { service } = harness({ ready: true, fixture });
    assert.equal((await service.defineCohort({ id: 'cohort-333', name: 'همکاران تأییدشده', expectedRevision: 1, reason: 'تعریف گروه انتشار' })).ok, true);
    const enrollment = await service.pause(await pause('open-enrollment', false, 2));
    if (fixture) { assert.equal(!enrollment.ok && enrollment.error.code, 'COHORT_NOT_READY'); continue; }
    assert.equal(enrollment.ok, true);
    const command = { ...await pause('open-operations', false, 3), kind: 'OPERATIONAL' as const };
    command.idempotency.payloadHash = await contract.canonicalHash({ kind: command.kind, paused: false, expectedRevision: 3, reason: command.reason });
    assert.equal((await service.pause(command)).ok, true);
    const result = await service.enroll({ sellerId: 'partner-333', expectedRevision: 4, reason: 'پذیرش همکار تأییدشده' });
    assert.equal(result.ok, true);
    const status = await service.status();
    assert.deepEqual(status.ok && status.value.cohort?.sellerIds, ['partner-333']);
  }
});

test('unauthorized controls fail and audit failure rolls the whole pause back', async () => {
  const denied = await harness({ deny: true }).service.pause(await pause());
  assert.equal(!denied.ok && denied.error.code, 'FORBIDDEN');
  const { service } = harness({ failAudit: true });
  assert.equal((await service.pause(await pause())).ok, false);
  const status = await service.status();
  assert.equal(status.ok && status.value.revision, 1);
});

test('confirmed faults deduplicate, pause automatically and require corrected evidence before resume', async () => {
  const options = { open: true, ready: true, remediated: false };
  const { service, monitor } = harness(options);
  const retry = { metric: 'JOB_RETRY' as const, outcome: 'RETRY' as const, subjectId: 'case-333', evidenceId: 'job-333', correlationId: 'trace-333' };
  assert.equal((await monitor.observe(retry)).ok, true);
  let state = await service.status();
  assert.equal(state.ok && state.value.operationalPaused, false);
  const fault = { ...retry, metric: 'PAIR_HEALTH' as const, outcome: 'CONFIRMED_VIOLATION' as const, category: 'PAIR_INCOMPLETE' as const };
  await Promise.all([monitor.observe(fault), monitor.observe(fault)]);
  state = await service.status();
  assert.equal(state.ok && state.value.operationalPaused, true);
  const incidents = await service.incidents();
  assert.equal(incidents.ok && incidents.value.length, 1);
  assert.equal(incidents.ok && incidents.value[0].occurrences, 2);
  const key = incidents.ok ? incidents.value[0].key : '';
  assert.equal((await service.resolveIncident(key, 'اصلاح علت و تطبیق شواهد')).ok, false);
  const resume = { ...await pause('resume-333', false, 2), kind: 'OPERATIONAL' as const };
  resume.idempotency.payloadHash = await contract.canonicalHash({ kind: resume.kind, paused: false, expectedRevision: 2, reason: resume.reason });
  assert.equal((await service.pause(resume)).ok, false);
  options.remediated = true;
  assert.equal((await service.resolveIncident(key, 'اصلاح علت و تطبیق شواهد')).ok, true);
  assert.equal((await service.pause(resume)).ok, true);
  // Delayed delivery of resolved evidence is a replay, not a fresh violation.
  await monitor.observe(fault);
  state = await service.status();
  assert.equal(state.ok && state.value.operationalPaused, false);
  assert.deepEqual(await service.incidents(), { ok: true, value: [] });
  // A genuinely new detector evidence identity opens a new incident.
  await monitor.observe({ ...fault, evidenceId: 'new-pair-violation-333' });
  state = await service.status();
  assert.equal(state.ok && state.value.operationalPaused, true);
});

test('a pause winning the transaction lock prevents a waiting writer from using stale open state', async () => {
  const { store, monitor } = harness({ open: true });
  const containment = monitor.observe({ metric: 'PAIR_HEALTH', outcome: 'CONFIRMED_VIOLATION', category: 'PAIR_INCOMPLETE',
    correlationId: 'trace-333', subjectId: 'case-333', evidenceId: 'pair-333' });
  let writes = 0;
  const mutation = runGuardedOperation(contract, store, async tx => {
    const auth = await tx.authorize();
    if (!auth.ok) throw new Error('fixture authorization');
    return { operation: 'CASE_COMMIT', permission: auth.value, caseState: 'CUSTOMER_APPROVED' };
  }, async () => { writes++; return 'committed'; });
  assert.equal((await containment).ok, true);
  const result = await mutation;
  assert.equal(!result.ok && result.error.code, 'OPERATIONAL_PAUSE');
  assert.equal(writes, 0);
});

test('committed fulfillment does not depend on rollout readiness, but still checks integrity', async () => {
  const { store } = harness({ readinessUnavailable: true });
  for (const integrityVerified of [true, false]) {
    const result = await runGuardedOperation(contract, store, async tx => {
      const auth = await tx.authorize();
      if (!auth.ok) throw new Error('fixture authorization');
      return { operation: 'FULFILLMENT_WRITE', permission: { ...auth.value, purpose: 'FULFILLMENT', partnerStatus: 'TERMINATED' }, caseState: 'COMMITTED', integrityVerified };
    }, async () => 'fulfilled');
    assert.equal(result.ok, integrityVerified);
  }
});

test('replay reauthorizes the current operator; Admin and expired grants cannot bypass control authorization', async () => {
  const options: { deny?: boolean } = {};
  const { service } = harness(options);
  const command = await pause();
  assert.equal((await service.pause(command)).ok, true);
  options.deny = true;
  assert.equal((await service.pause(command)).ok, false);
  for (const configuration of [{ adminWithoutGrant: true }, { grantExpiresAt: '2026-08-27T08:00:00.000Z' }]) {
    const result = await harness(configuration).service.pause(command);
    assert.equal(!result.ok && result.error.code, 'FORBIDDEN');
  }
});
