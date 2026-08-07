import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PhysicalGateExitService } from '../src/services/physicalGateExit';
import { deliverPendingDispatchBuyerSms } from '../src/services/dispatchBuyerSmsWorker';
import { voidAccountingDispatchWaybill } from '../src/services/dispatchAllocation';
import { createAuthoritativeSession, SESSION_COOKIE } from '../src/services/identitySessionService';

const prisma = new PrismaClient();

const main = async () => {
  assert.ok(process.env.DATABASE_URL?.includes('127.0.0.1:55432'), 'Verification must target sabalanerp-local PostgreSQL.');
  const liveAuthorizations = await prisma.dispatchExitAuthorization.findMany({ where: { status: 'ACTIVE', validUntil: { gt: new Date() },
    waybill: { status: 'ISSUED', candidate: { allocationRevision: { queueTurn: { status: 'LOADING_FINALIZED' } } } } },
    include: { session: true, waybill: { include: { candidate: { include: { allocationRevision: { include: { lines: true, queueTurn: true } } } } } } },
    orderBy: { issuedAt: 'desc' }, take: 20 });
  const normal = liveAuthorizations.find((item) => Boolean((item.waybill.candidate.allocationRevision.snapshot as any)?.notification?.confirmationPhone));
  const competitor = liveAuthorizations.find((item) => item.id !== normal?.id);
  assert.ok(normal && competitor, 'Run verify:dispatch-allocations and verify:dispatch-confirmation first.');
  const active = [normal, competitor];
  const actor = await prisma.user.findUniqueOrThrow({ where: { id: active[0].session.accountingActorId } });
  const guardAuthority = { actorRole: actor.role, workspace: 'security', workspacePermission: 'edit' };
  const accountingAuthority = { actorRole: actor.role, workspace: 'accounting', workspacePermission: 'edit',
    feature: 'accounting_dispatch_candidates_manage', featurePermission: 'edit' };
  const denied = await prisma.user.create({ data: { email: `exit-denied-${randomUUID()}@example.invalid`, username: `exit-denied-${randomUUID()}`,
    password: 'not-used', firstName: 'Denied', lastName: 'Exit', role: 'USER' } });
  const [actorSession, deniedSession] = await Promise.all([createAuthoritativeSession(prisma, actor.id, { userAgent: 'physical-exit-verifier' }),
    createAuthoritativeSession(prisma, denied.id, { userAgent: 'physical-exit-verifier' })]);
  const request = (token: string, path: string, init: RequestInit = {}) => fetch(`http://127.0.0.1:5000${path}`, {
    ...init, headers: { 'content-type': 'application/json', cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}`, ...(init.headers || {}) },
  });
  assert.equal((await fetch('http://127.0.0.1:5000/api/security/exit-desk/authorizations')).status, 401);
  assert.equal((await request(deniedSession.token, '/api/security/exit-desk/authorizations')).status, 403);
  assert.equal((await request(actorSession.token, '/api/security/vehicle-movements/ready-exit')).status, 410);
  assert.equal((await request(actorSession.token, '/api/security/vehicle-movements/exit', { method: 'POST', body: JSON.stringify({ loadingId: 'legacy-bypass' }) })).status, 410);
  const authorizedResponse = await request(actorSession.token, '/api/security/exit-desk/authorizations');
  if (authorizedResponse.status !== 200) assert.fail(`Authorized Exit Desk returned ${authorizedResponse.status}: ${await authorizedResponse.text()}`);
  const authorizedBody = await authorizedResponse.json() as { data: Array<{ id: string }> };
  assert.ok(authorizedBody.data.some((item) => item.id === active[0].id));
  const printedOnly = await prisma.accountingDispatchWaybill.findFirst({ where: { status: 'ISSUED', exitAuthorizations: { none: { status: 'ACTIVE' } } } });
  if (printedOnly) assert.equal(authorizedBody.data.some((item) => item.id === printedOnly.id), false, 'an issued/printed waybill is not an exit authorization');

  const revision = active[0].waybill.candidate.allocationRevision;
  const projectionBefore = await prisma.shipmentQuantityProjection.findUniqueOrThrow({ where: { contractItemId: revision.lines[0].sourceContractItemId } });
  const quantity = revision.lines.reduce((total, line) => total + Number(line.quantity), 0);
  const exitResponse = await request(actorSession.token, `/api/security/exit-desk/authorizations/${active[0].id}/exit`, { method: 'POST', body: '{}' });
  if (exitResponse.status !== 201) assert.fail(`Physical exit API returned ${exitResponse.status}: ${await exitResponse.text()}`);
  const exitBody = await exitResponse.json() as { data: { id: string; smsIntent: { id: string; phoneNumber: string; dispatchNumber: string; vehiclePlate: string } } };
  const duplicateResponse = await request(actorSession.token, `/api/security/exit-desk/authorizations/${active[0].id}/exit`, { method: 'POST', body: '{}' });
  assert.equal(duplicateResponse.status, 201);
  const duplicate = (await duplicateResponse.json() as { data: { id: string } }).data;
  assert.equal(duplicate.id, exitBody.data.id, 'an HTTP retry returns the immutable prior exit');
  assert.equal(await prisma.guardPhysicalExit.count({ where: { authorizationId: active[0].id } }), 1);
  assert.equal(await prisma.dispatchBuyerSmsIntent.count({ where: { physicalExitId: duplicate.id } }), 1);
  assert.equal(exitBody.data.smsIntent.phoneNumber, '09121111111');
  assert.deepEqual(Object.keys((await prisma.dispatchBuyerSmsIntent.findUniqueOrThrow({ where: { id: exitBody.data.smsIntent.id } })).payload as object).sort(), ['dispatchNumber', 'vehiclePlate']);
  const projectionAfter = await prisma.shipmentQuantityProjection.findUniqueOrThrow({ where: { contractItemId: revision.lines[0].sourceContractItemId } });
  assert.equal(Number(projectionAfter.finalizedReserved), Number(projectionBefore.finalizedReserved) - quantity);
  assert.equal(Number(projectionAfter.physicallyDispatched), Number(projectionBefore.physicallyDispatched) + quantity);
  assert.equal((await prisma.guardDriverQueueTurn.findUniqueOrThrow({ where: { id: revision.queueTurnId } })).status, 'EXIT_RECORDED');
  assert.equal((await prisma.dispatchExitAuthorization.findUniqueOrThrow({ where: { id: active[0].id } })).status, 'CONSUMED');
  assert.equal((await prisma.accountingDispatchWaybill.findUniqueOrThrow({ where: { id: active[0].waybillId } })).status, 'EXIT_RECORDED');
  await assert.rejects(prisma.guardPhysicalExit.update({ where: { id: duplicate.id }, data: { occurredAt: new Date() } }), /immutable/i);

  let smsAttempt = 0;
  const smsService = new PhysicalGateExitService(prisma, { sendBuyerSms: async () => {
    smsAttempt += 1;
    return smsAttempt === 1 ? { outcome: 'FAILED', retryable: true, detail: 'temporary provider failure' }
      : { outcome: 'UNKNOWN', detail: 'provider timed out after accepting the request' };
  } });
  const retryable = await smsService.deliverBuyerSms(exitBody.data.smsIntent.id);
  assert.equal(retryable.status, 'RETRY');
  await prisma.dispatchBuyerSmsIntent.update({ where: { id: retryable.id }, data: { availableAt: new Date(0) } });
  const unknown = await smsService.deliverBuyerSms(retryable.id);
  assert.equal(unknown.status, 'UNKNOWN');
  assert.equal((await prisma.guardPhysicalExit.findUniqueOrThrow({ where: { id: duplicate.id } })).id, duplicate.id,
    'SMS retry and unknown outcome cannot reverse physical exit');
  await prisma.dispatchBuyerSmsIntent.update({ where: { id: unknown.id }, data: { status: 'SENDING', lastAttemptAt: new Date(0), unknownAt: null } });
  const recovered = await deliverPendingDispatchBuyerSms(prisma, new Date());
  assert.equal(recovered.recoveredUnknown, 1);
  assert.equal((await prisma.dispatchBuyerSmsIntent.findUniqueOrThrow({ where: { id: unknown.id } })).status, 'UNKNOWN');
  await prisma.dispatchBuyerSmsIntent.update({ where: { id: unknown.id }, data: { status: 'PENDING', availableAt: new Date(0) } });
  const permanentFailureService = new PhysicalGateExitService(prisma, { sendBuyerSms: async () => ({
    outcome: 'FAILED', retryable: false, detail: 'invalid destination number',
  }) });
  const needsAttention = await permanentFailureService.deliverBuyerSms(unknown.id);
  assert.equal(needsAttention.status, 'NEEDS_ATTENTION');
  assert.ok(await prisma.dispatchConfirmationAlert.count({ where: { sessionId: active[0].sessionId,
    alertType: 'BUYER_EXIT_SMS_NEEDS_ATTENTION' } }), 'permanent SMS failures raise a visible alert');

  const revoked = await prisma.dispatchExitAuthorization.findFirstOrThrow({ where: { status: 'REVOKED' } });
  assert.equal((await request(actorSession.token, `/api/security/exit-desk/authorizations/${revoked.id}/exit`, { method: 'POST', body: '{}' })).status, 409);
  const expiredSession = await prisma.dispatchConfirmationSession.create({ data: { waybillId: active[0].waybillId, method: active[0].method,
    status: 'CONFIRMED', driverSource: active[0].driverSource, driverId: active[0].driverId, accountingActorId: actor.id,
    waybillIntegrityHash: active[0].waybillIntegrityHash, workstationId: 'EXPIRED-VERIFY', expiresAt: new Date(0), confirmedAt: new Date(0) } });
  const expired = await prisma.dispatchExitAuthorization.create({ data: { waybillId: active[0].waybillId, sessionId: expiredSession.id,
    status: 'ACTIVE', method: active[0].method, driverSource: active[0].driverSource, driverId: active[0].driverId,
    waybillIntegrityHash: active[0].waybillIntegrityHash, evidenceSnapshot: {}, integrityHash: randomUUID(), issuedAt: new Date(0), validUntil: new Date(1) } });
  assert.equal((await request(actorSession.token, `/api/security/exit-desk/authorizations/${expired.id}/exit`, { method: 'POST', body: '{}' })).status, 409);
  assert.equal((await prisma.dispatchExitAuthorization.findUniqueOrThrow({ where: { id: expired.id } })).status, 'EXPIRED',
    'expiration is committed even though the exit command is rejected');

  const revoke = () => prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `DISPATCH_EXIT_AUTHORIZATION:${active[1].id}`);
    const changed = await tx.dispatchExitAuthorization.updateMany({ where: { id: active[1].id, status: 'ACTIVE' }, data: { status: 'REVOKED',
      revokedAt: new Date(), revokedBy: actor.id, revocationReason: 'Competing verification command' } });
    if (changed.count !== 1) throw new Error('Authorization already finalized');
  });
  const competing = await Promise.allSettled([
    (async () => { const response = await request(actorSession.token, `/api/security/exit-desk/authorizations/${active[1].id}/exit`, { method: 'POST', body: '{}' });
      if (response.status !== 201) throw new Error(`Competing HTTP exit lost with ${response.status}`); return response.json(); })(),
    revoke(),
    voidAccountingDispatchWaybill(prisma, { waybillId: active[1].waybillId, reason: 'Competing verification command',
      idempotencyKey: `void-race-${randomUUID()}`, actorId: actor.id, effectiveAuthority: accountingAuthority }),
  ]);
  const competingExit = await prisma.guardPhysicalExit.findUnique({ where: { authorizationId: active[1].id } });
  const competingAuthorization = await prisma.dispatchExitAuthorization.findUniqueOrThrow({ where: { id: active[1].id } });
  const competingWaybill = await prisma.accountingDispatchWaybill.findUniqueOrThrow({ where: { id: active[1].waybillId } });
  if (competingExit) {
    assert.equal(competingAuthorization.status, 'CONSUMED');
    assert.equal(competingWaybill.status, 'EXIT_RECORDED');
    assert.equal(competing.filter((item) => item.status === 'fulfilled').length, 1);
  } else {
    assert.equal(competingAuthorization.status, 'REVOKED');
    assert.notEqual(competingWaybill.status, 'EXIT_RECORDED');
  }
  assert.ok(competing.some((item) => item.status === 'rejected'), 'competing commands cannot all commit incompatible outcomes');
  console.log('Physical gate exit, projection movement, SMS outbox and competing-command verification passed.');
};

main().finally(() => prisma.$disconnect());
