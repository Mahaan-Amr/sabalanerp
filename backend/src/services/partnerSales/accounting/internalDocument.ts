import { FinancialRecordKind, Prisma } from '@prisma/client';
import { renderContractHtml, renderContractPdfHeaderTemplate, type ContractCustomPrintOptions, type ContractPrintVariant } from '../../../utils/printTemplate';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../../lib/prisma';
import { createAuditedPartnerAuthorization } from '../authorization/audited';
import { hasSharedOperationAuthority } from '../authorization/sharedOperationAuthority';
import { withAccountingReadScope } from './readScope';
import { PARTNER_INTERNAL_ACCOUNTING_SOURCE } from './source';
import { projectPartnerInternalContent } from './internalDocumentContent';
import { fillPartnerPrintCodes, readPartnerPrintCodes } from '../../../utils/partnerProductPrint';
import { RevisionRefSchema, FulfillmentViewSchema } from '@sabalanerp/partner-sales-contracts';
import { readPartnerRevisionProjections } from '../cases/lifecycle';
import { readPartnerCommercialState } from '../cases/commercialLifecycle';
import { readPartnerPreparationDocument } from './preFinancialDocument';
import { buildAccountingVoidWorkflow } from '../../accountingVoidWorkflow';
import { partnerCustomerPrintSelect, partnerPrintValue } from './customerPrintInformation';

/** Only the Sabalan-to-Partner financial source enters this document. */
export async function readPartnerInternalDocument(caseId: string, actorUserId: string) {
  return withAccountingReadScope(prisma, { userId: actorUserId }, async scope => {
    const records = await scope.database.accountingFinancialRecord.findMany({
      where: scope.financial({ kind: FinancialRecordKind.INVOICE_CANDIDATE,
        sourceKind: PARTNER_INTERNAL_ACCOUNTING_SOURCE, contractId: null, customerId: null }),
      include: { invoiceItems: true, receivables: { where: scope.receivable(),
        include: { paymentStatuses: { where: scope.payment() } } },
        taxRecords: { where: scope.tax() } },
    });
    const contextualized = await scope.contextualize('FINANCIAL', records);
    const caseRecords = contextualized.filter(item => item.partnerContext?.caseId === caseId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const record = caseRecords.find(item => item.status !== 'VOIDED') ?? caseRecords[0];
    if (!record?.partnerContext) return readPartnerPreparationDocument(scope.database, actorUserId, caseId);
    const snapshot = record.sourceSnapshot as { partnerPreparation?: { owner?: unknown } } | null;
    const owner = RevisionRefSchema.safeParse(snapshot?.partnerPreparation?.owner);
    const revision = owner.success ? await scope.database.partnerCaseRevision.findUnique({ where: {
      caseId_revision: { caseId: owner.data.caseId, revision: owner.data.revision } },
      select: { graph: true, integrityHash: true, partySnapshots: true, customerContent: true, internalProjection: true } }) : null;
    const matchingRevision = owner.success && revision?.integrityHash === owner.data.integrityHash ? revision : null;
    const content = projectPartnerInternalContent(record.sourceSnapshot, matchingRevision?.graph);
    const codes = await readPartnerPrintCodes(scope.database, matchingRevision?.graph);
    content.items = content.items.map(item => ({ ...item, productCode: item.productCode || item.printDetails?.code || codes.get(item.productRowId),
      ...(item.printDetails ? { printDetails: fillPartnerPrintCodes({ ...item.printDetails, code: item.printDetails.code || item.productCode }, codes) } : {}) }));
    const views = owner.success && matchingRevision ? await readPartnerRevisionProjections(scope.database, owner.data) : undefined;
    const projection = matchingRevision?.internalProjection as { fulfillment?: unknown } | null;
    const fulfillment = views ? FulfillmentViewSchema.safeParse(projection?.fulfillment) : undefined;
    const contextContent = matchingRevision?.customerContent as { contractDate?: string; project?: { title?: string; address?: string } } | undefined;
    const customerParty = (matchingRevision?.partySnapshots as { customer?: { phone?: string } } | undefined)?.customer;
    const sale = await scope.database.partnerSaleCase.findUnique({ where: { id: caseId }, select: { state: true, headRevision: true, integrityHash: true,
      customer: { select: partnerCustomerPrintSelect } } });
    const received = record.receivables.reduce((sum, row) => sum.add(row.paidAmount), new Prisma.Decimal(0));
    const remaining = record.receivables.length ? record.receivables.reduce((sum, row) => sum.add(row.remainingAmount), new Prisma.Decimal(0)) : record.amount;
    const flags = await scope.database.accountingContractFlag.findMany({
      where: { sourceFinancialRecordId: record.id }, orderBy: { createdAt: 'desc' } });
    const voidCases = await scope.database.accountingFinancialVoidCase.findMany({
      where: { sourceRecordId: { in: caseRecords.map(item => item.id) } }, orderBy: { startedAt: 'desc' } });
    const voidWorkflows = voidCases.map(voidCase => {
      const sourceRecord = caseRecords.find(item => item.id === voidCase.sourceRecordId)!;
      return buildAccountingVoidWorkflow({ voidCase, sourceRecord, receivables: sourceRecord.receivables,
        payments: sourceRecord.receivables.flatMap(item => item.paymentStatuses), taxRecords: sourceRecord.taxRecords });
    });
    if (record.status === 'VOIDED') {
      const preparation = await readPartnerPreparationDocument(scope.database, actorUserId, caseId);
      if (preparation) return { ...preparation, financialRecords: caseRecords.map(item => ({ id: item.id,
        status: item.status, amount: item.amount.toString(), currency: item.currency, systemInvoiceNumber: item.systemInvoiceNumber })), voidWorkflows };
    }
    return {
      financialRecords: caseRecords.map(item => ({ id: item.id, status: item.status, amount: item.amount.toString(),
        currency: item.currency, systemInvoiceNumber: item.systemInvoiceNumber })), voidWorkflows,
      commercial: await readPartnerCommercialState(scope.database, caseId), caseState: sale?.state, receivedAmount: received.toFixed(), remainingAmount: remaining.toFixed(),
      id: record.id, owner: sale ? { caseId, revision: sale.headRevision, integrityHash: sale.integrityHash } : undefined, status: record.status, amount: record.amount.toString(),
      currency: record.currency, createdAt: record.createdAt,
      systemInvoiceNumber: record.systemInvoiceNumber,
      systemInvoiceDate: record.systemInvoiceDate,
      sepidarAmount: record.sepidarAmount?.toString() ?? null,
      metadata: (record.metadata as { mode?: string } | null)?.mode === 'PARTNER_SHARED_CORRECTION_REPLACEMENT'
        ? { mode: 'PARTNER_SHARED_CORRECTION_REPLACEMENT' } : undefined,
      partnerContext: { ...record.partnerContext, endCustomer: { ...record.partnerContext.endCustomer,
        phone: typeof customerParty?.phone === 'string' ? customerParty.phone : undefined } },
      customerInformation: sale?.customer,
      ...content,
      contractDate: contextContent?.contractDate,
      project: contextContent?.project ? { title: contextContent.project.title, address: contextContent.project.address } : undefined,
      deliveries: fulfillment?.success ? fulfillment.data.deliveries : [],
      technicalEvidenceAvailable: Boolean(matchingRevision),
      items: content.items.length ? content.items : record.invoiceItems.map(item => ({ productRowId: undefined as string | undefined, description: item.description,
        quantity: item.quantity.toString(), unitPrice: item.unitPrice.toString(),
        totalPrice: item.totalPrice.toString(), unit: '', details: [] as string[] })),
      receivables: record.receivables.map(item => ({ id: item.id, status: item.status,
        paidAmount: item.paidAmount.toString(), remainingAmount: item.remainingAmount.toString(),
        dueDate: item.dueDate,
        payments: item.paymentStatuses.map(payment => ({ id: payment.id, amount: payment.amount.toString(),
          method: payment.method, status: payment.status, occurredAt: payment.occurredAt })) })),
      taxRecords: record.taxRecords.map(item => ({ id: item.id, readinessStatus: item.readinessStatus,
        submissionStatus: item.submissionStatus, taxableAmount: item.taxableAmount.toString(),
        vatAmount: item.vatAmount.toString() })),
      flags: flags.map(flag => ({ id: flag.id, title: flag.title, note: flag.note,
        severity: flag.severity, status: flag.status })),
    };
  });
}

/** Resolve the internal financial record under the same Partner read and write
 * authority. The customer contract ID is only a duty/flag correlation key;
 * retail amounts never enter this command boundary. */
export async function withPartnerInternalAccountingTarget<T>(caseId: string, actorUserId: string,
  work: (database: Prisma.TransactionClient, target: { customerContractId: string;
    invoiceRecordId: string }) => Promise<T>): Promise<T | null> {
  return withAccountingReadScope(prisma, { userId: actorUserId }, async scope => {
    const sale = await scope.database.partnerSaleCase.findUnique({ where: { id: caseId },
      select: { customerContractId: true, internalRecordId: true, state: true } });
    if (!sale?.customerContractId || !sale.internalRecordId || sale.state !== 'COMMITTED') return null;
    const invoices = await scope.database.accountingFinancialRecord.findMany({
      where: scope.financial({ kind: FinancialRecordKind.INVOICE_CANDIDATE,
        sourceKind: PARTNER_INTERNAL_ACCOUNTING_SOURCE, sourceId: sale.internalRecordId,
        contractId: null, customerId: null }), select: { id: true } });
    const authorized = await scope.contextualize('FINANCIAL', invoices);
    const invoice = authorized.find(item => item.partnerContext?.caseId === caseId);
    if (!invoice) return null;
    const authority = createAuditedPartnerAuthorization(scope.database,
      { actorId: actorUserId, purpose: 'ACCOUNTING', channel: 'API' },
      { correlationId: randomUUID(), reason: 'ثبت اقدام حسابداری سند داخلی همکار' });
    if (!(await authority.authorize('ACCOUNTING_WRITE', { kind: 'CASE', id: caseId })).ok) return null;
    if (!await hasSharedOperationAuthority(scope.database, actorUserId, 'accounting', 'accounting_actions_manage')) return null;
    return work(scope.database, { customerContractId: sale.customerContractId, invoiceRecordId: invoice.id });
  });
}

/** A fresh allowlisted input to the ordinary Sabalan print template. Never pass
 * the linked customer contract or its graph/commercial envelopes to the printer. */
export function partnerInternalPrintInput(document: NonNullable<Awaited<ReturnType<typeof readPartnerInternalDocument>>>) {
  const totals = document.totals;
  const customer = document.customerInformation;
  const deliveryManagers = [...new Set((document.deliveries || []).map(delivery => delivery.projectManagerName?.trim()).filter(Boolean))];
  const managerName = deliveryManagers.length ? deliveryManagers.join('، ') : customer?.projectManagerName;
  return {
    contractNumber: document.partnerContext.customerContractNumber,
    titlePersian: 'سند داخلی فروش سبلان به همکار', partnerCommercialStatus: document.commercial?.status, status: document.caseState === 'COMMITTED' ? 'SIGNED' : 'DRAFT',
    createdAt: document.contractDate || document.createdAt, currency: document.currency == 'IRT' ? 'تومان' : document.currency == 'IRR' ? 'ریال' : document.currency,
    totalAmount: Number(document.amount), customer: { firstName: partnerPrintValue(document.partnerContext.endCustomer.displayName),
      nationalCode: partnerPrintValue(customer?.nationalCode),
      companyName: partnerPrintValue(customer?.companyName?.trim() || customer?.brandName),
      phoneNumbers: [{ number: partnerPrintValue(document.partnerContext.endCustomer.phone), isPrimary: true }] },
    items: document.items.map(item => ({ productRowId: item.productRowId,
      product: { namePersian: item.description, code: item.productCode }, description: (item.details || []).join('، '),
      quantity: Number(item.quantity), pieceCount: Number('pieceCount' in item ? item.pieceCount ?? item.quantity : item.quantity),
      billingUnit: item.unit, productType: 'productType' in item ? item.productType : undefined,
      length: 'lengthMeters' in item ? Number(item.lengthMeters) : undefined, lengthUnit: 'm',
      width: 'widthMeters' in item ? Number(item.widthMeters) : undefined, widthUnit: 'm',
      squareMeters: 'areaSquareMeters' in item ? Number(item.areaSquareMeters) : undefined,
      dimensions: (item.details || []).filter(detail => /^(طول|عرض|مساحت):/.test(detail)).join('، '),
      unitPrice: Number(item.unitPrice), totalPrice: Number(item.totalPrice),
      ...('wholesalePricing' in item && item.wholesalePricing ? { frozenPricingBreakdown: item.wholesalePricing } : {}),
      ...('printDetails' in item && item.printDetails ? { partnerPrintDetails: item.printDetails } : {}) })),
    contractData: {
      project: { projectName: partnerPrintValue(document.project?.title), address: partnerPrintValue(document.project?.address),
        projectManagerName: partnerPrintValue(managerName), projectManagerNumber: partnerPrintValue(customer?.projectManagerNumber) },
      discount: { amount: Number(totals?.discount || 0), inputMode: 'AMOUNT_TOMAN' },
      deliveries: (document.deliveries || []).map(delivery => ({ deliveryDate: delivery.date,
        deliveryAddress: delivery.destination, receiverName: delivery.receiverName, projectManagerName: delivery.projectManagerName,
        products: delivery.items.map(line => ({ productRowId: line.productRowId, quantity: Number(line.quantity), amount: Number(line.quantity),
          unit: document.items.find(item => item.productRowId === line.productRowId)?.unit,
          productName: document.items.find(item => item.productRowId === line.productRowId)?.description })) })),
      payment: { payments: (document.paymentPlan?.installments || []).map(item => ({
        method: item.method, amount: Number(item.amount.amount), paymentDate: item.dueDate,
        checkNumber: item.check?.number, checkOwnerName: item.check?.ownerName, status: 'PENDING' })) },
    },
  };
}

export function renderPartnerInternalDocumentHtml(document: NonNullable<Awaited<ReturnType<typeof readPartnerInternalDocument>>>,
  options: { variant?: ContractPrintVariant; customPrint?: ContractCustomPrintOptions } = {}) {
  const input = partnerInternalPrintInput(document);
  const variant = options.variant || 'accounting';
  const showMoney = !('amountKnown' in document && document.amountKnown === false) && variant !== 'workshop' && options.customPrint?.showPrices !== false && options.customPrint?.showTotals !== false;
  const unpriced = 'amountKnown' in document && document.amountKnown === false;
  const html = renderContractHtml(input, { ...options, variant, displayInRials: true, reservePdfHeaderSpace: true,
    ...(unpriced ? { unavailableMoneyLabel: 'در انتظار استعلام' } : {}) });
  const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
  const grouped = (value: Prisma.Decimal) => {
    const [whole, fraction] = value.toFixed().split('.');
    return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction ? `.${fraction}` : '');
  };
  const amount = (value: string) => grouped(new Prisma.Decimal(value).mul(document.currency === 'IRT' ? 10 : 1));
  const currencyLabel = 'ریال';
  const totals = document.totals;
  const internalSection = `<section class="section" style="break-inside:avoid;page-break-inside:avoid"><h2>سند داخلی فروش سبلان به همکار</h2>
    ${variant !== 'workshop' && options.customPrint?.showCustomerSection !== false ? `<div>طرف‌حساب سبلان: ${escape(document.partnerContext.debtor.displayName)}</div>
    <div>مشتری نهایی مرتبط: ${escape(document.partnerContext.endCustomer.displayName)}</div>` : ''}
    <div>سند داخلی: ${escape(document.partnerContext.internalRecordNumber)}</div>
    ${totals && showMoney ? `<div>جمع اقلام: ${amount(totals.net)} ${currencyLabel} · تخفیف: ${amount(totals.discount)} ${currencyLabel} · مالیات: ${amount(totals.tax)} ${currencyLabel} · هزینه‌های جانبی: ${amount(totals.charges)} ${currencyLabel}</div>` : ''}
    ${showMoney ? `<strong>جمع خرید از سبلان: ${amount(document.amount)} ${currencyLabel} (${grouped(new Prisma.Decimal(document.amount).div(document.currency === 'IRR' ? 10 : 1))} تومان)</strong>` : unpriced && variant !== 'workshop' && options.customPrint?.showPrices !== false && options.customPrint?.showTotals !== false ? '<strong>جمع خرید از سبلان: در انتظار استعلام</strong>' : ''}
    ${variant !== 'workshop' && options.customPrint?.showPaymentSection !== false && !document.paymentPlan?.installments.length ? '<div>برنامه پرداخت به سبلان هنوز ثبت نشده است.</div>' : ''}
    ${document.technicalEvidenceAvailable === false ? '<div>جزئیات فنی نسخه قطعی در دسترس نیست.</div>' : ''}
  </section>`;
  return html.replace('<footer class="footer">', internalSection + '<footer class="footer">');
}

export function renderPartnerInternalDocumentHeader(document: NonNullable<Awaited<ReturnType<typeof readPartnerInternalDocument>>>) {
  return renderContractPdfHeaderTemplate(partnerInternalPrintInput(document));
}
