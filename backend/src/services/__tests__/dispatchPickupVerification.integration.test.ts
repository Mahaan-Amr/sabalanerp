import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { admitGuardDriverQueueTurn, makeGuardQueueTurnAvailable, reserveGuardQueueTurn } from '../guardDriverQueue';
import { decideAccountingDispatchCandidate, finalizeCanonicalLoadingAllocations, saveCanonicalAllocationDraft } from '../dispatchAllocation';
import { shipmentQuantityEvidenceIntegrityHash } from '../shipmentQuantityProjectionStore';
import { approvedPricingRowIntegrityHash, approvedPricingVersionIntegrityHash, canonicalApprovedPricingHash } from '../approvedPricing/domain';
import { PrismaApprovedPricingRepository } from '../approvedPricing/prismaRepository';
import { createSalesInvoiceService } from '../salesDispatchInvoice/service';
import { DispatchConfirmationService } from '../dispatchConfirmation';
import { processPickupVerification, requirePickupVerification } from '../dispatchPickupVerification';

const target = new URL(process.env.DATABASE_URL || 'postgresql://invalid');
assert.equal(target.hostname, '127.0.0.1');
assert.equal(target.port, '55432');
assert.equal(target.pathname, '/sabalanerp');

const db = new PrismaClient();
const rollback = Symbol('Customer pickup verification rollback');

async function main() {
  try {
    await db.$transaction(async tx => {
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
      const customer = await tx.crmCustomer.create({ data: { firstName: 'آزمون', lastName: 'متفرقه' } });
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
      const input = { actorId, source: 'CUSTOMER_PICKUP' as const, vehicleType: 'وانت',
        plate: '۱۲ ژ ۳۴۵ ایران ۶۷', phone: '۰۹۱۲۳۴۵۶۷۸۹' };
      await assert.rejects(admitGuardDriverQueueTurn(client, input), /پلاک/);
      const valid = { ...input, plate: '۱۲ ب ۳۴۵ ایران ۶۷' };
      await assert.rejects(admitGuardDriverQueueTurn(client, { ...valid, phone: '' }), /شماره همراه/);
      const turn = await admitGuardDriverQueueTurn(client, valid);
      assert.equal(turn.status, 'WAITING_AT_GATE');
      await assert.rejects(admitGuardDriverQueueTurn(client, { ...valid, plate: '12ب34567' }), /پذیرش باز/);
      await makeGuardQueueTurnAvailable(client, turn.id, actorId);
      const reserved = await reserveGuardQueueTurn(client, { turnId: turn.id, loadingId: loading.id, actorId });
      assert.equal(reserved.status, 'RESERVED_FOR_LOADING');

      await saveCanonicalAllocationDraft(client, { loadingId: loading.id, queueTurnId: turn.id, actorId,
        lines: [{ sourceContractItemId: item.id, quantity: '1.000', unit: 'count' }],
      });
      const batch = await finalizeCanonicalLoadingAllocations(client, {
        loadingId: loading.id, idempotencyKey: 'finalize-pickup-test', actorId,
        effectiveAuthority: { actorRole: 'ADMIN', workspace: 'logistics', workspacePermission: 'edit' },
      });
      const candidate = batch.revisions[0].candidate;
      assert.ok(candidate);
      assert.equal((await tx.guardDriverQueueTurn.findUniqueOrThrow({ where: { id: turn.id } })).status, 'LOADING_FINALIZED');
      const issue = () => decideAccountingDispatchCandidate(client, {
        candidateId: candidate.id, action: 'ACCEPT', idempotencyKey: 'pickup-test', actorId,
      });
      await assert.rejects(issue(), /کد پیامکی/);
      const check = () => requirePickupVerification(tx, candidate.id, turn.driverSource, Error);
      await assert.rejects(check(), /کد پیامکی/);

      let sentCode = '';
      const verification = { actorId, candidateId: candidate.id, secret: randomUUID(),
        authorizePartnerCase: async () => false,
        sendSms: async (phone: string, code: string, reference: string) => {
          assert.equal(phone, '09123456789');
          assert.equal(reference, loading.loadingNumber);
          sentCode = code;
          return true;
        },
      };
      assert.deepEqual(await processPickupVerification(client, { ...verification, command: 'SEND' }), { verified: false });
      assert.match(sentCode, /^\d{6}$/);
      await assert.rejects(processPickupVerification(client, { ...verification, command: 'SEND' }), /بیش از حد/);
      const wrongCode = sentCode === '000000' ? '999999' : '000000';
      await assert.rejects(processPickupVerification(client, { ...verification, command: 'VERIFY', code: wrongCode }), /درست نیست/);
      await assert.rejects(check(), /کد پیامکی/);
      assert.deepEqual(await processPickupVerification(client, { ...verification, command: 'VERIFY', code: sentCode }), { verified: true });
      assert.equal((await check())?.verifiedBy, actorId);

      await issue();
      const waybill = await tx.accountingDispatchWaybill.findFirstOrThrow({ where: { candidateId: candidate.id } });
      const invoices = createSalesInvoiceService(client, async () => Buffer.from('test sales invoice'));
      const invoiceContext = { actorId, workspace: 'accounting' as const };
      await invoices.issue(invoiceContext, loading.id, 'pickup-test-invoice');
      const invoiceList = await invoices.list(invoiceContext, loading.id);
      assert.deepEqual(invoiceList.invoices.map(invoice => invoice.status), ['ISSUED']);
      const confirmation = new DispatchConfirmationService(client, {
        connector: {} as never, vault: {} as never, otpSecret: verification.secret,
        sendOtp: async () => assert.fail('Exit must reuse the pickup verification'),
      });
      const exit = await confirmation.startSession({ waybillId: waybill.id, actorId, workstationId: 'ACCOUNTING-WEB' });
      assert.equal(exit.status, 'CONFIRMED');
      assert.equal(exit.method, 'CUSTOMER_PICKUP_OTP');
      const authorization = await tx.dispatchExitAuthorization.findUniqueOrThrow({ where: { sessionId: exit.id } });
      assert.equal(authorization.driverId, turn.id);
      assert.equal(await tx.dispatchBiometricAttempt.count({ where: { sessionId: exit.id } }), 0);
      throw rollback;
    }, { timeout: 30_000 });
  } catch (error) {
    if (error !== rollback) throw error;
    console.log('Customer pickup admission, finalization, OTP, waybill, invoice and exit authorization passed.');
  } finally {
    await db.$disconnect();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
