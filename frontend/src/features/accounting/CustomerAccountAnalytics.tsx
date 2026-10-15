'use client';
import { ErpEmptyState, ErpSection } from '@/components/erp';
import { accountMoney, type CustomerAccount } from './customerAccountModel';
import { customerAccountInsights } from './customerAccountInsights';
import styles from './customerAccountWorkspace.module.css';

export default function CustomerAccountAnalytics({ account }: { account: CustomerAccount }) {
  const insight = customerAccountInsights(account);
  if (insight.original === BigInt(0)) return <ErpEmptyState title="بدهی قطعی ثبت نشده است" />;
  return <div className={styles.analytics}>
    <ErpSection title="تسویه بدهی‌های قطعی"><div className={styles.chart}>
      <svg viewBox="0 0 120 120" className={styles.donut} role="img" aria-label={`${insight.percent.toLocaleString('fa-IR')} درصد تسویه یا مصرف`}>
        <circle cx="60" cy="60" r="48" fill="none" stroke="var(--sds-surface-subtle)" strokeWidth="12" />
        <circle cx="60" cy="60" r="48" fill="none" stroke="var(--sds-success)" strokeWidth="12" pathLength="100" strokeDasharray={`${insight.percent} 100`} transform="rotate(-90 60 60)" />
        <text x="60" y="65" textAnchor="middle" fill="var(--sds-text-primary)" fontSize="22">{insight.percent.toLocaleString('fa-IR')}٪</text>
      </svg>
      <div className="space-y-3 text-sm"><p className={styles.success}>✓ تسویه / مصرف: {accountMoney(insight.consumed.toString())}</p><p>مانده: {accountMoney(insight.remaining.toString())}</p></div>
    </div><p className="mt-3 text-xs sds-text-secondary">بر مبنای اقلام قطعی؛ مبلغ قرارداد در این نمودار محاسبه نمی‌شود.</p></ErpSection>
    <ErpSection title="سن بدهی"><div className="space-y-4">{insight.buckets.map((bucket, index) => <div key={bucket.label}>
      <div className="mb-2 flex flex-wrap justify-between gap-2 text-sm"><span>{bucket.label}</span><strong>{accountMoney(bucket.amountRials)}</strong></div>
      <div className={styles.track}><div style={{ width: `${bucket.percent}%`, background: index === 0 ? 'var(--sds-accent)' : 'var(--sds-danger)' }} /></div>
    </div>)}</div></ErpSection>
  </div>;
}
