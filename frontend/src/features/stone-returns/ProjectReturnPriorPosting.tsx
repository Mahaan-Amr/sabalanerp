import { ErpButton, ErpCard, ErpSection, ErpSummaryGrid } from '@/components/erp';
import { projectReturnAccountingHref, type ProjectReturnPriorPosting as PriorPosting } from './projectReturnAllocationApi';
import { displayExactDecimal, displayStoneReturnQuantity } from './stoneReturnApi';

const money = (value: string) => `${displayExactDecimal(value)} ریال`;

export function ProjectReturnPriorPosting({ prior }: { prior: PriorPosting }) {
  const { receipt } = prior;
  return <ErpSection title="مرجوعی قطعی قبلی" description={receipt.productName}>
    <div className="space-y-4">
      <ErpSummaryGrid items={[
        { label: 'تاریخ ثبت قطعی', value: new Date(prior.finalizedAt).toLocaleString('fa-IR') },
        { label: 'مقدار سالم', value: displayStoneReturnQuantity(receipt.acceptedQuantity, receipt.unit) },
        { label: 'مقدار آسیب‌دیده', value: displayStoneReturnQuantity(receipt.rejectedQuantity, receipt.unit) },
        { label: 'نرخ توافقی قبلی', value: money(prior.agreedUnitRateRials) },
        { label: 'بستانکاری ثبت‌شده', value: money(prior.creditRials) },
      ]} />
      {prior.rows.map(row => <ErpCard key={row.id}>
        <ErpSummaryGrid items={[
          { label: 'صورتحساب مرجع', value: row.originalInvoiceNumber },
          { label: 'قرارداد', value: row.contractNumber },
          { label: 'پروژهٔ تاریخی', value: row.projectName ?? 'نامشخص' },
          { label: 'مقدار تخصیص‌یافته', value: displayStoneReturnQuantity(row.quantity, receipt.unit) },
        ]} />
      </ErpCard>)}
      {prior.credits.map(credit => <ErpCard key={credit.creditInvoiceId}>
        <ErpSummaryGrid items={[
          { label: 'صورتحساب بستانکاری', value: credit.creditNumber },
          { label: 'سند حسابداری', value: credit.voucherNumber ?? credit.voucherId },
          { label: 'سند مالیاتی', value: credit.taxDocument.serial },
          { label: 'بستانکاری این سند', value: money(credit.customerCreditRials) },
          { label: 'تسویه یا مصرف‌شده', value: money(credit.usedRials) },
          { label: 'ماندهٔ بستانکاری', value: money(credit.availableRials) },
        ]} />
      </ErpCard>)}
      <ErpButton label="مشاهده پروندهٔ اصلی" href={`${projectReturnAccountingHref}/${encodeURIComponent(receipt.id)}`} variant="soft" />
    </div>
  </ErpSection>;
}
