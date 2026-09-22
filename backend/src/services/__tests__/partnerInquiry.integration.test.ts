import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PrismaClient, type Prisma } from '@prisma/client';
import { canonicalHash, type InquiryIdentity, type PartnerCommand } from '@sabalanerp/partner-sales-contracts';
import { createPartnerInquiryService } from '../partnerSales/inquiries/service';
import { appendAuthorizationDecision, readAuthorizationDecisionByCorrelation } from '../effectiveAuthorization/audit';
import { ensureMissingResponderSupport } from '../partnerSales/inquiries/adapters';
import { resolveApprovalForUse } from '../partnerSales/inquiries/approvalUsage';

function localDatabaseUrl(): string {
  const url = new URL(process.env.CONTRACT_RECOVERY_TEST_DATABASE_URL ?? '');
  if (url.hostname !== '127.0.0.1' || url.port !== '55432' || url.pathname !== '/sabalanerp') throw new Error('Existing local DB required');
  url.searchParams.set('connection_limit', '2'); url.searchParams.set('pool_timeout', '10');
  return url.toString();
}

async function fixture(run: (tx: Prisma.TransactionClient, ids: { actorId: string; responderId: string; inquiryId: string }) => Promise<void>) {
  const database = new PrismaClient({ datasources: { db: { url: localDatabaseUrl() } } });
  const rollback = new Error('rollback inquiry fixture');
  try {
    await database.$transaction(async tx => {
      const suffix = randomUUID(), actorId = `inquiry-partner-${suffix}`, responderId = `inquiry-responder-${suffix}`;
      await tx.user.createMany({ data: [
        { id: actorId, username: actorId, email: `${actorId}@example.invalid`, password: 'not-a-login', firstName: 'Partner', lastName: 'Fixture' },
        { id: responderId, username: responderId, email: `${responderId}@example.invalid`, password: 'not-a-login', firstName: 'Responder', lastName: 'Fixture' },
      ] });
      await tx.partnerProfile.create({ data: { id: actorId, userId: actorId, state: 'ACTIVE' } });
      await tx.partnerReleaseCohort.create({ data: { id: actorId, name: actorId, activationEnabled: true,
        enrollmentPaused: false, operationalPaused: false } });
      await tx.partnerOperationsControl.update({ where: { id: 'partner-operations' }, data: {
        cohortId: actorId, enrollmentPaused: false, operationalPaused: false } });
      await tx.partnerCohortMembership.create({ data: { id: actorId, profileId: actorId, cohortId: actorId,
        actorId, eligibilityEvidence: { fixture: true } } });
      await run(tx, { actorId, responderId, inquiryId: `inquiry-${suffix}` });
      throw rollback;
    }, { timeout: 20_000 });
  } catch (error) { if (error !== rollback) throw error; }
  finally { await database.$disconnect(); }
}

const identity = (actorId: string): InquiryIdentity => ({ schemaVersion: 1, partnerSellerId: actorId,
  catalogProductId: 'catalog-stone-1', family: 'prepared', unit: 'count',
  configuration: [{ key: 'technicalConfigurationHash', value: `sha256-v1:${'1'.repeat(64)}` }],
  materialRateEvidenceId: 'material-evidence-1', materialRateHash: `sha256-v1:${'2'.repeat(64)}`,
  components: [], currency: 'IRT', calculationPolicyVersion: 'calculation-v1', roundingPolicyVersion: 'rounding-v2' });

async function submit(actorId: string, inquiryId: string, rowId = 'row-1', predecessor?: { rowId: string; revision: number; reason?: string }) {
  const rows = [{ rowId, configuration: { recoveryId: 'recovery-1', recoveryRevision: 1, productRowId: rowId }, ...(predecessor ? { predecessor } : {}) }];
  const payloadHash = await canonicalHash({ schemaVersion: 1, type: 'INQUIRY_SUBMIT', partnerSellerId: actorId, rows });
  return { schemaVersion: 1, type: 'INQUIRY_SUBMIT', partnerSellerId: actorId, rows,
    commandId: `command-${rowId}`, correlationId: `correlation-${rowId}`,
    idempotency: { actorId, operation: 'INQUIRY_SUBMIT', targetId: inquiryId, key: `key-${rowId}`, payloadHash } } as PartnerCommand;
}

test('submission binds owner-issued configuration evidence, replays exactly and projects no private rates', async () => {
  await fixture(async (tx, ids) => {
    const published: string[] = [];
    const service = createPartnerInquiryService({ actorId: ids.actorId,
      transaction: <T>(run: (database: Prisma.TransactionClient) => Promise<T>) => run(tx),
      authorize: async (_database, request) => request.actorId === ids.actorId ? { ok: true, value: { evidenceId: 'authorization-fixture' } } : { ok: false, error: { code: 'NOT_FOUND', status: 404, message: 'مورد در دسترس نیست.' } },
      resolveInitialResponder: async () => ({ ok: true, value: { responderId: ids.responderId, eligibilityEvidence: { source: 'fixture' } } }),
      resolveConfiguration: async (_database, request) => ({ ok: true, value: { identity: identity(ids.actorId),
        description: `سنگ آماده تست ${request.reference.productRowId}`,
        configuration: [{ label: 'تعداد', value: request.reference.productRowId === 'row-1' ? '۲' : '۳' }] } }),
      publishCommittedEvents: async eventIds => { published.push(...eventIds); throw new Error('simulated delivery outage'); },
    });
    const command = await submit(ids.actorId, ids.inquiryId);
    const first = await service.execute(command);
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.value.replayed, false);
    assert.deepEqual(published, first.value.eventIds, 'post-commit handoff occurs and delivery failure does not change command success');
    const replay = await service.execute(command);
    assert.equal(replay.ok, true);
    if (replay.ok) assert.equal(replay.value.replayed, true);
    const view = await service.query({ schemaVersion: 2, purpose: 'PARTNER_INQUIRY', inquiryId: ids.inquiryId });
    assert.equal(view.ok, true);
    if (!view.ok || view.value.purpose !== 'PARTNER_INQUIRY') return;
    assert.equal(view.value.rows[0].configurationRef.productRowId, 'row-1');
    assert.equal(view.value.rows[0].state, 'PENDING');
    assert.equal(JSON.stringify(view.value).includes('materialRate'), false);
    assert.equal(JSON.stringify(view.value).includes('wholesale'), false);
    assert.equal(await tx.partnerInquiry.count({ where: { id: ids.inquiryId } }), 1);
    assert.equal(await tx.partnerInquiryRow.count({ where: { inquiryId: ids.inquiryId } }), 1);
    assert.equal(await tx.partnerInquiryAssignment.count({ where: { inquiryId: ids.inquiryId } }), 1);
    const parallelInquiryId = `parallel-${ids.inquiryId}`;
    const parallel = await service.execute(await submit(ids.actorId, parallelInquiryId, 'parallel-row'));
    assert.equal(parallel.ok, true, 'a pending inquiry never blocks a separate new inquiry');
    assert.equal(await tx.partnerInquiry.count({ where: { profileId: ids.actorId } }), 2);
    assert.equal((await service.query({ schemaVersion: 2, purpose: 'PARTNER_INQUIRY',
      inquiryId: ids.inquiryId })).ok, true, 'the original pending inquiry remains independently readable');
  });
});

test('submission rejects foreign configuration and preserves a linear successor', async () => {
  await fixture(async (tx, ids) => {
    const service = createPartnerInquiryService({ actorId: ids.actorId,
      transaction: <T>(run: (database: Prisma.TransactionClient) => Promise<T>) => run(tx), authorize: async () => ({ ok: true, value: { evidenceId: 'authorization-fixture' } }),
      resolveInitialResponder: async () => ({ ok: true, value: { responderId: ids.responderId, eligibilityEvidence: { source: 'fixture' } } }),
      resolveConfiguration: async (_database, request) => request.reference.productRowId.startsWith('foreign')
        ? { ok: false, error: { code: 'NOT_FOUND', status: 404, message: 'مورد در دسترس نیست.' } }
        : { ok: true, value: { identity: identity(ids.actorId), description: 'سنگ تست', configuration: [{ label: 'نوع', value: 'آماده' }] } },
    });
    const invalid = await service.execute(await submit(ids.actorId, ids.inquiryId, 'foreign-row'));
    assert.equal(invalid.ok ? null : invalid.error.code, 'NOT_FOUND');
    assert.equal(await tx.partnerInquiry.count({ where: { id: ids.inquiryId } }), 0);
    assert.equal((await service.execute(await submit(ids.actorId, ids.inquiryId))).ok, true);
    await tx.partnerInquiryRow.update({ where: { id: 'row-1' }, data: { outcome: 'REJECTED', revision: 2 } });
    const otherInquiryId = `other-${ids.inquiryId}`;
    assert.equal((await service.execute(await submit(ids.actorId, otherInquiryId, 'other-base'))).ok, true);
    await tx.partnerInquiryRow.update({ where: { id: 'other-base' }, data: { outcome: 'REJECTED', revision: 2 } });
    const crossInquiry = await service.execute(await submit(ids.actorId, ids.inquiryId, 'cross-successor',
      { rowId: 'other-base', revision: 2, reason: 'اتصال نادرست بین دو استعلام' }));
    assert.equal(crossInquiry.ok ? null : crossInquiry.error.code, 'NOT_FOUND');
    const successor = await service.execute(await submit(ids.actorId, ids.inquiryId, 'row-2', { rowId: 'row-1', revision: 2, reason: 'اصلاح مشخصات فنی' }));
    assert.equal(successor.ok, true);
    const parallel = await service.execute(await submit(ids.actorId, ids.inquiryId, 'row-3', { rowId: 'row-1', revision: 2, reason: 'اصلاح موازی نامعتبر' }));
    assert.equal(parallel.ok ? null : parallel.error.code, 'STATE_CONFLICT');
    const view = await service.query({ schemaVersion: 2, purpose: 'PARTNER_INQUIRY', inquiryId: ids.inquiryId });
    if (!view.ok || view.value.purpose !== 'PARTNER_INQUIRY') throw new Error('Inquiry view unavailable');
    assert.equal(view.value.rows.find(row => row.rowId === 'row-2')?.predecessor?.rowId, 'row-1');
    assert.equal(view.value.rows.find(row => row.rowId === 'row-1')?.successor?.rowId, 'row-2');
  });
});

test('bulk responder decision commits valid rows independently, preserves stale rows and replays the exact batch', async () => {
  await fixture(async (tx, ids) => {
    const shared = {
      transaction: <T>(run: (database: Prisma.TransactionClient) => Promise<T>) => run(tx),
      authorize: async () => ({ ok: true as const, value: { evidenceId: 'authorization-fixture' } }),
      resolveInitialResponder: async () => ({ ok: true as const, value: { responderId: ids.responderId, eligibilityEvidence: { source: 'fixture' } } }),
      resolveConfiguration: async (_database: Prisma.TransactionClient, request: { reference: { productRowId: string } }) =>
        ({ ok: true as const, value: { identity: identity(ids.actorId), description: request.reference.productRowId,
          configuration: [{ label: 'ردیف', value: request.reference.productRowId }] } }),
    };
    const partner = createPartnerInquiryService({ actorId: ids.actorId, ...shared });
    const initial = await submit(ids.actorId, ids.inquiryId);
    if (initial.type !== 'INQUIRY_SUBMIT') throw new Error('submit command expected');
    const rows = [initial.rows[0], { ...initial.rows[0], rowId: 'row-2', configuration: { ...initial.rows[0].configuration, productRowId: 'row-2' } }];
    const payloadHash = await canonicalHash({ schemaVersion: 1, type: 'INQUIRY_SUBMIT', partnerSellerId: ids.actorId, rows });
    assert.equal((await partner.execute({ ...initial, rows, idempotency: { ...initial.idempotency, payloadHash } })).ok, true);
    const decisions = [
      { rowId: 'row-1', expectedRevision: 1, outcome: 'APPROVED' as const,
        wholesaleUnitPrice: { amount: '1250000', currency: 'IRT' as const } },
      { rowId: 'row-2', expectedRevision: 99, outcome: 'REJECTED' as const, reason: 'رد تستی ردیف قدیمی' },
    ];
    const intent = { schemaVersion: 1 as const, type: 'INQUIRY_DECIDE' as const, inquiryId: ids.inquiryId,
      expectedAssignmentRevision: 1, decisions };
    const decisionHash = await canonicalHash(intent);
    const command = { ...intent, commandId: 'bulk-decision-1', correlationId: 'bulk-decision-1',
      idempotency: { actorId: ids.responderId, operation: 'INQUIRY_DECIDE' as const,
        targetId: ids.inquiryId, key: 'bulk-decision-1', payloadHash: decisionHash } };
    const responder = createPartnerInquiryService({ actorId: ids.responderId, ...shared });
    await tx.partnerOperationsControl.update({ where: { id: 'partner-operations' }, data: { operationalPaused: true } });
    const paused = await responder.execute(command);
    assert.equal(paused.ok ? null : paused.error.code, 'OPERATIONAL_PAUSE');
    await tx.partnerOperationsControl.update({ where: { id: 'partner-operations' }, data: { operationalPaused: false } });
    const result = await responder.execute(command);
    assert.equal(result.ok, true);
    if (!result.ok || !result.value.batch) return;
    assert.equal(result.value.batch.outcomes[0].ok, true);
    assert.equal(result.value.batch.outcomes[1].ok ? null : result.value.batch.outcomes[1].error.code, 'ROW_STALE');
    const approval = await tx.partnerInquiryApproval.findUniqueOrThrow({ where: { rowId: 'row-1' } });
    assert.equal(approval.expiresAt.getTime() - approval.approvedAt.getTime(), 48 * 60 * 60 * 1000);
    const reusable = await resolveApprovalForUse(tx, { binding: { inquiryId: ids.inquiryId, rowId: 'row-1', revision: 2 },
      partnerSellerId: ids.actorId, configurationHash: (await tx.partnerInquiryRow.findUniqueOrThrow({ where: { id: 'row-1' } })).configurationHash });
    assert.equal(reusable.ok, true);
    assert.equal((await tx.partnerInquiryRow.findUniqueOrThrow({ where: { id: 'row-2' } })).outcome, 'PENDING');
    const responderView = await responder.query({ schemaVersion: 2, purpose: 'RESPONDER_INQUIRY', inquiryId: ids.inquiryId });
    assert.equal(responderView.ok, true);
    if (responderView.ok && responderView.value.purpose === 'RESPONDER_INQUIRY') {
      assert.equal(responderView.value.rows.find(row => row.rowId === 'row-1')?.description, 'row-1');
      assert.deepEqual(responderView.value.rows.find(row => row.rowId === 'row-2')?.configuration,
        [{ label: 'ردیف', value: 'row-2' }]);
      assert.equal(typeof responderView.value.submittedAt, 'string');
      assert.equal(responderView.value.rows.find(row => row.rowId === 'row-1')?.state, 'APPROVED');
      assert.deepEqual(responderView.value.rows.find(row => row.rowId === 'row-2')?.actions,
        [{ action: 'INQUIRY_RESPOND', enabled: true }]);
      assert.equal(JSON.stringify(responderView.value).includes('configurationRef'), false);
    }
    const replay = await responder.execute(command);
    assert.equal(replay.ok, true);
    if (replay.ok) { assert.equal(replay.value.replayed, true); assert.deepEqual(replay.value.batch, result.value.batch); }
    const successor = await submit(ids.actorId, ids.inquiryId, 'row-3',
      { rowId: 'row-1', revision: 2, reason: 'اصلاح فنی پس از قیمت قبلی' });
    assert.equal((await partner.execute(successor)).ok, true);
    const successorDecisions = [{ rowId: 'row-3', expectedRevision: 1, outcome: 'APPROVED' as const,
      wholesaleUnitPrice: { amount: '1300000', currency: 'IRT' as const } }];
    const successorIntent = { schemaVersion: 1 as const, type: 'INQUIRY_DECIDE' as const, inquiryId: ids.inquiryId,
      expectedAssignmentRevision: 1, decisions: successorDecisions };
    const successorDecision = { ...successorIntent, commandId: 'successor-decision', correlationId: 'successor-decision',
      idempotency: { actorId: ids.responderId, operation: 'INQUIRY_DECIDE' as const, targetId: ids.inquiryId,
        key: 'successor-decision', payloadHash: await canonicalHash(successorIntent) } };
    assert.equal((await responder.execute(successorDecision)).ok, true);
    const successorApproval = await tx.partnerInquiryApproval.findUniqueOrThrow({ where: { rowId: 'row-3' } });
    assert.equal(successorApproval.supersessionReason, 'اصلاح فنی پس از قیمت قبلی');
    const reasonlessSuccessor = await submit(ids.actorId, ids.inquiryId, 'row-4',
      { rowId: 'row-3', revision: 2 });
    assert.equal((await partner.execute(reasonlessSuccessor)).ok, true);
    const reasonlessDecisions = [{ rowId: 'row-4', expectedRevision: 1, outcome: 'APPROVED' as const,
      wholesaleUnitPrice: { amount: '1350000', currency: 'IRT' as const } }];
    const reasonlessIntent = { schemaVersion: 1 as const, type: 'INQUIRY_DECIDE' as const, inquiryId: ids.inquiryId,
      expectedAssignmentRevision: 1, decisions: reasonlessDecisions };
    const reasonlessDecision = { ...reasonlessIntent, commandId: 'reasonless-successor-decision',
      correlationId: 'reasonless-successor-decision', idempotency: { actorId: ids.responderId,
        operation: 'INQUIRY_DECIDE' as const, targetId: ids.inquiryId, key: 'reasonless-successor-decision',
        payloadHash: await canonicalHash(reasonlessIntent) } };
    const reasonlessResult = await responder.execute(reasonlessDecision);
    assert.equal(reasonlessResult.ok, true);
    const reasonlessApproval = await tx.partnerInquiryApproval.findUniqueOrThrow({ where: { rowId: 'row-4' } });
    assert.equal(reasonlessApproval.supersessionReason, null);
    const finalView = await partner.query({ schemaVersion: 2, purpose: 'PARTNER_INQUIRY', inquiryId: ids.inquiryId });
    if (!finalView.ok || finalView.value.purpose !== 'PARTNER_INQUIRY') throw new Error('Partner view unavailable');
    assert.equal(finalView.value.rows.find(row => row.rowId === 'row-1')?.state, 'SUPERSEDED');
    const superseded = await resolveApprovalForUse(tx, { binding: { inquiryId: ids.inquiryId, rowId: 'row-1', revision: 2 },
      partnerSellerId: ids.actorId, configurationHash: (await tx.partnerInquiryRow.findUniqueOrThrow({ where: { id: 'row-1' } })).configurationHash });
    assert.equal(superseded.ok ? null : superseded.error.code, 'APPROVAL_SUPERSEDED');
    await tx.partnerProfile.update({ where: { id: ids.actorId }, data: { state: 'TERMINATED', revision: { increment: 1 } } });
    const terminated = await resolveApprovalForUse(tx, { binding: { inquiryId: ids.inquiryId, rowId: 'row-1', revision: 2 },
      partnerSellerId: ids.actorId, configurationHash: (await tx.partnerInquiryRow.findUniqueOrThrow({ where: { id: 'row-1' } })).configurationHash });
    assert.equal(terminated.ok ? null : terminated.error.code, 'PARTNER_NOT_ACTIVE');
  });
});

test('responder can decide pending rows in separate commands after an earlier row changes the inquiry revision', async () => {
  await fixture(async (tx, ids) => {
    await tx.partnerProfile.update({ where: { id: ids.actorId }, data: {
      irreversibleAt: new Date('2026-09-21T08:00:00.000Z'),
    } });
    const shared = {
      transaction: <T>(run: (database: Prisma.TransactionClient) => Promise<T>) => run(tx),
      authorize: async () => ({ ok: true as const, value: { evidenceId: 'authorization-fixture' } }),
      resolveInitialResponder: async () => ({ ok: true as const, value: {
        responderId: ids.responderId, eligibilityEvidence: { source: 'fixture' },
      } }),
      resolveConfiguration: async (_database: Prisma.TransactionClient, request: { reference: { productRowId: string } }) =>
        ({ ok: true as const, value: { identity: identity(ids.actorId), description: request.reference.productRowId,
          configuration: [{ label: 'ردیف', value: request.reference.productRowId }] } }),
    };
    const partner = createPartnerInquiryService({ actorId: ids.actorId, ...shared });
    const initial = await submit(ids.actorId, ids.inquiryId);
    if (initial.type !== 'INQUIRY_SUBMIT') throw new Error('submit command expected');
    const rows = [initial.rows[0], { ...initial.rows[0], rowId: 'row-2',
      configuration: { ...initial.rows[0].configuration, productRowId: 'row-2' } }];
    const payloadHash = await canonicalHash({ schemaVersion: 1, type: 'INQUIRY_SUBMIT',
      partnerSellerId: ids.actorId, rows });
    assert.equal((await partner.execute({ ...initial, rows,
      idempotency: { ...initial.idempotency, payloadHash } })).ok, true);

    const responder = createPartnerInquiryService({ actorId: ids.responderId, ...shared });
    const decide = async (rowId: string, commandId: string) => {
      const intent = { schemaVersion: 1 as const, type: 'INQUIRY_DECIDE' as const, inquiryId: ids.inquiryId,
        expectedAssignmentRevision: 1, decisions: [{ rowId, expectedRevision: 1, outcome: 'APPROVED' as const,
          wholesaleUnitPrice: { amount: '2000000', currency: 'IRT' as const } }] };
      return responder.execute({ ...intent, commandId, correlationId: commandId,
        idempotency: { actorId: ids.responderId, operation: 'INQUIRY_DECIDE' as const,
          targetId: ids.inquiryId, key: commandId, payloadHash: await canonicalHash(intent) } });
    };

    const first = await decide('row-1', 'sequential-decision-1');
    assert.equal(first.ok, true);
    const second = await decide('row-2', 'sequential-decision-2');
    assert.equal(second.ok, true, second.ok ? undefined : second.error.code);
    assert.deepEqual((await tx.partnerInquiryRow.findMany({ where: { inquiryId: ids.inquiryId },
      orderBy: { id: 'asc' }, select: { id: true, outcome: true, revision: true } })), [
      { id: 'row-1', outcome: 'APPROVED', revision: 2 },
      { id: 'row-2', outcome: 'APPROVED', revision: 2 },
    ]);
  });
});

test('sales management response atomically takes over an open inquiry and preserves the prior responder evidence', async () => {
  await fixture(async (tx, ids) => {
    const managerId = `sales-manager-${randomUUID()}`;
    await tx.user.create({ data: { id: managerId, username: managerId, email: `${managerId}@example.invalid`,
      password: 'not-a-login', firstName: 'Sales', lastName: 'Manager', role: 'MANAGER' } });
    const shared = {
      transaction: <T>(run: (database: Prisma.TransactionClient) => Promise<T>) => run(tx),
      resolveInitialResponder: async () => ({ ok: true as const, value: {
        responderId: ids.responderId, eligibilityEvidence: { source: 'fixture' },
      } }),
      resolveConfiguration: async (_database: Prisma.TransactionClient, request: { reference: { productRowId: string } }) =>
        ({ ok: true as const, value: { identity: identity(ids.actorId), description: request.reference.productRowId,
          configuration: [{ label: 'ردیف', value: request.reference.productRowId }] } }),
    };
    const partner = createPartnerInquiryService({ actorId: ids.actorId, ...shared,
      authorize: async () => ({ ok: true as const, value: { evidenceId: 'partner-fixture' } }) });
    assert.equal((await partner.execute(await submit(ids.actorId, ids.inquiryId))).ok, true);
    const manager = createPartnerInquiryService({ actorId: managerId, ...shared,
      authorize: async () => ({ ok: true as const, value: {
        evidenceId: 'management-override-fixture', managementOverride: true,
      } }) });
    const query = await manager.query({ schemaVersion: 2, purpose: 'RESPONDER_INQUIRY', inquiryId: ids.inquiryId });
    assert.equal(query.ok, true);
    const staleIntent = { schemaVersion: 1 as const, type: 'INQUIRY_DECIDE' as const, inquiryId: ids.inquiryId,
      expectedAssignmentRevision: 1, decisions: [{ rowId: 'row-1', expectedRevision: 99,
        outcome: 'REJECTED' as const, reason: 'رد آزمایشی نسخه منقضی' }] };
    const stale = await manager.execute({ ...staleIntent, commandId: 'management-stale-decision',
      correlationId: 'management-stale-decision', idempotency: { actorId: managerId,
        operation: 'INQUIRY_DECIDE', targetId: ids.inquiryId, key: 'management-stale-decision',
        payloadHash: await canonicalHash(staleIntent) } });
    assert.equal(stale.ok, true);
    if (stale.ok) assert.equal(stale.value.batch?.outcomes[0]?.ok, false);
    assert.equal(await tx.partnerInquiryAssignment.count({ where: { inquiryId: ids.inquiryId } }), 1,
      'a stale management decision must not take over the assignment');
    const decisions = [{ rowId: 'row-1', expectedRevision: 1, outcome: 'APPROVED' as const,
      wholesaleUnitPrice: { amount: '1450000', currency: 'IRT' as const } }];
    const intent = { schemaVersion: 1 as const, type: 'INQUIRY_DECIDE' as const, inquiryId: ids.inquiryId,
      expectedAssignmentRevision: 1, decisions };
    const result = await manager.execute({ ...intent, commandId: 'management-takeover-decision',
      correlationId: 'management-takeover-decision', idempotency: { actorId: managerId,
        operation: 'INQUIRY_DECIDE', targetId: ids.inquiryId, key: 'management-takeover-decision',
        payloadHash: await canonicalHash(intent) } });
    assert.equal(result.ok, true);
    const packageWindow = await tx.partnerInquiry.findUniqueOrThrow({ where: { id: ids.inquiryId },
      select: { pricingReadyAt: true, pricingExpiresAt: true } });
    assert.ok(packageWindow.pricingReadyAt);
    assert.equal(packageWindow.pricingExpiresAt!.getTime() - packageWindow.pricingReadyAt.getTime(), 48 * 60 * 60 * 1000);
    const assignments = await tx.partnerInquiryAssignment.findMany({ where: { inquiryId: ids.inquiryId },
      orderBy: { revision: 'asc' } });
    assert.deepEqual(assignments.map(row => [row.revision, row.responderId]),
      [[1, ids.responderId], [2, managerId]]);
    assert.equal(assignments[1].reason, 'تصاحب مدیریتی اتمیک برای ثبت پاسخ استعلام باز');
    const event = await tx.partnerInquiryEvent.findFirstOrThrow({ where: { inquiryId: ids.inquiryId,
      type: 'INQUIRY_DECIDED' }, orderBy: { revision: 'desc' } });
    const evidence = event.evidence as { managementTakeover?: { previousResponderId?: string } };
    assert.equal(evidence.managementTakeover?.previousResponderId, ids.responderId);
  });
});

test('reassignment is pending-only and cancellation retains immutable approvals while closing pending rows', async () => {
  await fixture(async (tx, ids) => {
    const replacementId = `replacement-${randomUUID()}`;
    await tx.user.create({ data: { id: replacementId, username: replacementId, email: `${replacementId}@example.invalid`,
      password: 'not-a-login', firstName: 'Replacement', lastName: 'Responder' } });
    const shared = {
      transaction: <T>(run: (database: Prisma.TransactionClient) => Promise<T>) => run(tx),
      authorize: async () => ({ ok: true as const, value: { evidenceId: 'authorization-fixture' } }),
      resolveInitialResponder: async () => ({ ok: true as const, value: { responderId: ids.responderId, eligibilityEvidence: { source: 'fixture' } } }),
      resolveResponder: async (_database: Prisma.TransactionClient, input: { responderId: string }) => input.responderId === replacementId
        ? { ok: true as const, value: { responderId: replacementId, eligibilityEvidence: { source: 'replacement-fixture' } } }
        : { ok: false as const, error: { code: 'NOT_ASSIGNED' as const, status: 403 as const, message: 'پاسخ این استعلام به شما واگذار نشده است.' } },
      resolveConfiguration: async (_database: Prisma.TransactionClient, request: { reference: { productRowId: string } }) =>
        ({ ok: true as const, value: { identity: identity(ids.actorId), description: request.reference.productRowId,
          configuration: [{ label: 'ردیف', value: request.reference.productRowId }] } }),
    };
    const partner = createPartnerInquiryService({ actorId: ids.actorId, ...shared });
    assert.equal((await partner.execute(await submit(ids.actorId, ids.inquiryId))).ok, true);
    const reassignIntent = { schemaVersion: 1 as const, type: 'INQUIRY_REASSIGN' as const, inquiryId: ids.inquiryId,
      expectedAssignmentRevision: 1, responderId: replacementId, reason: 'تغییر پاسخ‌دهنده مصوب' };
    const reassignHash = await canonicalHash(reassignIntent);
    const manager = createPartnerInquiryService({ actorId: 'sales-manager-fixture', ...shared });
    await tx.partnerReleaseCohort.update({ where: { id: ids.actorId }, data: { operationalPaused: true } });
    const reassigned = await manager.execute({ ...reassignIntent, commandId: 'reassign-command', correlationId: 'reassign-command',
      idempotency: { actorId: 'sales-manager-fixture', operation: 'INQUIRY_REASSIGN', targetId: ids.inquiryId,
        key: 'reassign-command', payloadHash: reassignHash } });
    assert.equal(reassigned.ok, true);
    const latest = await tx.partnerInquiryAssignment.findFirstOrThrow({ where: { inquiryId: ids.inquiryId }, orderBy: { revision: 'desc' } });
    assert.equal(latest.revision, 2); assert.equal(latest.responderId, replacementId);
    const cancelIntent = { schemaVersion: 1 as const, type: 'INQUIRY_CANCEL' as const, inquiryId: ids.inquiryId,
      expectedRevision: 2, reason: 'لغو پشتیبانی استعلام تعلیق‌شده' };
    const cancelHash = await canonicalHash(cancelIntent);
    await tx.partnerProfile.update({ where: { id: ids.actorId }, data: { state: 'SUSPENDED' } });
    const cancelled = await manager.execute({ ...cancelIntent, commandId: 'cancel-command', correlationId: 'cancel-command',
      idempotency: { actorId: 'sales-manager-fixture', operation: 'INQUIRY_CANCEL', targetId: ids.inquiryId,
        key: 'cancel-command', payloadHash: cancelHash } });
    assert.equal(cancelled.ok, true);
    assert.equal((await tx.partnerInquiryRow.findUniqueOrThrow({ where: { id: 'row-1' } })).outcome, 'CANCELLED');
    const second = await manager.execute({ ...reassignIntent, expectedAssignmentRevision: 2, commandId: 'reassign-after-cancel',
      correlationId: 'reassign-after-cancel', idempotency: { actorId: 'sales-manager-fixture', operation: 'INQUIRY_REASSIGN',
        targetId: ids.inquiryId, key: 'reassign-after-cancel', payloadHash: await canonicalHash({ ...reassignIntent, expectedAssignmentRevision: 2 }) } });
    assert.equal(second.ok ? null : second.error.code, 'STATE_CONFLICT');
  });
});

test('authorization evidence lookup is exact even after the bounded audit history exceeds one hundred rows', async () => {
  await fixture(async (tx, ids) => {
    const evaluatedAt = new Date('2026-08-29T10:00:00.000Z');
    for (let index = 0; index < 101; index += 1) {
      await appendAuthorizationDecision(tx, { domain: 'PARTNER', actorId: ids.actorId, action: 'INQUIRY_READ',
        rootKind: 'INQUIRY', rootId: ids.inquiryId, purpose: 'PARTNER', channel: 'API', allowed: true,
        isAdmin: false, code: 'ALLOWED', scope: 'OWN', reason: null, correlationId: `older-${index}`,
        authorizationRevision: 1, lifecycleRevision: 1, assignmentId: null, assignmentRevision: null,
        evaluatedAt, evaluatedGrantIds: [] });
    }
    const expected = await appendAuthorizationDecision(tx, { domain: 'PARTNER', actorId: ids.actorId,
      action: 'INQUIRY_WRITE', rootKind: 'PROFILE', rootId: ids.actorId, purpose: 'PARTNER', channel: 'API',
      allowed: true, isAdmin: false, code: 'ALLOWED', scope: 'OWN', reason: null,
      correlationId: 'exact-inquiry-create', authorizationRevision: 1, lifecycleRevision: 1,
      assignmentId: null, assignmentRevision: null, evaluatedAt, evaluatedGrantIds: [] });
    const found = await readAuthorizationDecisionByCorrelation(tx, { domain: 'PARTNER', actorId: ids.actorId,
      action: 'INQUIRY_WRITE', rootKind: 'PROFILE', rootId: ids.actorId, purpose: 'PARTNER', channel: 'API',
      correlationId: 'exact-inquiry-create', allowed: true });
    assert.equal(found?.id, expected.id);
  });
});

test('missing active responder fails with the actionable message and creates one idempotent Admin support ticket', async () => {
  await fixture(async (tx, ids) => {
    const adminId = `admin-${randomUUID()}`;
    await tx.user.create({ data: { id: adminId, username: adminId, email: `${adminId}@example.invalid`,
      password: 'not-a-login', firstName: 'Admin', lastName: 'Fixture', role: 'ADMIN' } });
    const service = createPartnerInquiryService({ actorId: ids.actorId,
      transaction: <T>(run: (database: Prisma.TransactionClient) => Promise<T>) => run(tx),
      authorize: async () => ({ ok: true, value: { evidenceId: 'authorization-fixture' } }),
      resolveInitialResponder: async () => ({ ok: false, error: { code: 'NOT_ASSIGNED', status: 403,
        message: 'پاسخ این استعلام به شما واگذار نشده است.' } }),
      ensureMissingResponderSupport,
      resolveConfiguration: async () => ({ ok: true, value: { identity: identity(ids.actorId),
        description: 'سنگ تست', configuration: [{ label: 'نوع', value: 'آماده' }] } }),
    });
    const first = await service.execute(await submit(ids.actorId, ids.inquiryId));
    assert.deepEqual(first, { ok: false, error: { code: 'RESPONDER_UNAVAILABLE', status: 409,
      message: 'برای حساب شما پاسخ‌دهنده قیمت فعال تعیین نشده است؛ تا تعیین پاسخ‌دهنده، ثبت استعلام را متوقف کنید.' } });
    assert.equal((await tx.supportTicket.count({ where: { reporterId: ids.actorId } })), 1);
    assert.equal((await service.execute(await submit(ids.actorId, ids.inquiryId))).ok, false);
    assert.equal((await tx.supportTicket.count({ where: { reporterId: ids.actorId } })), 1);
  });
});
