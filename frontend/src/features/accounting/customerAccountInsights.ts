import type { CustomerAccount } from './customerAccountModel';

// Amount arithmetic stays in integer rials; only bounded chart percentages become numbers.
export function customerAccountInsights(account: CustomerAccount) {
  const debts = account.activityItems.filter(item => item.kind === 'RECEIVABLE');
  const original = debts.reduce((total, item) => total + BigInt(item.originalRials), BigInt(0));
  const remaining = debts.reduce((total, item) => total + BigInt(item.remainingRials), BigInt(0));
  const consumed = original - remaining;
  const buckets = [
    { label: 'جاری', from: -Infinity, to: 0 },
    { label: '۱ تا ۳۰ روز', from: 1, to: 30 },
    { label: '۳۱ تا ۶۰ روز', from: 31, to: 60 },
    { label: 'بیش از ۶۰ روز', from: 61, to: Infinity },
  ].map(bucket => ({ label: bucket.label, amount: debts.filter(item => item.agingDays >= bucket.from && item.agingDays <= bucket.to)
    .reduce((total, item) => total + BigInt(item.remainingRials), BigInt(0)) }));
  const maximum = buckets.reduce((max, row) => row.amount > max ? row.amount : max, BigInt(1));
  return { original, remaining, consumed,
    percent: original > BigInt(0) ? Math.max(0, Math.min(100, Number(consumed * BigInt(100) / original))) : 0,
    buckets: buckets.map(row => ({ label: row.label, amountRials: row.amount.toString(), percent: Number(row.amount * BigInt(100) / maximum) })),
    overdueRials: buckets.slice(1).reduce((total, row) => total + row.amount, BigInt(0)).toString() };
}
