import assert from 'node:assert/strict';
import express from 'express';
import { PartnerEventSchema, CustomerContractOutputSchema, canonicalHash } from '@sabalanerp/partner-sales-contracts';
import type { Prisma } from '@prisma/client';
import type { AddressInfo } from 'node:net';
import { prisma } from '../../lib/prisma';
import accountingRouter from '../../routes/accounting';
import partnerAccountingRouter from '../../routes/partner-accounting';
import dispatchCreditRouter from '../../routes/dispatchCredit';
import correctionRouter from '../../routes/partner-corrections';
import * as outputContracts from '@sabalanerp/partner-sales-contracts';
import { createCustomerOutputSnapshots } from '../partnerSales/customerOutput/snapshots';
import { createAuditedPartnerAuthorization } from '../partnerSales/authorization/audited';
import { readAuthorizationDecisionByCorrelation } from '../effectiveAuthorization/audit';
import { createContractDispatchDuty } from '../crossWorkspaceDutyAdapters/contractDispatchDutyAdapter';
import logisticsRouter from '../../routes/logistics';
import { createAuthoritativeSession, SESSION_COOKIE } from '../identitySessionService';

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '55432');
  assert.match(url.pathname, /^\/sabalanerp_concurrency_[a-f0-9]{16}$/);
  const expected = JSON.parse(process.env.PARTNER_TEST_OWNER!);
  const requesterId = process.env.PARTNER_TEST_ACTOR_ID!;
  const managerId = process.env.PARTNER_TEST_MANAGER_ID;
  const invoiceId = process.env.PARTNER_TEST_INVOICE_ID;
  const accountantId = process.env.PARTNER_TEST_ACCOUNTANT_ID;
  const logisticsId = process.env.PARTNER_TEST_LOADING_ACTOR_ID!;
  const sale = await prisma.partnerSaleCase.findUniqueOrThrow({ where: { id: expected.caseId }, include: { customerContract: true, head: true, profile: true } });
  const issueSession = (actorId: string) => createAuthoritativeSession(prisma, actorId, {
    ipAddress: '127.0.0.1', userAgent: 'isolated-partner-alternative-loading',
  });
  const [requester, manager, logistics, accountant] = await Promise.all([
    issueSession(requesterId), managerId && issueSession(managerId), issueSession(logisticsId), accountantId && issueSession(accountantId),
  ]);
  const app = express();
  app.use(express.json());
  app.use('/accounting', accountingRouter);
  app.use('/partner/accounting', partnerAccountingRouter);
  app.use('/dispatch-credit', dispatchCreditRouter);
  app.use('/corrections', correctionRouter);
  app.use('/logistics', logisticsRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  try {
    const request = async (path: string, token: string, body?: unknown, key = 'alternative-loading') => {
      const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`, {
        method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', cookie: `${SESSION_COOKIE}=${token}`,
          'Idempotency-Key': key, 'X-Correlation-Id': key, Connection: 'close' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, body: await response.json() as any };
    };
    const load = (path: string, body?: unknown, key?: string) => request(`/logistics${path}`, logistics.token, body, key);
    const projectsPath = `/customers/${sale.customerId}/projects`;
    const customersPath = '/customers?search=Customer%20Lifecycle';
    let selection = { sourceKind: 'PARTNER_CASE', expected, deliveryId: 'separate-delivery' };
    const assertHidden = async (key: string) => {
      for (const path of [customersPath, projectsPath]) {
        const response = await load(path);
        assert.equal(response.status, 200, JSON.stringify(response.body));
        assert.deepEqual(response.body.data, []);
      }
      assert.equal((await load('/loadings', selection, key)).status, 409);
    };
    const baselines = () => prisma.shipmentQuantityEvidence.findMany({ where: {
      partnerCaseId: expected.caseId, kind: 'CONTRACTED_SET',
    } });
    const accounting = (body: unknown, key: string) => request('/accounting/actions', requester.token, body, key);
    let authorityId: string | undefined;
    let clearedCheckId: string | undefined;
    if (manager) {
      assert.equal((await baselines()).length, 0);
      await assertHidden('before-approval');
      const pending = await request(`/dispatch-credit/contracts/${sale.customerContractId}/requests`, requester.token, { kind: 'MANAGER' });
      assert.equal(pending.status, 200, JSON.stringify(pending.body));
      authorityId = pending.body.data.id;
      await assertHidden('pending-approval');
      const decision = () => request(`/dispatch-credit/authorities/${pending.body.data.id}/actions`, manager.token,
        { action: 'APPROVE', promisedDate: '2099-01-01' });
      const approved = await decision();
      assert.equal(approved.status, 200, JSON.stringify(approved.body));
      assert.equal((await baselines()).length, 1, 'approving a current grant prepares the contractual baseline');
      assert.equal((await decision()).status, 409);
    } else {
      assert.ok(invoiceId);
      const approved = await accounting({ kind: 'APPROVE_FINANCIAL_INVOICE', invoiceId, sepidarAmount: '1600',
        systemInvoiceDate: new Date().toISOString().slice(0, 10), systemInvoiceNumber: 'settlement-test-invoice',
        note: 'تأیید صورتحساب آزمایشی پرونده همکار' }, 'publish-invoice');
      assert.equal(approved.status, 200, JSON.stringify(approved.body));
      const published = await request('/partner/accounting/receivables', requester.token, { expected, invoiceRecordId: invoiceId });
      assert.equal(published.status, 200, JSON.stringify(published.body));
      const receivable = await prisma.accountingReceivable.findFirstOrThrow({ where: { invoiceRecordId: invoiceId } });

      // Disqualify the Sepidar path while leaving the published canonical debt.
      // A positive baseline ensures these reads exercise the authority gate.
      await prisma.accountingFinancialRecord.update({ where: { id: invoiceId }, data: { sepidarAmount: null } });
      assert.equal((await baselines()).length, 1);
      await assertHidden('no-realized-receipt');
      const { customerPaymentPlan: plan } = CustomerContractOutputSchema.parse(sale.head.customerProjection);
      await prisma.$transaction(async tx => {
        const recordedAt = new Date();
        const receiptId = 'retail-fixture-receipt';
        const actorId = sale.profile.userId;
        const receipt = { receiptId, planId: plan.planId, kind: 'RECEIPT', method: 'CASH', actorId,
          commandId: receiptId, correlationId: receiptId, recordedAt: recordedAt.toISOString(),
          amount: { amount: '2000', currency: 'IRR' }, effectiveDate: recordedAt.toISOString().slice(0, 10),
          allocations: plan.installments.map(item => ({ installmentId: item.installmentId, amount: item.amount.amount })),
        };
        const event = PartnerEventSchema.parse({ schemaVersion: 1, type: 'RETAIL_RECEIPT', eventId: `retail-event:${receiptId}`,
          commandId: receiptId, correlationId: receiptId, actorId, recordedAt: receipt.recordedAt, effectiveDate: receipt.effectiveDate,
          owner: expected, planId: plan.planId, receiptId, amount: receipt.amount, allocations: receipt.allocations });
        const latest = await tx.partnerCaseEvent.findFirstOrThrow({ where: { caseId: sale.id }, orderBy: { sequence: 'desc' } });
        const effectiveDate = new Date(receipt.effectiveDate);
        await tx.partnerCaseEvent.create({ data: { id: event.eventId, type: event.type, caseId: sale.id,
          caseRevision: expected.revision, integrityHash: expected.integrityHash, sequence: latest.sequence + 1,
          actorId, commandId: receiptId, correlationId: receiptId, effectiveDate, evidence: { publicEvent: event } } });
        await tx.partnerRetailReceipt.create({ data: { id: receiptId, caseId: sale.id, planId: plan.planId,
          kind: receipt.kind, amount: receipt.amount.amount, currency: receipt.amount.currency, actorId,
          commandId: receiptId, effectiveDate, recordedAt, evidence: { schemaVersion: 1, receipt } } });
        await tx.partnerRetailReceiptAllocation.createMany({ data: receipt.allocations.map(item => ({
          ...item, receiptId, planId: plan.planId,
        })) });
      });
      await assertHidden('end-customer-paid-in-full');

      const partial = await accounting({ kind: 'REGISTER_RECEIPT', receivableId: receivable.id,
        method: 'BANK_TRANSFER', amount: '800' }, 'partial-receipt');
      assert.equal(partial.status, 200, JSON.stringify(partial.body));
      await assertHidden('partially-paid');
      const check = await accounting({ kind: 'REGISTER_RECEIPT', receivableId: receivable.id, method: 'CHECK', amount: '800',
        check: { checkNumber: '123456', ownerName: 'آزمون', dueDate: '2099-01-01' } }, 'register-check');
      assert.equal(check.status, 200, JSON.stringify(check.body));
      clearedCheckId = check.body.data.affected.paymentEventIds[0];
      const update = (status: string, key: string) =>
        accounting({ kind: 'UPDATE_CHECK_STATUS', paymentEventId: clearedCheckId, status }, key);
      const deposited = await update('DEPOSITED', 'deposited-check');
      assert.equal(deposited.status, 200, JSON.stringify(deposited.body));
      await assertHidden('posted-but-uncleared');
      // Legacy obligations can reach checkout without physical coverage.
      await prisma.$transaction(async tx => {
        await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
        await tx.shipmentQuantityEvidence.deleteMany({ where: { partnerCaseId: expected.caseId, kind: 'CONTRACTED_SET' } });
        await tx.partnerFulfillmentLineage.deleteMany({ where: { caseId: expected.caseId } });
      });
      assert.equal((await baselines()).length, 0);
      const clear = () => update('CLEARED', 'cleared-check');
      const cleared = await clear();
      assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
      assert.equal((await baselines()).length, 1, 'clearing the final wholesale payment prepares the contractual baseline');
      const replay = await clear();
      assert.equal(replay.status, 200, JSON.stringify(replay.body));
    }

    const customers = await load(customersPath);
    assert.equal(customers.status, 200, JSON.stringify(customers.body));
    assert.ok(customers.body.data.some((row: { id: string }) => row.id === sale.customerId));
    const projects = await load(projectsPath);
    assert.equal(projects.status, 200, JSON.stringify(projects.body));
    const selected = projects.body.data.find((row: { deliveryId: string }) => row.deliveryId === selection.deliveryId);
    assert.ok(selected, JSON.stringify(projects.body));
    assert.deepEqual(selected.owner, expected);
    assert.equal(selected.contractNumber, sale.customerContract?.contractNumber);
    const draft = await load('/loadings', { ...selection, expected: selected.owner, deliveryId: selected.deliveryId }, 'alternative-draft');
    assert.equal(draft.status, 201, JSON.stringify(draft.body));
    const reopened = await load(`/loadings/${draft.body.data.loadingId}`);
    assert.equal(reopened.status, 200, JSON.stringify(reopened.body));
    assert.equal(reopened.body.data.source.recipient.customerId, sale.customerId);
    assert.equal(reopened.body.data.source.deliveryId, selection.deliveryId);
    assert.equal(reopened.body.data.source.rows[0].plannedQuantity, '0.750');
    assert.equal((await baselines()).length, 1);

    if (authorityId && manager) {
      const audit = await prisma.accountingAuditLog.findFirstOrThrow({ where: { entityId: authorityId, action: 'DISPATCH_MANAGER_APPROVE' } });
      const { partnerCaseOwner, ...legacyDecision } = audit.afterState as Prisma.JsonObject;
      assert.deepEqual(partnerCaseOwner, expected);
      await prisma.accountingAuditLog.update({ where: { id: audit.id }, data: { afterState: legacyDecision as Prisma.InputJsonObject } });
      const legacy = await load(projectsPath);
      assert.equal(legacy.status, 200, JSON.stringify(legacy.body));
      assert.ok(legacy.body.data.some((row: { deliveryId: string }) => row.deliveryId === selection.deliveryId),
        'a historical decision after this effective Case revision remains valid');
      await prisma.accountingAuditLog.update({ where: { id: audit.id }, data: { afterState: {
        ...legacyDecision, partnerCaseOwner: { ...expected, revision: expected.revision + 1 },
      } as Prisma.InputJsonObject } });
      await assertHidden('manager-witness-for-another-case-revision');
      await prisma.accountingAuditLog.update({ where: { id: audit.id }, data: { afterState: audit.afterState as Prisma.InputJsonObject } });
      // Keep a live-shaped grant with a stale commercial revision.
      const authority = await prisma.contractDispatchAuthority.findUniqueOrThrow({ where: { id: authorityId } });
      await prisma.contractDispatchAuthority.update({ where: { id: authority.id }, data: { revision: authority.revision - 1 } });
      await assertHidden('stale-manager-grant');
      await prisma.contractDispatchAuthority.update({ where: { id: authority.id }, data: { revision: authority.revision } });
      const revoke = (id: string) => request(`/dispatch-credit/authorities/${id}/actions`, manager.token,
        { action: 'REVOKE', reason: 'لغو مجوز مدیر در آزمون محلی' });
      const revoked = await revoke(authorityId);
      assert.equal(revoked.status, 200, JSON.stringify(revoked.body));
      await assertHidden('revoked-only-authority');
      assert.equal((await load(`/loadings/${draft.body.data.loadingId}`)).status, 200);
      const renewed = await request(`/dispatch-credit/contracts/${sale.customerContractId}/requests`, requester.token, { kind: 'MANAGER' });
      assert.equal(renewed.status, 200, JSON.stringify(renewed.body));
      const renewedDecision = await request(`/dispatch-credit/authorities/${renewed.body.data.id}/actions`, manager.token,
        { action: 'APPROVE', promisedDate: '2099-01-01' });
      assert.equal(renewedDecision.status, 200, JSON.stringify(renewedDecision.body));
      const renewedDraft = await load('/loadings', selection, 'renewed-manager-approval');
      assert.equal(renewedDraft.status, 201, JSON.stringify(renewedDraft.body));

      const partnerId = sale.profile.userId;
      const partner = await issueSession(partnerId);
      const command = async (intent: Record<string, unknown>, actorId: string, suffix: string) => {
        const commandId = `${sale.id}-${suffix}`;
        return { schemaVersion: 1, ...intent, commandId, correlationId: commandId,
          idempotency: { actorId, operation: intent.type, targetId: sale.id, key: commandId, payloadHash: await canonicalHash(intent) } };
      };
      const correctionRequest = await command({ type: 'CORRECTION_REQUEST', expected, expectedState: 'COMMITTED',
        scope: 'RETAIL_ONLY', reason: 'اصلاح مستند قیمت فروش به مشتری' }, partnerId, 'manager-retail-request');
      const requested = await request('/corrections/commands', partner.token, correctionRequest);
      assert.equal(requested.status, 200, JSON.stringify(requested.body));
      const correctionId = `correction:${correctionRequest.commandId}`;
      const evidence = await prisma.$transaction(async tx => {
        const correlationId = `${sale.id}-manager-retail-scope-evidence`;
        const binding = { actorId: managerId!, purpose: 'MANAGEMENT', channel: 'API' } as const;
        const result = await createAuditedPartnerAuthorization(tx, binding, { correlationId, reason: 'تأیید دامنه اصلاح خرده‌فروشی' })
          .authorize('CORRECTION_SCOPE_APPROVE', { kind: 'CASE', id: sale.id });
        assert.equal(result.ok, true);
        return readAuthorizationDecisionByCorrelation(tx, { ...binding, domain: 'PARTNER', action: 'CORRECTION_SCOPE_APPROVE',
          rootKind: 'CASE', rootId: sale.id, correlationId, allowed: true });
      });
      assert.ok(evidence);
      const gate = await command({ type: 'CORRECTION_GATE', expected, expectedState: 'COMMITTED', correctionId,
        gate: 'SALES_SCOPE', outcome: 'APPROVE', evidenceId: evidence.id, reason: 'تأیید دامنه اصلاح خرده‌فروشی' }, managerId!, 'manager-retail-scope');
      const gated = await request('/corrections/commands', manager.token, gate);
      assert.equal(gated.status, 200, JSON.stringify(gated.body));
      const plan = CustomerContractOutputSchema.parse(sale.head.customerProjection).customerPaymentPlan;
      const save = await command({ type: 'RETAIL_CORRECTION_SAVE', expected, expectedState: 'COMMITTED',
        opportunityId: `opportunity:${correctionId}`,
        retailPrices: [{ productRowId: reopened.body.data.source.rows[0].productRowId,
          retailUnitPrice: { amount: '1100', currency: 'IRR' } }],
        customerPaymentPlan: { ...plan, planId: `${sale.id}-manager-retail-plan`, predecessorPlanId: plan.planId,
          version: plan.version + 1, effectiveDate: '2099-01-01', installments: [{ installmentId: `${sale.id}-manager-retail-installment`,
            dueDate: '2099-01-02', amount: { amount: '2200', currency: 'IRR' }, method: 'CASH' }] },
      }, partnerId, 'manager-retail-save');
      const saved = await request('/corrections/commands', partner.token, save);
      assert.equal(saved.status, 200, JSON.stringify(saved.body));
      const successor = saved.body.data.head;
      // Seed a valid verified customer session at the correction service's
      // confirmation seam. The real command verifies it and activates the Case.
      const snapshotId = `${sale.id}-confirmed-retail-successor`;
      await prisma.$transaction(async tx => {
        const revision = await tx.partnerCaseRevision.findUniqueOrThrow({ where: { caseId_revision: {
          caseId: sale.id, revision: successor.revision,
        } } });
        const { seller, outputHash: _outputHash, ...retail } = CustomerContractOutputSchema.parse(revision.customerProjection);
        const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
        const expiresAt = new Date(clock.now.getTime() + 60_000);
        const phone = retail.customer.phone.replace(/\D/g, '');
        const normalizedRecipient = phone.startsWith('0') ? `+98${phone.slice(1)}` : `+${phone}`;
        const snapshot = await createCustomerOutputSnapshots(outputContracts).mint({ snapshotId, owner: successor, normalizedRecipient,
          createdAt: clock.now.toISOString(), expiresAt: expiresAt.toISOString(), business: {
            legalName: seller.displayName, businessPhone: seller.phone, businessAddress: seller.address,
          }, retail: { ...retail, status: 'PENDING_APPROVAL', confirmation: 'PENDING' } });
        await tx.partnerCustomerOutputSnapshot.create({ data: { id: snapshotId, caseId: sale.id,
          caseRevision: successor.revision, integrityHash: successor.integrityHash, contentHash: snapshot.content.outputHash,
          contractNumber: snapshot.content.contractNumber, recipient: normalizedRecipient, expiresAt,
          content: snapshot, commandId: snapshotId } });
        await tx.contractPublicConfirmation.create({ data: { contractId: sale.customerContractId!, tokenHash: snapshotId,
          phoneNumber: `0${normalizedRecipient.slice(3)}`, otpCodeHash: snapshotId, otpExpiresAt: expiresAt,
          linkExpiresAt: expiresAt, status: 'VERIFIED', verifiedAt: clock.now, createdBy: `partner-output:${snapshotId}`,
          commercialRevision: sale.customerContract!.commercialRevision } });
      });
      const confirm = await command({ type: 'CORRECTION_GATE', expected: successor, expectedState: 'COMMITTED', correctionId,
        gate: 'CUSTOMER_CONFIRM', outcome: 'APPROVE', evidenceId: snapshotId, reason: 'تأیید نسخه اصلاحی با شواهد مشتری' },
      partnerId, 'manager-retail-confirm');
      const confirmed = await request('/corrections/commands', partner.token, confirm);
      assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
      const corrected = await prisma.salesContract.findUniqueOrThrow({ where: { id: sale.customerContractId! } });
      assert.equal(corrected.commercialRevision, sale.customerContract?.commercialRevision);
      assert.equal(corrected.partnerRevision, expected.revision + 1);
      selection = { ...selection, expected: saved.body.data.head };
      await assertHidden('before-corrected-managerial-approval');
      const authorityPath = `/dispatch-credit/contracts/${sale.customerContractId}`;
      // An older pending request may coexist with a legacy commercial grant.
      const earlierGrant = await prisma.contractDispatchAuthority.findUniqueOrThrow({ where: { id: renewed.body.data.id } });
      const staleRequest = await prisma.contractDispatchAuthority.create({ data: { contractId: corrected.id,
        kind: 'MANAGER', revision: corrected.commercialRevision, requestedBy: requesterId, createdAt: earlierGrant.createdAt } });
      await createContractDispatchDuty(prisma, staleRequest.id);
      const staleManager = await request(authorityPath, requester.token);
      assert.equal(staleManager.body.data.draftManagerId, null);
      assert.equal(staleManager.body.data.activeManagerId, earlierGrant.id);
      assert.equal(staleManager.body.data.canRequestManager, true);
      assert.equal(staleManager.body.data.authorities.find((row: { id: string }) => row.id === staleRequest.id).canDecide, false);
      const stalePath = `/dispatch-credit/authorities/${staleRequest.id}/actions`;
      assert.equal((await request(stalePath, manager.token, { action: 'APPROVE', promisedDate: '2099-02-01' })).status, 409);
      assert.equal(staleManager.body.data.eligible, true, 'the earlier commercial-revision grant still governs downstream dispatch');
      const replacement = await request(`${authorityPath}/requests`, requester.token, { kind: 'MANAGER' });
      assert.equal(replacement.status, 200, JSON.stringify(replacement.body));
      const superseded = await prisma.crossWorkspaceDuty.findUniqueOrThrow({ where: { stableKey: `CONTRACT_DISPATCH:${staleRequest.id}` } });
      assert.equal(superseded.status, 'CANCELLED');
      assert.equal((await request(authorityPath, requester.token)).body.data.eligible, true,
        'requesting fresh draft authority preserves the current commercial grant while pending');
      const replacementPath = `/dispatch-credit/authorities/${replacement.body.data.id}/actions`;
      const replacementDecision = { action: 'APPROVE', promisedDate: '2099-02-01' };
      assert.equal((await request(replacementPath, requester.token, replacementDecision)).status, 409);
      assert.equal((await request(replacementPath, manager.token, replacementDecision)).status, 200);
      const afterRenewal = await request(authorityPath, requester.token);
      assert.equal(afterRenewal.body.data.activeManagerId, replacement.body.data.id);
      assert.equal(afterRenewal.body.data.draftManagerId, replacement.body.data.id);
      assert.equal(afterRenewal.body.data.authorities.find((row: { id: string }) => row.id === renewed.body.data.id).status, 'SUPERSEDED');
      assert.equal((await load('/loadings', selection, 'corrected-managerial-approval')).status, 201);

      assert.ok(invoiceId && accountant);
      const approvedInvoice = await request('/accounting/actions', accountant.token, {
        kind: 'APPROVE_FINANCIAL_INVOICE', invoiceId, sepidarAmount: '1600',
        systemInvoiceDate: new Date().toISOString().slice(0, 10), systemInvoiceNumber: 'alternate-basis-invoice',
        note: 'تأیید مبنای مالی مستقل از مجوز مدیر',
      }, 'alternate-financial-approval');
      assert.equal(approvedInvoice.status, 200, JSON.stringify(approvedInvoice.body));
      const revokedRenewed = await revoke(replacement.body.data.id);
      assert.equal(revokedRenewed.status, 200, JSON.stringify(revokedRenewed.body));
      const retained = await load(projectsPath);
      assert.ok(retained.body.data.some((row: { deliveryId: string }) => row.deliveryId === selection.deliveryId));
      const financialDraft = await load('/loadings', selection, 'retained-alternate-financial-basis');
      assert.equal(financialDraft.status, 201, JSON.stringify(financialDraft.body));

    }
    if (clearedCheckId) {
      const bounced = await accounting({ kind: 'UPDATE_CHECK_STATUS', status: 'BOUNCED', paymentEventId: clearedCheckId }, 'bounced-check');
      assert.equal(bounced.status, 200, JSON.stringify(bounced.body));
      await assertHidden('payment-reversed');
      assert.equal((await load(`/loadings/${draft.body.data.loadingId}`)).status, 200);
      const recovered = await accounting({ kind: 'UPDATE_CHECK_STATUS', status: 'CLEARED', paymentEventId: clearedCheckId }, 'cleared-again');
      assert.equal(recovered.status, 200, JSON.stringify(recovered.body));
      assert.equal((await baselines()).length, 1);

    }
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
