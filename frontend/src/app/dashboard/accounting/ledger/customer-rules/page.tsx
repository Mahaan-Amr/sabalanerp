'use client';

import { useEffect, useRef, useState } from 'react';
import { ErpButton, ErpCard, ErpCheckbox, ErpField, ErpInlineState, ErpInput, ErpPage, ErpPersianDateField, ErpSearchableSelect, ErpSection, ErpSummaryGrid } from '@/components/erp';
import { accountingAPI } from '@/lib/api';
import { accountingFailureMessage, dateFa } from '@/features/accounting/accountingUi';

type Account = { id: string; code: string; titlePersian: string; level: string; normalSide: string; statementRole: string; partyRequirement: string; financialAccountRequirement: string; effectiveFrom: string; effectiveTo?: string | null; retiredAt?: string | null };
type Rule = { id: string; code: string; version: number; effectiveFrom: string; effectiveTo?: string | null } & Record<Role, string>;
type Role = 'receivableAccountId' | 'customerAdvanceAccountId' | 'bankClearingAccountId' | 'revenueAccountId' | 'outputTaxAccountId' | 'inventoryAccountId' | 'costAccountId';
const roles: Array<{ id: Role; label: string; side: string; role: string; party?: string; financial?: string }> = [
  { id: 'receivableAccountId', label: 'دریافتنی مشتری', side: 'DEBIT', role: 'ASSET', party: 'REQUIRED' },
  { id: 'customerAdvanceAccountId', label: 'پیش‌دریافت مشتری', side: 'CREDIT', role: 'LIABILITY', party: 'REQUIRED' },
  { id: 'bankClearingAccountId', label: 'بانک / صندوق دریافت', side: 'DEBIT', role: 'ASSET', financial: 'REQUIRED' },
  { id: 'revenueAccountId', label: 'درآمد فروش', side: 'CREDIT', role: 'REVENUE' },
  { id: 'outputTaxAccountId', label: 'مالیات فروش', side: 'CREDIT', role: 'LIABILITY' },
  { id: 'inventoryAccountId', label: 'موجودی کالا', side: 'DEBIT', role: 'ASSET' },
  { id: 'costAccountId', label: 'بهای تمام‌شده فروش', side: 'DEBIT', role: 'EXPENSE' },
];
const empty = () => Object.fromEntries(roles.map(row => [row.id, ''])) as Record<Role, string>;
type Context = { id: string; configured: boolean; accessProfile: string; books: Array<{ id: string; namePersian: string; accounts: Account[] }> };

export default function CustomerPostingRulesPage() {
  const [context, setContext] = useState<Context>();
  const [rules, setRules] = useState<Rule[]>([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [retry, setRetry] = useState(0);
  const [code, setCode] = useState('');
  const [version, setVersion] = useState('1');
  const [date, setDate] = useState('');
  const [selected, setSelected] = useState(empty);
  const [confirmed, setConfirmed] = useState(false);
  const inFlight = useRef(false);
  useEffect(() => {
    let current = true;
    setLoading(true); setError('');
    Promise.all([accountingAPI.getLedgerContext(), accountingAPI.getCustomerPostingRules()]).then(([ctx, rows]) => {
      if (current) { setContext(ctx.data.data); setRules(rows.data.data); }
    }).catch(reason => { if (current) setError(accountingFailureMessage(reason, 'قواعد ثبت مشتری بارگیری نشد.')); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [retry]);
  useEffect(() => { setConfirmed(false); }, [code, version, date, selected]);
  const accounts = context?.books?.[0]?.accounts || [];
  const eligible = (account: Account, role: typeof roles[number]) => account.level === 'MOIN' && !account.retiredAt
    && account.normalSide === role.side && account.statementRole === role.role
    && (!role.party || account.partyRequirement === role.party) && (!role.financial || account.financialAccountRequirement === role.financial)
    && Boolean(date) && new Date(account.effectiveFrom) <= new Date(date) && (!account.effectiveTo || new Date(account.effectiveTo) >= new Date(date));
  const valid = Boolean(code.trim() && date && /^[1-9]\d*$/.test(version)) && roles.every(role => accounts.some(account => account.id === selected[role.id] && eligible(account, role)))
    && new Set(Object.values(selected)).size === roles.length;
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid || !confirmed || !context || inFlight.current) return;
    inFlight.current = true; setPending(true); setError(''); setSuccess('');
    try {
      const response = await accountingAPI.createCustomerPostingRule({ legalEntityId: context.id, code: code.trim(), version: Number(version), effectiveFrom: new Date(date).toISOString(), ...selected });
      setRules(rows => [response.data.data, ...rows]); setConfirmed(false);
      setSuccess('قاعده ثبت مشتری ذخیره شد؛ به پرونده مشتری برگردید و فرم افتتاحیه را دوباره باز کنید.');
    } catch (reason) { setError(accountingFailureMessage(reason, 'قاعده ثبت نشد؛ حساب‌ها و نسخه قاعده را بررسی کنید.')); }
    finally { inFlight.current = false; setPending(false); }
  }
  return <ErpPage eyebrow="حسابداری" title="قواعد ثبت حسابداری مشتری" backHref="/dashboard/accounting/ledger" actions={[{ label: 'حساب‌های مالی مشتریان', href: '/dashboard/accounting/customer-accounts' }]}>
    {error && <ErpInlineState kind="error" title={error} action={{ label: 'تلاش دوباره', onClick: () => setRetry(value => value + 1) }} />}
    {success && <ErpInlineState kind="success" title={success} />}
    {loading ? <ErpInlineState kind="empty" title="در حال بارگیری قواعد…" /> : !context?.configured ? <ErpInlineState kind="permission" title="ابتدا دفترکل را راه‌اندازی کنید." action={{ label: 'راه‌اندازی دفترکل', href: '/dashboard/accounting/ledger' }} /> : <>
      <ErpSection title="قواعد موجود">
        {!rules.length && <ErpInlineState kind="empty" title="قاعده ثبت حسابداری مشتری تعریف نشده است." />}
        {rules.map(rule => <ErpCard key={rule.id} className="space-y-3 p-4"><strong>{rule.code} · نسخه {rule.version.toLocaleString('fa-IR')}</strong><p>از {dateFa(rule.effectiveFrom)}{rule.effectiveTo ? ` تا ${dateFa(rule.effectiveTo)}` : ''}</p><ErpSummaryGrid items={roles.map(role => { const account = accounts.find(row => row.id === rule[role.id]); return { label: role.label, value: account ? `${account.code} · ${account.titlePersian}` : 'حساب در این دفتر موجود نیست' }; })} /></ErpCard>)}
      </ErpSection>
      {context.accessProfile !== 'ACCOUNTING_MANAGER' ? <ErpInlineState kind="permission" title="تعریف قاعده فقط برای مدیر حسابداری مجاز است." /> : <ErpSection title="تعریف قاعده مشتری" description="هر نقش، معین مستقل می‌خواهد. تعریف قاعده به‌تنهایی سند یا مانده مشتری ایجاد نمی‌کند؛ قواعد قبلی بازنویسی نمی‌شوند.">
        <ErpInlineState kind="empty" title="دریافتنی و پیش‌دریافت باید طرف حساب اجباری داشته باشند؛ معین بانک باید حساب مالی اجباری داشته باشد." action={{ label: 'بررسی و افزودن معین در کدینگ', href: '/dashboard/accounting/ledger?tab=chart' }} />
        <form onSubmit={save} className="space-y-4"><fieldset disabled={pending} className="space-y-4"><div className="grid gap-4 md:grid-cols-2">
          <ErpField label="کد قاعده" required><ErpInput required value={code} onChange={event => setCode(event.target.value)} /></ErpField>
          <ErpField label="نسخه قاعده" required><ErpInput required inputMode="numeric" value={version} onChange={event => setVersion(event.target.value.replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))))} /></ErpField>
          <ErpPersianDateField label="تاریخ شروع اثر قاعده" value={date} onChange={value => { setDate(value); setSelected(empty()); }} valueFormat="iso-date" required />
          {roles.map(role => <ErpField key={role.id} label={role.label} required hint={date && !accounts.some(account => eligible(account, role)) ? 'معین سازگار در تاریخ انتخابی موجود نیست؛ کدینگ حساب‌ها را بررسی کنید.' : undefined}><ErpSearchableSelect required aria-label={role.label} value={selected[role.id]} onChange={event => setSelected(current => ({ ...current, [role.id]: event.target.value }))}><option value="">انتخاب معین</option>{accounts.filter(account => eligible(account, role)).map(account => <option key={account.id} value={account.id} disabled={Object.entries(selected).some(([key, id]) => key !== role.id && id === account.id)}>{account.code} · {account.titlePersian}</option>)}</ErpSearchableSelect></ErpField>)}
        </div><ErpCheckbox checked={confirmed} onChange={event => setConfirmed(event.target.checked)} label="نگاشت حساب‌ها و تاریخ اثر را بررسی کردم." />
        <ErpButton type="submit" label={pending ? 'در حال ذخیره…' : 'ذخیره قاعده مشتری'} disabled={pending || !valid || !confirmed} /></fieldset></form>
      </ErpSection>}
    </>}
  </ErpPage>;
}
