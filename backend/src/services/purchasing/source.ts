import {ordinaryPurchaseDemands} from './ordinaryDemand';
import { Prisma } from '@prisma/client';
import { readCurrentPartnerCaseViews } from '../partnerSales/cases/lifecycle';
import { preparePartnerFinancialSource, matchesFinancialPreparation, type PartnerFinancialPreparation } from '../partnerSales/accounting/source';
import { assertCapability, type Access } from './access';
import { PurchasingError } from './domain';
import type { Tx } from './repository';
export const purchasingUnit = (unit: string) => ({ squareMeter: 'مترمربع', square_meter: 'مترمربع', meter: 'متر طول', count: 'عدد', physicalPiece: 'عدد', piece: 'عدد', ton: 'تن', kg: 'کیلوگرم', cubicMeter: 'مترمکعب' } as Record<string, string>)[unit] || unit;
export function ordinaryItemUnit(item: { productType: string | null; product: { preparedSalesUnit: string; volumetricSalesUnit: string } }) {
  return item.productType === 'prepared' ? purchasingUnit(item.product.preparedSalesUnit) : item.productType === 'volumetric' ? purchasingUnit(item.product.volumetricSalesUnit) : 'مترمربع';
}
export async function partnerPurchaseSource(tx: Tx, caseId: string) {
  const views = await readCurrentPartnerCaseViews(tx, caseId);
  if (!views) throw new PurchasingError('PARTNER_SOURCE_UNVERIFIED', 'اطلاعات نسخه جاری پرونده همکار قابل تأیید نیست؛ از مسئول فروش همکار پیگیری کنید.');
  return views;
}
export async function partnerFinancialReady(tx: Tx, views: NonNullable<Awaited<ReturnType<typeof partnerPurchaseSource>>>, at?: Date) {
  if (!views.accounting || !views.row.internalRecordId) return false;
  const prepared = await preparePartnerFinancialSource({ view: views.accounting, partnerSellerId: views.row.profile.userId }, views.accounting.owner);
  if (!prepared.ok) return false;
  const records = await tx.accountingFinancialRecord.findMany({ where: { sourceKind: 'PARTNER_INTERNAL_RECORD', sourceId: views.row.internalRecordId, kind: { in: ['INVOICE_CANDIDATE', 'RECEIVABLE'] }, voidedAt: null, status: { not: 'VOIDED' }, ...(at ? { createdAt: { lte: at } } : {}) }, select: { sourceSnapshot: true } });
  return records.some(r => { const saved = (r.sourceSnapshot as { partnerPreparation?: PartnerFinancialPreparation } | null)?.partnerPreparation; return saved && matchesFinancialPreparation(prepared.value, saved); });
}
export async function contractSource(tx: Tx, a: Access, id: string, itemId: string, firm = false, at?: Date) {
  const identity = await tx.salesContract.findUnique({ where: { id }, select: { partnerCaseId: true } });
  if (identity?.partnerCaseId) await tx.$queryRaw`SELECT id FROM partner_sale_cases WHERE id = ${identity.partnerCaseId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM sales_contracts WHERE id = ${id} FOR UPDATE`;
  const contract = await tx.salesContract.findUnique({ where: { id }, include: { customer: true, productGraphState:true, items: { where: { id: itemId, retiredAt: null }, include: { product: true } } } });
  if (!contract || contract.isInactive || ['CANCELLED', 'EXPIRED'].includes(contract.status)) throw new PurchasingError('CONTRACT_SOURCE_CHANGED', 'قرارداد انتخاب‌شده فعال نیست؛ نسخه جاری قرارداد را بررسی کنید.', 409, 'contractId');
  assertCapability(a.buyer || a.manager || contract.responsibleSellerId === a.actorId, 'فقط برای قراردادهای تحت مسئولیت خود می‌توانید درخواست ثبت کنید.');
  if (contract.partnerCaseId) {
    const views = await partnerPurchaseSource(tx, contract.partnerCaseId), row = views.partner.products.find(p => p.productRowId === itemId);
    if (!row) throw new PurchasingError('CONTRACT_SOURCE_CHANGED', 'ردیف انتخاب‌شده در نسخه جاری پرونده همکار نیست؛ فهرست را به‌روز کنید.');
    if (firm && !await partnerFinancialReady(tx, views, at)) throw new PurchasingError('FINANCIAL_RECORD_REQUIRED', 'رکورد مالی معتبرِ فروش سبلان به همکار برای نسخه جاری موجود نیست؛ با حسابداری پیگیری کنید.', 409, 'contractId');
    return { contract, sourceVersion: views.row.headRevision, item: { id: row.productRowId, quantity: new Prisma.Decimal(row.quantity), description: row.description, unit: purchasingUnit(row.unit), product: { name: row.description, namePersian: row.description } } };
  }
  const item = contract.items[0];
  if (!item) throw new PurchasingError('CONTRACT_SOURCE_CHANGED', 'ردیف انتخاب‌شده فعال نیست؛ نسخه جاری قرارداد را بررسی کنید.', 409, 'itemId');
  if (firm) {
    const records = await tx.accountingFinancialRecord.findMany({ where: { contractId: id, kind: { in: ['INVOICE_CANDIDATE', 'RECEIVABLE'] }, status: { not: 'VOIDED' }, voidedAt: null, ...(at ? { createdAt: { lte: at } } : {}) }, select: { id: true, sourceSnapshot: true } });
    const valid = records.find(r => (r.sourceSnapshot as { commercialRevision?: number } | null)?.commercialRevision === contract.commercialRevision || contract.commercialRevision === 0 && !(r.sourceSnapshot as { commercialRevision?: number } | null)?.commercialRevision);
    if (!valid) throw new PurchasingError('FINANCIAL_RECORD_REQUIRED', `سفارش ثبت نشد؛ قرارداد ${contract.contractNumber} رکورد مالی معتبر ندارد. با حسابداری پیگیری کنید.`, 409, 'contractId');
  }
  const demand=ordinaryPurchaseDemands(contract).get(item.id);
  if(!demand)throw new PurchasingError('PURCHASE_QUANTITY_SOURCE_UNVERIFIED','مقدار معتبر این ردیف پیدا نشد.');
  return { contract, sourceVersion: contract.commercialRevision, item: { ...item, description:demand.description||item.description,quantity:demand.quantity, unit:demand.unit } };
}
