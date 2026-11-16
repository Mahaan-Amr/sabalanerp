'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { ErpBadge, ErpButton, ErpCard, ErpCheckbox, ErpDisclosure, ErpEmptyState, ErpField, ErpInlineState, ErpInput, ErpPersianDateField, ErpSearchableSelect, ErpSheet, ErpSummaryGrid, ErpTextarea } from '@/components/erp';
import { accountingAPI, browserSessionContinuation } from '@/lib/api';
import { useUnarchivedDraftGuard } from '@/lib/useUnarchivedDraftGuard';
import { accountingFailureMessage } from './accountingUi';
import type { CustomerAccount } from './customerAccountModel';
import type { CustomerFinanceContext } from './CustomerReceiptPartsFields';
import CustomerAllocationTable from './CustomerAllocationTable';
import { customerAllocationData, customerAllocationPlan, emptyAllocationDraft, fillCustomerAllocation, tomanInput, tomanMoney, tomanRials, ZERO, type AllocationDraft } from './customerAllocationPlan';
import { readPendingAllocation, reservePendingAllocation, retirePendingAllocation, type PendingAllocation } from './customerAllocationPending';
import styles from './customerAllocation.module.css';

const todayTehran = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran' }).format(new Date());
type AllocationCommand = {
  kind: 'ALLOCATION'; amountRials: string; allocations: never[]; sourceAllocations: ReturnType<typeof customerAllocationPlan>['sourceAllocations'];
  occurredAt: string; periodId: string; postingRuleId: string; reason: string; reference: string; confirmed: boolean; idempotencyKey: string;
};
function responseCode(error: unknown) {
  return (error as { response?: { data?: { code?: string } } })?.response?.data?.code;
}
function accountingContextAt(context: CustomerFinanceContext | undefined, date: string) {
  const at = new Date(`${date}T00:00:00.000Z`).getTime();
  return {
    periods: context?.periods.filter(row => new Date(row.startsAt).getTime() <= at && new Date(row.endsAt).getTime() >= at) || [],
    rules: context?.rules.filter(row => new Date(row.effectiveFrom).getTime() <= at && (!row.effectiveTo || new Date(row.effectiveTo).getTime() >= at)) || [],
  };
}
function preferredContextId(current: string, choices: { id: string }[]) {
  return choices.some(row => row.id === current) ? current : choices.length === 1 ? choices[0].id : '';
}

export default function CustomerAllocationWorkspace({ accountId, account, onRefresh, sourceSelection }: {
  accountId: string; account: CustomerAccount; onRefresh: () => Promise<void>; sourceSelection?: { key: string; revision: number };
}) {
  const { user } = useAuth();
  const ownerRef = useRef(user?.id);
  ownerRef.current = user?.id;
  const scopeRef = useRef({ accountId, bookId: account.bookId, customerId: account.customerId });
  scopeRef.current = { accountId, bookId: account.bookId, customerId: account.customerId };
  const data = useMemo(() => customerAllocationData(account), [account]);
  const [draft, setDraft] = useState<AllocationDraft>(emptyAllocationDraft);
  const [search, setSearch] = useState('');
  const [review, setReview] = useState(false);
  const [context, setContext] = useState<CustomerFinanceContext>();
  const [contextError, setContextError] = useState<string>();
  const [date, setDate] = useState(todayTehran);
  const [periodId, setPeriodId] = useState('');
  const [ruleId, setRuleId] = useState('');
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [posted, setPosted] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [storageState, setStorageState] = useState<'checking' | 'ready' | 'blocked'>('checking');
  const [recovered, setRecovered] = useState(false);
  const durableRequest = useRef<PendingAllocation>();
  const request = useRef<{ fingerprint: string; command: AllocationCommand }>();
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const contextSequence = useRef(0);
  const consumedSelection = useRef<number>();
  const plan = useMemo(() => customerAllocationPlan(data, draft), [data, draft]);
  const locked = pending || uncertain || posted || storageState !== 'ready';
  useUnarchivedDraftGuard('customer-allocation', review || locked || draft.selected.length > 0 || draft.enabled.length > 0 || Object.keys(draft.amounts).length > 0 || Object.keys(draft.budgets).length > 0 || Boolean(reason || reference || periodId || ruleId) || date !== todayTehran());
  const canAllocate = account.capabilities.canManageTreasury;
  const { periods: matchingPeriods, rules: matchingRules } = accountingContextAt(context, date);
  const validContext = matchingPeriods.some(row => row.id === periodId) && matchingRules.some(row => row.id === ruleId) && date <= todayTehran();
  const validEvidence = reason.trim().length >= 8 && Boolean(reference.trim()) && validContext;
  const unusableSelectedSource = draft.enabled.some(key => !data.sources.some(row => row.key === key && !row.unavailable));

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let cancelled = false;
    setStorageState('checking');
    durableRequest.current = undefined; request.current = undefined;
    setUncertain(false); setRecovered(false); setPosted(false);
    if (!user?.id || !account.bookId || !account.customerId) { setStorageState('blocked'); return; }
    const owner = user.id, bookId = account.bookId, customerId = account.customerId;
    void (async () => {
      try {
        const lease = await browserSessionContinuation.acquire();
        const assertOwner = () => {
          if (cancelled || ownerRef.current !== owner || lease.userId !== owner || scopeRef.current.accountId !== accountId
            || scopeRef.current.bookId !== bookId || scopeRef.current.customerId !== customerId) throw new Error('ALLOCATION_OWNER_CHANGED');
          browserSessionContinuation.assertCurrent(lease);
        };
        assertOwner();
        const saved = await readPendingAllocation(bookId, customerId, assertOwner);
        assertOwner();
        if (saved) {
          if (saved.owner !== owner || saved.accountId !== accountId) throw new Error('ALLOCATION_OWNER_CHANGED');
          const command = saved.command as unknown as AllocationCommand;
          durableRequest.current = saved;
          request.current = { fingerprint: JSON.stringify(command), command };
          setDraft(saved.draft); setDate(command.occurredAt.slice(0, 10)); setPeriodId(command.periodId); setRuleId(command.postingRuleId);
          setReason(command.reason); setReference(command.reference); setConfirmed(false); setUncertain(true); setRecovered(true);
          setError('نتیجهٔ درخواست قبلی هنوز روشن نیست؛ ابتدا وضعیت همان درخواست را بررسی کنید.');
        }
        if (!cancelled) setStorageState('ready');
      } catch {
        if (!cancelled) { setStorageState('blocked'); setError('حفظ یا بازیابی درخواست تأیید نشد؛ امکان ثبت جدید وجود ندارد.'); }
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id, accountId, account.bookId, account.customerId]);
  useEffect(() => { setConfirmed(false); }, [draft, date, periodId, ruleId, reason, reference, account]);
  useEffect(() => {
    if (!sourceSelection || !canAllocate || consumedSelection.current === sourceSelection.revision) return;
    if (locked) { setError('ابتدا نتیجه تخصیص قبلی را روشن کنید؛ درخواست آن حفظ شده است.'); return; }
    consumedSelection.current = sourceSelection.revision;
    // Reopening from a receipt carries that source into an existing draft.
    setDraft(current => ({ ...current, enabled: Array.from(new Set([...current.enabled, sourceSelection.key])) }));
    setNotice(undefined);
  }, [sourceSelection, canAllocate, locked]);
  useEffect(() => {
    if (!context) return;
    const { periods, rules } = accountingContextAt(context, date);
    setPeriodId(current => preferredContextId(current, periods));
    setRuleId(current => preferredContextId(current, rules));
  }, [context, date]);

  const loadContext = useCallback(async () => {
    const sequence = ++contextSequence.current;
    setContext(undefined); setContextError(undefined); setConfirmed(false);
    try {
      const response = await accountingAPI.getCustomerWorkspaceContext(accountId);
      if (mounted.current && sequence === contextSequence.current) {
        const next: CustomerFinanceContext = response.data.data;
        const { periods, rules } = accountingContextAt(next, date);
        setPeriodId(current => preferredContextId(current, periods));
        setRuleId(current => preferredContextId(current, rules));
        setContext(next);
      }
    } catch (failure) {
      if (mounted.current && sequence === contextSequence.current) setContextError(accountingFailureMessage(failure, 'اطلاعات ثبت مالی بارگیری نشد.'));
    }
  }, [accountId, date]);

  function changeDraft(next: AllocationDraft) {
    if (locked || !canAllocate) return;
    setDraft(next); setConfirmed(false); setError(undefined); setNotice(undefined);
  }
  function startReview() {
    if (!canAllocate || !plan.valid || locked) return;
    setReview(true); setError(undefined); void loadContext();
  }
  async function refreshPosted() {
    if (inFlight.current) return;
    inFlight.current = true; setPending(true);
    try {
      await onRefresh();
      if (!mounted.current) return;
      if (!durableRequest.current || !ownerRef.current || durableRequest.current.owner !== ownerRef.current
        || durableRequest.current.accountId !== accountId) throw new Error('ALLOCATION_PENDING_UNVERIFIED');
      const owner = ownerRef.current, lease = await browserSessionContinuation.acquire();
      const assertOwner = () => { if (!mounted.current || ownerRef.current !== owner || lease.userId !== owner || scopeRef.current.accountId !== accountId
        || scopeRef.current.bookId !== durableRequest.current?.bookId || scopeRef.current.customerId !== durableRequest.current?.customerId) throw new Error('ALLOCATION_OWNER_CHANGED'); browserSessionContinuation.assertCurrent(lease); };
      await retirePendingAllocation(durableRequest.current, assertOwner);
      durableRequest.current = undefined;
      setDraft(emptyAllocationDraft()); setPosted(false); setUncertain(false); setReview(false); setConfirmed(false);
      setRecovered(false);
      setReason(''); setReference(''); setContext(undefined); setPeriodId(''); setRuleId(''); setDate(todayTehran()); setError(undefined); request.current = undefined;
    } catch (failure) {
      if (mounted.current) setError(accountingFailureMessage(failure, 'تخصیص ثبت شده است؛ برای دیدن مانده تازه، به‌روزرسانی را دوباره انجام دهید.'));
    } finally {
      inFlight.current = false;
      if (mounted.current) setPending(false);
    }
  }
  async function save() {
    if (inFlight.current || !canAllocate || posted || recovered || storageState !== 'ready') return;
    if (!uncertain) {
      if (!plan.valid || !validEvidence || !confirmed) return;
      // Persist the same JSON shape sent over HTTP; optional source IDs may be undefined in the view model.
      const sourceAllocations = JSON.parse(JSON.stringify(plan.sourceAllocations)) as AllocationCommand['sourceAllocations'];
      const payload = { kind: 'ALLOCATION' as const, amountRials: '0', allocations: [] as never[], sourceAllocations,
        occurredAt: new Date(`${date}T00:00:00.000Z`).toISOString(), periodId, postingRuleId: ruleId, reason: reason.trim(), reference: reference.trim(), confirmed: true };
      const fingerprint = JSON.stringify(payload);
      if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, command: { ...payload, idempotencyKey: crypto.randomUUID() } };
    }
    if (!request.current) return;
    inFlight.current = true; setPending(true); setError(undefined);
    let saved = false;
    try {
      const owner = ownerRef.current, bookId = account.bookId, customerId = account.customerId;
      if (!owner || !bookId || !customerId) throw new Error('ALLOCATION_OWNER_UNPROVEN');
      const lease = await browserSessionContinuation.acquire();
      const assertOwner = () => { if (!mounted.current || ownerRef.current !== owner || lease.userId !== owner || scopeRef.current.accountId !== accountId
        || scopeRef.current.bookId !== bookId || scopeRef.current.customerId !== customerId) throw new Error('ALLOCATION_OWNER_CHANGED'); browserSessionContinuation.assertCurrent(lease); };
      assertOwner();
      if (!durableRequest.current) {
        durableRequest.current = await reservePendingAllocation({ owner, bookId, customerId, accountId, command: request.current.command, draft }, assertOwner);
      }
      if (durableRequest.current.owner !== owner || durableRequest.current.accountId !== accountId) throw new Error('ALLOCATION_OWNER_CHANGED');
      assertOwner();
      await accountingAPI.recordCustomerWorkspaceTreasury(accountId, request.current.command, lease);
      assertOwner();
      if (!mounted.current) return;
      setUncertain(false); setPosted(true); setNotice(`تخصیص ${tomanMoney(plan.total)} ثبت شد.`);
      saved = true;
    } catch (failure) {
      if (!mounted.current) return;
      if (!durableRequest.current) {
        setStorageState('blocked'); setUncertain(true);
        setError('حفظ درخواست تأیید نشد؛ برای جلوگیری از ثبت تکراری، این صفحه را بازبینی کنید.');
        return;
      }
      // HTTP status alone cannot prove that a forwarded request did not commit.
      // Keep the exact durable request until an authoritative outcome is proven.
      setUncertain(true);
      setError(responseCode(failure) === 'CUSTOMER_SOURCE_SHARES_CLOSED'
        ? 'نتیجه درخواست مشخص نیست و بررسی خودکار فعلاً در دسترس نیست؛ اطلاعات درخواست را حفظ کنید.'
        : 'نتیجه ثبت مشخص نیست؛ با «تلاش دوباره همان درخواست» نتیجه را بررسی کنید. اطلاعات درخواست تا روشن‌شدن نتیجه حفظ می‌شود.');
    } finally {
      inFlight.current = false;
      if (mounted.current) setPending(false);
    }
    if (saved) await refreshPosted();
  }

  async function checkRecoveredStatus() {
    if (inFlight.current || !request.current || !durableRequest.current || !canAllocate) return;
    inFlight.current = true; setPending(true); setError(undefined);
    let committed = false;
    try {
      const owner = ownerRef.current, saved = durableRequest.current;
      if (!owner || !saved || saved.owner !== owner || saved.accountId !== accountId) throw new Error('ALLOCATION_OWNER_UNPROVEN');
      const lease = await browserSessionContinuation.acquire();
      if (!mounted.current || ownerRef.current !== owner || lease.userId !== owner || scopeRef.current.accountId !== saved.accountId
        || scopeRef.current.bookId !== saved.bookId || scopeRef.current.customerId !== saved.customerId) throw new Error('ALLOCATION_OWNER_CHANGED');
      browserSessionContinuation.assertCurrent(lease);
      const response = await accountingAPI.getCustomerAllocationCommandStatus(accountId, request.current.command, lease);
      if (!mounted.current) return;
      if (ownerRef.current !== owner || scopeRef.current.accountId !== saved.accountId || scopeRef.current.bookId !== saved.bookId
        || scopeRef.current.customerId !== saved.customerId) throw new Error('ALLOCATION_OWNER_CHANGED');
      browserSessionContinuation.assertCurrent(lease);
      if (response.data?.data?.status === 'COMMITTED') { setUncertain(false); setPosted(true); committed = true; }
      else setError('نتیجهٔ درخواست هنوز تأیید نشده است؛ ثبت جدید انجام ندهید.');
    } catch { if (mounted.current) setError('بررسی وضعیت فعلاً در دسترس نیست؛ درخواست قبلی محفوظ است.'); }
    finally { inFlight.current = false; if (mounted.current) setPending(false); }
    if (committed) await refreshPosted();
  }

  const sourceUse = (key: string) => plan.shares.filter(row => row.sourceKey === key).reduce((sum, row) => sum + row.amountRials, ZERO);
  const footer = <div className={styles.footer}><span>{draft.selected.length.toLocaleString('fa-IR')} بدهی انتخاب‌شده · {tomanMoney(plan.total)}</span><div className="flex flex-wrap gap-2">
    <ErpButton label="تکمیل مانده انتخاب‌شده" tone="neutral" disabled={!canAllocate || locked || !draft.selected.length || plan.capacity === ZERO || Boolean(Object.keys(plan.sourceErrors).length)} onClick={() => changeDraft(fillCustomerAllocation(data, draft))} />
    <ErpButton label="بررسی تخصیص" variant="solid" disabled={!canAllocate || locked || !plan.valid} onClick={startReview} />
  </div></div>;
  return <section aria-label="تخصیص به بدهی‌های مشتری" className={styles.workspace}>
    <h2 className={styles.heading}>تخصیص به بدهی‌های مشتری</h2>
    <ErpSummaryGrid columns={3} items={[
      { label: 'بدهی باز', value: tomanMoney(data.debts.reduce((sum, row) => sum + row.remaining, ZERO)) },
      { label: 'منابع قابل تخصیص', value: tomanMoney(data.sources.filter(row => !row.unavailable).reduce((sum, row) => sum + row.remaining, ZERO)) },
      { label: 'تخصیص این‌بار', value: tomanMoney(plan.total) },
    ]} />
    {notice && <ErpInlineState kind="success" title={notice} />}
    {storageState === 'blocked' && <ErpInlineState kind="error" title="دسترسی به وضعیت محفوظ درخواست تأیید نشد؛ ثبت جدید ممکن نیست." />}
    {!canAllocate && <ErpInlineState kind="permission" title="دسترسی ثبت تخصیص برای این حساب ندارید." />}
    {uncertain && <ErpInlineState kind="error" title="نتیجه درخواست قبلی هنوز مشخص نیست؛ پیش‌نویس آن حفظ شده است." action={{ label: 'ادامه بررسی درخواست قبلی', onClick: () => setReview(true) }} />}
    {posted && <ErpInlineState kind="stale" title="تخصیص ثبت شده است؛ مانده‌ها باید بازخوانی شوند." action={{ label: 'به‌روزرسانی مانده‌ها', onClick: () => void refreshPosted() }} />}
    <ErpDisclosure title={`منابع تخصیص · ${draft.enabled.length.toLocaleString('fa-IR')} منبع انتخاب‌شده`} expanded>
      <div className={styles.sourceBudgets}>
        {!data.sources.length && <ErpEmptyState title="منبع قابل تخصیص وجود ندارد" />}
        {data.sources.map(source => <div key={source.key} className={styles.source}>
          <div className={styles.sourceTop}><ErpCheckbox checked={draft.enabled.includes(source.key)} disabled={!canAllocate || locked || Boolean(source.unavailable)} label={source.label}
            onChange={event => changeDraft({ ...draft, enabled: event.target.checked ? [...draft.enabled, source.key] : draft.enabled.filter(key => key !== source.key) })} />
            <ErpBadge tone="neutral">{tomanMoney(source.remaining)}</ErpBadge></div>
          <p className={styles.hint}>{source.note}</p>
          {source.unavailable && <p className={styles.error}>{source.unavailable}</p>}
          {draft.enabled.includes(source.key) && <><ErpField label="سقف مصرف این منبع · تومان" error={plan.sourceErrors[source.key]}>
            <ErpInput numberFormat="money" aria-label={`سقف ${source.label}`} disabled={!canAllocate || locked || Boolean(source.unavailable)} value={draft.budgets[source.key] ?? tomanInput(source.remaining)}
              onChange={event => changeDraft({ ...draft, budgets: { ...draft.budgets, [source.key]: event.target.value } })} />
          </ErpField><p className={styles.hint}>مصرف این‌بار: {tomanMoney(sourceUse(source.key))} · پس از تخصیص: {tomanMoney(source.remaining - sourceUse(source.key))}</p></>}
        </div>)}
        <p className={styles.hint}>سهم‌ها به ترتیب نمایش منابع پیشنهاد می‌شوند؛ پیش از تأیید قابل بررسی‌اند. همه مبالغ به تومان است.</p>
      </div>
    </ErpDisclosure>
    <CustomerAllocationTable groups={data.groups} draft={draft} plan={plan} search={search} onSearch={setSearch} onChange={changeDraft} disabled={!canAllocate || locked} footer={footer} />
    {plan.error && <ErpInlineState kind="error" title={plan.error} action={unusableSelectedSource ? { label: 'حذف منابع بدون مانده', disabled: locked || !canAllocate,
      onClick: () => changeDraft({ ...draft, enabled: draft.enabled.filter(key => data.sources.some(row => row.key === key && !row.unavailable)) }) } : undefined} />}
    {!review && error && <ErpInlineState kind="error" title={error} />}
    <ErpSheet open={review} onClose={() => setReview(false)} title="بررسی و تأیید تخصیص" presentation="modal" size="wide" pending={pending}
      footer={<div className="flex flex-wrap gap-2"><ErpButton label="بازگشت و ویرایش" tone="neutral" disabled={pending} onClick={() => setReview(false)} />
        {posted ? <ErpButton label="به‌روزرسانی مانده‌ها" variant="solid" disabled={pending} onClick={() => void refreshPosted()} />
          : recovered ? <ErpButton label="بررسی وضعیت درخواست" variant="solid" disabled={pending || !canAllocate} onClick={() => void checkRecoveredStatus()} />
          : <ErpButton label={pending ? 'در حال ثبت…' : uncertain ? 'تلاش دوباره همان درخواست' : 'ثبت قطعی تخصیص'} variant="solid" disabled={pending || !canAllocate || (!uncertain && (!plan.valid || !validEvidence || !confirmed))} onClick={() => void save()} />}
      </div>}>
      <div className={styles.review}>
        {error && <ErpInlineState kind="error" title={error} />}
        {plan.error && <ErpInlineState kind="stale" title={plan.error} />}
        <ErpSummaryGrid columns={3} items={[{ label: 'جمع تخصیص', value: tomanMoney(plan.total) }, { label: 'تعداد بدهی', value: plan.selectedDebts.filter(row => (tomanRials(draft.amounts[row.item.id] || '') ?? ZERO) > ZERO).length.toLocaleString('fa-IR') },
          { label: 'مانده منابع منتخب پس از تخصیص', value: tomanMoney(plan.enabledSources.reduce((sum, row) => sum + row.remaining, ZERO) - plan.total) }]} />
        <h3 className="font-bold">سهم منابع و مانده بدهی‌ها</h3>
        {plan.selectedDebts.filter(row => (tomanRials(draft.amounts[row.item.id] || '') ?? ZERO) > ZERO).map(debt => <ErpCard key={debt.item.id} className="p-4">
          <strong>{data.groups.find(row => row.id === debt.groupId)?.label} / {debt.label}</strong>
          <p className={styles.hint}>مانده قبل: {tomanMoney(debt.remaining)} · مانده بعد: {tomanMoney(debt.remaining - (tomanRials(draft.amounts[debt.item.id] || '') ?? ZERO))}</p>
          {plan.shares.filter(row => row.debtId === debt.item.id).map(share => <div key={share.sourceKey} className={styles.share}><span>{data.sources.find(row => row.key === share.sourceKey)?.label}</span><strong>{tomanMoney(share.amountRials)}</strong></div>)}
        </ErpCard>)}
        {contextError ? <ErpInlineState kind="error" title={contextError} action={{ label: 'بارگیری دوباره اطلاعات ثبت', onClick: () => void loadContext() }} /> : !context ? <ErpInlineState kind="empty" title="در حال بارگیری اطلاعات ثبت مالی…" /> : <fieldset disabled={locked} className="grid min-w-0 gap-4">
          <ErpPersianDateField label="تاریخ عملیات" valueFormat="iso-date" value={date} onChange={setDate} required disableFutureDates />
          <ErpField label="دلیل / شرح عملیات" required hint="حداقل ۸ نویسه"><ErpTextarea value={reason} minLength={8} required onChange={event => setReason(event.target.value)} /></ErpField>
          <ErpField label="مرجع مستندات" required><ErpInput required value={reference} onChange={event => setReference(event.target.value)} /></ErpField>
          <ErpDisclosure title="دوره و حساب‌های ثبت" expanded={!validContext}>
            <div className="grid gap-4 md:grid-cols-2"><ErpField label="دوره مالی" required><ErpSearchableSelect aria-label="دوره مالی" value={periodId} required onChange={event => setPeriodId(event.target.value)}><option value="">انتخاب دوره</option>{matchingPeriods.map(row => <option key={row.id} value={row.id}>{row.fiscalYear.titlePersian} · {row.titlePersian}</option>)}</ErpSearchableSelect></ErpField>
              <ErpField label="قاعده ثبت مشتری" required><ErpSearchableSelect aria-label="قاعده ثبت مشتری" value={ruleId} required onChange={event => setRuleId(event.target.value)}><option value="">انتخاب قاعده</option>{matchingRules.map(row => <option key={row.id} value={row.id}>{row.code} · نسخه {row.version.toLocaleString('fa-IR')}</option>)}</ErpSearchableSelect></ErpField></div>
            {!matchingPeriods.length && <ErpInlineState kind="permission" title="برای این تاریخ دوره مالی بازی وجود ندارد." />}
            {!matchingRules.length && <ErpInlineState kind="permission" title="برای این تاریخ قاعده ثبت معتبر وجود ندارد." />}
          </ErpDisclosure>
          <ErpCheckbox checked={confirmed} onChange={event => setConfirmed(event.target.checked)} label="مبلغ بدهی‌ها و سهم دقیق منابع را بررسی و تأیید می‌کنم." />
        </fieldset>}
      </div>
    </ErpSheet>
  </section>;
}
