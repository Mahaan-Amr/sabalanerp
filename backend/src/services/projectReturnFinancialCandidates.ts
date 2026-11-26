import type { AccountingFinancialRecord, Prisma } from '@prisma/client';
import { PartnerEventSchema } from '@sabalanerp/partner-sales-contracts';
import { pricingCurrencyKind } from './approvedPricing/domain';
import { exactQuantityText, ExactQuantityDecimal, formatExactQuantityAtoms, parseExactQuantityAtoms } from './exactQuantity';
import { inferLogisticsContractUnit, resolveLogisticsContractRow } from './logisticsContractRow';
import { PartnerAccountingCommandError } from './partnerSales/accounting/errors';
import { validatePendingPartnerApproval } from './partnerSales/accounting/financialApproval';
import { readPartnerInvoiceSource } from './partnerSales/accounting/invoiceSource';
import { hasConflictingPartnerAccountingEvidence } from './partnerSales/accounting/provenance';
import { PartnerOfficialAccountingIntegrityError, latestPartnerFinancialApproval, readPartnerOfficialPurchase } from './partnerSales/accounting/officialPurchase';
import { readCurrentPartnerCaseViews } from './partnerSales/cases/lifecycle';
import { partnerContractWasDeleted } from './partnerSales/cases/operationalDeletion';
import { stoneReturnEvidenceRecord as record, type ProjectReturnContractSource } from './projectReturnDispatch';
import { hasValidPersistedSalesShipmentEvidenceHash } from './shipmentQuantityProjectionStore';
import type { StoneReturnCandidate } from './stoneReturnCandidates';
import { stoneReturnLineKey, type FinancialAllocationSource } from './stoneReturnAllocationRules';

type Tx = Prisma.TransactionClient;
export type PartnerProjectReturnSource = {
  projectId: string; contractId: string; partnerCaseId: string; partnerRevision: number; productRowId: string;
};
export type CapturedProjectReturnSource = ProjectReturnContractSource | PartnerProjectReturnSource;
type Party = { kind: 'CUSTOMER' | 'PARTNER'; id: string };
export type FinancialProjectReturnCandidate = FinancialAllocationSource & Pick<StoneReturnCandidate,
  'contractId' | 'contractNumber' | 'productRowId' | 'unit' | 'contractDate' | 'contractCreatedAt' | 'sellerName'
  | 'originalInvoicedQuantity' | 'linePriorReturnedQuantity' | 'lineRemainingQuantity' | 'remainingQuantity'> & {
  projectId: string; contractItemId: string | null; partnerCaseId: string | null; financialParty: Party;
  originalInvoiceNumber: string; originalNetRateRials: string | null; dispatchEvidenceId: null;
  financialQuantityEvidenceId?: string;
};
type Scope = {
  customerId: string; productId: string; unit: string; projectIds: string[];
  before: Date; contractSources?: CapturedProjectReturnSource[];
};

const issued = (row: AccountingFinancialRecord, before: Date) =>
  ['ISSUED', 'POSTED'].includes(row.status) && !row.voidedAt && row.financiallyApprovedAt
  && row.financiallyApprovedAt <= before && !!row.financiallyApprovedBy && !!row.systemInvoiceNumber;

const moneyRials = (amount: string, currency: string) => {
  try {
    const kind = currency === 'IRR' ? 'RIAL' : currency === 'IRT' ? 'TOMAN' : pricingCurrencyKind(currency);
    const factor = kind === 'TOMAN' ? 10 : 1;
    return new ExactQuantityDecimal(amount).mul(factor);
  } catch {
    return null;
  }
};

const quantityAtoms = (value: string | Prisma.Decimal) => parseExactQuantityAtoms(exactQuantityText(value));
const saleRowKey = (row: { contractId: string; productRowId: string }) => stoneReturnLineKey(row.contractId, row.productRowId);

function capacity(quantity: string | Prisma.Decimal, returned: bigint, unit: string) {
  const approved = quantityAtoms(quantity);
  if (approved <= 0n || returned < 0n || (unit === 'count' && !exactQuantityText(quantity).endsWith('.000'))) return null;
  const remaining = returned < approved ? approved - returned : 0n;
  return {
    originalInvoicedQuantity: formatExactQuantityAtoms(approved), linePriorReturnedQuantity: formatExactQuantityAtoms(returned),
    lineRemainingQuantity: formatExactQuantityAtoms(remaining), remainingQuantity: formatExactQuantityAtoms(remaining),
  };
}

async function returnedQuantities(tx: Tx, contractIds: string[], customerId: string) {
  const commercial = await tx.accountingCommercialCustomerInvoice.findMany({
    where: { contractId: { in: contractIds }, referenceInvoiceId: null,
      profile: { partySourceKind: 'CUSTOMER', partySourceId: customerId } },
    select: { id: true, contractId: true },
  });
  const contractsByReference = new Map(commercial.map(row => [row.id, row.contractId]));
  if (!contractsByReference.size) return new Map<string, bigint>();
  const previous = await tx.accountingReturnEvidenceConsumption.groupBy({
    where: { originalInvoiceId: { in: [...contractsByReference.keys()] } },
    by: ['originalInvoiceId', 'productRowId'], _sum: { quantity: true },
  });
  const quantities = new Map<string, bigint>();
  for (const row of previous) {
    const contractId = contractsByReference.get(row.originalInvoiceId);
    if (!contractId || !row._sum.quantity) continue;
    const key = saleRowKey({ contractId, productRowId: row.productRowId });
    quantities.set(key, (quantities.get(key) ?? 0n) + quantityAtoms(row._sum.quantity));
  }
  return quantities;
}

async function directCandidates(tx: Tx, scope: Scope, existing: StoneReturnCandidate[]) {
  const items = await tx.contractItem.findMany({
    where: {
      productId: scope.productId, retiredAt: null, productRowId: { not: null },
      contract: { customerId: scope.customerId, partnerCaseId: null, partnerKind: null,
        OR: scope.projectIds.map(projectId => ({ contractData: { path: ['projectId'], equals: projectId } })) },
    },
    include: { contract: { select: { id: true, contractNumber: true, contractData: true, createdAt: true,
      realizedSeller: { select: { firstName: true, lastName: true } },
      responsibleSeller: { select: { firstName: true, lastName: true } },
    } } },
  });
  const physicalRows = new Set(existing.map(saleRowKey));
  const eligible = items.filter(item => {
    const projectId = record(item.contract.contractData).projectId;
    return item.productRowId && !physicalRows.has(saleRowKey({ ...item, productRowId: item.productRowId }))
      && (scope.contractSources === undefined || scope.contractSources.some(source =>
        'contractItemId' in source && !source.dispatchEvidenceId && source.contractItemId === item.id
        && source.contractId === item.contractId && source.projectId === projectId && source.productRowId === item.productRowId));
  });
  if (!eligible.length) return [];

  const contractIds = [...new Set(eligible.map(item => item.contractId))];
  const financial = await tx.accountingFinancialRecord.findMany({
    where: { contractId: { in: contractIds }, customerId: scope.customerId, sourceKind: 'SALES_CONTRACT', kind: 'INVOICE_CANDIDATE' },
    include: { invoiceItems: true },
    orderBy: [{ financiallyApprovedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
  });
  const ownedFinancial = financial.filter(row => row.sourceId === row.contractId
    && !hasConflictingPartnerAccountingEvidence(row));
  const [returned, captured] = await Promise.all([
    returnedQuantities(tx, contractIds, scope.customerId),
    tx.shipmentQuantityEvidence.findMany({ where: {
      sourceKind: 'SALES_CONTRACT', contractItemId: { in: eligible.map(item => item.id) }, unit: scope.unit,
      kind: 'CONTRACTED_SET', sourceType: 'FINANCIALLY_APPROVED_CONTRACT_QUANTITY_VERSION', sourceVersion: 1,
    } }),
  ]);
  const candidates: FinancialProjectReturnCandidate[] = [];
  for (const item of eligible) {
    const { contract, productRowId, id: contractItemId } = item;
    const projectId = record(contract.contractData).projectId;
    if (!productRowId || typeof projectId !== 'string') continue;
    for (const invoice of ownedFinancial) {
      if (invoice.contractId !== contract.id || !issued(invoice, scope.before)) continue;
      const snapshot = record(invoice.sourceSnapshot);
      const frozen = record(snapshot.contractData);
      if (snapshot.id !== contract.id || snapshot.customerId !== scope.customerId || frozen.projectId !== projectId) continue;
      let frozenCatalogId: unknown;
      try {
        const frozenRow = resolveLogisticsContractRow(frozen, { id: contractItemId, productId: scope.productId, productRowId });
        const frozenItem = (Array.isArray(snapshot.items) ? snapshot.items.map(record) : []).find(row => row.id === contractItemId);
        const productType = typeof frozenItem?.productType === 'string' ? frozenItem.productType : null;
        if (inferLogisticsContractUnit({ productType }, frozenRow) !== scope.unit) continue;
        frozenCatalogId = frozenRow.productId ?? frozenItem?.productId;
        if (frozenCatalogId != null && frozenCatalogId !== scope.productId) continue;
      } catch {
        continue;
      }

      const exactLines = invoice.invoiceItems.filter(line => line.contractItemId === contractItemId);
      if (exactLines.length > 1 || (exactLines[0] && exactLines[0].productId !== scope.productId)
        || (!exactLines.length && invoice.invoiceItems.length)) continue;
      const approval = invoice.financiallyApprovedAt!.toISOString();
      const capture = captured.find(evidence => evidence.contractId === contract.id && evidence.contractItemId === contractItemId
        && evidence.productRowId === productRowId && record(evidence.metadata).financiallyApprovedAt === approval
        && record(evidence.metadata).financialRecordId === invoice.id && evidence.sourceId === `${invoice.id}:${contractItemId}`
        && evidence.effectiveAt.toISOString() === approval && hasValidPersistedSalesShipmentEvidenceHash(evidence));
      const [line] = exactLines;
      // A contract-quantity capture covers the whole contract. Other invoice
      // modes need the exact financial line to establish the amount covered.
      const wholeContract = ['FROM_CONTRACT_TOTAL', 'REPLACEMENT_AFTER_CORRECTION'].includes(String(record(invoice.metadata).mode));
      const quantityEvidence = wholeContract ? capture : undefined;
      if (!line && (!quantityEvidence || frozenCatalogId !== scope.productId)) continue;
      const quantity = quantityEvidence?.quantity ?? line.quantity;
      const limits = capacity(quantity, returned.get(saleRowKey({ contractId: contract.id, productRowId })) ?? 0n, scope.unit);
      if (!limits) continue;
      const rate = line && moneyRials(line.unitPrice.toFixed(), invoice.currency);
      const seller = contract.realizedSeller ?? contract.responsibleSeller;
      candidates.push({
        financialRecordId: invoice.id, financialLineId: line?.id ?? quantityEvidence!.id,
        ...(quantityEvidence && { financialQuantityEvidenceId: quantityEvidence.id }),
        financialParty: { kind: 'CUSTOMER', id: scope.customerId }, originalInvoiceNumber: invoice.systemInvoiceNumber!,
        contractId: contract.id, contractItemId, contractNumber: contract.contractNumber, productRowId, projectId,
        partnerCaseId: null, dispatchEvidenceId: null, unit: scope.unit, ...limits,
        originalNetRateRials: rate?.gte(0) ? rate.toFixed() : null,
        contractDate: typeof frozen.contractDate === 'string' ? frozen.contractDate : null,
        contractCreatedAt: contract.createdAt.toISOString(),
        sellerName: seller ? [seller.firstName, seller.lastName].filter(Boolean).join(' ').trim() || null : null,
      });
      // Reissues are alternate evidence for one sale row, never cumulative capacity.
      break;
    }
  }
  return candidates;
}

function ownsPartnerRow(graph: unknown, productRowId: string, productId: string) {
  const rows = record(graph).rows;
  return Array.isArray(rows) && rows.map(record).some(row => row.productRowId === productRowId && row.catalogProductId === productId);
}

async function readApprovedPartnerReturnInvoice(tx: Tx, caseId: string, internalRecordId: string, before: Date) {
  const [events, financial] = await Promise.all([
    tx.partnerCaseEvent.findMany({ where: { caseId, type: 'SABALAN_FINANCIAL_APPROVED' }, select: { evidence: true } }),
    tx.accountingFinancialRecord.findMany({
      where: { sourceKind: 'PARTNER_INTERNAL_RECORD', sourceId: internalRecordId, kind: 'INVOICE_CANDIDATE',
        contractId: null, customerId: null, metadata: { path: ['partnerCaseId'], equals: caseId } },
      include: { _count: { select: { receivables: true } } },
    }),
  ]);
  const approval = latestPartnerFinancialApproval(events.flatMap(event => {
    const parsed = PartnerEventSchema.safeParse(record(event.evidence).publicEvent);
    return parsed.success ? [parsed.data] : [];
  }));
  try {
    if (approval && new Date(approval.recordedAt) <= before) {
      const now = new Date();
      const result = await readPartnerOfficialPurchase(tx, { internalRecordId, approval, cutoff: now, asOf: now, voided: false });
      const proof = result.official?.invoice;
      const invoice = financial.find(row => row.id === proof?.invoiceRecordId);
      if (result.covered && proof && invoice && issued(invoice, before)) return { invoice, preparation: proof.preparation };
    }

    // Financial approval and creating a receivable are separate Partner actions.
    // A sealed approved invoice can back a draft before a payable is published.
    const pending = financial.filter(row => issued(row, before) && record(row.metadata).partnerReceivablePending === true
      && row._count.receivables === 0);
    if (pending.length !== 1) return null;
    const [invoice] = pending;
    await validatePendingPartnerApproval(invoice);
    const { preparation } = await readPartnerInvoiceSource(tx, invoice, caseId);
    return { invoice, preparation };
  } catch (error) {
    if (!(error instanceof PartnerOfficialAccountingIntegrityError) && !(error instanceof PartnerAccountingCommandError)) throw error;
    return null;
  }
}

async function partnerCandidates(tx: Tx, scope: Scope) {
  const captured = scope.contractSources?.filter((source): source is PartnerProjectReturnSource => 'partnerCaseId' in source);
  if (captured && !captured.length) return [];
  const cases = await tx.partnerSaleCase.findMany({
    where: { state: 'COMMITTED', customerId: scope.customerId, customerContract: { is: { isInactive: false } },
      ...(captured && { id: { in: [...new Set(captured.map(source => source.partnerCaseId))] } }),
      OR: scope.projectIds.map(projectId => ({ head: { customerContent: { path: ['projectId'], equals: projectId } } })),
    },
    select: { id: true, customerContractId: true, internalRecordId: true, createdAt: true,
      profile: { select: { user: { select: { firstName: true, lastName: true } } } } },
  });
  const candidates: FinancialProjectReturnCandidate[] = [];
  for (const source of cases) {
    const { id: caseId, customerContractId: contractId, internalRecordId } = source;
    if (!contractId || !internalRecordId || await partnerContractWasDeleted(tx, contractId)) continue;
    const view = await readCurrentPartnerCaseViews(tx, caseId);
    const projectId = record(view?.row.head.customerContent).projectId;
    const contractNumber = view?.partner.customerContractNumber;
    if (!view?.accounting || !contractNumber || view.row.customerContractId !== contractId || view.row.internalRecordId !== internalRecordId
      || typeof projectId !== 'string' || !scope.projectIds.includes(projectId)) continue;
    const approved = await readApprovedPartnerReturnInvoice(tx, caseId, internalRecordId, scope.before);
    if (!approved || approved.preparation.debtor.commercialAccountId !== view.accounting.commercialAccountId) continue;
    const { invoice, preparation } = approved;
    // The wholesale invoice belongs to Sabalan's relationship with the Partner.
    // The retail customer contract establishes receipt scope and catalog identity.
    const revision = await tx.partnerCaseRevision.findUnique({ where: { caseId_revision: {
      caseId, revision: preparation.owner.revision,
    } }, select: { graph: true, customerContent: true } });
    if (!revision || record(revision.customerContent).projectId !== projectId) continue;
    for (const row of preparation.products) {
      const unit = row.unit === 'm' ? 'meter' : row.unit;
      if (unit !== scope.unit || !ownsPartnerRow(revision.graph, row.productRowId, scope.productId)
        || !ownsPartnerRow(view.row.head.graph, row.productRowId, scope.productId)
        || (captured && !captured.some(entry => entry.contractId === contractId && entry.partnerCaseId === caseId
          && entry.projectId === projectId && entry.productRowId === row.productRowId))) continue;
      const limits = capacity(row.quantity, 0n, unit);
      if (!limits) continue;
      candidates.push({
        financialRecordId: invoice.id, financialLineId: row.productRowId, financialParty: { kind: 'PARTNER', id: preparation.debtor.commercialAccountId },
        originalInvoiceNumber: invoice.systemInvoiceNumber!, originalNetRateRials: moneyRials(row.wholesaleUnitPrice, invoice.currency)?.toFixed() ?? null,
        contractId, contractItemId: null, contractNumber, projectId, productRowId: row.productRowId, partnerCaseId: caseId,
        dispatchEvidenceId: null, unit, ...limits, contractCreatedAt: source.createdAt.toISOString(),
        sellerName: [source.profile.user.firstName, source.profile.user.lastName].filter(Boolean).join(' ').trim() || null,
      });
    }
  }
  return candidates;
}

export async function loadProjectReturnFinancialCandidates(tx: Tx, scope: Scope, existing: StoneReturnCandidate[]) {
  if (!scope.projectIds.length) return [];
  const [direct, partner] = await Promise.all([directCandidates(tx, scope, existing), partnerCandidates(tx, scope)]);
  return [...direct, ...partner];
}
