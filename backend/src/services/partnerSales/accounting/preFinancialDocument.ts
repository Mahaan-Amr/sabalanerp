import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { createAuditedPartnerAuthorization } from '../authorization/audited';
import { readPartnerCommercialState } from '../cases/commercialLifecycle';
import { projectPartnerInternalContent, partnerInternalPhysicalFacts } from './internalDocumentContent';
import { withAccountingReadScope } from './readScope';
import { prisma } from '../../../lib/prisma';

const object = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};

/** A read-only preparation projection, never a persisted financial record.
 * Retail rates, totals and customer payment terms are not returned. */
export async function readPartnerPreparationDocument(tx: Prisma.TransactionClient, actorId: string, caseId: string) {
  const allowed = await createAuditedPartnerAuthorization(tx, { actorId, purpose: 'ACCOUNTING', channel: 'LIST' },
    { correlationId: randomUUID() }).authorize('ACCOUNTING_READ', { kind: 'CASE', id: caseId });
  if (!allowed.ok) return null;
  const root = await tx.partnerSaleCase.findUnique({ where: { id: caseId }, include: {
    head: true, internalRecord: true, customerContract: true, trackingCode: true,
    profile: { include: { commercialAccount: true } },
  } });
  if (!root?.internalRecord || !root.customerContract) return null;
  const commercial = await readPartnerCommercialState(tx, caseId);
  if (!commercial) return null;
  const write = !root.customerContract.isInactive && commercial.status === 'FINAL' && (await createAuditedPartnerAuthorization(tx,
    { actorId, purpose: 'ACCOUNTING', channel: 'API' }, { correlationId: randomUUID(), reason: 'بررسی امکان ثبت مالی قرارداد قطعی همکار' })
    .authorize('ACCOUNTING_WRITE', { kind: 'CASE', id: caseId })).ok;
  const owner = { caseId, revision: root.headRevision, integrityHash: root.integrityHash };
  const projection = object(root.head.internalProjection);
  const accounting = object(projection.accounting), partner = object(projection.partner);
  const parties = object(root.head.partySnapshots), context = object(root.head.customerContent);
  const content = projectPartnerInternalContent({ partnerPreparation: { owner,
    products: accounting.products, totals: accounting.totals, paymentPlan: accounting.sabalanPaymentPlan } }, root.head.graph);
  const amountKnown = Boolean(content.totals);
  const items = amountKnown ? content.items : (Array.isArray(partner.products) ? partner.products : []).map((row: Record<string, any>) => ({
      ...partnerInternalPhysicalFacts(String(row.productRowId), root.head.graph),
      productCode: typeof row.productCode === 'string' ? row.productCode : partnerInternalPhysicalFacts(String(row.productRowId), root.head.graph).productCode,
      productRowId: String(row.productRowId), description: String(row.description), quantity: String(row.quantity),
      unit: String(row.unit), unitPrice: '0', totalPrice: '0',
    }));
  return { id: root.internalRecord.id, preparationOnly: true, amountKnown, commercial, canRegister: write,
    caseState: root.state, isInactive: root.customerContract.isInactive, owner, status: 'DRAFT', amount: content.totals?.payable ?? '0',
    receivedAmount: '0', remainingAmount: content.totals?.payable ?? '0', currency: 'IRT', createdAt: root.createdAt,
    systemInvoiceNumber: null, systemInvoiceDate: null, sepidarAmount: null, metadata: undefined,
    partnerContext: { caseId, caseNumber: root.caseNumber, trackingNumber: root.trackingCode?.number,
      customerContractNumber: root.customerContract.contractNumber, internalRecordNumber: root.internalRecord.recordNumber,
      partnerSellerId: root.profile.userId, commercialAccountId: root.profile.commercialAccount?.id ?? '',
      debtor: { displayName: String(object(parties.partner).displayName ?? '') },
      endCustomer: { displayName: String(object(parties.customer).displayName ?? '') }, revision: root.headRevision,
      actionUrl: `/dashboard/accounting/contracts/partner/${encodeURIComponent(caseId)}`, accountingWritable: false },
    ...content, items, contractDate: typeof context.contractDate === 'string' ? context.contractDate : undefined,
    project: context.project ? { title: String(object(context.project).title ?? ''), address: String(object(context.project).address ?? '') } : undefined,
    deliveries: (Array.isArray(context.deliveries) ? context.deliveries : []).map((value: unknown) => {
      const delivery = object(value);
      return { deliveryId: String(delivery.deliveryId), date: String(delivery.date), destination: String(delivery.destination),
        receiverName: typeof delivery.receiverName === 'string' ? delivery.receiverName : undefined,
        items: (Array.isArray(delivery.items) ? delivery.items : []).map((value: unknown) => { const item = object(value);
          return { productRowId: String(item.productRowId), quantity: String(item.quantity) }; }) };
    }),
    technicalEvidenceAvailable: true,
    receivables: [] as Array<{ id: string; status: string; paidAmount: string; remainingAmount: string; dueDate: Date; payments: Array<{ id: string; amount: string; method: string; status: string; occurredAt: Date | null }> }>,
    taxRecords: [] as Array<{ id: string; readinessStatus: string; submissionStatus: string; taxableAmount: string; vatAmount: string }>,
    flags: [] as Array<{ id: string; title: string; note: string | null; severity: string; status: string }>,
  };
}

export async function listPartnerPreparationDocuments(actorId: string, lifecycleView: 'active' | 'inactive' | 'pending' = 'active') {
  return withAccountingReadScope(prisma, { userId: actorId }, async scope => {
    const pending = lifecycleView === 'pending' ? await scope.database.contractLifecycleRequest.findMany({
      where: { status: 'PENDING' }, select: { contractId: true } }) : [];
    const roots = await scope.database.partnerSaleCase.findMany({ where: { commercialFlowVersion: 1,
      internalRecordId: { not: null }, customerContractId: { not: null }, customerContract: lifecycleView === 'pending'
        ? { id: { in: pending.map(row => row.contractId) } } : { isInactive: lifecycleView === 'inactive' } },
      select: { id: true }, orderBy: { id: 'asc' } });
    const documents: NonNullable<Awaited<ReturnType<typeof readPartnerPreparationDocument>>>[] = [];
    for (const root of roots) {
      const document = await readPartnerPreparationDocument(scope.database, actorId, root.id);
      if (document) documents.push(document);
    }
    return documents;
  });
}
