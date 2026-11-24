import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient, type Prisma } from '@prisma/client';
import { PartnerEventSchema, canonicalHash } from '@sabalanerp/partner-sales-contracts';
import { assertDispatchDocumentsMigrationTarget } from './dispatchDocumentsTemporaryDatabase';
import { seedHistoricalAccountingRead } from './partnerAccountingHistoricalReadSeed';
import { createSalesInvoiceService } from '../salesDispatchInvoice/service';
import { bytesHash } from '../salesDispatchInvoice/source';
import { renderSalesInvoice } from '../salesDispatchInvoice/render';
import { pricedAllocationIntegrityHash } from '../pricedAllocationLedger';

// Public issuance/download seam; only persistence fixture assembly and the PDF
// transport are adapted. All source, ownership, official-price and hash readers run.
const url = new URL(process.env.DATABASE_URL ?? '');
if (url.hostname !== '127.0.0.1' || url.port !== '55432')
  throw new Error('Use the existing sabalanerp-local database at 127.0.0.1:55432.');
const candidateDatabase = process.env.SABALAN_CANDIDATE_QA_DATABASE_NAME;
if (candidateDatabase) assertDispatchDocumentsMigrationTarget(url.toString(), candidateDatabase);
else if (url.pathname !== '/sabalanerp') throw new Error('Only the existing local database or a verified candidate QA clone is allowed.');
const db = new PrismaClient();
const rollback = Symbol('rollback Partner invoice acceptance');
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
async function run() {
  const before = await db.salesDispatchInvoice.count();
  try {
    await db.$transaction(async tx => {
      let invoiceNumber = 8000000n + BigInt(Math.floor(Math.random() * 1000000));
      const client = new Proxy(tx, { get(target, key, receiver) {
        if (key === '$transaction') return async (work: (value: unknown) => unknown) => work(client);
        if (key === '$queryRaw') return async (query: TemplateStringsArray, ...params: unknown[]) =>
          query.join('').includes("nextval('sales_dispatch_invoice_number_seq')")
            ? [{ number: invoiceNumber++ }] : (tx.$queryRaw as any)(query, ...params);
        return Reflect.get(target, key, receiver);
      } }) as unknown as PrismaClient;
      // Reuse the historical official-accounting fixture. Its fixture-only
      // replication mode avoids replaying unrelated lifecycle writers; switch
      // it off before exercising the public service and every integrity reader.
      const { fixture: f, actorId } = await seedHistoricalAccountingRead(client, undefined, false, {
        configureGraph: graph => {
          const commercial = graph.rows[0].commercial as Record<string, unknown>;
          commercial.requestedWidthMeters = '0.5';
          commercial.calculationSnapshot = { quantityMode: 'piece-count',
            cuttingPricingLines: [{ lineId: 'longitudinal-cut', quantity: '10', rateToman: '999991', amountToman: '9999910' }] };
          commercial.totalAmountToman = '999992';
        },
        wholesalePricing: { materialAmount: '1580', componentAmount: '20', totalAmount: '1600', mandatoryCharges: [],
          ancillaryCharges: [{ id: 'cut:longitudinal-cut', label: 'برش طولی', quantity: '10', unit: 'meter', unitPrice: '2', amount: '20' }] },
      });
      const preparation = f.invoice.sourceSnapshot.partnerPreparation;
      const owner = preparation.owner;
      const now = new Date(Date.now() - 1000);
      const approval = PartnerEventSchema.parse({ schemaVersion: 1, type: 'SABALAN_FINANCIAL_APPROVED',
        eventId: randomUUID(), commandId: randomUUID(), correlationId: randomUUID(), actorId,
        recordedAt: now.toISOString(), effectiveDate: now.toISOString().slice(0, 10), owner,
        internalRecordId: f.row.internalRecordId, accountingReceivableId: randomUUID(),
        financialApprovalEvidenceId: randomUUID(), amount: preparation.amount });
      assert.equal(approval.type, 'SABALAN_FINANCIAL_APPROVED');
      const { type: _type, schemaVersion: _schema, owner: _owner, internalRecordId: _internal,
        accountingReceivableId: _receivable, amount: _amount, ...approvalEvidence } = approval;
      await tx.accountingFinancialRecord.update({ where: { id: f.invoice.id }, data: {
        status: 'ISSUED', financiallyApprovedAt: now, financiallyApprovedBy: actorId,
        metadata: json({ partnerCaseId: owner.caseId, partnerApproval: approvalEvidence }),
      } });
      await tx.accountingReceivable.create({ data: { id: approval.accountingReceivableId,
        invoiceRecordId: f.invoice.id, originalAmount: preparation.amount.amount,
        remainingAmount: preparation.amount.amount, currency: preparation.amount.currency,
        dueDate: now, status: 'OPEN', createdBy: actorId,
        metadata: json({ partnerReceivable: { id: approval.accountingReceivableId,
          invoiceRecordId: f.invoice.id, internalRecordId: preparation.internalRecordId,
          partnerSellerId: preparation.debtor.partnerSellerId, commercialAccountId: preparation.debtor.commercialAccountId,
          owner, paymentPlan: preparation.paymentPlan, originalAmount: preparation.amount } }),
      } });
      await tx.partnerCaseEvent.create({ data: { id: approval.eventId, caseId: owner.caseId, caseRevision: 1,
        integrityHash: owner.integrityHash, sequence: 2, type: approval.type, actorId, commandId: approval.commandId,
        correlationId: approval.correlationId, effectiveDate: now, evidence: json({ publicEvent: approval }) } });
      const loading = await tx.logisticsLoading.create({ data: { loadingNumber: `PARTNER-INVOICE-${randomUUID()}`,
        customerId: 'historical-customer', status: 'FINALIZED', createdBy: actorId,
        sourceKind: 'PARTNER_CASE', partnerCaseId: owner.caseId, partnerCaseRevision: 1,
        partnerIntegrityHash: owner.integrityHash, partnerDeliveryId: 'fixture-delivery', partnerSourceSnapshot: {}, partnerSourceHash: randomUUID() } });
      const batch = await tx.logisticsAllocationBatch.create({ data: { loadingId: loading.id,
        idempotencyKey: randomUUID(), finalizedBy: actorId } });
      const driver = await tx.externalDriver.create({ data: { firstName: 'راننده', lastName: 'آزمون',
        nationalCode: randomUUID().replace(/\D/g, '').padEnd(10, '0').slice(0, 10), phone: '09120000000',
        statusRecordedBy: actorId, createdBy: actorId } });
      const vehicle = await tx.externalVehicle.create({ data: { vehicleType: 'آزمون', createdBy: actorId, statusRecordedBy: actorId } });
      const admission = { driver: { firstName: 'راننده', lastName: 'آزمون' }, plate: { plate: '۱۲الف۳۴۵' } };
      const turn = await tx.guardDriverQueueTurn.create({ data: { driverSource: 'EXTERNAL',
        externalDriverId: driver.id, externalVehicleId: vehicle.id, status: 'LOADING_FINALIZED',
        admittedBy: actorId, admissionSnapshot: json(admission), integrityHash: randomUUID(), loadingId: loading.id } });
      const snapshot = { loading: { id: loading.id, number: loading.loadingNumber,
        customer: { id: 'historical-customer', name: 'مشتری نهایی' } }, queueTurn: { admissionSnapshot: admission } };
      const revision = await tx.logisticsAllocationRevision.create({ data: { batchId: batch.id, loadingId: loading.id,
        queueTurnId: turn.id, revisionNumber: 1, snapshot: json(snapshot), integrityHash: randomUUID(), finalizedBy: actorId,
        sourceKind: 'PARTNER_CASE', partnerCaseId: owner.caseId, partnerInternalRecordId: f.row.internalRecordId,
        partnerCaseRevision: 1, partnerIntegrityHash: owner.integrityHash, partnerDeliveryId: 'fixture-delivery', sealedAt: now } });
      const row = preparation.products[0];
      const line = await tx.logisticsAllocationRevisionLine.create({ data: { revisionId: revision.id,
        sourceKind: 'PARTNER_CASE', partnerCaseId: owner.caseId,
        partnerCaseRevision: 1, partnerIntegrityHash: owner.integrityHash, partnerDeliveryId: 'fixture-delivery', partnerLineageId: randomUUID(),
        productRowId: row.productRowId, quantity: '1', unit: row.unit, snapshot: {}, integrityHash: randomUUID() } });
      const pricing = await tx.partnerAllocationRevisionPricing.create({ data: { allocationRevisionId: revision.id,
        caseId: owner.caseId, caseRevision: 1, integrityHash: owner.integrityHash, internalRecordId: f.row.internalRecordId,
        sourceFinancialRecordId: f.invoice.id, financialApprovalEvidenceId: approval.financialApprovalEvidenceId,
        preparationEvidenceHash: preparation.evidenceHash, readinessEvidenceHash: await canonicalHash({ schemaVersion: 1,
          purpose: 'PARTNER_SHIPMENT_PRICING_READY', owner, internalRecordId: preparation.internalRecordId,
          invoiceRecordId: f.invoice.id, financialApprovalEvidenceId: approval.financialApprovalEvidenceId,
          preparationEvidenceHash: preparation.evidenceHash }), currency: preparation.amount.currency,
        grossAmount: '800', discountAmount: '0', netAmount: '800', pricingIntegrityHash: randomUUID() } });
      const payload = { sourceKind: 'PARTNER_CASE' as const, caseId: owner.caseId, internalRecordId: f.row.internalRecordId,
        allocationRevisionLineId: line.id, productRowId: row.productRowId, quantity: '1.000', unit: row.unit,
        pricingVersionId: approval.financialApprovalEvidenceId, pricingRowId: row.approvalEvidenceId!,
        grossAmount: '800.000000000000', discountAmount: '0.000000000000', netAmount: '800.000000000000',
        consumesFinalRemainder: false, evidence: { ledgerSequence: 1, beforeQuantity: '0', afterQuantity: '1', contractedQuantity: '2' }, recordedBy: actorId };
      await tx.partnerPricedAllocationEvent.create({ data: { allocationRevisionLineId: line.id, pricingReferenceId: pricing.id,
        approvalEvidenceId: row.approvalEvidenceId!, quantity: '1', grossAmount: '800', discountAmount: '0', netAmount: '800',
        consumesFinalRemainder: false, evidence: payload.evidence, recordedBy: actorId, integrityHash: pricedAllocationIntegrityHash(payload) } });
      const candidate = await tx.accountingDispatchCandidate.create({ data: { allocationRevisionId: revision.id, status: 'ACCEPTED' } });
      await tx.accountingDispatchWaybill.create({ data: { candidateId: candidate.id, number: invoiceNumber++,
        snapshot: json(snapshot), integrityHash: randomUUID(), issuedBy: actorId } });
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'origin'");
      const service = createSalesInvoiceService(client, async (snapshot, reason) => Buffer.from(renderSalesInvoice(snapshot, reason)));
      const context = { actorId, workspace: 'accounting' as const };
      const issued = await service.issue(context, loading.id, randomUUID());
      const downloaded = await service.download(context, loading.id, issued.id);
      const html = Buffer.from(downloaded.bytes).toString();
      assert.match(html, /برش طولی/);
      assert.doesNotMatch(html, /999991|999992|۹۹۹٬۹۹۱|۹۹۹٬۹۹۲/,
        'retail graph amounts must never replace frozen wholesale service prices');
      // Independently worked example: one of two contracted meters owns 5 of
      // the recorded 10 service meters at 2 IRR/m; the approved cargo stays 800 IRR.
      const invoice = await service.list(context, loading.id);
      assert.equal(invoice.invoices[0].id, issued.id);
      assert.equal(invoice.invoices[0].status, 'ISSUED');
      const operation = [...html.matchAll(/<tr class="operation">([\s\S]*?)<\/tr>/g)]
        .find(match => match[1].includes('برش طولی'))?.[1];
      assert.ok(operation, 'download exposes the frozen cutting service');
      const cells = [...operation.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(match => match[1]);
      assert.deepEqual(cells.slice(4), ['—', '—', '—', '۵', '—', '۲ / متر طول', '۱۰'],
        'the shipped half has 5 service meters at the approved 2 IRR/m, totaling 10 IRR');
      assert.match(html, /مبلغ پرداختنی<\/td><td[^>]*>۸۰۰<\/td>/);
      assert.match(html, /همکار آزمایشی/);
      assert.equal((await service.download(context, loading.id, issued.id)).bytes.toString(), html,
        'successive downloads preserve the same approved quantities and charges');
      const saved = await tx.salesDispatchInvoice.findUniqueOrThrow({ where: { id: issued.id } });
      const oldSnapshot = structuredClone(saved.snapshot) as Record<string, any>;
      delete oldSnapshot.pdfLayoutVersion;
      for (const rows of Object.values(oldSnapshot.print.rows) as any[][])
        for (const row of rows) if (row.category === 'برش') row.linearMeasurement = '۹۹۹۹';
      const originalBytes = Buffer.from('original Partner historical invoice artifact');
      const legacyClient = new Proxy(client, { get(target, key, receiver) {
        if (key === '$transaction') return async (work: (value: unknown) => unknown) => work(legacyClient);
        if (key === 'salesDispatchInvoice') return { findFirst: async () => ({ ...saved,
          snapshot: oldSnapshot, pdf: originalBytes, pdfSha256: bytesHash(originalBytes) }) };
        return Reflect.get(target, key, receiver);
      } });
      const legacy = createSalesInvoiceService(legacyClient,
        async (snapshot, reason) => Buffer.from(renderSalesInvoice(snapshot, reason)));
      const refreshed = await legacy.download(context, loading.id, issued.id);
      assert.equal(refreshed.number, issued.number);
      assert.equal(Buffer.from(refreshed.bytes).toString(), html,
        'historical stale printable rows refresh from frozen Partner geometry and approved wholesale evidence');
      assert.equal(bytesHash((await legacy.download(context, loading.id, issued.id, false, true)).bytes), bytesHash(originalBytes),
        'the original artifact remains independently retrievable');
      console.log('Partner partial dispatch issue/download and historical refresh preserve service share, wholesale price and original artifact');
      throw rollback;
    }, { timeout: 60000, maxWait: 10000 });
  } catch (error) { if (error !== rollback) throw error; }
  finally { assert.equal(await db.salesDispatchInvoice.count(), before); await db.$disconnect(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
