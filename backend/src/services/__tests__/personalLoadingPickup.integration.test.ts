import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { selectLoadingTransport, retirePersonalLoadingDraft } from '../personalLoadingPickup';
import { getDispatchCaseTimeline } from '../dispatchCaseTimeline';
import { PhysicalGateExitService } from '../physicalGateExit';
import { projectAccountingDispatchCandidateSummary } from '../accountingDispatchCandidatePresentation';
import { cancelFinalizedOrdinaryLoading, decideAccountingDispatchCandidate, finalizeCanonicalLoadingAllocations, saveCanonicalAllocationDraft } from '../dispatchAllocation';
import { shipmentQuantityEvidenceIntegrityHash } from '../shipmentQuantityProjectionStore';
import { approvedPricingRowIntegrityHash, approvedPricingVersionIntegrityHash, canonicalApprovedPricingHash } from '../approvedPricing/domain';
import { PrismaApprovedPricingRepository } from '../approvedPricing/prismaRepository';
import { createSalesInvoiceService } from '../salesDispatchInvoice/service';
import { DispatchConfirmationService } from '../dispatchConfirmation';

const target = new URL(process.env.DATABASE_URL || 'postgresql://invalid');
assert.equal(target.hostname, '127.0.0.1');
assert.equal(target.port, '55432');
assert.match(target.pathname, /^\/sabalanerp_dispatchdocs_[a-f0-9]{16}$/);

const db = new PrismaClient();
const rollback = Symbol('Customer pickup verification rollback');

async function main() {
  try {
    const fixture = await db.$transaction(async tx => {
      const client = new Proxy(tx, {
        get(target, key, receiver) {
          if (key === '$transaction') return async (work: (client: typeof tx) => unknown) => work(client);
          if (key === '$queryRawUnsafe') return async (query: string, ...values: unknown[]) =>
            query.includes("nextval('accounting_dispatch_waybill_number_seq')")
              ? [{ number: -BigInt(`0x${randomUUID().slice(0, 8)}`) }]
              : tx.$queryRawUnsafe(query, ...values);
          if (key === '$queryRaw') return async (query: TemplateStringsArray | Parameters<typeof tx.$queryRaw>[0], ...values: unknown[]) =>
            Array.isArray(query) && query.join('').includes("nextval('sales_dispatch_invoice_number_seq')")
              ? [{ number: BigInt(`0x${randomUUID().slice(0, 8)}`) }]
              : tx.$queryRaw(query, ...values);
          return Reflect.get(target, key, receiver);
        },
      }) as PrismaClient;
      const actor = await tx.user.create({ data: {
        email: `pickup-test-${randomUUID()}@example.invalid`, username: randomUUID(), password: 'test-only',
        firstName: 'آزمون', lastName: 'پذیرش', role: 'ADMIN',
      } });
      const actorId = actor.id;
      const customer = await tx.crmCustomer.create({ data: { firstName: 'آزمون', lastName: 'شخصی', phoneNumbers: { create: { number: '09123456789', type: 'MOBILE', isPrimary: true } } } });
      const project = await tx.projectAddress.create({ data: { customerId: customer.id, address: 'نشانی آزمون' } });
      const department = await tx.department.findFirstOrThrow();
      const product = await tx.product.findFirstOrThrow();
      const rowId = randomUUID();
      const contract = await tx.salesContract.create({ data: {
        contractNumber: `PICKUP-CONTRACT-${randomUUID()}`, title: 'Pickup test', titlePersian: 'آزمون بارگیری', content: '',
        status: 'APPROVED', customerId: customer.id, departmentId: department.id, createdBy: actorId,
        responsibleSellerId: actorId, contractData: { products: [{ rowId, productId: product.id, quantity: '2.000', unit: 'count' }] },
      } });
      const item = await tx.contractItem.create({ data: { contractId: contract.id, productId: product.id, productRowId: rowId,
        productType: 'count', quantity: 2, unitPrice: 10, totalPrice: 20 } });
      const at = new Date();
      await tx.contractPublicConfirmation.create({ data: { contractId: contract.id, tokenHash: randomUUID(),
        phoneNumber: '09123456789', otpCodeHash: randomUUID(), otpExpiresAt: at, linkExpiresAt: at,
        status: 'CONFIRMED', verifiedAt: at, createdBy: actorId } });
      const sourceSnapshot = { customerId: customer.id, contractData: contract.contractData };
      const finance = await tx.accountingFinancialRecord.create({ data: { kind: 'INVOICE_CANDIDATE', status: 'ISSUED',
        sourceKind: 'SALES_CONTRACT', sourceId: contract.id, contractId: contract.id, customerId: customer.id,
        sourceSnapshot, amount: 20, currency: contract.currency, sepidarAmount: 20, systemInvoiceNumber: `PICKUP-${randomUUID()}`, systemInvoiceDate: at,
        financiallyApprovedAt: at, financiallyApprovedBy: actorId, createdBy: actorId } });
      const common = { contractId: contract.id, sourceFinancialRecordId: finance.id, versionNumber: 1 };
      const row = { ...common, versionId: randomUUID(), contractItemId: item.id, productRowId: rowId, ordinal: 1,
        contractedQuantity: '2.000', unit: 'count', canonicalAllInTotal: '20.000000000000', discountEligible: true,
        componentEvidence: { base: '20.000000000000', discountBasis: '20.000000000000' } };
      const rowHash = approvedPricingRowIntegrityHash(row);
      const version = { ...common, id: row.versionId, approvedAt: at, approvedBy: actorId, schemaVersion: 1,
        currency: contract.currency, grossAmount: '20.000000000000', discountAmount: '0.000000000000', netAmount: '20.000000000000',
        sourceEvidence: { contractNumber: contract.contractNumber, customer: { id: customer.id },
          destination: { kind: 'PROJECT_ADDRESS', projectId: project.id, address: project.address },
          financialApproval: { sourceSnapshotHash: canonicalApprovedPricingHash(sourceSnapshot) } },
        rowHashes: [rowHash] };
      const pricing = new PrismaApprovedPricingRepository(tx);
      await pricing.withContractLock(contract.id, () => pricing.insertAndAdvance({
        ...version, integrityHash: approvedPricingVersionIntegrityHash(version),
        rows: [{ ...row, id: randomUUID(), integrityHash: rowHash }],
      }));
      await tx.contractPricingReadinessResult.create({ data: { contractId: contract.id, pricingVersionId: version.id,
        sourceFinancialRecordId: finance.id, status: 'READY', sourceCount: 1, sourceIdentityHash: canonicalApprovedPricingHash(randomUUID()),
        quantityTotal: 2, amountTotal: 20, evidenceHash: canonicalApprovedPricingHash(randomUUID()), evaluatedBy: actorId,
      } });
      const baseline = { id: `contracted-${item.id}`, contractId: contract.id, contractItemId: item.id, productRowId: rowId,
        unit: 'count', kind: 'CONTRACTED_SET' as const, quantity: '2.000', effectiveAt: at.toISOString(), recordedAt: at.toISOString(),
        sourceType: 'CONTRACT_QUANTITY_VERSION', sourceId: item.id, sourceVersion: 1, integrityHash: '',
        metadata: { financiallyApprovedAt: at.toISOString() } };
      await tx.shipmentQuantityEvidence.create({ data: { ...baseline, effectiveAt: at, recordedAt: at,
        integrityHash: shipmentQuantityEvidenceIntegrityHash(baseline) } });
      const loading = await tx.logisticsLoading.create({ data: {
        loadingNumber: `PICKUP-TEST-${randomUUID()}`, customerId: customer.id, projectId: project.id, createdBy: actorId,
        lines: { create: { sourceContractId: contract.id, sourceContractItemId: item.id,
          productRowId: rowId, productId: product.id, quantity: 1, unit: 'count' } },
      } });
      const unrelated = await tx.salesContract.create({ data: { contractNumber: `UNSELECTED-${randomUUID()}`,
        title: 'Unselected', titlePersian: 'انتخاب نشده', content: '', customerId: customer.id, departmentId: department.id, createdBy: actorId, responsibleSellerId: actorId } });
      if (process.env.PERSONAL_PICKUP_HTTP === '1') return {
        actorId, contractNumber: contract.contractNumber, loadingId: loading.id, itemId: item.id, unrelatedNumber: unrelated.contractNumber,
      };
      const select = (mode: 'PERSONAL' | 'DRIVERS') => selectLoadingTransport(client, { loadingId: loading.id, actorId, mode });
      const first = await select('PERSONAL'); assert.ok(first.turn);
      assert.equal((await select('PERSONAL')).turn?.id, first.turn.id);
      const allocate = (queueTurnId: string) => saveCanonicalAllocationDraft(client, { loadingId: loading.id, queueTurnId, actorId,
        lines: [{ sourceContractItemId: item.id, quantity: '1', unit: 'count' }] });
      await allocate(first.turn.id);
      await select('DRIVERS');
      assert.equal((await tx.logisticsLoadingLine.findFirstOrThrow({ where: { loadingId: loading.id } })).quantity.toString(), '0');
      assert.equal(await tx.logisticsAllocationDraft.count({ where: { loadingId: loading.id } }), 0);
      assert.equal((await tx.guardDriverQueueTurn.findUniqueOrThrow({ where: { id: first.turn.id } })).status, 'CLOSED_WITHOUT_LOADING');
      const selected = await select('PERSONAL'); assert.ok(selected.turn); const turn = selected.turn;
      assert.notEqual(turn.id, first.turn.id);
      assert.equal(await tx.guardDriverQueueEvent.count({ where: { turnId: turn.id, eventType: 'ADMITTED' } }), 0);
      const timeline = await getDispatchCaseTimeline(client, turn.id, { workspace: 'logistics', permission: 'edit' });
      assert.equal(timeline?.events.find(event => event.eventType === 'PERSONAL_PICKUP_SELECTED')?.station, 'LOGISTICS');
      await allocate(turn.id);
      const batch = await finalizeCanonicalLoadingAllocations(client, { loadingId: loading.id, idempotencyKey: 'personal-finalize', actorId,
        effectiveAuthority: { actorRole: 'ADMIN', workspace: 'logistics', workspacePermission: 'edit' } });
      const candidate = batch.revisions[0].candidate; assert.ok(candidate);
      const revision = await tx.logisticsAllocationRevision.findUniqueOrThrow({ where: { id: candidate.allocationRevisionId } });
      const summary = projectAccountingDispatchCandidateSummary(revision.snapshot);
      assert.deepEqual(summary.personalPickup?.contracts, [{ id: contract.id, number: contract.contractNumber }]);
      assert.ok(!JSON.stringify(summary).includes(unrelated.contractNumber));
      await assert.rejects(select('DRIVERS'), /پیش‌نویس/);
      await tx.$executeRawUnsafe('SAVEPOINT personal_cancellation');
      await cancelFinalizedOrdinaryLoading(client, { loadingId: loading.id, actorId, reason: 'لغو آزمون پیش از خروج' });
      assert.equal((await tx.guardDriverQueueTurn.findUniqueOrThrow({ where: { id: turn.id } })).status, 'CLOSED_WITHOUT_LOADING');
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT personal_cancellation');
      await decideAccountingDispatchCandidate(client, { candidateId: candidate.id, action: 'ACCEPT', idempotencyKey: 'personal-accept', actorId });
      const waybill = await tx.accountingDispatchWaybill.findFirstOrThrow({ where: { candidateId: candidate.id } });
      const confirmation = new DispatchConfirmationService(client, { connector: new Proxy({} as never, {
        get: () => assert.fail('No biometric connector access for personal pickup') }), vault: {} as never,
        otpSecret: randomUUID(), sendOtp: async () => assert.fail('No OTP for personal pickup') });
      const issue = () => confirmation.startSession({ waybillId: waybill.id, actorId, workstationId: 'ACCOUNTING-WEB' });
      await assert.rejects(issue(), /فاکتور/);
      assert.equal(await tx.dispatchExitAuthorization.count({ where: { waybillId: waybill.id } }), 0);
      await createSalesInvoiceService(client, async () => Buffer.from('test personal invoice'))
        .issue({ actorId, workspace: 'accounting' }, loading.id, 'personal-invoice');
      await tx.accountingFinancialRecord.update({ where: { id: finance.id }, data: { financiallyApprovedAt: null, financiallyApprovedBy: null } });
      await assert.rejects(issue(), /مالی/);
      await tx.accountingFinancialRecord.update({ where: { id: finance.id }, data: { financiallyApprovedAt: at, financiallyApprovedBy: actorId } });
      const financialCount = await tx.accountingFinancialRecord.count({ where: { contractId: contract.id } });
      const exit = await issue();
      assert.equal(exit.status, 'CONFIRMED'); assert.equal(exit.method, 'PERSONAL_PICKUP_ACCOUNTING');
      const repeated = await issue();
      assert.ok('authorization' in repeated && 'authorization' in exit);
      assert.deepEqual(repeated.authorization, exit.authorization);
      assert.equal(await tx.accountingFinancialRecord.count({ where: { contractId: contract.id } }), financialCount);
      assert.equal(await tx.dispatchPickupVerification.count({ where: { candidateId: candidate.id } }), 0);
      assert.equal(await tx.dispatchBiometricAttempt.count({ where: { sessionId: exit.id } }), 0);
      assert.equal(await tx.dispatchOtpChallenge.count({ where: { sessionId: exit.id } }), 0);
      const authorization = await tx.dispatchExitAuthorization.findUniqueOrThrow({ where: { sessionId: exit.id } });
      const gate = new PhysicalGateExitService(client, { sendBuyerSms: async message => {
        assert.equal(message.phoneNumber, '09123456789'); assert.equal(message.vehiclePlate, 'سواری شخصی');
        return { outcome: 'SENT', providerMessageId: 'personal-test' }; } });
      const authorized = (await gate.listCurrentlyAuthorized()).find(entry => entry.id === authorization.id);
      assert.deepEqual(authorized?.summary?.personalPickup?.contracts, [{ id: contract.id, number: contract.contractNumber }]);
      const command = { authorizationId: authorization.id, actorId, idempotencyKey: 'personal-exit', correlationId: randomUUID(), effectiveAuthority: { workspace: 'security' } };
      await tx.accountingFinancialRecord.update({ where: { id: finance.id }, data: { financiallyApprovedAt: null, financiallyApprovedBy: null } });
      await assert.rejects(gate.recordExit(command), /مالی/);
      assert.equal((await tx.dispatchExitAuthorization.findUniqueOrThrow({ where: { id: authorization.id } })).status, 'ACTIVE');
      await tx.accountingFinancialRecord.update({ where: { id: finance.id }, data: { financiallyApprovedAt: at, financiallyApprovedBy: actorId } });
      const physical = await gate.recordExit(command);
      assert.equal((await gate.recordExit(command)).id, physical.id);
      assert.equal((await tx.dispatchExitAuthorization.findUniqueOrThrow({ where: { id: authorization.id } })).status, 'CONSUMED');
      assert.equal(await tx.shipmentQuantityEvidence.count({ where: { contractId: contract.id, kind: 'PHYSICAL_EXIT' } }), 1);
      assert.ok(physical.smsIntent); assert.equal((await gate.deliverBuyerSms(physical.smsIntent.id)).status, 'SENT');
      assert.ok(!(await gate.listCurrentlyAuthorized()).some(entry => entry.id === authorization.id));
      const abandoned = await tx.logisticsLoading.create({ data: { loadingNumber: `PERSONAL-DISCARD-${randomUUID()}`, customerId: customer.id, projectId: project.id, createdBy: actorId } });
      const abandonedTurn = await selectLoadingTransport(client, { loadingId: abandoned.id, actorId, mode: 'PERSONAL' });
      assert.ok(abandonedTurn.turn);
      assert.equal(await retirePersonalLoadingDraft(tx, abandoned.id, actorId), true);
      assert.equal((await tx.logisticsLoading.findUniqueOrThrow({ where: { id: abandoned.id } })).status, 'CANCELLED');
      assert.equal((await tx.guardDriverQueueTurn.findUniqueOrThrow({ where: { id: abandonedTurn.turn.id } })).status, 'CLOSED_WITHOUT_LOADING');
      throw rollback;
    }, { timeout: 60_000 });
    if (fixture) execFileSync(process.execPath, [require.resolve('tsx/cli'), 'src/services/__tests__/personalPickupHttpProbe.ts'], {
      env: { ...process.env, PERSONAL_ORDINARY_FIXTURE: JSON.stringify(fixture) }, stdio: 'inherit', timeout: 120_000,
    });
  } catch (error) { if (error !== rollback) throw error;
    console.log('Personal selection, switch, selected contracts, financial/invoice gates, no OTP/biometrics, single exit and buyer SMS passed.');
  } finally { await db.$disconnect(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
