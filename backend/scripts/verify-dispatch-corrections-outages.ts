import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { createAuthoritativeSession, SESSION_COOKIE } from '../src/services/identitySessionService';

const prisma = new PrismaClient();

const main = async () => {
  assert.ok(process.env.DATABASE_URL?.includes('127.0.0.1:55432'), 'Verification must target sabalanerp-local PostgreSQL.');
  const exited = await prisma.guardPhysicalExit.findFirst({ orderBy: { recordedAt: 'desc' }, include: { waybill: {
    include: { candidate: { include: { allocationRevision: { include: { lines: true } } } } } } } });
  assert.ok(exited, 'Run the #221 physical gate exit verifier first.');
  const actor = await prisma.user.findFirstOrThrow({ where: { role: 'ADMIN' } });
  const guardActor = await prisma.user.create({ data: { email: `outage-guard-${randomUUID()}@example.invalid`,
    username: `outage-guard-${randomUUID()}`, password: 'not-used', firstName: 'Outage', lastName: 'Guard', role: 'ADMIN' } });
  const ordinary = await prisma.user.create({ data: { email: `outage-denied-${randomUUID()}@example.invalid`,
    username: `outage-denied-${randomUUID()}`, password: 'not-used', firstName: 'Denied', lastName: 'Operator', role: 'USER' } });
  const [actorSession, guardSession, deniedSession] = await Promise.all([
    createAuthoritativeSession(prisma, actor.id, { userAgent: 'correction-outage-verifier' }),
    createAuthoritativeSession(prisma, guardActor.id, { userAgent: 'correction-outage-verifier' }),
    createAuthoritativeSession(prisma, ordinary.id, { userAgent: 'correction-outage-verifier' }),
  ]);
  const request = (token: string, path: string, init: RequestInit = {}) => fetch(`http://127.0.0.1:5000${path}`, { ...init,
    headers: { 'content-type': 'application/json', cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}`, ...(init.headers || {}) } });
  const jsonRequest = (token: string, path: string, body: unknown) => request(token, path, { method: 'POST', body: JSON.stringify(body) });
  const expectStatus = async (response: Response, expected: number) => {
    if (response.status !== expected) assert.fail(`Expected HTTP ${expected}, received ${response.status}: ${await response.text()}`);
  };
  assert.equal((await jsonRequest(deniedSession.token, '/api/accounting/dispatch-corrections', {})).status, 403);
  assert.equal((await jsonRequest(deniedSession.token, '/api/security/dispatch-returns/missing/verify', {})).status, 403);

  const line = exited.waybill.candidate.allocationRevision.lines[0];
  const projectionBefore = await prisma.shipmentQuantityProjection.findUniqueOrThrow({ where: { contractItemId: line.sourceContractItemId } });
  assert.equal((await jsonRequest(actorSession.token, '/api/accounting/dispatch-corrections', { waybillId: exited.waybillId,
    reason: 'Cannot predate physical dispatch', effectiveAt: new Date(exited.occurredAt.getTime() - 1).toISOString(),
    lines: [{ contractItemId: line.sourceContractItemId, quantity: '0.500' }] })).status, 400);
  const createResponse = await jsonRequest(actorSession.token, '/api/accounting/dispatch-corrections', { waybillId: exited.waybillId,
    reason: 'Append-only verification adjustment', effectiveAt: new Date().toISOString(),
    lines: [{ contractItemId: line.sourceContractItemId, quantity: '0.500' }] });
  await expectStatus(createResponse, 201);
  const correction = (await createResponse.json() as any).data;
  assert.equal((await prisma.shipmentQuantityProjection.findUniqueOrThrow({ where: { contractItemId: line.sourceContractItemId } })).physicallyDispatched.toFixed(3),
    projectionBefore.physicallyDispatched!.toFixed(3), 'draft correction cannot affect the projection');
  const postedResponse = await jsonRequest(actorSession.token, `/api/accounting/dispatch-corrections/${correction.id}/post`, {});
  await expectStatus(postedResponse, 200);
  const afterPositive = await prisma.shipmentQuantityProjection.findUniqueOrThrow({ where: { contractItemId: line.sourceContractItemId } });
  assert.equal(afterPositive.physicallyDispatched!.toFixed(3), projectionBefore.physicallyDispatched!.add('0.500').toFixed(3));
  await assert.rejects(prisma.dispatchCorrection.update({ where: { id: correction.id }, data: { reason: 'rewrite' } }), /immutable/i);

  const reversalResponse = await jsonRequest(actorSession.token, '/api/accounting/dispatch-corrections', { waybillId: exited.waybillId,
    reason: 'Opposite correction for prior mistake', effectiveAt: new Date().toISOString(), reversalOfId: correction.id,
    lines: [{ contractItemId: line.sourceContractItemId, quantity: '-0.500' }] });
  await expectStatus(reversalResponse, 201);
  const reversal = (await reversalResponse.json() as any).data;
  assert.equal((await jsonRequest(actorSession.token, `/api/accounting/dispatch-corrections/${reversal.id}/post`, {})).status, 200);
  assert.equal((await prisma.shipmentQuantityProjection.findUniqueOrThrow({ where: { contractItemId: line.sourceContractItemId } })).physicallyDispatched!.toFixed(3),
    projectionBefore.physicallyDispatched!.toFixed(3));
  assert.equal((await jsonRequest(actorSession.token, '/api/accounting/dispatch-corrections', { waybillId: exited.waybillId,
    reason: 'A duplicate opposite must be rejected', effectiveAt: new Date().toISOString(), reversalOfId: correction.id,
    lines: [{ contractItemId: line.sourceContractItemId, quantity: '-0.500' }] })).status, 409);

  const dispatchEvidence = await prisma.shipmentQuantityEvidence.findFirstOrThrow({ where: { kind: 'PHYSICAL_EXIT',
    contractItemId: line.sourceContractItemId, metadata: { path: ['physicalExitId'], equals: exited.id } } });
  await assert.rejects(prisma.shipmentQuantityEvidence.update({ where: { id: dispatchEvidence.id }, data: { metadata: { rewritten: true } } }),
    /append-only|immutable/i);
  const customer = await prisma.crmCustomer.findFirstOrThrow();
  const inboundResponse = await jsonRequest(guardSession.token, '/api/security/vehicle-movements/inbound', {
    purpose: 'SALES_RETURN', customerId: customer.id, loadingId: exited.waybill.candidate.allocationRevision.loadingId,
    occurredAt: new Date().toISOString() });
  await expectStatus(inboundResponse, 201);
  const inbound = (await inboundResponse.json() as any).data;
  const completeResponse = await request(guardSession.token, `/api/security/vehicle-movements/${inbound.id}/complete`, {
    method: 'PUT', body: JSON.stringify({}) });
  await expectStatus(completeResponse, 200);
  const movement = (await completeResponse.json() as any).data;
  const returnResponse = await jsonRequest(guardSession.token, `/api/security/dispatch-returns/${movement.id}/verify`, {
    dispatchEvidenceId: dispatchEvidence.id, quantity: '0.250' });
  await expectStatus(returnResponse, 201);
  const returnEvidence = (await returnResponse.json() as any).data;
  const returnRetryResponse = await jsonRequest(guardSession.token, `/api/security/dispatch-returns/${movement.id}/verify`, {
    dispatchEvidenceId: dispatchEvidence.id, quantity: '0.250' });
  await expectStatus(returnRetryResponse, 201);
  assert.equal(((await returnRetryResponse.json()) as any).data.id, returnEvidence.id);
  const prematureNegativeResponse = await jsonRequest(actorSession.token, '/api/accounting/dispatch-corrections', { waybillId: exited.waybillId,
    reason: 'Cannot predate verified return', effectiveAt: new Date(new Date(returnEvidence.effectiveAt).getTime() - 1).toISOString(),
    lines: [{ contractItemId: line.sourceContractItemId, quantity: '-0.250', returnEvidenceId: returnEvidence.id }] });
  await expectStatus(prematureNegativeResponse, 201);
  const prematureNegative = (await prematureNegativeResponse.json() as any).data;
  assert.equal((await jsonRequest(actorSession.token, `/api/accounting/dispatch-corrections/${prematureNegative.id}/post`, {})).status, 409);
  const negativeResponse = await jsonRequest(actorSession.token, '/api/accounting/dispatch-corrections', { waybillId: exited.waybillId,
    reason: 'Accepted Guard-proven physical return', effectiveAt: new Date().toISOString(),
    lines: [{ contractItemId: line.sourceContractItemId, quantity: '-0.250', returnEvidenceId: returnEvidence.id }] });
  await expectStatus(negativeResponse, 201);
  const negative = (await negativeResponse.json() as any).data;
  await expectStatus(await jsonRequest(actorSession.token, `/api/accounting/dispatch-corrections/${negative.id}/post`, {}), 200);
  assert.equal((await prisma.shipmentQuantityProjection.findUniqueOrThrow({ where: { contractItemId: line.sourceContractItemId } })).physicallyDispatched!.toFixed(3),
    projectionBefore.physicallyDispatched!.sub('0.250').toFixed(3));

  const outageWaybillCandidates = await prisma.accountingDispatchWaybill.findMany({ where: { status: 'ISSUED', physicalExit: null, manualOutageExit: null,
    candidate: { allocationRevision: { manualOutageExit: null, queueTurn: { status: 'LOADING_FINALIZED', manualOutageExit: null } } } },
    include: { candidate: { include: { allocationRevision: { include: { lines: true, queueTurn: true } } } } }, take: 50 });
  const outageWaybills = outageWaybillCandidates.filter((waybill, index, all) => all.findIndex((candidate) =>
    candidate.candidate.allocationRevision.queueTurnId === waybill.candidate.allocationRevision.queueTurnId) === index).slice(0, 2);
  assert.ok(outageWaybills.length >= 2, 'Run dispatch allocation and confirmation verification to create two outage-ready waybills.');
  const actualStartedAt = new Date(Date.now() - 60_000);
  const actualOccurredAt = new Date(Date.now() - 30_000);
  const outageResponse = await jsonRequest(actorSession.token, '/api/accounting/dispatch-outages/verify', { reason: 'Verified ERP-wide test outage',
    actualStartedAt: actualStartedAt.toISOString(),
    verification: { incidentReference: `INC-${Date.now()}`, confirmedUnavailableServices: ['backend', 'database'] } });
  await expectStatus(outageResponse, 201);
  const outage = (await outageResponse.json() as any).data;
  await assert.rejects(prisma.dispatchOutage.update({ where: { id: outage.id }, data: { reason: 'rewrite' } }), /immutable/i);
  const paperNumber = `MOE-${String(Date.now()).slice(-8)}`;
  const paperResponse = await jsonRequest(actorSession.token, '/api/accounting/manual-outage-exits', { outageId: outage.id,
    waybillId: outageWaybills[0].id, paperNumber, actualOccurredAt: actualOccurredAt.toISOString(),
    paperEvidence: { attachmentReference: `paper://${paperNumber}`, witnessedAt: actualOccurredAt.toISOString() } });
  await expectStatus(paperResponse, 201);
  const paper = (await paperResponse.json() as any).data;
  await assert.rejects(prisma.manualOutageExit.update({ where: { id: paper.id }, data: { paperEvidence: { rewritten: true } } }), /immutable/i);
  await assert.rejects(prisma.manualOutageExit.update({ where: { id: paper.id }, data: { status: 'APPROVED' } }),
    /manual_outage_approved_requires_distinct_actors/i);
  const spoiledPaperNumber = `MOE-${String(Date.now() + 1).slice(-8)}`;
  const spoiledResponse = await jsonRequest(actorSession.token, '/api/accounting/manual-outage-exits', { outageId: outage.id,
    waybillId: outageWaybills[1].id, paperNumber: spoiledPaperNumber, actualOccurredAt: actualOccurredAt.toISOString(),
    paperEvidence: { attachmentReference: `paper://${spoiledPaperNumber}` } });
  await expectStatus(spoiledResponse, 201);
  const spoiledPaper = (await spoiledResponse.json() as any).data;
  await expectStatus(await jsonRequest(guardSession.token, `/api/security/manual-outage-exits/${spoiledPaper.id}/spoil`, {
    reason: 'Pre-numbered form was damaged before use' }), 200);
  assert.ok(await prisma.dispatchEvidenceException.count({ where: { exceptionType: 'SPOILED_EMERGENCY_RECORD', aggregateId: spoiledPaper.id } }));
  const missingPaperNumber = `MOE-${String(Date.now() + 2).slice(-8)}`;
  await expectStatus(await jsonRequest(guardSession.token, '/api/security/manual-outage-papers/missing', {
    paperNumber: missingPaperNumber, reason: 'Number absent during post-outage reconciliation' }), 201);
  assert.ok(await prisma.dispatchEvidenceException.count({ where: { exceptionType: 'MISSING_EMERGENCY_RECORD', aggregateId: missingPaperNumber } }));
  assert.equal((await jsonRequest(actorSession.token, `/api/accounting/manual-outage-exits/${paper.id}/accounting-approval`, {})).status, 200);
  assert.equal((await jsonRequest(actorSession.token, `/api/accounting/manual-outage-exits/${paper.id}/accounting-approval`, {})).status, 200,
    'same-actor approval retry must be idempotent');
  assert.equal((await jsonRequest(guardSession.token, `/api/accounting/manual-outage-exits/${paper.id}/accounting-approval`, {})).status, 409,
    'a different supervisor cannot replace immutable Accounting approval evidence');
  await assert.rejects(prisma.manualOutageExit.update({ where: { id: paper.id }, data: { accountingApprovedBy: guardActor.id } }), /immutable/i);
  assert.equal((await jsonRequest(actorSession.token, `/api/security/manual-outage-exits/${paper.id}/guard-approval`, {})).status, 409,
    'the same global actor cannot provide both approvals');
  assert.equal((await jsonRequest(guardSession.token, `/api/security/manual-outage-exits/${paper.id}/guard-approval`, {})).status, 200);
  const actualEndedAt = new Date();
  assert.equal((await jsonRequest(actorSession.token, `/api/accounting/dispatch-outages/${outage.id}/end`, {
    actualEndedAt: actualEndedAt.toISOString() })).status, 200);
  const registeredResponse = await jsonRequest(guardSession.token, `/api/security/manual-outage-exits/${paper.id}/register`, {});
  await expectStatus(registeredResponse, 200);
  const registered = await prisma.manualOutageExit.findUniqueOrThrow({ where: { id: paper.id }, include: { smsIntent: true } });
  assert.equal(registered.status, 'REGISTERED');
  assert.equal(registered.actualOccurredAt.toISOString(), actualOccurredAt.toISOString());
  assert.ok(registered.recordedAt && registered.recordedAt > registered.actualOccurredAt);
  assert.equal((registered.snapshot as any).biometricSuccess, false);
  assert.equal((registered.snapshot as any).otpSuccess, false);
  assert.ok(registered.smsIntent && registered.smsIntent.idempotencyKey === `BUYER_OUTAGE_EXIT:${paper.id}`);
  assert.equal(await prisma.shipmentQuantityEvidence.count({ where: { kind: 'MANUAL_OUTAGE_EXIT',
    sourceType: 'MANUAL_OUTAGE_EXIT', sourceId: { startsWith: `${paper.id}:` } } }), outageWaybills[0].candidate.allocationRevision.lines.length);
  assert.equal((await prisma.accountingDispatchWaybill.findUniqueOrThrow({ where: { id: outageWaybills[0].id } })).status, 'EXIT_RECORDED');
  assert.equal(await prisma.dispatchExitAuthorization.count({ where: { waybillId: outageWaybills[0].id, status: 'ACTIVE' } }), 0,
    'manual registration must eliminate competing active digital authorizations');

  const duplicate = await jsonRequest(actorSession.token, '/api/accounting/manual-outage-exits', { outageId: outage.id,
    waybillId: outageWaybills[0].id, paperNumber, actualOccurredAt: actualOccurredAt.toISOString(), paperEvidence: {} });
  assert.equal(duplicate.status, 409);
  assert.ok(await prisma.dispatchEvidenceException.count({ where: { exceptionType: 'DUPLICATE_EMERGENCY_PAPER_NUMBER', aggregateId: paper.id } }));
  assert.equal(await prisma.dispatchBuyerSmsIntent.count({ where: { manualOutageExitId: paper.id } }), 1, 'retrospective retry cannot duplicate SMS intent');
  const assertAuditChain = async (aggregateType: string, aggregateId: string, requiredEvents: string[]) => {
    const events = await prisma.dispatchLifecycleAudit.findMany({ where: { aggregateType, aggregateId },
      orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }] });
    for (const eventType of requiredEvents) assert.ok(events.some((event) => event.eventType === eventType), `${eventType} audit event is required`);
    for (let index = 1; index < events.length; index += 1) assert.equal(events[index].previousHash, events[index - 1].eventHash);
    assert.ok(events.every((event) => (event.payload as any).effectiveAuthority), 'every audit event must preserve effective authority');
  };
  await assertAuditChain('DISPATCH_CORRECTION', correction.id, ['CORRECTION_DRAFT_CREATED', 'CORRECTION_POSTED']);
  await assertAuditChain('GUARD_RETURN', returnEvidence.id, ['PHYSICAL_RETURN_VERIFIED']);
  await assertAuditChain('DISPATCH_OUTAGE', outage.id, ['ERP_WIDE_OUTAGE_VERIFIED', 'ERP_WIDE_OUTAGE_ENDED']);
  await assertAuditChain('MANUAL_OUTAGE_EXIT', paper.id, ['PAPER_EXIT_REGISTERED_PENDING_APPROVALS', 'ACCOUNTING_PAPER_EXIT_APPROVED',
    'GUARD_PAPER_EXIT_APPROVED', 'MANUAL_OUTAGE_EXIT_REGISTERED', 'DUPLICATE_EMERGENCY_PAPER_NUMBER']);
  await assertAuditChain('MANUAL_OUTAGE_EXIT', spoiledPaper.id, ['PAPER_EXIT_REGISTERED_PENDING_APPROVALS', 'PAPER_EXIT_SPOILED']);
  await assertAuditChain('MANUAL_OUTAGE_PAPER', missingPaperNumber, ['EMERGENCY_PAPER_REPORTED_MISSING']);
  console.log('Append-only corrections, Guard returns, outage dual control, retrospective truth and evidence exceptions passed.');
};

main().finally(() => prisma.$disconnect());
