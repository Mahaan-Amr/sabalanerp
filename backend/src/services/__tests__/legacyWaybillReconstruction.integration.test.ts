import { latestLoadingCancellationRequest, requestLoadingCancellation } from '../crossWorkspaceDutyAdapters/loadingCancellationDutyAdapter';
import { getCrossWorkspaceDutyDetail, listCrossWorkspaceDuties } from '../crossWorkspaceDutyInbox';
import { respondToCrossWorkspaceDuty } from '../crossWorkspaceDutyModule';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { createTemporaryConcurrencyDatabase } from './shipmentStatementConcurrency/database';
import { createConcurrentPricingFixture } from './shipmentStatementConcurrency/pricingFixture';
import { createAuthorizedActorFixture } from './shipmentStatementConcurrency/authorityFixture';
import { cancelFinalizedOrdinaryLoading, decideAccountingDispatchCandidate, finalizeCanonicalLoadingAllocations, LoadingCancellationAccountingAccessError } from '../dispatchAllocation';
import { readLegacyWaybillReconstruction, reconstructLegacyWaybill } from '../legacyWaybillReconstruction';
import { createSalesInvoiceService } from '../salesDispatchInvoice/service';
import { classifyLoadingDocumentPart, issueLoadingDocuments } from '../loadingDocumentIssuance';
import { DispatchConfirmationService } from '../dispatchConfirmation';
import { ProtectedTemplateVault } from '../biometricTemplateVault';
import { DeterministicBiometricSimulator } from '../biometricSimulator';
import { PhysicalGateExitService } from '../physicalGateExit';
import { closeGuardQueueTurnWithoutLoading, listGuardQueueAdmissionOptions, releaseGuardQueueReservation, reserveGuardQueueTurn, voidGuardQueueTurn } from '../guardDriverQueue';
import { getDispatchCaseTimeline, listDispatchCases } from '../dispatchCaseTimeline';
import { readShipmentQuantityProjection } from '../shipmentQuantityProjectionStore';

async function run() {
  const sourceDatabaseUrl = process.env.DATABASE_URL;
  if (!sourceDatabaseUrl) throw new Error('DATABASE_URL must point at sabalanerp-local.');
  const root = path.resolve(process.cwd(), '..');
  const database = await createTemporaryConcurrencyDatabase({ repositoryRoot: root, sourceDatabaseUrl });
  const db = database.client();
  try {
    execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], {
      cwd: process.cwd(), env: { ...process.env, DATABASE_URL: database.databaseUrl }, stdio: 'pipe', timeout: 120000,
    });
    process.env.CUSTOMER_SHIPMENT_STATEMENTS_ENABLED = 'false';
    const fixture = await createConcurrentPricingFixture(db, database.runId, database.databaseUrl, { activateCutover: false });
    await finalizeCanonicalLoadingAllocations(db, { loadingId: fixture.loadings[0].id, actorId: fixture.actorId,
      effectiveAuthority: fixture.effectiveAuthority, idempotencyKey: `legacy-${database.runId}` });
    const revision = await db.logisticsAllocationRevision.findFirstOrThrow({ where: { loadingId: fixture.loadings[0].id }, include: { candidate: true } });
    assert.ok(revision.candidate);
    const { actor, authority } = await createAuthorizedActorFixture(db, { runId: database.runId, workspace: 'accounting',
      feature: 'accounting_dispatch_candidates_manage', workspacePermission: 'admin' });
    const accepted = await decideAccountingDispatchCandidate(db, { candidateId: revision.candidate.id, action: 'ACCEPT',
      actorId: actor.id, effectiveAuthority: authority, idempotencyKey: `legacy-accept-${database.runId}` });
    assert.ok(accepted && typeof accepted === 'object' && !Array.isArray(accepted) && 'status' in accepted && 'waybill' in accepted);
    assert.equal(accepted.status, 'ACCEPTED');
    const issuedWaybill = accepted.waybill;
    assert.ok(issuedWaybill && typeof issuedWaybill === 'object' && !Array.isArray(issuedWaybill) && 'id' in issuedWaybill);
    const waybillId = String(issuedWaybill.id);
    const render = async (input: Parameters<typeof import('../../documents/dispatch/dispatchDocumentPdf').renderDispatchDocumentPdf>[0]) => {
      assert.equal(input.reconstructionLabel, 'LEGACY_RECONSTRUCTED');
      const bytes = Buffer.from('%PDF-legacy-test');
      return { bytes, metadata: { documentId: input.documentId, kind: input.kind, mimeType: 'application/pdf' as const,
        size: bytes.length, sha256: 'ignored', templateVersion: input.templateVersion, generatorVersion: 'chromium-pdf-v1' as const } };
    };
    const command = { waybillId, actorId: actor.id, reason: 'فایل اولیه نگهداری نشده است' };
    const [first, concurrent] = await Promise.all([reconstructLegacyWaybill(db, command, render), reconstructLegacyWaybill(db, command, render)]);
    const replay = await reconstructLegacyWaybill(db, command, render);
    assert.equal(first.id, concurrent.id);
    assert.equal(first.id, replay.id);
    assert.equal(replay.reused, true);
    assert.equal(await db.legacyWaybillReconstruction.count({ where: { waybillId } }), 1);
    assert.equal(await db.dispatchDocumentArtifact.count({ where: { waybillId } }), 0);
    assert.equal(await db.dispatchLifecycleAudit.count({ where: { aggregateType: 'LEGACY_WAYBILL_RECONSTRUCTION', aggregateId: waybillId } }), 1);
    assert.equal((await readLegacyWaybillReconstruction(db, waybillId)).id, first.id);
    await assert.rejects(() => db.legacyWaybillReconstruction.update({ where: { waybillId }, data: { reason: 'changed' } }));
    const current = await db.logisticsAllocationRevision.findUniqueOrThrow({ where: { id: revision.id }, include: { candidate: {
      include: { waybills: { include: { documentArtifacts: true, legacyReconstruction: true } } },
    } } });
    const part = classifyLoadingDocumentPart(current, false, true);
    assert.equal(part.state, 'COMPLETE');
    const invoices = createSalesInvoiceService(db, async () => Buffer.from('%PDF-test-invoice'));
    const invoiceContext = { actorId: actor.id, workspace: 'accounting' as const, requireDispatchDocumentGate: true,
      expectedRevisionIds: [revision.id] };
    const group = { loadingId: fixture.loadings[0].id, invoicePredecessorId: null, parts: [part],
      issueWaybill: async () => { throw new Error('must not issue another waybill'); },
      issueInvoice: async (key: string) => { await invoices.issue(invoiceContext, fixture.loadings[0].id, key); } };
    await issueLoadingDocuments(group);
    await issueLoadingDocuments(group);
    assert.equal(await db.salesDispatchInvoice.count({ where: { loadingId: fixture.loadings[0].id } }), 1);
    assert.equal(await db.accountingDispatchWaybill.count({ where: { candidateId: revision.candidate.id } }), 1);
    const cancelInput = { loadingId: fixture.loadings[0].id, actorId: fixture.actorId, reason: 'لغو بارگیری آزمایشی پیش از خروج' };
    const originalTurn = await db.guardDriverQueueTurn.findUniqueOrThrow({ where: { id: revision.queueTurnId } });
    const driverId = originalTurn.externalDriverId!;
    assert.ok(driverId);
    assert.ok(!(await listGuardQueueAdmissionOptions(db)).externalDrivers.some(driver => driver.id === driverId));
    await assert.rejects(() => cancelFinalizedOrdinaryLoading(db, cancelInput), /ابطال آن‌ها را تأیید کنید/);
    const invoice = await db.salesDispatchInvoice.findFirstOrThrow({ where: { loadingId: fixture.loadings[0].id } });
    const expectedDocumentIds = [invoice.id, waybillId];
    await assert.rejects(() => cancelFinalizedOrdinaryLoading(db, { ...cancelInput, expectedDocumentIds }), LoadingCancellationAccountingAccessError);
    await assert.rejects(() => cancelFinalizedOrdinaryLoading(db, { ...cancelInput, actorId: actor.id, expectedDocumentIds: [waybillId] }), /اسناد بارگیری تغییر کرده‌اند/);
    const line = await db.logisticsAllocationRevisionLine.findFirstOrThrow({ where: { revisionId: revision.id } });
    const projection = () => readShipmentQuantityProjection(db, { contractId: line.sourceContractId! });
    const available = async () => (await projection()).rows.find(row => row.contractItemId === line.sourceContractItemId)?.quantities?.availableToLoad;
    assert.equal(Number(await available()), 1);

    const [firstRequest, duplicate] = await Promise.all([
      requestLoadingCancellation(db, cancelInput), requestLoadingCancellation(db, cancelInput),
    ]);
    assert.ok(firstRequest);
    assert.equal(firstRequest.id, duplicate?.id);
    assert.equal(firstRequest.status, 'PENDING');
    const accountingInbox = await listCrossWorkspaceDuties(db, { actorUserId: actor.id, workspaceCode: 'accounting', view: 'assigned' });
    assert.ok(accountingInbox.some(duty => duty.id === firstRequest.id));
    const detailInput = { dutyId: firstRequest.id, actorUserId: actor.id, workspaceCode: 'accounting' };
    const detail = await getCrossWorkspaceDutyDetail(db, detailInput);
    assert.deepEqual(detail.allowedActionCodes, ['APPROVE', 'DECLINE']);
    assert.ok(detail.fields.description?.includes(cancelInput.reason));
    assert.ok(detail.fields.description?.includes(`فاکتور فروش شمارهٔ ${invoice.number}`));
    await assert.rejects(() => getCrossWorkspaceDutyDetail(db, { ...detailInput, actorUserId: cancelInput.actorId }));
    const response = { dutyId: firstRequest.id, actorUserId: actor.id, expectedSourceVersion: firstRequest.sourceVersion, expectedEnvelopeVersion: 1,
      policyVersion: 1, actionCode: 'APPROVE', reason: null };
    await assert.rejects(() => respondToCrossWorkspaceDuty(db, { ...response, actorUserId: cancelInput.actorId }), /DUTY_NOT_AVAILABLE/);
    await assert.rejects(() => cancelFinalizedOrdinaryLoading(db, { ...cancelInput, actorId: actor.id, expectedDocumentIds }), /در انتظار تصمیم حسابداری/);
    await assert.rejects(() => respondToCrossWorkspaceDuty(db, { ...response, actionCode: 'DECLINE' }), /REASON_REQUIRED/);
    const rejection = 'دلیل رد درخواست آزمایشی';
    await respondToCrossWorkspaceDuty(db, { ...response, actionCode: 'DECLINE', reason: rejection });
    assert.deepEqual(await latestLoadingCancellationRequest(db, cancelInput.loadingId), {
      ...firstRequest, status: 'REJECTED', reason: rejection,
    });
    assert.equal((await db.logisticsLoading.findUniqueOrThrow({ where: { id: cancelInput.loadingId } })).status, 'FINALIZED');
    assert.equal((await db.salesDispatchInvoice.findUniqueOrThrow({ where: { id: invoice.id } })).voidedAt, null);
    assert.equal((await db.accountingDispatchWaybill.findUniqueOrThrow({ where: { id: waybillId } })).status, 'ISSUED');
    assert.equal(Number(await available()), 1);

    const renewed = await requestLoadingCancellation(db, cancelInput);
    assert.ok(renewed && renewed.id !== firstRequest.id);
    const approve = { ...response, dutyId: renewed.id, expectedSourceVersion: renewed.sourceVersion };
    await assert.rejects(() => respondToCrossWorkspaceDuty(db, { ...approve, expectedSourceVersion: firstRequest.sourceVersion }), /SOURCE_VERSION_CHANGED/);
    const outcomes = await Promise.allSettled([respondToCrossWorkspaceDuty(db, approve), respondToCrossWorkspaceDuty(db, approve)]);
    assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal((await latestLoadingCancellationRequest(db, cancelInput.loadingId))?.status, 'APPROVED');
    assert.equal(Number(await available()), 2);
    assert.ok((await db.salesDispatchInvoice.findUniqueOrThrow({ where: { id: invoice.id } })).voidedAt);
    assert.equal((await db.accountingDispatchWaybill.findUniqueOrThrow({ where: { id: waybillId } })).status, 'VOIDED');
    assert.equal(await db.dispatchDocumentCommandResult.count({ where: { waybillId, command: 'VOID', status: 'SUCCEEDED' } }), 1);

    assert.equal(await db.shipmentQuantityEvidence.count({ where: { sourceType: 'FINALIZED_LOADING_CANCELLATION', sourceId: line.id } }), 1);
    const cancelledLoading = await db.logisticsLoading.findUniqueOrThrow({ where: { id: cancelInput.loadingId } });
    assert.equal(cancelledLoading.status, 'CANCELLED');
    assert.equal(cancelledLoading.cancellationReason, cancelInput.reason);
    assert.equal((await db.accountingDispatchCandidate.findUniqueOrThrow({ where: { id: revision.candidate.id } })).status, 'WITHDRAWN');
    const readyForLoading = await db.guardDriverQueueTurn.findUniqueOrThrow({ where: { id: originalTurn.id } });
    assert.equal(readyForLoading.status, 'AVAILABLE_FOR_LOADING');
    assert.equal(readyForLoading.loadingId, null);
    assert.equal(readyForLoading.admittedAt.toISOString(), originalTurn.admittedAt.toISOString());
    assert.equal(readyForLoading.voidedAt, null);
    assert.ok(!(await listGuardQueueAdmissionOptions(db)).externalDrivers.some(driver => driver.id === driverId));
    const guardDecision = { turnId: originalTurn.id, actorId: fixture.actorId, reason: 'رسیدگی آزمایشی گارد' };
    const nextLoading = { ...guardDecision, loadingId: fixture.loadings[1].id };
    const reservation = await reserveGuardQueueTurn(db, nextLoading);
    assert.equal(reservation.loadingId, nextLoading.loadingId);
    assert.equal(reservation.status, 'RESERVED_FOR_LOADING');
    const logisticsScope = { workspace: 'logistics', permission: 'edit' };
    const oldCases = await listDispatchCases(db, logisticsScope, { loadingId: cancelInput.loadingId });
    assert.equal(oldCases[0]?.loadingId, cancelInput.loadingId);
    const oldCase = await getDispatchCaseTimeline(db, originalTurn.id, logisticsScope, { loadingId: cancelInput.loadingId });
    assert.equal(oldCase?.currentAction, 'COMPLETE');
    const liveCase = await getDispatchCaseTimeline(db, originalTurn.id, logisticsScope, { loadingId: nextLoading.loadingId });
    assert.equal(liveCase?.currentAction, 'REVIEW_CURRENT_STATION');

    await releaseGuardQueueReservation(db, nextLoading);
    const completed = process.env.TEST_CANCEL_GUARD_VOID === 'true'
      ? await voidGuardQueueTurn(db, guardDecision) : await closeGuardQueueTurnWithoutLoading(db, guardDecision);
    assert.equal(completed.status, process.env.TEST_CANCEL_GUARD_VOID === 'true' ? 'VOIDED' : 'CLOSED_WITHOUT_LOADING');
    assert.equal(await cancelFinalizedOrdinaryLoading(db, cancelInput), cancelInput.loadingId);
    assert.equal((await db.guardDriverQueueTurn.findUniqueOrThrow({ where: { id: originalTurn.id } })).status, completed.status);
    const admission = await listGuardQueueAdmissionOptions(db);
    assert.ok(admission.externalDrivers.some(driver => driver.id === driverId));
    assert.ok(admission.externalVehicles.some(vehicle => vehicle.id === originalTurn.externalVehicleId));

    await finalizeCanonicalLoadingAllocations(db, { loadingId: fixture.loadings[1].id, actorId: fixture.actorId,
      effectiveAuthority: fixture.effectiveAuthority, idempotencyKey: `legacy-second-${database.runId}` });
    const loadSecond = () => db.logisticsAllocationRevision.findFirstOrThrow({ where: { loadingId: fixture.loadings[1].id },
      include: { candidate: { include: { waybills: { include: { documentArtifacts: true, legacyReconstruction: true } } } } } });
    const second = await loadSecond();
    assert.equal(classifyLoadingDocumentPart(second, false, true).state, 'PENDING');
    let failOnce = true;
    const issueSecond = async (part: ReturnType<typeof classifyLoadingDocumentPart>) => issueLoadingDocuments({
      loadingId: fixture.loadings[1].id, invoicePredecessorId: null, parts: [part],
      issueWaybill: async (candidateId, idempotencyKey) => { await decideAccountingDispatchCandidate(db,
        { candidateId, idempotencyKey, action: 'ACCEPT', actorId: actor.id, effectiveAuthority: authority }); },
      reconstructWaybill: async candidateId => {
        const waybill = await db.accountingDispatchWaybill.findFirstOrThrow({ where: { candidateId, status: 'ISSUED' } });
        if (failOnce) { failOnce = false; throw new Error('simulated render failure'); }
        await reconstructLegacyWaybill(db, { ...command, waybillId: waybill.id }, render);
      },
      issueInvoice: async key => { await invoices.issue({ ...invoiceContext, expectedRevisionIds: [second.id] }, fixture.loadings[1].id, key); },
    });
    await assert.rejects(() => issueSecond(classifyLoadingDocumentPart(second, false, true)), /simulated render failure/);
    const retry = await loadSecond();
    assert.equal(classifyLoadingDocumentPart(retry, false, true).state, 'RECONSTRUCT');
    await issueSecond(classifyLoadingDocumentPart(retry, false, true));
    assert.equal(await db.accountingDispatchWaybill.count({ where: { candidateId: second.candidate!.id } }), 1);
    assert.equal(await db.salesDispatchInvoice.count({ where: { loadingId: fixture.loadings[1].id } }), 1);
    const secondTurn = await db.guardDriverQueueTurn.findUniqueOrThrow({ where: { id: second.queueTurnId } });
    assert.ok(secondTurn.externalDriverId);
    const simulator = new DispatchConfirmationService(db, { vault: new ProtectedTemplateVault({ activeKeyId: 'test', keys: { test: Buffer.alloc(32, 7) } }),
      connector: new DeterministicBiometricSimulator(), otpSecret: 'isolated-integration-secret', sendOtp: async () => {} });
    const initialEnrollment = await db.driverBiometricEnrollment.findFirstOrThrow({ where: { externalDriverId: secondTurn.externalDriverId, status: 'ACTIVE' } });
    await simulator.deactivateEnrollment({ enrollmentId: initialEnrollment.id, actorId: actor.id, reason: 'آماده‌سازی آزمون جداشده' });
    await simulator.enrollInternalDriver({ personnelId: `external:${secondTurn.externalDriverId}`, confirmationPhone: '09123333333', actorId: actor.id,
      templates: ['RIGHT_INDEX', 'LEFT_INDEX'].map(finger => ({ finger, format: 'ISO-19794-2', material: Buffer.from(`test-${finger}`),
        deviceEvidence: {}, provenance: 'APPROVED_CONNECTOR' as const })) });
    const secondWaybill = await db.accountingDispatchWaybill.findFirstOrThrow({ where: { candidateId: second.candidate!.id } });
    const session = await simulator.startSession({ waybillId: secondWaybill.id, actorId: actor.id, workstationId: 'ISOLATED-TEST' });
    const confirmation = await simulator.verifyInternalBiometric({ sessionId: session.id, actorId: actor.id });
    assert.ok(confirmation.authorization);
    const { actor: guard, authority: guardAuthority } = await createAuthorizedActorFixture(db, { runId: database.runId,
      workspace: 'security', feature: 'security_dispatch_confirmation_approve', workspacePermission: 'admin', withSecurityPersonnel: true });
    const gate = new PhysicalGateExitService(db);
    const exitInput = { authorizationId: confirmation.authorization.id, actorId: guard.id, effectiveAuthority: guardAuthority,
      idempotencyKey: `isolated-exit-${database.runId}`, correlationId: `isolated-exit-${database.runId}` };
    await db.externalDriver.update({ where: { id: secondTurn.externalDriverId }, data: { status: 'RESTRICTED' } });
    await assert.rejects(() => gate.recordExit(exitInput), /خروج مجاز نیست/);
    await db.externalDriver.update({ where: { id: secondTurn.externalDriverId }, data: { status: 'ACTIVE' } });
    const requestBeforeExit = await requestLoadingCancellation(db, { ...cancelInput, loadingId: fixture.loadings[1].id });
    assert.ok(requestBeforeExit);
    const exit = await gate.recordExit(exitInput);
    assert.equal((await gate.recordExit(exitInput)).id, exit.id);
    assert.equal((await db.guardDriverQueueTurn.findUniqueOrThrow({ where: { id: secondTurn.id } })).status, 'EXIT_RECORDED');
    const decideAfterExit = { ...response, dutyId: requestBeforeExit.id, expectedSourceVersion: requestBeforeExit.sourceVersion };
    await assert.rejects(() => respondToCrossWorkspaceDuty(db, decideAfterExit), /DUTY_LOADING_CANCELLATION_CHANGED/);
    assert.equal((await latestLoadingCancellationRequest(db, fixture.loadings[1].id))?.status, 'PENDING');
    await respondToCrossWorkspaceDuty(db, { ...decideAfterExit, actionCode: 'DECLINE', reason: 'خروج راننده ثبت شده است.' });
    await assert.rejects(() => cancelFinalizedOrdinaryLoading(db, { ...cancelInput, loadingId: fixture.loadings[1].id }), /لغو فقط پیش از ثبت خروج/);
    assert.equal((await db.logisticsLoading.findUniqueOrThrow({ where: { id: fixture.loadings[1].id } })).status, 'FINALIZED');

    console.log('legacy waybill reconstruction local integration: PASS');
  } finally { await db.$disconnect(); await database.cleanup(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
