import { Prisma } from '@prisma/client';
import { CustomerContractOutputSchema } from '@sabalanerp/partner-sales-contracts';
import { authorizePartnerSalesCaseRead } from './partnerSales/cases/contractDetail';
import { readCurrentPartnerCaseViews } from './partnerSales/cases/lifecycle';
import { partnerCustomerPrintDetails } from '../utils/partnerProductPrint';
import { salesContractAccessWhere } from './salesContractAccess';
import { commercialDeadlinePassed } from './ordinaryContractLifecycle';

const select = {
  id: true, contractNumber: true, createdAt: true, status: true, isInactive: true,
  commercialFlowVersion: true, commercialExpiresAt: true, firstFinancialRecordAt: true, dispatchExpiryExempt: true,
  partnerKind: true, partnerCaseId: true, partnerRevision: true, partnerIntegrityHash: true,
  contractData: true, currency: true,
  productGraphState: { select: { graph: true } },
  items: { where: { retiredAt: null }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: {
    id: true, productRowId: true, productId: true, productType: true, quantity: true,
    totalPrice: true, originalTotalPrice: true, isMandatory: true, mandatoryPercentage: true,
    product: { select: { namePersian: true } },
  } },
} satisfies Prisma.SalesContractSelect;

type Contract = Prisma.SalesContractGetPayload<{ select: typeof select }>;
type Db = Prisma.TransactionClient;
type Actor = { id: string; role: string; departmentId?: string | null };
type RecordValue = Record<string, unknown>;
const object = (value: unknown): RecordValue =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
const records = (value: unknown) => Array.isArray(value) ? value.map(object) : [];
const str = (...values: unknown[]) => values.find((value): value is string =>
  typeof value === 'string' && value.trim().length > 0);
const Decimal = Prisma.Decimal.clone({ precision: 90 });
const amount = (value: unknown) => {
  if (typeof value !== 'string' && typeof value !== 'number' && !Prisma.Decimal.isDecimal(value)) return null;
  if (!/^\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(String(value))) return null;
  const decimal = new Decimal(String(value));
  return decimal.isFinite() && decimal.gte(0) ? decimal : null;
};
const firstAmount = (...values: unknown[]) => values.map(amount).find(value => value !== null) ?? null;
const asString = (value: ReturnType<typeof amount>) => value?.toFixed() ?? null;
const toToman = (value: unknown, currency: string) => {
  const decimal = amount(value);
  switch (currency.trim().toLowerCase()) {
    case 'irr': case 'rial': case 'rials': case 'ریال': return decimal?.div(10) ?? null;
    case 'irt': case 'toman': case 'تومان': return decimal;
    default: return null;
  }
};
const hasUnit = (unit: unknown, options: string[]) =>
  typeof unit === 'string' && options.includes(unit.toLowerCase().replace(/[\s‌]/g, ''));
const inMeters = (value: unknown, unit: unknown) => {
  const length = amount(value);
  if (hasUnit(unit, ['m', 'meter', 'متر'])) return length;
  if (hasUnit(unit, ['cm', 'centimeter', 'سانتیمتر'])) return length?.div(100) ?? null;
  if (hasUnit(unit, ['mm', 'millimeter', 'میلیمتر'])) return length?.div(1000) ?? null;
  return null;
};

function measurements(input: { type?: string; unit?: unknown; quantity?: unknown; count?: unknown;
  area?: unknown; length?: unknown; lengthUnit?: unknown }) {
  const quantity = amount(input.quantity);
  const count = amount(input.count) ?? (hasUnit(input.unit, ['count', 'piece', 'عدد', 'قطعه']) ? quantity : null);
  const area = amount(input.area) ?? (hasUnit(input.unit, ['squaremeter', 'm²', 'm2', 'مترمربع']) ? quantity : null);
  const length = inMeters(input.length, input.lengthUnit);
  const linear = hasUnit(input.unit, ['meter', 'linearmeter', 'm', 'متر', 'مترطول']) ? quantity : null;
  const linearMeters = linear ?? (input.type === 'longitudinal' ? length?.mul(count?.gt(0) ? count : 1) ?? null : null);
  return { squareMeters: asString(area), linearMeters: asString(linearMeters), pieceCount: asString(count?.gt(0) ? count : null) };
}

function contractInfo(contract: Contract, date?: string, partnerCommercialStatus?: string) {
  const data = object(contract.contractData);
  return {
    id: contract.id, number: contract.contractNumber,
    date: date ?? str(data.contractDate, data.date, object(data.contract).date) ?? contract.createdAt.toISOString(),
    status: contract.status !== 'CANCELLED' && commercialDeadlinePassed(contract) ? 'EXPIRED' : contract.status,
    commercialFlowVersion: contract.commercialFlowVersion, isInactive: contract.isInactive,
    partnerCommercialStatus,
  };
}

function ordinaryItems(contract: Contract) {
  const products = records(object(contract.contractData).products);
  const snapshots = new Map(products.map(row => [str(row.rowId, row.productRowId, row.id), row]));
  const graph = new Map(records(object(contract.productGraphState?.graph).rows)
    .map(row => [str(row.productRowId), row]));
  // Legacy products without row IDs may be mapped by product only when both sides are unique.
  const uniqueSnapshot = (productId: string) => {
    const matches = products.filter(row => row.productId === productId || row.id === productId);
    return matches.length === 1 && contract.items.filter(item => item.productId === productId).length === 1 ? matches[0] : undefined;
  };
  return contract.items.map(item => {
    const row = (item.productRowId && snapshots.get(item.productRowId)) || uniqueSnapshot(item.productId) || {};
    const graphRow = graph.get(item.productRowId ?? '') ?? {};
    const commercial = object(graphRow.commercial);
    const calculation = object(commercial.calculationSnapshot);
    const legacyCurrency = str(row.currency) ?? contract.currency;
    const base = amount(commercial.baseAmountToman) ?? toToman(firstAmount(row.originalTotalPrice, item.originalTotalPrice), legacyCurrency);
    const charge = firstAmount(calculation.mandatoryAmountToman, object(calculation.mandatoryPricingLine).amountToman);
    const enabled = item.isMandatory || row.isMandatory === true || calculation.mandatoryEnabled === true || Boolean(charge?.gt(0));
    const percentage = enabled ? firstAmount(calculation.mandatoryPercentage, row.mandatoryPercentage, item.mandatoryPercentage) : null;
    const markup = enabled ? charge ?? toToman(row.mandatoryAmount, legacyCurrency)
      ?? (base && percentage ? base.mul(percentage).div(100) : null) : null;
    const after = base && markup ? base.plus(markup) : null;
    const type = str(graphRow.productType, row.productType, item.productType);
    const unit = row.unit;
    return {
      id: item.id, productKey: item.productId,
      name: str(graphRow.contractualTitle, row.name, row.stoneName, item.product.namePersian) ?? 'محصول بدون نام',
      contract: contractInfo(contract),
      ...measurements({ type, unit, quantity: item.quantity,
        count: firstAmount(commercial.requestedQuantity, row.pieceCount, row.unit == null ? row.quantity : null),
        area: firstAmount(commercial.requestedAreaSquareMeters, row.squareMeters, row.areaSquareMeters),
        length: firstAmount(commercial.requestedLengthMeters, row.lengthMeters, row.length),
        lengthUnit: commercial.requestedLengthMeters != null || row.lengthMeters != null ? 'm' : row.lengthUnit,
      }),
      totalToman: asString(amount(commercial.totalAmountToman) ?? toToman(item.totalPrice, contract.currency)),
      mandatory: enabled, mandatoryPercentage: asString(percentage),
      beforeToman: asString(base), afterToman: asString(after),
    };
  });
}

async function partnerItems(tx: Db, contract: Contract, actorId: string, correlationId: string) {
  if (!contract.partnerCaseId) return [];
  const access = await authorizePartnerSalesCaseRead(tx, { actorId, caseId: contract.partnerCaseId, correlationId });
  if (!access.ok) return [];
  const current = await readCurrentPartnerCaseViews(tx, contract.partnerCaseId);
  if (!current || current.row.customerContractId !== contract.id || current.row.headRevision !== contract.partnerRevision
    || current.row.integrityHash !== contract.partnerIntegrityHash) return [];
  const parsed = CustomerContractOutputSchema.safeParse(current.row.head.customerProjection);
  if (!parsed.success) return [];
  const output = parsed.data;
  const graph = current.row.head.graph;
  const print = new Map(partnerCustomerPrintDetails(output, graph).map(row => [row.productRowId, row]));
  const graphRows = new Map(records(object(graph).rows).map(row => [str(row.productRowId), row]));
  const currency = output.totals.currency;
  return output.products.filter(row => row.productType !== 'service').map(row => {
    const details = print.get(row.productRowId);
    const graphRow = graphRows.get(row.productRowId);
    const calculation = object(object(graphRow?.commercial).calculationSnapshot);
    const charges = details?.mandatory.map(charge => toToman(charge.amount, currency)) ?? [];
    const enabled = charges.length > 0 || calculation.mandatoryEnabled === true || Boolean(amount(calculation.mandatoryAmountToman)?.gt(0));
    const base = toToman(details?.materialAmount, currency);
    const after = enabled && base && charges.length && charges.every(charge => charge !== null)
      ? charges.reduce((sum, charge) => sum.plus(charge ?? 0), base) : null;
    const lineTotal = amount(row.retailLineTotal) ?? amount(row.quantity)?.mul(row.retailUnitPrice);
    return {
      id: `${contract.id}:${row.productRowId}`,
      productKey: str(graphRow?.catalogProductId, row.productCode) ?? row.description,
      name: row.description, contract: contractInfo(contract, output.contractDate, current.row.state),
      ...measurements({ type: row.productType, unit: row.unit, quantity: row.quantity, count: row.count,
        area: row.areaSquareMeters, length: row.lengthMeters, lengthUnit: 'm' }),
      totalToman: asString(toToman(lineTotal, currency)),
      mandatory: enabled ? true : details?.materialAmount !== undefined ? false : null,
      mandatoryPercentage: asString(enabled ? firstAmount(details?.mandatory[0]?.percentage, calculation.mandatoryPercentage) : null),
      beforeToman: asString(base), afterToman: asString(after),
    };
  });
}

export async function readCustomerBuyerItems(tx: Db, input: {
  customerId: string; actor: Actor; includeOrdinary: boolean; correlationId: string;
}) {
  const contracts = await tx.salesContract.findMany({
    where: { customerId: input.customerId, ...salesContractAccessWhere(input.actor),
      AND: [{ OR: [
        { partnerKind: 'PARTNER_CUSTOMER' },
        ...(input.includeOrdinary ? [{ partnerKind: null, partnerCaseId: null }] : []),
      ] }] },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], select,
  });
  const rows: (ReturnType<typeof ordinaryItems>[number] | Awaited<ReturnType<typeof partnerItems>>[number])[] = [];
  for (const contract of contracts) {
    rows.push(...(contract.partnerKind === 'PARTNER_CUSTOMER'
      ? await partnerItems(tx, contract, input.actor.id, input.correlationId) : ordinaryItems(contract)));
  }
  return rows;
}
