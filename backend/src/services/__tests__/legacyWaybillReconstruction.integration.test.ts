import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { createTemporaryConcurrencyDatabase } from './shipmentStatementConcurrency/database';
import { createConcurrentPricingFixture } from './shipmentStatementConcurrency/pricingFixture';
import { createAuthorizedActorFixture } from './shipmentStatementConcurrency/authorityFixture';
import { decideAccountingDispatchCandidate, finalizeCanonicalLoadingAllocations } from '../dispatchAllocation';
import { readLegacyWaybillReconstruction, reconstructLegacyWaybill } from '../legacyWaybillReconstruction';
import { createSalesInvoiceService } from '../salesDispatchInvoice/service';
import { classifyLoadingDocumentPart, issueLoadingDocuments } from '../loadingDocumentIssuance';
import { DispatchConfirmationService } from '../dispatchConfirmation';
import { ProtectedTemplateVault } from '../biometricTemplateVault';
import { DeterministicBiometricSimulator } from '../biometricSimulator';
import { PhysicalGateExitService } from '../physicalGateExit';

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
    const exit = await gate.recordExit(exitInput);
    assert.equal((await gate.recordExit(exitInput)).id, exit.id);
    assert.equal((await db.guardDriverQueueTurn.findUniqueOrThrow({ where: { id: secondTurn.id } })).status, 'EXIT_RECORDED');
    console.log('legacy waybill reconstruction local integration: PASS');
  } finally { await db.$disconnect(); await database.cleanup(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
