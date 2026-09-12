import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalHash, partnerError } from '@sabalanerp/partner-sales-contracts';
import { createPartnerActivationHttpPort } from '../activation/partnerActivationHttpPort';
import { createPartnerOperationsHttpPort } from '../activation/partnerOperationsHttpPort';
import { activationOperationAvailability } from '../activation/activationUiPolicy';

test('activation HTTP port validates v3 query and command receipts', async () => {
  const calls: unknown[] = [];
  const client = { post: async (path: string, body: unknown) => {
    calls.push([path, body]);
    return path.endsWith('query-v3') ? { data: { success: true, data: { schemaVersion: 3,
      purpose: 'PARTNER_ACTIVATION', actorId: 'admin-1', release: { controlRevision: 1,
        status: 'MISSING', actions: [] }, candidates: [], identityEvidence: [], commercialTerms: [], creditTerms: [], responders: [] } } }
      : { data: { success: true, data: { schemaVersion: 3, commandId: 'publish-1', replayed: false,
        controlRevision: 2, eventIds: ['event-1'] } } };
  } };
  const port = createPartnerActivationHttpPort(client);
  assert.equal((await port.query({ schemaVersion: 3, purpose: 'PARTNER_ACTIVATION' })).ok, true);
  const intent = { schemaVersion: 3 as const, type: 'RELEASE_READINESS_PUBLISH' as const,
    verifiedPackageId: 'verified-1', expectedControlRevision: 1, reason: 'انتشار بسته معتبر آمادگی' };
  const command = { ...intent, commandId: 'publish-1', correlationId: 'publish-1', idempotency: {
    actorId: 'admin-1', operation: intent.type, targetId: 'verified-1', key: 'publish-1',
    payloadHash: await canonicalHash(intent) } };
  assert.equal((await port.execute(command)).ok, true);
  assert.equal(calls.length, 2);
  assert.equal((await port.execute({ ...command, unexpected: true } as typeof command)).ok, false);
});

test('activation UI advances from independent enrollment to operational resume without a dead end', () => {
  const base = { schemaVersion: 3 as const, purpose: 'PARTNER_ACTIVATION' as const, actorId: 'admin-1',
    release: { controlRevision: 5, status: 'READY' as const, actions: [] },
    cohort: { id: 'cohort-1', name: 'فروشندگان همکار', enrollmentOpen: true, operationsOpen: false },
    candidates: [], identityEvidence: [], commercialTerms: [], creditTerms: [], responders: [] };
  const beforeEnrollment = { ...base, subject: { userId: 'fariba-1', displayName: 'فریبا پورشهید',
    profileId: 'profile-1', profileRevision: 2,
    gates: [{ id: 'ENROLLMENT' as const, label: 'عضویت مستقل در cohort', ready: false,
      blocker: partnerError('DEPENDENCY_BLOCKED') }], actions: [] } };
  assert.equal(activationOperationAvailability(beforeEnrollment).canEnroll, true);
  const afterEnrollment = { ...beforeEnrollment, subject: { ...beforeEnrollment.subject,
    gates: [{ id: 'ENROLLMENT' as const, label: 'عضویت مستقل در cohort', ready: true }] } };
  assert.equal(activationOperationAvailability(afterEnrollment).canEnroll, false);
  assert.equal(activationOperationAvailability(afterEnrollment).canOpenOperations, true);
});

test('activation operations port keeps cohort enrollment and pause as separate authenticated commands', async () => {
  const calls: Array<[string, unknown]> = [];
  const client = { post: async (path: string, body: unknown) => {
    calls.push([path, body]);
    return { data: { ok: true, value: { revision: calls.length + 1,
      enrollmentPaused: false, operationalPaused: true,
      cohort: { id: 'cohort-1', name: 'فروشندگان همکار', sellerIds: [] } } } };
  } };
  const operations = createPartnerOperationsHttpPort(client);
  assert.equal((await operations.defineCohort({ id: 'cohort-1', name: 'فروشندگان همکار', expectedRevision: 1,
    reason: 'تعریف cohort مستقل برای آزمون رابط' })).ok, true);
  assert.equal((await operations.enroll({ sellerId: 'fariba-1', expectedRevision: 2,
    reason: 'عضویت مستقل فروشنده در آزمون رابط' })).ok, true);
  assert.equal((await operations.pause({ actorId: 'admin-1', kind: 'OPERATIONAL', paused: false,
    expectedRevision: 3, reason: 'بازکردن عملیات پس از کنترل آزمون رابط' })).ok, true);
  assert.deepEqual(calls.map(([path]) => path), ['/partner/operations/cohort',
    '/partner/operations/cohort/enroll', '/partner/operations/pause']);
  const pause = calls[2][1] as { type: string; idempotency: { actorId: string; payloadHash: string } };
  assert.equal(pause.type, 'OPERATIONS_PAUSE');
  assert.equal(pause.idempotency.actorId, 'admin-1');
  assert.match(pause.idempotency.payloadHash, /^sha256-v1:[a-f0-9]{64}$/);
  const denied = createPartnerOperationsHttpPort({ post: async () => ({ data: { ok: false, error: {
    ...partnerError('FORBIDDEN'), supportReference: 'support-1',
  } } }) });
  const denial = await denied.enroll({ sellerId: 'fariba-1', expectedRevision: 2,
    reason: 'بررسی حفظ خطای عمومی معتبر در رابط' });
  assert.equal(denial.ok ? null : denial.error.code, 'FORBIDDEN');
});
