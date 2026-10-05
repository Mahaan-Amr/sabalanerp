'use client';

import { useEffect, useRef, useState } from 'react';
import { ErpButton, ErpCheckbox, ErpDisclosure, ErpField, ErpInlineState, ErpInput, ErpPersianDateField, ErpSearchableSelect, ErpSheet, ErpSummaryGrid, ErpTextarea } from '@/components/erp';
import { accountingAPI } from '@/lib/api';
import { accountingFailureMessage, dateFa } from './accountingUi';
import { accountMoney, accountOperationLabels, normalizeAccountAmount, type AccountOperationKind, type CustomerAccount } from './customerAccountModel';

type Context = {
  periods: Array<{ id: string; titlePersian: string; startsAt: string; endsAt: string; fiscalYear: { titlePersian: string } }>;
  rules: Array<{ id: string; code: string; version: number; effectiveFrom: string; effectiveTo: string | null; bankClearingAccountId: string }>;
  accounts: Array<{ id: string; code: string; titlePersian: string; financialAccountRequirement: string }>;
  financialAccounts: Array<{ id: string; titlePersian: string; currency: string }>;
};
export default function CustomerAccountOperationFlow({ accountId, account, kind, allocationId, onClose, onSaved }: {
  accountId: string; account: CustomerAccount; kind: AccountOperationKind; allocationId?: string; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const [context, setContext] = useState<Context>();
  const [contextError, setContextError] = useState<string>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [retry, setRetry] = useState(0);
  const [value, setValue] = useState(kind === 'SET_BALANCE' ? account.netBalanceRials : '');
  const [date, setDate] = useState(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran' }).format(new Date()));
  const [periodId, setPeriodId] = useState('');
  const [ruleId, setRuleId] = useState('');
  const [counterId, setCounterId] = useState('');
  const [bankId, setBankId] = useState('');
  const [financialId, setFinancialId] = useState('');
  const [source, setSource] = useState('');
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const request = useRef<{ fingerprint: string; key: string }>();
  const inFlight = useRef(false);
  const isTreasury = ['RECEIPT', 'ALLOCATION', 'REVERSE_ALLOCATION'].includes(kind);
  const isCash = kind === 'RECEIPT' || kind === 'REFUND';
  const isBalance = kind === 'OPENING' || kind === 'SET_BALANCE';
  const receiptSources = account.receipts.filter(row => BigInt(row.amountRials) - BigInt(row.allocatedRials) - BigInt(row.refundedRials) > BigInt(0));
  const creditSources = account.openItems.filter(row => row.kind === 'CREDIT');
  const selectedRule = context?.rules.find(row => row.id === ruleId);
  useEffect(() => {
    let current = true;
    setContextError(undefined);
    accountingAPI.getCustomerWorkspaceContext(accountId).then(response => { if (current) setContext(response.data.data); })
      .catch(reason => { if (current) setContextError(accountingFailureMessage(reason, 'اطلاعات ثبت مالی بارگیری نشد.')); });
    return () => { current = false; };
  }, [accountId, retry]);
  useEffect(() => {
    if (!context) return;
    const at = new Date(date);
    const period = context.periods.find(row => new Date(row.startsAt) <= at && new Date(row.endsAt) >= at);
    setPeriodId(period?.id || '');
    const rule = context.rules.find(row => new Date(row.effectiveFrom) <= at && (!row.effectiveTo || new Date(row.effectiveTo) >= at));
    setRuleId(rule?.id || ''); setBankId(rule?.bankClearingAccountId || '');
  }, [context, date]);
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    setError(undefined);
    const normalized = normalizeAccountAmount(value);
    if (!['ALLOCATION', 'REVERSE_ALLOCATION'].includes(kind) && !(isBalance ? /^-?\d+$/ : /^\d+$/).test(normalized)) { setError('مبلغ را به ریال و بدون اعشار وارد کنید.'); return; }
    const lines = Object.entries(allocations).filter(([, value]) => value.trim()).map(([openItemId, amount]) => ({ openItemId, amountRials: normalizeAccountAmount(amount) }));
    if (kind === 'ALLOCATION' && (!lines.length || lines.some(row => !/^\d+$/.test(row.amountRials) || BigInt(row.amountRials) <= BigInt(0)))) { setError('برای حداقل یک بدهی، مبلغ تخصیص مثبت وارد کنید.'); return; }
    const payload = { kind, amountRials: normalized || '0', periodId, postingRuleId: ruleId, counterAccountId: counterId || undefined,
      bankLedgerId: bankId || undefined, financialAccountId: financialId || undefined,
      receiptId: source.startsWith('receipt:') ? source.slice(8) : undefined, creditItemId: source.startsWith('credit:') ? source.slice(7) : undefined,
      allocationId, occurredAt: new Date(date).toISOString(), reason, reference, confirmed, allocations: lines,
      expectedBalanceRials: kind === 'SET_BALANCE' ? account.netBalanceRials : undefined };
    const fingerprint = JSON.stringify(payload);
    if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, key: crypto.randomUUID() };
    inFlight.current = true; setPending(true);
    try {
      if (isTreasury) await accountingAPI.recordCustomerWorkspaceTreasury(accountId, { ...payload, idempotencyKey: request.current.key });
      else await accountingAPI.recordCustomerAccountOperation(accountId, { ...payload, idempotencyKey: request.current.key });
      await onSaved();
      onClose();
    } catch (reason) { setError(accountingFailureMessage(reason, 'عملیات ثبت نشد؛ اطلاعات را بررسی کنید و دوباره تلاش کنید.')); }
    finally { inFlight.current = false; setPending(false); }
  }
  return <ErpSheet open onClose={onClose} title={accountOperationLabels[kind]} presentation="modal" size="wide" pending={pending}>
    <div className="mb-5"><strong>{account.displayName}</strong><span className="mt-1 block text-sm sds-text-secondary">مانده فعلی: {accountMoney(account.netBalanceRials)}</span></div>
    {contextError ? <ErpInlineState kind="error" title={contextError} action={{ label: 'تلاش دوباره', onClick: () => setRetry(value => value + 1) }} /> : !context ? <ErpInlineState kind="empty" title="در حال آماده‌سازی فرم…" /> : !context.periods.length || !context.rules.length ?
      <ErpInlineState kind="permission" title="برای ثبت، دوره باز و قاعده حسابداری مشتری لازم است." action={{ label: 'تنظیمات حسابداری', href: '/dashboard/accounting/settings' }} /> :
      <form onSubmit={save} className="space-y-5"><fieldset disabled={pending} className="space-y-5">
        <div className="grid gap-4 md:grid-cols-2">
          {!['ALLOCATION', 'REVERSE_ALLOCATION'].includes(kind) && <ErpField label={kind === 'SET_BALANCE' ? 'مانده مطلوب (ریال)' : 'مبلغ (ریال)'} required hint={isBalance ? 'بدهکار مثبت، بستانکار منفی' : undefined}>
            <ErpInput required inputMode={isBalance ? 'text' : 'numeric'} value={value} onChange={event => { setValue(event.target.value); setConfirmed(false); }} /></ErpField>}
          <ErpPersianDateField label="تاریخ عملیات" value={date} onChange={value => { setDate(value); setConfirmed(false); }} valueFormat="iso-date" required disableFutureDates />
          {isCash && <ErpField label={kind === 'REFUND' ? 'حساب پرداخت وجه' : 'حساب دریافت وجه'} required><ErpSearchableSelect value={financialId} onChange={event => setFinancialId(event.target.value)} required aria-label="حساب مالی">
            <option value="">انتخاب حساب</option>{context.financialAccounts.filter(row => row.currency === 'IRR').map(row => <option key={row.id} value={row.id}>{row.titlePersian}</option>)}
          </ErpSearchableSelect></ErpField>}
          {['REFUND', 'ALLOCATION'].includes(kind) && <ErpField label={kind === 'REFUND' ? 'منبع قابل استرداد' : 'دریافت تخصیص‌نیافته'} required><ErpSearchableSelect value={source} onChange={event => setSource(event.target.value)} required aria-label="منبع وجه">
            <option value="">انتخاب منبع</option>{receiptSources.map(row => <option key={row.id} value={`receipt:${row.id}`}>دریافت {dateFa(row.occurredAt)} · {accountMoney((BigInt(row.amountRials) - BigInt(row.allocatedRials) - BigInt(row.refundedRials)).toString())}</option>)}
            {kind === 'REFUND' && creditSources.map(row => <option key={row.id} value={`credit:${row.id}`}>{row.invoiceNumber} · {accountMoney(row.remainingRials)}</option>)}
          </ErpSearchableSelect></ErpField>}
          {!isTreasury && kind !== 'REFUND' && <ErpField label="حساب مقابل" required><ErpSearchableSelect value={counterId} onChange={event => setCounterId(event.target.value)} required aria-label="حساب مقابل">
            <option value="">انتخاب حساب</option>{context.accounts.filter(row => row.financialAccountRequirement !== 'REQUIRED').map(row => <option key={row.id} value={row.id}>{row.code} · {row.titlePersian}</option>)}
          </ErpSearchableSelect></ErpField>}
        </div>
        {kind === 'SET_BALANCE' && /^-?\d+$/.test(normalizeAccountAmount(value)) && <ErpSummaryGrid items={[
          { label: 'مانده مطلوب', value: accountMoney(normalizeAccountAmount(value)) },
          { label: 'اثر سند اصلاحی', value: accountMoney((BigInt(normalizeAccountAmount(value)) - BigInt(account.netBalanceRials)).toString()) },
        ]} />}
        {kind === 'REFUND' && BigInt(account.receivableRials) > BigInt(0) && <ErpInlineState kind="stale" title={`این مشتری ${accountMoney(account.receivableRials)} مانده دریافتنی دارد؛ پیش از استرداد بررسی کنید.`} />}
        {kind === 'ALLOCATION' && <div className="grid gap-3">{account.openItems.filter(row => row.kind === 'RECEIVABLE').map(row => <ErpField key={row.id} label={row.invoiceNumber} hint={`مانده: ${accountMoney(row.remainingRials)}`}>
          <ErpInput inputMode="numeric" value={allocations[row.id] || ''} onChange={event => setAllocations(current => ({ ...current, [row.id]: event.target.value }))} placeholder="مبلغ تخصیص به ریال" />
        </ErpField>)}</div>}
        <ErpField label="دلیل / شرح عملیات" required><ErpTextarea required minLength={8} value={reason} onChange={event => setReason(event.target.value)} /></ErpField>
        <ErpField label="مرجع مستندات" required><ErpInput required value={reference} onChange={event => setReference(event.target.value)} placeholder="شماره رسید، نامه یا مرجع مدرک" /></ErpField>
        <ErpDisclosure title="دوره و حساب‌های ثبت" expanded={!periodId || !ruleId}>
          <div className="grid gap-4 md:grid-cols-2"><ErpField label="دوره مالی" required><ErpSearchableSelect required value={periodId} onChange={event => setPeriodId(event.target.value)} aria-label="دوره مالی"><option value="">انتخاب دوره</option>{context.periods.map(row => <option key={row.id} value={row.id}>{row.fiscalYear.titlePersian} · {row.titlePersian}</option>)}</ErpSearchableSelect></ErpField>
            <ErpField label="قاعده ثبت مشتری" required><ErpSearchableSelect required value={ruleId} onChange={event => { setRuleId(event.target.value); setBankId(context.rules.find(row => row.id === event.target.value)?.bankClearingAccountId || ''); }} aria-label="قاعده ثبت مشتری"><option value="">انتخاب قاعده</option>{context.rules.map(row => <option key={row.id} value={row.id}>{row.code} · نسخه {row.version.toLocaleString('fa-IR')}</option>)}</ErpSearchableSelect></ErpField>
            {isCash && <ErpField label="حساب دفترکل بانک / صندوق" required><ErpSearchableSelect value={bankId} onChange={event => setBankId(event.target.value)} required aria-label="حساب دفترکل بانک"><option value="">انتخاب حساب</option>{context.accounts.filter(row => row.financialAccountRequirement !== 'FORBIDDEN').map(row => <option key={row.id} value={row.id}>{row.code} · {row.titlePersian}</option>)}</ErpSearchableSelect></ErpField>}
          </div>
        </ErpDisclosure>
        <ErpCheckbox checked={confirmed} onChange={event => setConfirmed(event.target.checked)} label="اطلاعات و اثر مالی را بررسی کردم؛ ثبت قطعی انجام شود." />
        {error && <ErpInlineState kind="error" title={error} />}
        <div className="flex flex-wrap justify-end gap-3"><ErpButton label="انصراف" tone="neutral" onClick={onClose} disabled={pending} />
          <ErpButton type="submit" label={pending ? 'در حال ثبت…' : 'ثبت قطعی'} tone={kind === 'REFUND' || kind === 'REVERSE_ALLOCATION' ? 'warning' : 'primary'} disabled={pending || !confirmed || !periodId || !selectedRule} /></div>
      </fieldset></form>}
  </ErpSheet>;
}
