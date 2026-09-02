import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { DispatchConfirmationService } from '../src/services/dispatchConfirmation';
import { DeterministicBiometricSimulator } from '../src/services/biometricSimulator';
import { ProtectedTemplateVault } from '../src/services/biometricTemplateVault';
import { createAuthoritativeSession, SESSION_COOKIE } from '../src/services/identitySessionService';
import { BiometricWorkstationGateway } from '../src/services/biometricWorkstationGateway';
import { signBiometricConnectorResponse } from '../src/services/biometricWorkstationProtocol';
import { reconcileBiometricConnectorChallenges } from '../src/services/biometricConnectorReconciliation';
import { verifyProductionDispatchAuditChains } from '../src/services/dispatchDocumentAuditRecovery/operations';

const prisma = new PrismaClient();
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const main = async () => {
  assert.ok(process.env.DATABASE_URL?.includes('127.0.0.1:55432'), 'Verification must target sabalanerp-local PostgreSQL.');
  const deliveries: Array<{ phone: string; code: string; dispatchNumber: string; sessionId: string }> = [];
  let now = new Date();
  const service = new DispatchConfirmationService(prisma, { connector: new DeterministicBiometricSimulator(),
    vault: new ProtectedTemplateVault({ activeKeyId: 'verify-v1', keys: { 'verify-v1': randomBytes(32) } }),
    otpSecret: `dispatch-confirmation-verifier-${suffix}`, now: () => now,
    sendOtp: async (message) => { deliveries.push(message); } });

  const actor = await prisma.user.create({ data: { email: `confirmation-${suffix}@example.invalid`, username: `confirmation-${suffix}`,
    password: 'not-used', firstName: 'Confirmation', lastName: 'Verifier', role: 'ADMIN' } });
  const personnel = await prisma.personnel.create({ data: { firstName: 'Internal', lastName: 'Driver', nationalCode: `I${suffix}` } });
  const driver = await prisma.internalDriverProfile.create({ data: { personnelId: personnel.id, status: 'ACTIVE', createdBy: actor.id } });
  await prisma.internalDriverEligibilityPeriod.create({ data: { driverId: driver.id, status: 'ELIGIBLE', effectiveFrom: now,
    reason: 'Dispatch confirmation verification', recordedBy: actor.id } });
  if (!await prisma.biometricGovernancePolicy.findFirst({ where: { activeFrom: { lte: now }, retiredAt: null } })) {
    await assert.rejects(service.assertEnrollmentCaptureAllowed(personnel.id), /disabled until legal basis/i);
    await assert.rejects(service.enrollInternalDriver({ personnelId: personnel.id, acknowledgement: 'accepted', confirmationPhone: '09121111111',
      templates: [{ finger: 'LEFT_INDEX', format: 'ISO-19794-2', material: Buffer.from('one'), deviceEvidence: {}, provenance: 'APPROVED_CONNECTOR' },
        { finger: 'RIGHT_INDEX', format: 'ISO-19794-2', material: Buffer.from('two'), deviceEvidence: {}, provenance: 'APPROVED_CONNECTOR' }], actorId: actor.id }), /disabled until legal basis/i);
  }
  await service.recordGovernancePolicy({ policyVersion: `policy-${suffix}`, legalBasis: 'Explicit employee acknowledgement for gate identity confirmation',
    consentWordingVersion: 'dispatch-consent-v1', templateRetentionDays: 365, confirmationEvidenceRetentionDays: 365,
    securityLogRetentionDays: 730, exportRetentionDays: 365, backupRetentionDays: 90, deletionCertificateRetentionDays: 2555,
    accessControlPolicy: 'Narrow HR and Security permissions', legalHoldPolicy: 'Suspend deletion under documented hold',
    incidentResponsePolicy: 'Notify Security and privacy counsel', disclosurePolicy: 'No ordinary export or disclosure',
    counselApprovedAt: now, counselApprovedBy: `counsel-${suffix}`, actorId: actor.id });
  await assert.rejects(service.enrollInternalDriver({ personnelId: personnel.id, acknowledgement: 'accepted', confirmationPhone: '09121111111',
    templates: [{ finger: 'LEFT_INDEX', format: 'ISO-19794-2', material: Buffer.from('one'), deviceEvidence: {}, provenance: 'APPROVED_CONNECTOR' }], actorId: actor.id }), /two distinct fingers/i);
  await assert.rejects(service.enrollInternalDriver({ personnelId: personnel.id, acknowledgement: 'accepted', confirmationPhone: '09121111111',
    templates: [{ finger: 'LEFT_INDEX', format: 'ISO-19794-2', material: Buffer.from('one'), deviceEvidence: { rawImage: 'forbidden' }, provenance: 'APPROVED_CONNECTOR' },
      { finger: 'RIGHT_INDEX', format: 'ISO-19794-2', material: Buffer.from('two'), deviceEvidence: {}, provenance: 'APPROVED_CONNECTOR' }], actorId: actor.id }), /Raw biometric material/i);
  const enrollment = await service.enrollInternalDriver({ personnelId: personnel.id, acknowledgement: 'Policy accepted for dispatch confirmation',
    confirmationPhone: '09121111111', templates: [
      { finger: 'LEFT_INDEX', format: 'ISO-19794-2', material: Buffer.from('protected-feature-vector-one'), deviceEvidence: { deviceSerial: 'SIM-0001', quality: 90 }, provenance: 'APPROVED_CONNECTOR' },
      { finger: 'RIGHT_INDEX', format: 'ISO-19794-2', material: Buffer.from('protected-feature-vector-two'), deviceEvidence: { deviceSerial: 'SIM-0001', quality: 92 }, provenance: 'APPROVED_CONNECTOR' },
    ], actorId: actor.id });
  assert.equal(enrollment.templates.length, 2);
  assert.equal('protectedEnvelope' in enrollment.templates[0], false, 'ordinary enrollment result must not expose protected envelopes');
  const storedTemplate = await prisma.driverBiometricTemplate.findFirstOrThrow({ where: { enrollmentId: enrollment.id } });
  assert.notEqual(JSON.stringify(storedTemplate.protectedEnvelope), 'protected-feature-vector-one');

  const externalWaybill = await prisma.accountingDispatchWaybill.findFirst({ where: { status: 'ISSUED', candidate: { allocationRevision: { queueTurn: { driverSource: 'EXTERNAL' } } } },
    orderBy: { issuedAt: 'desc' }, include: { candidate: { include: { allocationRevision: { include: { lines: true, queueTurn: true } } } } } });
  assert.ok(externalWaybill, 'Run verify:dispatch-allocations first to create a canonical issued waybill fixture.');

  const internalVehicle = await prisma.companyVehicle.create({ data: { fleetCode: `CONF-${randomUUID()}`, vehicleType: 'TRUCK', status: 'ACTIVE', createdBy: actor.id } });
  const internalAssignment = await prisma.driverVehicleAssignment.create({ data: { driverId: driver.id, vehicleId: internalVehicle.id, effectiveFrom: now,
    reason: 'Dispatch confirmation verification', recordedBy: actor.id } });
  let internalTurnId: string | null = null;

  const cloneWaybill = async (queueTurnId: string, driverSnapshot: Record<string, string>) => {
    const base = externalWaybill!;
    const maximum = await prisma.logisticsAllocationRevision.aggregate({ where: { loadingId: base.candidate.allocationRevision.loadingId }, _max: { revisionNumber: true } });
    const revision = await prisma.logisticsAllocationRevision.create({ data: { batchId: base.candidate.allocationRevision.batchId,
      loadingId: base.candidate.allocationRevision.loadingId, queueTurnId, revisionNumber: (maximum._max.revisionNumber || 0) + 1,
      snapshot: driverSnapshot, integrityHash: randomUUID(), finalizedBy: actor.id } });
    for (const line of base.candidate.allocationRevision.lines) await prisma.logisticsAllocationRevisionLine.create({ data: { revisionId: revision.id,
      sourceContractId: line.sourceContractId, sourceContractItemId: line.sourceContractItemId, productRowId: line.productRowId,
      productId: line.productId, quantity: line.quantity, unit: line.unit, snapshot: line.snapshot, integrityHash: randomUUID() } });
    await prisma.logisticsAllocationRevision.update({ where: { id: revision.id }, data: { sealedAt: now } });
    const candidate = await prisma.accountingDispatchCandidate.create({ data: { allocationRevisionId: revision.id, status: 'ACCEPTED', dispositionAt: now,
      dispositionBy: actor.id, workItem: { create: { status: 'COMPLETED', completedAt: now } } } });
    return prisma.accountingDispatchWaybill.create({ data: { candidateId: candidate.id, snapshot: { revisionId: revision.id, ...driverSnapshot },
      integrityHash: randomUUID(), issuedBy: actor.id } });
  };
  const cloneInternalWaybill = async () => {
    const base = externalWaybill!;
    if (!internalTurnId) internalTurnId = (await prisma.guardDriverQueueTurn.create({ data: { driverSource: 'INTERNAL', status: 'LOADING_FINALIZED', internalDriverId: driver.id,
      companyVehicleId: internalVehicle.id, assignmentId: internalAssignment.id, admittedBy: actor.id, admissionSnapshot: { driverId: driver.id, source: 'INTERNAL' }, integrityHash: randomUUID(),
      loadingId: base.candidate.allocationRevision.loadingId, finalizedAt: now, finalizedBy: actor.id } })).id;
    return cloneWaybill(internalTurnId, { driverId: driver.id, source: 'INTERNAL' });
  };

  const external = await service.startSession({ waybillId: externalWaybill!.id, actorId: actor.id, workstationId: 'ACCOUNTING-01' });
  await assert.rejects(service.startSession({ waybillId: externalWaybill!.id, actorId: actor.id, workstationId: 'ACCOUNTING-02' }), /unique|active/i);
  assert.equal(external.method, 'EXTERNAL_OTP_GUARD');
  assert.equal(deliveries.at(-1)?.code.length, 6);
  assert.equal(deliveries.at(-1)?.dispatchNumber, externalWaybill!.number.toString());
  await assert.rejects(service.resendOtp(external.id), /not available yet/i);
  await assert.rejects(service.verifyOtp({ sessionId: external.id, code: '999999' }), /incorrect/i);
  await service.verifyOtp({ sessionId: external.id, code: deliveries.at(-1)!.code, actorId: actor.id });
  const firstOtpId = (await prisma.dispatchOtpChallenge.findFirstOrThrow({ where: { sessionId: external.id }, orderBy: { createdAt: 'desc' } })).id;
  now = new Date(now.getTime() + 60_001);
  await service.resendOtp(external.id);
  assert.ok((await prisma.dispatchOtpChallenge.findUniqueOrThrow({ where: { id: firstOtpId } })).invalidatedAt, 'replacement invalidates a previously verified OTP');
  await assert.rejects(service.approveByGuard({ sessionId: external.id, guardActorId: `guard-${suffix}`, reauthenticatedAt: now }), /latest driver OTP/i);
  await service.verifyOtp({ sessionId: external.id, code: deliveries.at(-1)!.code, actorId: actor.id });
  const externalAuthorization = await service.approveByGuard({ sessionId: external.id, guardActorId: `guard-${suffix}`, reauthenticatedAt: now });
  assert.equal(externalAuthorization.validUntil.getTime() - externalAuthorization.issuedAt.getTime(), 12 * 3_600_000);
  const evidence = await service.readProtectedEvidence(external.id, actor.id);
  assert.equal('otpChallenges' in evidence, false, 'protected evidence view must exclude OTP digests');
  assert.equal(externalAuthorization.status, 'ACTIVE', 'authorization remains single-use evidence for the atomic Guard exit transaction in #221');
  const terminalWaybill = await cloneWaybill(externalWaybill!.candidate.allocationRevision.queueTurnId,
    { driverId: externalWaybill!.candidate.allocationRevision.queueTurn.externalDriverId!, source: 'EXTERNAL' });
  const terminal = await service.startSession({ waybillId: terminalWaybill.id, actorId: actor.id, workstationId: 'ACCOUNTING-01' });
  const wrongCode = deliveries.at(-1)!.code === '000000' ? '999999' : '000000';
  const guesses = await Promise.allSettled(Array.from({ length: 5 }, () => service.verifyOtp({ sessionId: terminal.id, code: wrongCode })));
  assert.equal(guesses.every((guess) => guess.status === 'rejected'), true);
  assert.equal((await prisma.dispatchConfirmationSession.findUniqueOrThrow({ where: { id: terminal.id } })).status, 'FAILED');
  assert.equal((await prisma.dispatchOtpChallenge.findFirstOrThrow({ where: { sessionId: terminal.id } })).incorrectCount, 5);

  const internalWaybill = await cloneInternalWaybill();
  const internal = await service.startSession({ waybillId: internalWaybill.id, actorId: actor.id, workstationId: 'ACCOUNTING-01' });
  const matched = await service.verifyInternalBiometric({ sessionId: internal.id, actorId: actor.id, scenario: 'SUCCESS' });
  assert.equal(matched.authorization.status, 'ACTIVE');
  const revoked = await service.revokeAuthorization({ authorizationId: matched.authorization.id, actorId: actor.id, reason: 'Waybill recheck required' });
  assert.equal(revoked.status, 'REVOKED');
  await assert.rejects(prisma.dispatchExitAuthorization.update({ where: { id: revoked.id }, data: { validUntil: new Date('2099-01-01') } }), /immutable/i);
  await assert.rejects(prisma.dispatchExitAuthorization.update({ where: { id: revoked.id }, data: { status: 'ACTIVE' } }), /status transition/i);

  const physicalWaybill = await cloneInternalWaybill();
  const physicalSession = await service.startSession({ waybillId: physicalWaybill.id, actorId: actor.id, workstationId: 'ACCOUNTING-01' });
  const commandSecret = randomBytes(32);
  const transportKey = randomBytes(32);
  const gateway = new BiometricWorkstationGateway(prisma, { 'ACCOUNTING-01': { commandSecretBase64: commandSecret.toString('base64'),
    activeTransportKeyId: 'verify-transport-v1', transportKeysBase64: { 'verify-transport-v1': transportKey.toString('base64') } } }, () => now);
  const prepared = await service.prepareInternalBiometric(physicalSession.id, actor.id);
  let issued;
  try { issued = await gateway.issueVerification({ workstationId: prepared.workstationId, actorId: actor.id, sessionId: prepared.sessionId,
    driverId: prepared.driverId, waybillIntegrityHash: prepared.waybillIntegrityHash, expectedTemplate: prepared.expectedTemplate }); }
  finally { prepared.expectedTemplate.fill(0); }
  const signedResult = signBiometricConnectorResponse({ commandId: issued.command.commandId, result: { availability: 'AVAILABLE',
    device: { model: 'BioMini SLIM 2', serial: 'VERIFY-SERIAL', connectorVersion: '1.0.0', sdkVersion: '3.11.1.595' },
    captureQuality: { state: 'ACCEPTED', score: 86 }, liveness: { state: 'LIVE', score: 999 }, match: { state: 'MATCH', score: 97 }, errorCategory: 'NONE', retryable: false }, completedAt: now.toISOString() }, commandSecret);
  const claimed = await gateway.claimVerification({ challengeId: issued.command.commandId, actorId: actor.id, signedResponse: signedResult });
  const physicalMatched = await service.recordInternalBiometricResult({ sessionId: physicalSession.id, actorId: actor.id, result: claimed.response.result });
  await gateway.complete([claimed.challenge.id], true);
  assert.equal(physicalMatched.authorization.status, 'ACTIVE');
  assert.equal((await prisma.biometricConnectorChallenge.findUniqueOrThrow({ where: { id: claimed.challenge.id } })).status, 'COMPLETED');
  await service.revokeAuthorization({ authorizationId: physicalMatched.authorization.id, actorId: actor.id, reason: 'End production handshake verification fixture' });

  const fallback = await service.startSession({ waybillId: internalWaybill.id, actorId: actor.id, workstationId: 'ACCOUNTING-01' });
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const result = await service.verifyInternalBiometric({ sessionId: fallback.id, actorId: actor.id, scenario: 'NON_MATCH' });
    assert.equal(result.fallbackEligible, attempt === 3);
  }
  await service.beginInternalFallback({ sessionId: fallback.id, actorId: actor.id });
  await service.verifyOtp({ sessionId: fallback.id, code: deliveries.at(-1)!.code, actorId: actor.id });
  await assert.rejects(service.approveByGuard({ sessionId: fallback.id, guardActorId: actor.id, reauthenticatedAt: now, reason: 'Scanner failed' }), /different actor from Accounting/i);
  const approvals = await Promise.allSettled([
    service.approveByGuard({ sessionId: fallback.id, guardActorId: `guard-supervisor-a-${suffix}`, reauthenticatedAt: now, reason: 'Three live good-quality nonmatches' }),
    service.approveByGuard({ sessionId: fallback.id, guardActorId: `guard-supervisor-b-${suffix}`, reauthenticatedAt: now, reason: 'Three live good-quality nonmatches' }),
  ]);
  assert.equal(approvals.filter((result) => result.status === 'fulfilled').length, 1);
  const fallbackAuthorization = (approvals.find((result) => result.status === 'fulfilled') as PromiseFulfilledResult<any>).value;
  assert.equal(fallbackAuthorization.method, 'INTERNAL_FALLBACK');
  assert.equal(await prisma.dispatchGuardApproval.count({ where: { sessionId: fallback.id } }), 1);
  assert.equal(await prisma.dispatchConfirmationAlert.count({ where: { sessionId: fallback.id } }), 1);
  assert.ok(await prisma.dispatchConfirmationAlert.findFirst({ where: { sessionId: fallback.id, alertType: 'INTERNAL_BIOMETRIC_FALLBACK' } }));
  const attempt = await prisma.dispatchBiometricAttempt.findFirstOrThrow({ where: { sessionId: fallback.id } });
  await assert.rejects(prisma.dispatchBiometricAttempt.update({ where: { id: attempt.id }, data: { result: { tampered: true } } }), /append-only/i);

  const expiringWaybill = await cloneInternalWaybill();
  const expiring = await service.startSession({ waybillId: expiringWaybill.id, actorId: actor.id, workstationId: 'ACCOUNTING-01' });
  now = new Date(now.getTime() + 10 * 60_000 + 1);
  await assert.rejects(service.verifyInternalBiometric({ sessionId: expiring.id, actorId: actor.id }), /expired/i);
  const consentWaybill = await cloneInternalWaybill();
  const consentSession = await service.startSession({ waybillId: consentWaybill.id, actorId: actor.id, workstationId: 'ACCOUNTING-01' });
  await service.verifyInternalBiometric({ sessionId: consentSession.id, actorId: actor.id, scenario: 'DISCONNECT' });
  await service.beginInternalFallback({ sessionId: consentSession.id, actorId: actor.id });
  await service.verifyOtp({ sessionId: consentSession.id, code: deliveries.at(-1)!.code, actorId: actor.id });
  const withdrawn = await service.withdrawEnrollment({ enrollmentId: enrollment.id, actorId: actor.id, reason: 'Driver withdrew biometric consent' });
  assert.equal(withdrawn.status, 'WITHDRAWN');
  await assert.rejects(service.approveByGuard({ sessionId: consentSession.id, guardActorId: `guard-consent-${suffix}`, reauthenticatedAt: now,
    reason: 'Scanner disconnected' }), /consent ended/i);
  await prisma.internalDriverProfile.update({ where: { id: driver.id }, data: { status: 'ARCHIVED' } });
  const ineligibleWaybill = await cloneInternalWaybill();
  await assert.rejects(service.startSession({ waybillId: ineligibleWaybill.id, actorId: actor.id, workstationId: 'ACCOUNTING-01' }), /not currently eligible/i);

  const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('driver_biometric_enrollments','driver_biometric_templates','dispatch_otp_challenges')`;
  assert.equal(columns.some((column) => /raw.*image|fingerprint.*image/i.test(column.column_name)), false);
  const denied = await prisma.user.create({ data: { email: `confirmation-denied-${suffix}@example.invalid`, username: `confirmation-denied-${suffix}`,
    password: 'not-used', firstName: 'Denied', lastName: 'Verifier', role: 'USER' } });
  const [actorSession, deniedSession] = await Promise.all([createAuthoritativeSession(prisma, actor.id, { userAgent: 'dispatch-confirmation-verifier' }),
    createAuthoritativeSession(prisma, denied.id, { userAgent: 'dispatch-confirmation-verifier' })]);
  const request = (token: string, path: string) => fetch(`http://127.0.0.1:5000${path}`, { headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` } });
  assert.equal((await fetch(`http://127.0.0.1:5000/api/dispatch-confirmation/sessions/${fallback.id}/evidence`)).status, 401);
  assert.equal((await request(deniedSession.token, `/api/dispatch-confirmation/sessions/${fallback.id}/evidence`)).status, 403);
  const protectedResponse = await request(actorSession.token, `/api/dispatch-confirmation/sessions/${fallback.id}/evidence`);
  if (protectedResponse.status !== 200) assert.fail(`Protected evidence API returned ${protectedResponse.status}: ${await protectedResponse.text()}`);
  const protectedBody = await protectedResponse.json() as { data: Record<string, unknown> };
  assert.equal('otpChallenges' in protectedBody.data, false);
  const staleChallengeId = randomUUID();
  await prisma.biometricConnectorChallenge.create({ data: { id: staleChallengeId, operation: 'HEALTH', workstationId: 'ACCOUNTING-01', actorId: actor.id,
    subjectId: 'ACCOUNTING-01', contextId: 'reconciliation-test', commandDigest: randomBytes(32).toString('hex'), nonceHash: randomBytes(32).toString('hex'), issuedAt: new Date(now.getTime() - 60_000), expiresAt: new Date(now.getTime() - 30_000) } });
  const reconciliation = await reconcileBiometricConnectorChallenges(prisma, { actorId: actor.id, now });
  assert.ok(reconciliation.staleCommandsFailed >= 1);
  assert.equal((await prisma.biometricConnectorChallenge.findUniqueOrThrow({ where: { id: staleChallengeId } })).status, 'FAILED');
  assert.ok(await prisma.dispatchEvidenceException.findFirst({ where: { aggregateType: 'BIOMETRIC_CONNECTOR_CHALLENGE', aggregateId: staleChallengeId, status: 'OPEN' } }));
  const reconciliationAudits = await prisma.dispatchLifecycleAudit.findMany({ where: { aggregateType: 'BIOMETRIC_CONNECTOR_CHALLENGE', aggregateId: staleChallengeId }, orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }] });
  assert.deepEqual(verifyProductionDispatchAuditChains(reconciliationAudits), []);
  console.log('Dispatch confirmation API/database verification passed.');
};

main().finally(() => prisma.$disconnect());
