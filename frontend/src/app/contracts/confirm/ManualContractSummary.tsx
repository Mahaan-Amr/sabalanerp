import React from 'react';
import { ErpNeumorphicCard, ErpNeumorphicDisclosure } from '@/components/erp';
import { formatDisplayNumber, formatPriceWithRial, toFiniteNumber } from '@/lib/numberFormat';
import PersianCalendar from '@/lib/persian-calendar';
import { getContractProductNonServiceSubtotal } from '@/features/contract-creation/utils/contractProductPricing';
import { getBillableCuttingBreakdown } from '@/features/contract-creation/utils/mandatoryCuttingPricing';
import { getServiceRowSourceLabel, getServiceRowUnitLabel } from '@/features/contract-creation/utils/contractServiceRows';
import { normalizeProductFinishing } from '@/features/contract-creation/utils/finishingUtils';
import { buildContractPaymentPresentation } from '@/features/sales/contractPaymentPresentation';

type PublicContract = {
  contractStatus: string;
  status: string;
  contract: {
    contractNumber: string;
    createdAt?: string;
    contractData: any;
    totalAmount: number | string | null;
    currency: string;
    customer: { firstName?: string; lastName?: string; companyName?: string; phoneNumber?: string };
    items: any[];
    deliveries: any[];
    payments: any[];
  };
};

const value = (input: unknown) => input === null || input === undefined || input === '' ? '—' : String(input);
const date = (input: unknown) => {
  if (!input) return '—';
  const text = String(input);
  if (/^1[34]\d{2}[/-]\d{1,2}[/-]\d{1,2}/.test(text)) return text.replace(/-/g, '/');
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? text : PersianCalendar.toPersian(parsed);
};
const productType = (type?: string) => ({ longitudinal: 'طولی', stair: 'پله', slab: 'اسلب' })[type as 'longitudinal' | 'stair' | 'slab'] || '—';
const stairPart = (part?: string) => ({ tread: 'کف پله', riser: 'خیز پله', landing: 'پاگرد' })[part as 'tread' | 'riser' | 'landing'] || '—';
const status = (input: string) => ({ APPROVED: 'تایید شده', VERIFIED: 'تایید شده', PENDING: 'در انتظار تایید', PENDING_APPROVAL: 'در انتظار تایید', SIGNED: 'امضا شده', PRINTED: 'چاپ شده', CANCELLED: 'لغو شده', EXPIRED: 'منقضی شده' })[input as 'APPROVED'] || value(input);
const paymentStatus = (input: string | null) => input === 'WILL_BE_PAID' ? 'پرداخت خواهد شد' : value(input);
const unit = (input: string) => ({ meter: 'متر', squareMeter: 'متر مربع', ton: 'تن' })[input as 'meter'] || 'عدد';

export function buildManualContractSummary(data: PublicContract) {
  const contract = data.contract;
  const snapshot = contract.contractData || {};
  const relationalItems = Array.isArray(contract.items) ? contract.items : [];
  const savedProducts = Array.isArray(snapshot.products) ? snapshot.products : [];
  const products = savedProducts.length > 0 ? savedProducts.map((product: any) => {
    const current = relationalItems.find((item: any) => item.productRowId && item.productRowId === product.rowId);
    return current ? { ...product, quantity: current.quantity, totalPrice: current.totalPrice, product: current.product || product.product } : product;
  }) : relationalItems;
  const currency = snapshot.payment?.currency || contract.currency || 'تومان';
  const money = (amount: unknown) => formatPriceWithRial(toFiniteNumber(amount as number | string | null), currency);
  const productRows = products.map((product: any, index: number) => ({
    id: product.rowId || product.id || `product-${index}`,
    code: product.stoneCode || product.product?.code || '—',
    name: product.stoneName || product.product?.namePersian || product.product?.name || '—',
    type: stairPart(product.stairPartType) !== '—' ? `${productType(product.productType)} / ${stairPart(product.stairPartType)}` : productType(product.productType),
    dimensions: [
      product.length ? `طول: ${product.length}${product.lengthUnit || ''}` : null,
      product.width ? `عرض: ${product.width}${product.widthUnit || ''}` : null,
      product.thicknessCm ? `ضخامت: ${product.thicknessCm}cm` : null
    ].filter(Boolean).join(' | ') || '—',
    quantity: product.quantity,
    area: product.squareMeters,
    total: getContractProductNonServiceSubtotal(product)
  }));
  const dependentServices: Array<{ id: string; product: string; category: string; name: string; amount: string; rate: string; cost: number }> = [];
  products.forEach((product: any, productIndex: number) => {
    const name = product.stoneName || product.product?.namePersian || `محصول ${productIndex + 1}`;
    (product.appliedSubServices || []).forEach((service: any, index: number) => dependentServices.push({
      id: `tool-${productIndex}-${index}`, product: name, category: 'ابزار/خدمات',
      name: service.subService?.namePersian || service.subService?.name || '—',
      amount: `${formatDisplayNumber(service.meter)} ${service.calculationBase === 'squareMeters' ? 'متر مربع' : 'متر'}`,
      rate: value(service.subService?.pricePerMeter), cost: toFiniteNumber(service.cost)
    }));
    getBillableCuttingBreakdown(product).forEach((cut, index) => dependentServices.push({
      id: `cut-${productIndex}-${index}`, product: name, category: 'برش',
      name: cut.type === 'cross' ? 'برش عرضی' : 'برش طولی',
      amount: `${formatDisplayNumber(cut.meters)} متر`, rate: value(cut.rate), cost: toFiniteNumber(cut.cost)
    }));
    if (product.finishingId && product.finishingCost) {
      const finishing = normalizeProductFinishing(product);
      dependentServices.push({ id: `finishing-${productIndex}`, product: name, category: 'فینیشینگ',
        name: product.finishingName || '—',
        amount: finishing?.amountLabel || `${formatDisplayNumber(product.finishingSquareMeters || product.squareMeters)} متر مربع`,
        rate: finishing?.rateLabel || value(product.finishingPricePerSquareMeter), cost: toFiniteNumber(product.finishingCost) });
    }
  });
  const serviceRows = Array.isArray(snapshot.serviceRows) ? snapshot.serviceRows : [];
  const independentServices = serviceRows.map((row: any, index: number) => ({
    id: row.id || `service-${index}`, category: getServiceRowSourceLabel(row.sourceType), name: row.title || '—',
    amount: `${formatDisplayNumber(row.quantity)} ${getServiceRowUnitLabel(row.unit)}`,
    rate: money(row.unitPrice), cost: toFiniteNumber(row.totalPrice)
  }));
  const snapshotDeliveries = Array.isArray(snapshot.deliveries) ? snapshot.deliveries : [];
  const savedDeliveries = Array.isArray(contract.deliveries) ? contract.deliveries : [];
  const deliveries = (savedDeliveries.length > 0 ? savedDeliveries : snapshotDeliveries).map((delivery: any, index: number) => {
    const prior = snapshotDeliveries[index] || {};
    const allocated = Array.isArray(delivery.products) ? delivery.products : [];
    return {
      id: delivery.id || `delivery-${index}`,
      deliveryDate: date(delivery.deliveryDate), deliveryAddress: value(delivery.deliveryAddress || snapshot.project?.address),
      projectManagerName: value(prior.projectManagerName), receiverName: value(prior.receiverName), notes: value(delivery.notes),
      products: allocated.map((entry: any) => {
        const product = products.find((candidate: any) => candidate.rowId && candidate.rowId === entry.productRowId) ||
          products.find((candidate: any) => candidate.productId === entry.productId);
        const service = serviceRows.find((candidate: any) => candidate.id === entry.serviceRowId);
        const savedEntry = (prior.products || []).find((candidate: any) =>
          (entry.productRowId && candidate.productRowId === entry.productRowId) ||
          (entry.serviceRowId && candidate.serviceRowId === entry.serviceRowId));
        const amount = entry.amount ?? entry.quantity;
        return `${service?.title || product?.stoneName || entry.product?.namePersian || entry.product?.name || 'محصول'} (${formatDisplayNumber(amount)} ${service ? getServiceRowUnitLabel(service.unit) : unit(entry.unit || savedEntry?.unit)})`;
      })
    };
  });
  const payments = buildContractPaymentPresentation({ payments: contract.payments, contractData: snapshot, currency }).rows;
  const productsTotal = productRows.reduce((sum: number, row: any) => sum + row.total, 0);
  const servicesTotal = [...dependentServices, ...independentServices].reduce((sum, row) => sum + row.cost, 0);
  const paymentTotal = payments.reduce((sum, payment) => sum + payment.amount, 0);
  const grandTotal = toFiniteNumber(contract.totalAmount) || Math.max(productsTotal + servicesTotal - toFiniteNumber(snapshot.discount?.amount), 0);
  return { contract, snapshot, currency, money, productRows, dependentServices, independentServices, deliveries, payments,
    productsTotal, servicesTotal, paymentTotal, grandTotal, remaining: grandTotal - paymentTotal };
}

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex justify-between gap-4 text-sm"><span className="text-secondary">{label}:</span><span className="font-medium text-primary text-left">{children}</span></div>
);
const Table = ({ headings, rows }: { headings: string[]; rows: React.ReactNode[][] }) => (
  <div className="overflow-x-auto px-4 pb-4">
    {rows.length === 0 ? <p className="text-sm text-muted">—</p> : <table className="w-full min-w-[680px] text-sm">
      <thead><tr className="border-b border-[var(--sds-border-default)] text-secondary">{headings.map(heading => <th key={heading} className="py-2 text-right">{heading}</th>)}</tr></thead>
      <tbody>{rows.map((cells, index) => <tr key={index} className="border-b border-[var(--sds-border-subtle)]">{cells.map((cell, cellIndex) => <td key={cellIndex} className="py-2 pl-3 text-secondary">{cell}</td>)}</tr>)}</tbody>
    </table>}
  </div>
);

export default function ManualContractSummary({ data }: { data: PublicContract }) {
  const summary = buildManualContractSummary(data);
  const { contract, snapshot, money } = summary;
  const customerName = [contract.customer.firstName, contract.customer.lastName].filter(Boolean).join(' ') || contract.customer.companyName || 'مشتری';
  return <div className="space-y-3" dir="rtl">
    <ErpNeumorphicCard className="p-5 sm:p-6">
      <h2 className="mb-5 text-2xl font-bold text-primary">خلاصه قرارداد</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-4">
          <ErpNeumorphicCard className="space-y-2 p-4"><h3 className="mb-3 font-semibold text-secondary">اطلاعات قرارداد</h3>
            <Field label="شماره قرارداد">{contract.contractNumber}</Field>
            <Field label="تاریخ قرارداد">{date(snapshot.contractDate || contract.createdAt)}</Field>
            <Field label="وضعیت">{status(data.contractStatus)}</Field>
          </ErpNeumorphicCard>
          <ErpNeumorphicCard className="space-y-2 p-4"><h3 className="mb-3 font-semibold text-secondary">اطلاعات مشتری</h3>
            <Field label="نام">{customerName}</Field><Field label="شماره موبایل تایید">{value(contract.customer.phoneNumber)}</Field>
          </ErpNeumorphicCard>
        </div>
        <div className="space-y-4"><ErpNeumorphicCard className="space-y-2 p-4"><h3 className="mb-3 font-semibold text-secondary">جمع‌بندی مالی</h3>
          <Field label="جمع محصولات">{money(summary.productsTotal)}</Field>
          <Field label="جمع خدمات">{money(summary.servicesTotal)}</Field>
          {toFiniteNumber(snapshot.discount?.amount) > 0 && <Field label="تخفیف">{money(snapshot.discount.amount)}</Field>}
          <Field label="جمع پرداختی">{money(summary.paymentTotal)}</Field>
          <div className="border-t border-[var(--sds-border-default)] pt-2"><Field label="مبلغ نهایی قرارداد">{money(summary.grandTotal)}</Field></div>
          <Field label="مانده پرداخت">{money(summary.remaining)}</Field>
        </ErpNeumorphicCard>
          <ErpNeumorphicCard className="p-4"><Field label="وضعیت تایید مشتری">{status(data.status)}</Field></ErpNeumorphicCard>
        </div>
      </div>
    </ErpNeumorphicCard>
    <ErpNeumorphicDisclosure open><summary className="cursor-pointer px-4 py-3 font-semibold text-primary">محصولات قرارداد ({summary.productRows.length})</summary>
      <Table headings={['کد', 'نام', 'نوع', 'ابعاد', 'تعداد', 'متراژ', 'مبلغ کل']} rows={summary.productRows.map((row: any) => [row.code, row.name, row.type, row.dimensions, formatDisplayNumber(row.quantity), formatDisplayNumber(row.area), money(row.total)])} />
    </ErpNeumorphicDisclosure>
    <ErpNeumorphicDisclosure><summary className="cursor-pointer px-4 py-3 font-semibold text-primary">خدمات و عملیات وابسته ({summary.dependentServices.length})</summary>
      <Table headings={['محصول', 'دسته', 'شرح', 'مقدار', 'نرخ', 'هزینه']} rows={summary.dependentServices.map(row => [row.product, row.category, row.name, row.amount, row.rate, money(row.cost)])} />
    </ErpNeumorphicDisclosure>
    <ErpNeumorphicDisclosure open><summary className="cursor-pointer px-4 py-3 font-semibold text-primary">خدمات مستقل ({summary.independentServices.length})</summary>
      <Table headings={['دسته', 'شرح', 'مقدار', 'نرخ', 'هزینه']} rows={summary.independentServices.map((row: any) => [row.category, row.name, row.amount, row.rate, money(row.cost)])} />
    </ErpNeumorphicDisclosure>
    <ErpNeumorphicDisclosure><summary className="cursor-pointer px-4 py-3 font-semibold text-primary">برنامه تحویل ({summary.deliveries.length})</summary>
      <div className="space-y-3 px-4 pb-4">{summary.deliveries.length === 0 ? <p className="text-sm text-muted">—</p> : summary.deliveries.map((delivery: any) =>
        <ErpNeumorphicCard key={delivery.id} className="space-y-2 p-4"><div className="grid gap-2 sm:grid-cols-2">
          <Field label="تاریخ">{delivery.deliveryDate}</Field><Field label="آدرس">{delivery.deliveryAddress}</Field>
          <Field label="مدیر پروژه">{delivery.projectManagerName}</Field><Field label="تحویل‌گیرنده">{delivery.receiverName}</Field>
        </div><Field label="توضیحات">{delivery.notes}</Field>
          <div className="text-sm text-secondary">اقلام: {delivery.products.length > 0 ? delivery.products.join('، ') : '—'}</div>
        </ErpNeumorphicCard>)}</div>
    </ErpNeumorphicDisclosure>
    <ErpNeumorphicDisclosure><summary className="cursor-pointer px-4 py-3 font-semibold text-primary">برنامه پرداخت ({summary.payments.length})</summary>
      <Table headings={['روش', 'مبلغ', 'تاریخ پرداخت', 'تاریخ تحویل چک', 'شماره چک', 'صاحب چک', 'وضعیت']} rows={summary.payments.map(row => [row.methodLabel, money(row.amount), date(row.paymentDate), date(row.handoverDate), value(row.checkNumber), value(row.checkOwnerName), paymentStatus(row.status)])} />
    </ErpNeumorphicDisclosure>
  </div>;
}
