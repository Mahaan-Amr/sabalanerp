import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { prisma } from '../../lib/prisma';
import logisticsRouter from '../../routes/logistics';
import guardRouter from '../../routes/canonical-guard-queue';
import accountingRouter from '../../routes/accounting';
import { createAuthoritativeSession, SESSION_COOKIE } from '../identitySessionService';
import { createPrismaDispatchReplayTruthVerifier, replayPersistedDispatchDocumentChain } from '../dispatchDocumentAuditRecovery/operations';
import { DispatchConfirmationService } from '../dispatchConfirmation';
import { DeterministicBiometricSimulator } from '../biometricSimulator';
import { ProtectedTemplateVault } from '../biometricTemplateVault';

async function main() {
  const url = new URL(process.env.DATABASE_URL || '');
  if (url.hostname !== '127.0.0.1' || url.port !== '55432'
      || !/^\/sabalanerp_concurrency_[a-f0-9]{16}$/.test(url.pathname)) throw new Error('Isolated local test DB required');
  const actorId = process.env.PARTNER_TEST_ACTOR_ID!;
  const accountantId = process.env.PARTNER_TEST_ACCOUNTANT_ID!;
  const expected = JSON.parse(process.env.PARTNER_TEST_OWNER!);
  try {
    const [logisticsSession, accountingSession] = await Promise.all([
      createAuthoritativeSession(prisma, actorId, { ipAddress: '127.0.0.1', userAgent: 'isolated-334-finalization' }),
      createAuthoritativeSession(prisma, accountantId, { ipAddress: '127.0.0.1', userAgent: 'isolated-334-documents' }),
    ]);
    const app = express(); app.use(express.json());
    app.use('/api/logistics', logisticsRouter); app.use('/api/security', guardRouter); app.use('/api/accounting', accountingRouter);
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const request = async (path: string, method = 'GET', body?: unknown, token = logisticsSession.token,
        key = `${expected.caseId}-finalization`) => {
        const response = await fetch(`${base}${path.startsWith('/api/') ? path : `/api/logistics${path}`}`, {
          method, headers: { 'content-type': 'application/json', cookie: `${SESSION_COOKIE}=${token}`,
            'Idempotency-Key': key, 'X-Correlation-Id': key }, ...(body ? { body: JSON.stringify(body) } : {}) });
        return { status: response.status, body: await response.json() as any };
      };
      const payload = { sourceKind: 'PARTNER_CASE', expected, deliveryId: 'second-delivery',
        reason: 'ثبت بارگیری نهایی پرونده همکار با قیمت مصوب' };
      const control = await prisma.partnerOperationsControl.findUniqueOrThrow({ where: { id: 'partner-operations' } });
      if (!control.cohortId) throw new Error('Partner rollout cohort fixture is missing');
      await prisma.$transaction(async tx => {
        await tx.partnerOperationsControl.update({ where: { id: 'partner-operations' }, data: { operationalPaused: true } });
        await tx.partnerReleaseCohort.update({ where: { id: control.cohortId! }, data: {
          activationEnabled: false, operationalPaused: true,
        } });
      });
      const created = await request('/loadings', 'POST', payload, logisticsSession.token, `${expected.caseId}-final-loading`);
      assert.equal(created.status, 201, JSON.stringify(created.body));
      const loadingId = created.body.data.loadingId;
      const source = (await request(`/loadings/${loadingId}`)).body.data.source;
      const driver = await prisma.externalDriver.create({ data: { firstName: 'Final', lastName: 'Dispatch',
        nationalCode: '3340000001', phone: '09120003341', status: 'ACTIVE', statusRecordedBy: actorId, createdBy: actorId,
        documents: { create: { documentType: 'DRIVING_LICENCE', reference: 'isolated-334-final-driver', recordedBy: actorId } } } });
      const vehicle = await prisma.externalVehicle.create({ data: { vehicleType: 'Final Partner dispatch', status: 'ACTIVE',
        statusRecordedBy: actorId, createdBy: actorId,
        plates: { create: { plate: '334-final', normalizedPlate: '334final', effectiveFrom: new Date(),
          reason: 'isolated finalization fixture', recordedBy: actorId } },
        documents: { create: { documentType: 'VEHICLE_REGISTRATION', reference: 'isolated-334-final-vehicle', recordedBy: actorId } } } });
      const admission = await request('/api/security/canonical-driver-queue', 'POST',
        { source: 'EXTERNAL', driverId: driver.id, vehicleId: vehicle.id }, logisticsSession.token, `${expected.caseId}-final-turn`);
      assert.equal(admission.status, 201, JSON.stringify(admission.body));
      const turnId = admission.body.data.id;
      assert.equal((await request(`/api/security/canonical-driver-queue/${turnId}/available`, 'POST', {},
        logisticsSession.token, `${expected.caseId}-final-available`)).status, 200);
      assert.equal((await request(`/canonical-driver-queue/${turnId}/reserve`, 'POST', { loadingId, expected,
        reason: 'رزرو راننده برای صدور بارنامه مشتری' }, logisticsSession.token, `${expected.caseId}-final-reserve`)).status, 200);
      const allocated = await request(`/loadings/${loadingId}/canonical-allocations/${turnId}`, 'PUT', { expected,
        reason: 'ثبت مقدار قطعی بارنامه مشتری', lines: [{ sourceKind: 'PARTNER_CASE',
          productRowId: source.rows[0].productRowId, quantity: '0.250', unit: source.rows[0].unit }] },
      logisticsSession.token, `${expected.caseId}-final-allocation`);
      assert.equal(allocated.status, 200, JSON.stringify(allocated.body));
      const finalized = await request(`/loadings/${loadingId}/finalize`, 'POST', { expected,
        reason: 'نهایی‌سازی بارگیری با شواهد مالی رسمی' }, logisticsSession.token, `${expected.caseId}-finalize`);
      assert.equal(finalized.status, 200, JSON.stringify(finalized.body));
      assert.equal((await prisma.partnerOperationsControl.findUniqueOrThrow({ where: { id: 'partner-operations' } })).operationalPaused,
        true, 'committed loading create, reserve, allocate, and finalize must survive the emergency pause');
      const revisionId = finalized.body.data.revisions[0].id;
      const candidateId = finalized.body.data.revisions[0].candidate.id;
      const revision = await prisma.logisticsAllocationRevision.findUniqueOrThrow({ where: { id: revisionId }, include: {
        lines: true, pricingReferences: true, partnerPricing: { include: { events: true } } } });
      assert.equal(revision.sourceKind, 'PARTNER_CASE');
      assert.equal(revision.lines.every(line => line.sourceContractId === null && line.sourceContractItemId === null), true);
      assert.equal(revision.pricingReferences.length, 0, 'Partner pricing must not manufacture ordinary pricing references');
      assert.equal(revision.partnerPricing?.events.length, 1);
      const issued = await request(`/api/accounting/dispatch-candidates/${candidateId}/decision`, 'POST', { action: 'ACCEPT' },
        accountingSession.token, `${expected.caseId}-issue-documents`);
      assert.equal(issued.status, 200, JSON.stringify(issued.body));
      const waybillId = issued.body.data.waybill.id;
      const artifacts = await prisma.dispatchDocumentArtifact.findMany({ where: { waybillId }, orderBy: { kind: 'asc' } });
      assert.deepEqual(new Set(artifacts.map(row => row.kind)), new Set(['WAYBILL', 'STATEMENT']));
      const readerId = `${expected.caseId}-waybill-reader`;
      await prisma.user.create({ data: { id: readerId, username: readerId, email: `${readerId}@example.invalid`,
        password: 'not-a-login', firstName: 'Waybill', lastName: 'Reader' } });
      await prisma.workspacePermission.create({ data: { userId: readerId, workspace: 'accounting', permissionLevel: 'view', grantedBy: accountantId } });
      await prisma.featurePermission.create({ data: { userId: readerId, workspace: 'accounting',
        feature: 'accounting_dispatch_candidates_view', permissionLevel: 'view', grantedBy: accountantId } });
      const readerSession = await createAuthoritativeSession(prisma, readerId,
        { ipAddress: '127.0.0.1', userAgent: 'isolated-334-waybill-only' });
      const fetchArtifact = (artifactId: string, token: string) => fetch(`${base}/api/accounting/dispatch-waybills/${waybillId}/artifacts/${artifactId}`,
        { headers: { cookie: `${SESSION_COOKIE}=${token}`, 'X-Correlation-Id': `${expected.caseId}-artifact` } });
      const waybill = artifacts.find(row => row.kind === 'WAYBILL')!;
      const statement = artifacts.find(row => row.kind === 'STATEMENT')!;
      assert.equal((await fetchArtifact(waybill.id, readerSession.token)).status, 200,
        'waybill-only Accounting readers can hand the price-free document to the customer');
      assert.equal((await fetchArtifact(statement.id, readerSession.token)).status, 404,
        'ordinary Accounting page authority cannot expose Partner wholesale pricing');
      assert.equal((await fetchArtifact(statement.id, accountingSession.token)).status, 200,
        'the assigned internal Accounting actor can read the wholesale statement');
      const combinedDenied = await request(`/api/accounting/dispatch-candidates/${candidateId}/document-read-model?waybillId=${waybillId}`,
        'GET', undefined, readerSession.token);
      assert.equal(combinedDenied.status, 404, 'the combined model is wholesale-sensitive');
      let otp = '';
      const confirmation = new DispatchConfirmationService(prisma, {
        connector: new DeterministicBiometricSimulator(),
        vault: new ProtectedTemplateVault({ activeKeyId: 'test', keys: { test: Buffer.alloc(32, 7) } }),
        otpSecret: 'issue-334-isolated-dispatch-confirmation-secret',
        sendOtp: async message => { otp = message.code; },
      });
      const confirmationSession = await confirmation.startSession({ waybillId, actorId: accountantId,
        workstationId: 'ISSUE-334-ACCOUNTING-DESK' });
      assert.ok(otp, 'the external-driver confirmation must issue an OTP');
      await confirmation.verifyOtp({ sessionId: confirmationSession.id, code: otp, actorId: accountantId });
      const authorization = await confirmation.approveByGuard({ sessionId: confirmationSession.id,
        guardActorId: actorId, reauthenticatedAt: new Date() });
      await prisma.effectiveActionGrant.updateMany({ where: { principalId: accountantId, domain: 'PARTNER',
        action: 'ACCOUNTING_WRITE', revokedAt: null }, data: { revokedAt: new Date(), revokedBy: accountantId,
        revocationReason: 'آزمون لغو دسترسی نوشتن اسناد', revocationCorrelationId: `${expected.caseId}-revoke-document-write` } });
      const deniedReplay = await request(`/api/accounting/dispatch-candidates/${candidateId}/decision`, 'POST', { action: 'ACCEPT' },
        accountingSession.token, `${expected.caseId}-issue-documents`);
      assert.equal(deniedReplay.status, 409, 'idempotent Partner document commands must recheck current Case write authority');
      const exited = await request(`/api/security/exit-desk/authorizations/${authorization.id}/exit`, 'POST', {
        reasonDetail: 'خروج فیزیکی آزمایشی پرونده همکار',
      }, logisticsSession.token, `${expected.caseId}-physical-exit`);
      assert.equal(exited.status, 201, JSON.stringify(exited.body));
      const physicalEvidence = await prisma.shipmentQuantityEvidence.findMany({ where: {
        kind: 'PHYSICAL_EXIT', metadata: { path: ['physicalExitId'], equals: exited.body.data.id },
      } });
      assert.equal(physicalEvidence.length, 1);
      assert.equal(physicalEvidence.every(row => row.contractId === null && row.contractItemId === null), true,
        'Partner physical evidence must retain Case lineage without fake ordinary contract identity');
      const replay = await replayPersistedDispatchDocumentChain(prisma, waybillId, createPrismaDispatchReplayTruthVerifier(prisma));
      assert.equal(replay.status, 'VERIFIED', JSON.stringify(replay.issues));
      await prisma.effectiveActionGrant.updateMany({ where: { principalId: accountantId, domain: 'PARTNER',
        action: 'ACCOUNTING_READ', revokedAt: null }, data: { revokedAt: new Date(), revokedBy: accountantId,
        revocationReason: 'آزمون لغو دسترسی سند عمده', revocationCorrelationId: `${expected.caseId}-revoke-statement` } });
      assert.equal((await fetchArtifact(statement.id, accountingSession.token)).status, 404,
        'every statement access rechecks current Case authority');
      assert.equal((await fetchArtifact(waybill.id, accountingSession.token)).status, 200,
        'revoking wholesale authority does not turn the price-free waybill into a wholesale document');
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  } finally { await prisma.$disconnect(); }
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
