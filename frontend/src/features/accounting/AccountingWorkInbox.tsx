import React from 'react';
import { ErpButton, ErpCard, ErpEmptyState, ErpSection } from '@/components/erp';
import { type AccountingContractRow, money } from './accountingUi';

const waitingLabel = (value: string, now: Date) => {
  const started = new Date(value);
  if (Number.isNaN(started.getTime())) return 'زمان انتظار نامشخص';
  const days = Math.max(0, Math.floor((now.getTime() - started.getTime()) / 86_400_000));
  return days === 0 ? 'کمتر از یک روز' : `${days.toLocaleString('fa-IR')} روز`;
};

export function AccountingWorkInbox({ contracts, now = new Date() }: {
  contracts: readonly AccountingContractRow[];
  now?: Date;
}) {
  const tasks = contracts.filter(contract => contract.attention)
    .sort((left, right) => left.attention!.priority - right.attention!.priority
      || new Date(left.attention!.waitingSince).getTime() - new Date(right.attention!.waitingSince).getTime())
    .slice(0, 6);
  return <ErpSection title="کارهای امروز">
    {tasks.length ? <div className="space-y-3">{tasks.map(contract => {
      const attention = contract.attention!;
      return <ErpCard key={contract.contractId} className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="sds-text-primary font-semibold">قرارداد {contract.contractNumber} · {contract.customer.displayName}</p>
            <p className="sds-text-secondary mt-1 text-sm">{attention.reason}</p>
          </div>
          <ErpButton label={attention.nextAction} href={`/dashboard/accounting/contracts/${encodeURIComponent(contract.contractId)}?section=financial&returnTo=${encodeURIComponent('/dashboard/accounting')}`} />
        </div>
        <div className="sds-text-secondary mt-3 grid gap-1 text-sm sm:grid-cols-2 xl:grid-cols-4">
          <span>مبلغ قرارداد: {money(contract.accounting.totalContractAmount, 'IRR')}</span>
          <span>دریافت‌شده: {money(contract.accounting.receivedAmount, 'IRR')} · مانده: {money(contract.accounting.remainingAmount, 'IRR')}</span>
          <span>مدت انتظار: {waitingLabel(attention.waitingSince, now)}</span>
          <span>مسئول فعلی: {attention.owner}</span>
        </div>
        <p className="sds-text-secondary mt-2 text-sm">مدرک یا مغایرت: {attention.evidence}</p>
      </ErpCard>;
    })}</div> : <ErpEmptyState title="در خلاصهٔ فعلی اقدام فوری برای قراردادها پیدا نشد." />}
    <div className="mt-3 flex justify-end"><ErpButton label="مشاهده همه قراردادها" href="/dashboard/accounting/contracts?view=reviewable" variant="outline" /></div>
  </ErpSection>;
}
