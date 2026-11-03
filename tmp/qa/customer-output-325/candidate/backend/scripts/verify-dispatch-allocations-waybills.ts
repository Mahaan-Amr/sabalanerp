import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import {
  decideAccountingDispatchCandidate,
  createSuccessorAllocationRevision,
  finalizeCanonicalLoadingAllocations,
  replaceAccountingDispatchWaybill,
  saveCanonicalAllocationDraft,
  voidAccountingDispatchWaybill,
} from '../src/services/dispatchAllocation';
import {
  admitGuardDriverQueueTurn,
  makeGuardQueueTurnAvailable,
  reserveGuardQueueTurn,
} from '../src/services/guardDriverQueue';
import { shipmentQuantityEvidenceIntegrityHash } from '../src/services/shipmentQuantityProjectionStore';
import { createAuthoritativeSession, SESSION_COOKIE } from '../src/services/identitySessionService';

const prisma = new PrismaClient();
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const createReadyTurn = async (guardId: string, loadingId: string, ordinal: number) => {
  const driver = await prisma.externalDriver.create({ data: {
    firstName: 'Dispatch', lastName: `Driver ${ordinal}`, nationalCode: `${String(Date.now()).slice(-8)}${String(ordinal).padStart(2, '0')}`,
    phone: `0912000000${ordinal}`, status: 'ACTIVE', createdBy: guardId,
  } });
  await prisma.externalDriverDocument.create({ data: { driverId: driver.id, documentType: 'DRIVING_LICENCE',
    reference: `LIC-${suffix}-${ordinal}`, expiresAt: new Date('2028-01-01'), recordedBy: guardId } });
  const vehicle = await prisma.externalVehicle.create({ data: { vehicleType: 'TRUCK', status: 'ACTIVE', createdBy: guardId } });
  await prisma.externalVehiclePlate.create({ data: { vehicleId: vehicle.id, plate: `TEST-${suffix}-${ordinal}`,
    normalizedPlate: `TEST${suffix.replace(/\W/g, '')}${ordinal}`, effectiveFrom: new Date('2026-01-01'),
    reason: 'Dispatch allocation verification', recordedBy: guardId } });
  await prisma.externalVehicleDocument.create({ data: { vehicleId: vehicle.id, documentType: 'VEHICLE_REGISTRATION',
    reference: `REG-${suffix}-${ordinal}`, expiresAt: new Date('2028-01-01'), recordedBy: guardId } });
  const admitted = await admitGuardDriverQueueTurn(prisma, { source: 'EXTERNAL', driverId: driver.id,
    vehicleId: vehicle.id, actorId: guardId });
  await makeGuardQueueTurnAvailable(prisma, admitted.id, guardId);
  await reserveGuardQueueTurn(prisma, { turnId: admitted.id, loadingId, actorId: guardId });
  return admitted.id;
};

const main = async () => {
  assert.ok(process.env.DATABASE_URL?.includes('127.0.0.1:55432'), 'Verification must target sabalanerp-local PostgreSQL.');
  const [department, product] = await Promise.all([prisma.department.findFirst(), prisma.product.findFirst()]);
  assert.ok(department && product, 'The local seed must contain a department and product.');
  const actor = await prisma.user.create({ data: { email: `dispatch-${suffix}@example.invalid`, username: `dispatch-${suffix}`,
    password: 'not-used', firstName: 'Dispatch', lastName: 'Verifier', role: 'ADMIN' } });
  const customer = await prisma.crmCustomer.create({ data: { firstName: 'Dispatch', lastName: 'Customer' } });
  const project = await prisma.projectAddress.create({ data: { customerId: customer.id, address: 'Dispatch verification project' } });
  const rowId = `dispatch-row-${suffix}`;
  const contract = await prisma.salesContract.create({ data: {
    contractNumber: `DISPATCH-${suffix}`, title: 'Dispatch verification', titlePersian: 'Dispatch verification', content: '',
    status: 'APPROVED', customerId: customer.id, departmentId: department.id, createdBy: actor.id,
    responsibleSellerId: actor.id, contractData: { products: [{ rowId, productId: product.id, quantity: '10.000', unit: 'count', name: product.name }] },
  } });
  const accountingAuthority = { actorRole: actor.role, workspace: 'accounting', workspacePermission: 'edit' };
  await prisma.contractPublicConfirmation.create({ data: {
    contractId: contract.id, tokenHash: `dispatch-token-${suffix}`, phoneNumber: '09121111111',
    otpCodeHash: `dispatch-otp-${suffix}`, otpExpiresAt: new Date(Date.now() + 600_000),
    linkExpiresAt: new Date(Date.now() + 86_400_000), status: 'CONFIRMED', verifiedAt: new Date(), createdBy: actor.id,
  } });
  const item = await prisma.contractItem.create({ data: { contractId: contract.id, productId: product.id, productRowId: rowId,
    productType: 'count', quantity: 10, unitPrice: 1, totalPrice: 10 } });
  const approvedAt = new Date();
  await prisma.accountingFinancialRecord.create({ data: { kind: 'INVOICE_CANDIDATE', status: 'APPROVED_FOR_ISSUE',
    sourceKind: 'SALES_CONTRACT', sourceId: contract.id, contractId: contract.id, customerId: customer.id,
    financiallyApprovedAt: approvedAt, financiallyApprovedBy: actor.id, createdBy: actor.id } });
  const baseline = { id: `contracted-${item.id}`, contractId: contract.id, contractItemId: item.id, productRowId: rowId,
    unit: 'count', kind: 'CONTRACTED_SET' as const, quantity: '10.000', effectiveAt: approvedAt.toISOString(),
    recordedAt: approvedAt.toISOString(), sourceType: 'CONTRACT_QUANTITY_VERSION', sourceId: item.id,
    sourceVersion: 1, integrityHash: '', metadata: { financiallyApprovedAt: approvedAt.toISOString() } };
  baseline.integrityHash = shipmentQuantityEvidenceIntegrityHash(baseline);
  await prisma.shipmentQuantityEvidence.create({ data: { contractId: contract.id, contractItemId: item.id, productRowId: rowId,
    unit: 'count', kind: 'CONTRACTED_SET', quantity: 10, effectiveAt: approvedAt, recordedAt: approvedAt,
    sourceType: baseline.sourceType, sourceId: baseline.sourceId, sourceVersion: 1,
    integrityHash: baseline.integrityHash, metadata: baseline.metadata } });
  const loading = await prisma.logisticsLoading.create({ data: { loadingNumber: `LOAD-${suffix}`, customerId: customer.id,
    projectId: project.id, createdBy: actor.id, lines: { create: { sourceContractId: contract.id,
      sourceContractItemId: item.id, productRowId: rowId, productId: product.id, quantity: 7, unit: 'count' } } } });
  const turnOne = await createReadyTurn(actor.id, loading.id, 1);
  const turnTwo = await createReadyTurn(actor.id, loading.id, 2);
  await saveCanonicalAllocationDraft(prisma, { loadingId: loading.id, queueTurnId: turnOne,
    lines: [{ sourceContractItemId: item.id, quantity: '6.000', unit: 'count' }], actorId: actor.id });
  await saveCanonicalAllocationDraft(prisma, { loadingId: loading.id, queueTurnId: turnTwo,
    lines: [{ sourceContractItemId: item.id, quantity: '6.000', unit: 'count' }], actorId: actor.id });
  await assert.rejects(finalizeCanonicalLoadingAllocations(prisma, { loadingId: loading.id,
    idempotencyKey: `too-much-${suffix}`, actorId: actor.id }), /authoritative available balance/i);
  assert.equal(await prisma.accountingDispatchCandidate.count({ where: { allocationRevision: { loadingId: loading.id } } }), 0,
    'failed atomic finalization cannot leave candidates behind');
  await saveCanonicalAllocationDraft(prisma, { loadingId: loading.id, queueTurnId: turnOne,
    lines: [{ sourceContractItemId: item.id, quantity: '3.000', unit: 'count' }], actorId: actor.id });
  await saveCanonicalAllocationDraft(prisma, { loadingId: loading.id, queueTurnId: turnTwo,
    lines: [{ sourceContractItemId: item.id, quantity: '4.000', unit: 'count' }], actorId: actor.id });
  const [first, retry] = await Promise.all([
    finalizeCanonicalLoadingAllocations(prisma, { loadingId: loading.id, idempotencyKey: `finalize-${suffix}`, actorId: actor.id }),
    finalizeCanonicalLoadingAllocations(prisma, { loadingId: loading.id, idempotencyKey: `finalize-${suffix}`, actorId: actor.id }),
  ]);
  assert.equal(first.id, retry.id, 'concurrent idempotent finalization returns one batch');
  assert.equal(first.revisions.length, 2);
  assert.equal(await prisma.accountingDispatchCandidate.count({ where: { allocationRevision: { loadingId: loading.id } } }), 2);
  assert.equal(await prisma.accountingDispatchWorkItem.count({ where: { candidate: { allocationRevision: { loadingId: loading.id } } } }), 2);
  assert.equal((await prisma.shipmentQuantityProjection.findUniqueOrThrow({ where: { contractItemId: item.id } })).finalizedReserved.toFixed(3), '7.000');
  const candidates = await prisma.accountingDispatchCandidate.findMany({ where: { allocationRevision: { loadingId: loading.id } },
    include: { allocationRevision: { include: { lines: true } } } });
  candidates.sort((left, right) => Number(left.allocationRevision.lines[0].quantity) - Number(right.allocationRevision.lines[0].quantity));
  const accepted = await decideAccountingDispatchCandidate(prisma, { candidateId: candidates[0].id, action: 'ACCEPT',
    idempotencyKey: `accept-${suffix}`, actorId: actor.id });
  const acceptedRetry = await decideAccountingDispatchCandidate(prisma, { candidateId: candidates[0].id, action: 'ACCEPT',
    idempotencyKey: `accept-${suffix}`, actorId: actor.id });
  assert.deepEqual(acceptedRetry, accepted);
  assert.match(String((accepted as any).waybill.number), /^\d+$/);
  await decideAccountingDispatchCandidate(prisma, { candidateId: candidates[1].id, action: 'REJECT', reason: 'Allocation detail is incorrect',
    idempotencyKey: `reject-${suffix}`, actorId: actor.id });
  assert.equal((await prisma.shipmentQuantityProjection.findUniqueOrThrow({ where: { contractItemId: item.id } })).finalizedReserved.toFixed(3), '3.000',
    'rejected allocation evidence must leave the reserved bucket');
  assert.equal((await prisma.accountingDispatchCandidate.findUniqueOrThrow({ where: { id: candidates[0].id } })).status, 'ACCEPTED',
    'rejecting a sibling cannot disturb an accepted candidate');
  const successor = await createSuccessorAllocationRevision(prisma, { predecessorRevisionId: candidates[1].allocationRevisionId,
    lines: [{ sourceContractItemId: item.id, quantity: '2.000', unit: 'count' }],
    idempotencyKey: `successor-${suffix}`, actorId: actor.id });
  const successorRetry = await createSuccessorAllocationRevision(prisma, { predecessorRevisionId: candidates[1].allocationRevisionId,
    lines: [{ sourceContractItemId: item.id, quantity: '2.000', unit: 'count' }],
    idempotencyKey: `successor-${suffix}`, actorId: actor.id });
  assert.equal(successorRetry.id, successor.id);
  assert.equal((await prisma.shipmentQuantityProjection.findUniqueOrThrow({ where: { contractItemId: item.id } })).finalizedReserved.toFixed(3), '5.000');
  const successorRevision = await prisma.logisticsAllocationRevision.findUniqueOrThrow({ where: { predecessorRevisionId: candidates[1].allocationRevisionId },
    include: { candidate: true, lines: true } });
  await assert.rejects(decideAccountingDispatchCandidate(prisma, { candidateId: successorRevision.candidate!.id,
    action: 'TYPO' as any, reason: 'must not be accepted', idempotencyKey: `invalid-${suffix}`, actorId: actor.id }), /action must be/i);
  const successorAccepted = await decideAccountingDispatchCandidate(prisma, { candidateId: successorRevision.candidate!.id,
    action: 'ACCEPT', idempotencyKey: `successor-accept-${suffix}`, actorId: actor.id });
  const voidedSuccessor = await voidAccountingDispatchWaybill(prisma, { waybillId: (successorAccepted as any).waybill.id,
    reason: 'Successor document withdrawn', idempotencyKey: `void-${suffix}`, actorId: actor.id, effectiveAuthority: accountingAuthority });
  const voidedSuccessorRetry = await voidAccountingDispatchWaybill(prisma, { waybillId: (successorAccepted as any).waybill.id,
    reason: 'Successor document withdrawn', idempotencyKey: `void-${suffix}`, actorId: actor.id, effectiveAuthority: accountingAuthority });
  assert.deepEqual(voidedSuccessorRetry, voidedSuccessor);
  const original = await prisma.accountingDispatchWaybill.findUniqueOrThrow({ where: { id: (accepted as any).waybill.id } });
  await assert.rejects(prisma.accountingDispatchWaybill.update({ where: { id: original.id }, data: { number: original.number + 1n } }), /immutable/i);
  const replacement = await replaceAccountingDispatchWaybill(prisma, { waybillId: original.id, reason: 'Correct immutable document detail',
    idempotencyKey: `replace-${suffix}`, actorId: actor.id, effectiveAuthority: accountingAuthority });
  const replacementRetry = await replaceAccountingDispatchWaybill(prisma, { waybillId: original.id, reason: 'Correct immutable document detail',
    idempotencyKey: `replace-${suffix}`, actorId: actor.id, effectiveAuthority: accountingAuthority });
  assert.deepEqual(replacementRetry, replacement, 'replacement must be idempotent after the original is voided');
  assert.notEqual(replacement.replacement.number, original.number.toString());
  const preserved = await prisma.accountingDispatchWaybill.findUniqueOrThrow({ where: { id: original.id } });
  assert.equal(preserved.status, 'VOIDED');
  assert.equal(preserved.voidReason, 'Correct immutable document detail');
  assert.equal(await prisma.accountingDispatchWaybill.count({ where: { candidateId: candidates[0].id } }), 2,
    'replacement preserves both permanent numbers');
  const revisionLine = await prisma.logisticsAllocationRevisionLine.findFirstOrThrow({ where: { revision: { loadingId: loading.id } } });
  await assert.rejects(prisma.logisticsAllocationRevisionLine.update({ where: { id: revisionLine.id }, data: { quantity: 1 } }), /immutable/i);
  await assert.rejects(prisma.logisticsAllocationRevisionLine.create({ data: { revisionId: successorRevision.id,
    sourceContractId: contract.id, sourceContractItemId: item.id, productRowId: rowId, productId: product.id,
    quantity: 1, unit: 'count', snapshot: {}, integrityHash: `tamper-${suffix}` } }), /immutable/i);
  assert.ok(await prisma.dispatchLifecycleAudit.findFirst({ where: { aggregateType: 'ACCOUNTING_DISPATCH_CANDIDATE',
    aggregateId: candidates[0].id, eventType: 'CANDIDATE_CREATED' } }));
  assert.ok(await prisma.dispatchLifecycleAudit.findFirst({ where: { aggregateType: 'ACCOUNTING_DISPATCH_WAYBILL',
    aggregateId: original.id, eventType: 'WAYBILL_ISSUED' } }));
  const audits = await prisma.dispatchLifecycleAudit.findMany({ where: { aggregateType: 'ACCOUNTING_DISPATCH_CANDIDATE', aggregateId: candidates[0].id },
    orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }] });
  audits.forEach((event, index) => assert.equal(event.previousHash, index ? audits[index - 1].eventHash : null));
  const unauthorized = await prisma.user.create({ data: { email: `dispatch-denied-${suffix}@example.invalid`,
    username: `dispatch-denied-${suffix}`, password: 'not-used', firstName: 'Denied', lastName: 'Verifier', role: 'USER' } });
  const [actorSession, deniedSession] = await Promise.all([
    createAuthoritativeSession(prisma, actor.id, { userAgent: 'dispatch-verifier' }),
    createAuthoritativeSession(prisma, unauthorized.id, { userAgent: 'dispatch-verifier' }),
  ]);
  const request = (token: string, path: string, init: RequestInit = {}) => fetch(`http://127.0.0.1:5000${path}`, {
    ...init, headers: { 'content-type': 'application/json', cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}`, ...(init.headers || {}) },
  });
  assert.equal((await fetch('http://127.0.0.1:5000/api/accounting/dispatch-candidates')).status, 401);
  assert.equal((await request(deniedSession.token, '/api/accounting/dispatch-candidates')).status, 403);
  assert.equal((await request(deniedSession.token, `/api/accounting/dispatch-candidates/${successorRevision.candidate!.id}/decision`,
    { method: 'POST', body: JSON.stringify({ action: 'REJECT', reason: 'denied', idempotencyKey: 'denied' }) })).status, 403);
  const authorizedCandidates = await request(actorSession.token, '/api/accounting/dispatch-candidates');
  assert.equal(authorizedCandidates.status, 200, await authorizedCandidates.text());
  console.log('Dispatch allocation and waybill API/database verification passed.');
};

main().finally(() => prisma.$disconnect());
