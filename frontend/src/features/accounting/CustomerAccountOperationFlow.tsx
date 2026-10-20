'use client';
import FormattedNumberInput from '@/components/FormattedNumberInput';

import { useEffect, useRef, useState } from 'react';
import {useUnarchivedDraftGuard} from '@/lib/useUnarchivedDraftGuard';
import { ErpButton, ErpCheckbox, ErpDisclosure, ErpField, ErpInlineState, ErpInput, ErpPersianDateField, ErpSearchableSelect, ErpSheet, ErpSummaryGrid, ErpTextarea } from '@/components/erp';
import { accountingAPI } from '@/lib/api';
import { accountingFailureMessage, dateFa } from './accountingUi';
import { accountMoney, accountOperationLabels, accountStatusLabels, normalizeAccountAmount, receiptIsCheck, receiptRemainingRials, type AccountOperationKind, type CustomerAccount } from './customerAccountModel';
import { allocationPlanPayload, newOpeningLine, newReceiptPart, openingLinesPayload, receiptPartsPayload, rialsInput, type OpeningLineDraft, type ReceiptPartDraft } from './customerFinanceDraft';
import CustomerReceiptPartsFields, { type CustomerFinanceContext } from './CustomerReceiptPartsFields';
import CustomerOpeningFields from './CustomerOpeningFields';

export default function CustomerAccountOperationFlow({ accountId, account, kind, allocationId, onClose, onSaved }: {
  accountId: string; account: CustomerAccount; kind: AccountOperationKind; allocationId?: string; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const [context, setContext] = useState<CustomerFinanceContext>();
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
  const [parts, setParts] = useState<ReceiptPartDraft[]>([newReceiptPart('first')]);
  const [opening, setOpening] = useState<CustomerAccount>();
  const [openingLines, setOpeningLines] = useState<OpeningLineDraft[]>([]);
  const [identityConfirmed, setIdentityConfirmed] = useState(false);
  const [totalConfirmed, setTotalConfirmed] = useState(false);
  const [shares, setShares] = useState<Record<string, Record<string, string>>>({});
  const [reversals, setReversals] = useState<Record<string, Record<string, string>>>({});
  const [unpaid, setUnpaid] = useState('');
  const [collectionId, setCollectionId] = useState('');
  const [lineKey, setLineKey] = useState('');
  const [contractId, setContractId] = useState('');
  const [recordId, setRecordId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [refundShares, setRefundShares] = useState<Record<string, Record<string, string>>>({});
  const request = useRef<{ fingerprint: string; key: string }>();
  const inFlight = useRef(false);
  useUnarchivedDraftGuard('customer-account-operation',true);
  const isResolution = kind === 'RESOLVE_RECEIPT';
  const isEndorsement = kind === 'CHECK_ENDORSE' || kind === 'CHECK_RECIPIENT_RETURN';
  const isTreasury = ['RECEIPT', 'ALLOCATION', 'REVERSE_ALLOCATION', 'CORRECT_RECEIPT', 'CANCEL_RECEIPT', 'CHECK_DEPOSIT', 'CHECK_SETTLE', 'RESOLVE_RECEIPT', 'CHECK_ENDORSE', 'CHECK_RECIPIENT_RETURN'].includes(kind);
  const isCheckBank = kind === 'CHECK_DEPOSIT' || kind === 'CHECK_SETTLE';
  const isCorrection = kind === 'CORRECT_RECEIPT' || kind === 'CANCEL_RECEIPT';
  const isCash = kind === 'REFUND' || isCheckBank;
  const hasAmount = !['RECEIPT', 'ALLOCATION', 'REVERSE_ALLOCATION', 'CANCEL_RECEIPT', 'CHECK_DEPOSIT', 'ATTRIBUTION', 'RESOLVE_RECEIPT', 'CHECK_ENDORSE', 'CHECK_RECIPIENT_RETURN'].includes(kind);
  const isBalance = kind === 'OPENING' || kind === 'SET_BALANCE';
  const receiptSources = account.receipts.filter(row => kind === 'REFUND' ? BigInt(row.refundableRials ?? (receiptIsCheck(row) ? '0' : receiptRemainingRials(row))) > BigInt(0) : isResolution ? !row.checkInstrumentId && !row.sourceParentId && BigInt(row.effectiveAmountRials ?? row.amountRials) > BigInt(0) : isCheckBank || isEndorsement ? receiptIsCheck(row) : isCorrection ? BigInt(row.effectiveAmountRials ?? row.amountRials) > BigInt(0) : BigInt(receiptRemainingRials(row)) > BigInt(0));
  const creditSources = account.openItems.filter(row => row.kind === 'CREDIT');
  const receipt = account.receipts.find(row => source === `receipt:${row.id}`);
  const check = account.treasuryChecks.find(row => row.id === (receipt?.checkInstrumentId ?? receipt?.source?.id));
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
  useEffect(() => {
    if (kind !== 'OPENING') return;
    let current = true;
    setOpening(undefined); setIdentityConfirmed(false); setTotalConfirmed(false);
    if (!date || !Number.isFinite(new Date(date).getTime())) return;
    accountingAPI.getCustomerWorkspace(accountId, { openingBasisAt: new Date(date).toISOString() }).then(response => {
      if (!current) return;
      const snapshot: CustomerAccount = response.data.data;
      setOpening(snapshot);
      setOpeningLines(snapshot.openingSources?.length ? snapshot.openingSources.map(row => ({ ...newOpeningLine(row.id), kind: row.kind, amount: row.amountRials, existingSourceIds: [row.id] })) : [newOpeningLine('unattributed')]);
    }).catch(reason => { if (current) setError(accountingFailureMessage(reason, 'تطبیق افتتاحیه بارگیری نشد.')); });
    return () => { current = false; };
  }, [accountId, kind, date, retry]);
  useEffect(() => { setConfirmed(false); }, [value, date, periodId, ruleId, counterId, bankId, financialId, source, reason, reference, parts, openingLines, shares, reversals, unpaid, collectionId, identityConfirmed, totalConfirmed, lineKey, contractId, recordId, supplierId, refundShares]);
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    setError(undefined);
    let payload;
    try {
    const componentPayload = kind === 'RECEIPT' || isResolution ? receiptPartsPayload(parts) : undefined;
    const normalized = componentPayload ? componentPayload.reduce((sum, row) => sum + BigInt(row.amountRials), BigInt(0)).toString() : hasAmount ? rialsInput(value, isBalance) : '0';
    payload = { kind, amountRials: normalized, periodId, postingRuleId: ruleId, counterAccountId: counterId || undefined,
      bankLedgerId: bankId || undefined, financialAccountId: financialId || undefined,
      receiptId: source.startsWith('receipt:') ? source.slice(8) : undefined, creditItemId: source.startsWith('credit:') ? source.slice(7) : undefined,
      allocationId, occurredAt: new Date(date).toISOString(), reason, reference, confirmed, allocations: kind === 'CHECK_ENDORSE' ? Object.entries(shares.supplier || {}).filter(([, amount]) => amount.trim()).map(([openItemId, amount]) => ({ openItemId, amountRials: rialsInput(amount) })) : [], supplierPartyId: supplierId || undefined,
      expectedBalanceRials: kind === 'SET_BALANCE' ? account.netBalanceRials : undefined, parts: componentPayload,
      sourceAllocations: kind === 'ALLOCATION' ? allocationPlanPayload(shares) : undefined,
      expectedAmountRials: isCorrection || isResolution ? receipt?.effectiveAmountRials ?? receipt?.amountRials : undefined,
      expectedSequence: isCheckBank || isEndorsement ? check?.events?.[0]?.sequence : undefined, collectionLedgerId: collectionId || undefined,
      resolvedShares: isResolution ? parts.map(part => ({ partKey: part.key, allocations: Object.entries(shares[part.key] || {}).filter(([, amount]) => amount.trim()).map(([openItemId, amount]) => ({ openItemId, amountRials: rialsInput(amount) })),
        refunds: Object.entries(refundShares[part.key] || {}).filter(([, amount]) => amount.trim()).map(([refundId, amount]) => ({ refundId, amountRials: rialsInput(amount) })) })) : undefined,
      unpaidRials: kind === 'CHECK_SETTLE' ? rialsInput(unpaid || '0') : undefined,
      reversals: isCorrection || kind === 'CHECK_SETTLE' ? Object.entries(reversals).map(([allocationId, amounts]) => ({ allocationId, lines: Object.entries(amounts).filter(([, value]) => value.trim()).map(([openItemId, value]) => ({ openItemId, amountRials: rialsInput(value) })) })).filter(row => row.lines.length) : undefined,
      openingReview: kind === 'OPENING' && opening ? { expectedSnapshotHash: opening.openingSnapshotHash, identityConfirmed, totalConfirmed, lines: openingLinesPayload(openingLines, opening, value) } : undefined,
      lineKey, contractId: contractId || undefined, financialRecordId: recordId || undefined, expectedSnapshotHash: account.openingSnapshotHash,
      attributionSequence: account.openingAttributions?.find(row => row.lineKey === lineKey)?.sequence ?? 0 };
    if (kind === 'OPENING' && !payload.openingReview) throw new Error('تطبیق افتتاحیه را بارگیری کنید.');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'اطلاعات معتبر نیست.'); return; }
    const fingerprint = JSON.stringify(payload);
    if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, key: crypto.randomUUID() };
    inFlight.current = true; setPending(true);
    try {
      if (kind === 'ATTRIBUTION') await accountingAPI.attributeCustomerOpening(accountId, { ...payload, expectedSequence: payload.attributionSequence, idempotencyKey: request.current.key });
      else if (isTreasury) await accountingAPI.recordCustomerWorkspaceTreasury(accountId, { ...payload, idempotencyKey: request.current.key });
      else await accountingAPI.recordCustomerAccountOperation(accountId, { ...payload, idempotencyKey: request.current.key });
      await onSaved();
      onClose();
    } catch (reason) { setError(accountingFailureMessage(reason, 'عملیات ثبت نشد؛ اطلاعات را بررسی کنید و دوباره تلاش کنید.')); }
    finally { inFlight.current = false; setPending(false); }
  }
  return <ErpSheet open onClose={onClose} title={accountOperationLabels[kind]} presentation="modal" size="wide" pending={pending}>
    <div className="mb-5"><strong>{account.displayName}</strong><span className="mt-1 block text-sm sds-text-secondary">مانده فعلی: {accountMoney(account.netBalanceRials)}</span></div>
    {contextError ? <ErpInlineState kind="error" title={contextError} action={{ label: 'تلاش دوباره', onClick: () => setRetry(value => value + 1) }} /> : !context ? <ErpInlineState kind="empty" title="در حال آماده‌سازی فرم…" /> : (!context.periods.length || !context.rules.length) && kind !== 'ATTRIBUTION' ?
      <div className="space-y-3">
        {!context.periods.length && <ErpInlineState kind="permission" title="دوره مالی بازی تعریف نشده است." action={{ label: 'بررسی دوره‌های مالی', href: '/dashboard/accounting/ledger?tab=settings' }} />}
        {!context.rules.length && <ErpInlineState kind="permission" title="قاعده ثبت حسابداری مشتری تعریف نشده است." action={{ label: 'تعریف قاعده مشتری', href: '/dashboard/accounting/ledger/customer-rules' }} />}
      </div> :
      <form onSubmit={save} className="space-y-5"><fieldset disabled={pending} className="space-y-5">
        <div className="grid gap-4 md:grid-cols-2">
          {hasAmount && <ErpField label={kind === 'OPENING' ? 'مانده کل تأییدشده (ریال)' : kind === 'SET_BALANCE' ? 'مانده مطلوب (ریال)' : kind === 'CORRECT_RECEIPT' ? 'مبلغ صحیح دریافت (ریال)' : kind === 'CHECK_SETTLE' ? 'مبلغ وصول‌شده (ریال)' : 'مبلغ (ریال)'} required hint={isBalance ? 'بدهکار مثبت، بستانکار منفی' : undefined}>
            <FormattedNumberInput decimalScale={null} required value={value} onTextChange={next => { setValue(next); setConfirmed(false); }} /></ErpField>}
          {kind !== 'ATTRIBUTION' && <ErpPersianDateField label={kind === 'OPENING' ? 'تاریخ مبنای افتتاحیه' : 'تاریخ عملیات'} value={date} onChange={setDate} valueFormat="iso-date" required disableFutureDates />}
          {isCash && <ErpField label={kind === 'REFUND' ? 'حساب پرداخت وجه' : 'حساب دریافت وجه'} required><ErpSearchableSelect value={financialId} onChange={event => setFinancialId(event.target.value)} required aria-label="حساب مالی">
            <option value="">انتخاب حساب</option>{context.financialAccounts.filter(row => row.currency === 'IRR').map(row => <option key={row.id} value={row.id}>{row.titlePersian}</option>)}
          </ErpSearchableSelect></ErpField>}
          {(kind === 'REFUND' || isCorrection || isCheckBank || isResolution || isEndorsement) && <ErpField label={kind === 'REFUND' ? 'منبع قابل استرداد' : 'دریافت مرتبط'} required><ErpSearchableSelect value={source} onChange={event => { setSource(event.target.value); setReversals({}); setShares({}); setRefundShares({}); }} required aria-label="منبع وجه">
            <option value="">انتخاب منبع</option>{receiptSources.map(row => <option key={row.id} value={`receipt:${row.id}`}>{accountStatusLabels[row.componentKind ?? 'BANK'] || 'دریافت'} {dateFa(row.occurredAt)} · {accountMoney(kind === 'REFUND' ? row.refundableRials : row.effectiveAmountRials ?? row.amountRials)}</option>)}
            {kind === 'REFUND' && creditSources.map(row => <option key={row.id} value={`credit:${row.id}`}>{row.invoiceNumber} · {accountMoney(row.remainingRials)}</option>)}
          </ErpSearchableSelect></ErpField>}
          {!isTreasury && !['REFUND', 'ATTRIBUTION'].includes(kind) && <ErpField label="حساب مقابل" required><ErpSearchableSelect value={counterId} onChange={event => setCounterId(event.target.value)} required aria-label="حساب مقابل">
            <option value="">انتخاب حساب</option>{context.accounts.filter(row => row.financialAccountRequirement !== 'REQUIRED').map(row => <option key={row.id} value={row.id}>{row.code} · {row.titlePersian}</option>)}
          </ErpSearchableSelect></ErpField>}
        </div>
        {(kind === 'RECEIPT' || isResolution) && <CustomerReceiptPartsFields context={context} parts={parts} onChange={setParts} />}
        {isResolution && receipt && <>
          <ErpInlineState kind="stale" title="ابزارها و سهم تمام مصرف‌ها و استردادهای قبلی را با مدرک تطبیق دهید؛ جمع حساب مشتری ثابت می‌ماند." />
          <ErpSummaryGrid items={[{ label: 'مبلغ مؤثر قدیمی', value: accountMoney(receipt.effectiveAmountRials ?? receipt.amountRials) }, { label: 'مصرف قبلی', value: accountMoney(receipt.allocatedRials) }, { label: 'استرداد قبلی', value: accountMoney(receipt.refundedRials) }]} />
          {parts.map((part, index) => <ErpDisclosure key={part.key} title={`سهم ابزار ${(index + 1).toLocaleString('fa-IR')}`}><div className="grid gap-3 md:grid-cols-2">
            {part.kind === 'CHECK' && <ErpField label="چک موجود بدون دریافت مرتبط"><ErpSearchableSelect aria-label={`چک موجود ابزار ${index + 1}`} value={part.existingCheckId || ''} onChange={event => {
              const existing = account.treasuryChecks.find(row => row.id === event.target.value);
              setParts(current => current.map(row => row.key === part.key ? { ...row, existingCheckId: event.target.value, existingCheckStatus: existing?.status, existingClearedRials: existing?.clearedRials, collectedLedgerId: '', ledgerId: '',
                ...(existing ? { serial: existing.serialNumber, sayad: existing.sayadId || '', bank: existing.bankName, due: existing.dueAt.slice(0, 10), amount: existing.amountRials } : {}) } : row));
            }}><option value="">ثبت ابزار از مدرک</option>{account.treasuryChecks.filter(row => !row.receipt && ['RECEIVED', 'DEPOSITED', 'CLEARED'].includes(row.status)).map(row => <option key={row.id} value={row.id}>{row.serialNumber} · {row.bankName} · {accountStatusLabels[row.status]}</option>)}</ErpSearchableSelect></ErpField>}
            {Array.from(new Set(receipt.allocations.filter(row => !row.reversedAt).flatMap(row => row.lines.map(line => line.openItemId)))).map(itemId => <ErpField key={itemId} label={account.activityItems.find(row => row.id === itemId)?.invoiceNumber || 'بدهی قبلی'}><FormattedNumberInput decimalScale={null} value={shares[part.key]?.[itemId] || ''} onTextChange={next => setShares(current => ({ ...current, [part.key]: { ...current[part.key], [itemId]: next } }))} placeholder="سهم مصرف قبلی به ریال" /></ErpField>)}
            {account.refunds.filter(row => row.refundOfId === receipt.id).map(refund => <ErpField key={refund.id} label={`استرداد ${dateFa(refund.occurredAt)}`} hint={accountMoney(refund.amountRials)}><FormattedNumberInput decimalScale={null} value={refundShares[part.key]?.[refund.id] || ''} onTextChange={next => setRefundShares(current => ({ ...current, [part.key]: { ...current[part.key], [refund.id]: next } }))} placeholder="سهم استرداد قبلی به ریال" /></ErpField>)}
          </div></ErpDisclosure>)}
        </>}
        {kind === 'CHECK_ENDORSE' && <>
          <ErpField label="گیرنده چک" required><ErpSearchableSelect required aria-label="گیرنده چک" value={supplierId} onChange={event => { setSupplierId(event.target.value); setShares({}); }}><option value="">انتخاب تأمین‌کننده</option>{context.suppliers?.map(row => <option key={row.id} value={row.id}>{row.displayName}</option>)}</ErpSearchableSelect></ErpField>
          {context.supplierOpenItems?.filter(row => row.supplierPartyId === supplierId).map(row => <ErpField key={row.id} label={`تخصیص به فاکتور ${row.invoiceNumber}`} hint={`مانده ${accountMoney(row.remainingRials)}`}><FormattedNumberInput decimalScale={null} value={shares.supplier?.[row.id] || ''} onTextChange={next => setShares(current => ({ ...current, supplier: { ...current.supplier, [row.id]: next } }))} /></ErpField>)}
          <ErpInlineState kind="empty" title="تمام مبلغ چک به گیرنده واگذار می‌شود؛ بخش تخصیص‌نیافته پیش‌پرداخت همان تأمین‌کننده است. تخصیص‌های مشتری حفظ می‌شوند." />
        </>}
        {kind === 'CHECK_RECIPIENT_RETURN' && <ErpInlineState kind="stale" title="بازگشت از گیرنده، حضانت چک و بدهی به گیرنده را برمی‌گرداند؛ عدم پرداخت بانک باید با مدرک مستقل ثبت شود." />}
        {kind === 'OPENING' && (opening ? <>
          <CustomerOpeningFields lines={openingLines} onChange={setOpeningLines} account={opening} />
          {/^-?\d+$/.test(normalizeAccountAmount(value)) && <ErpSummaryGrid items={[{ label: 'مانده کل', value: accountMoney(normalizeAccountAmount(value)) }, { label: 'خالص انتقال جدید', value: accountMoney((BigInt(normalizeAccountAmount(value)) - (opening.openingSources ?? []).reduce((sum, row) => sum + (row.kind === 'CREDIT' ? -BigInt(row.amountRials) : BigInt(row.amountRials)), BigInt(0))).toString()) }]} />}
          <ErpCheckbox checked={identityConfirmed} onChange={event => setIdentityConfirmed(event.target.checked)} label="هویت مشتری با منبع افتتاحیه تطبیق دارد." />
          <ErpCheckbox checked={totalConfirmed} onChange={event => setTotalConfirmed(event.target.checked)} label="مانده کل و شمول ریز اقلام با مدرک معتبر تأیید شده‌اند." />
        </> : <ErpInlineState kind="empty" title="در حال بارگیری تطبیق افتتاحیه…" action={{ label: 'تلاش دوباره', onClick: () => setRetry(value => value + 1) }} />)}
        {kind === 'SET_BALANCE' && /^-?\d+$/.test(normalizeAccountAmount(value)) && <ErpSummaryGrid items={[
          { label: 'مانده مطلوب', value: accountMoney(normalizeAccountAmount(value)) },
          { label: 'اثر سند اصلاحی', value: accountMoney((BigInt(normalizeAccountAmount(value)) - BigInt(account.netBalanceRials)).toString()) },
        ]} />}
        {kind === 'REFUND' && BigInt(account.receivableRials) > BigInt(0) && <ErpInlineState kind="stale" title={`این مشتری ${accountMoney(account.receivableRials)} مانده دریافتنی دارد؛ پیش از استرداد بررسی کنید.`} />}
        {kind === 'ALLOCATION' && <div className="space-y-3">{[
          ...receiptSources.map(row => ({ key: `receipt:${row.id}`, label: `${accountStatusLabels[row.componentKind ?? 'BANK'] || 'دریافت'} ${dateFa(row.occurredAt)}${receiptIsCheck(row) ? ` · ${accountStatusLabels[account.treasuryChecks.find(check => check.id === (row.checkInstrumentId ?? row.source?.id))?.status ?? ''] || 'وضعیت نیازمند بررسی'}` : ''}`, remaining: receiptRemainingRials(row) })),
          ...creditSources.map(row => ({ key: `credit:${row.id}`, label: row.invoiceNumber, remaining: row.remainingRials })),
        ].map(source => <ErpDisclosure key={source.key} title={`${source.label} · مانده ${accountMoney(source.remaining)}`}><div className="grid gap-3 md:grid-cols-2">{account.openItems.filter(row => row.kind === 'RECEIVABLE').map(row => <ErpField key={row.id} label={row.invoiceNumber} hint={`مانده بدهی: ${accountMoney(row.remainingRials)}`}>
          <FormattedNumberInput decimalScale={null} value={shares[source.key]?.[row.id] || ''} onTextChange={next => setShares(current => ({ ...current, [source.key]: { ...current[source.key], [row.id]: next } }))} placeholder="سهم این منبع به ریال" />
        </ErpField>)}</div></ErpDisclosure>)}</div>}
        {(isCorrection || kind === 'CHECK_SETTLE') && receipt && <>
          <ErpSummaryGrid items={[{ label: 'مبلغ مؤثر', value: accountMoney(receipt.effectiveAmountRials ?? receipt.amountRials) }, { label: 'تخصیص فعال', value: accountMoney(receipt.allocatedRials) }, { label: 'استرداد قبلی', value: accountMoney(receipt.refundedRials) }]} />
          {kind === 'CANCEL_RECEIPT' ? <ErpInlineState kind="stale" title="لغو همه تخصیص‌های مؤثر همین دریافت را برمی‌گرداند؛ استرداد قبلی باید تعیین تکلیف شود." /> : receipt.allocations.filter(row => !row.reversedAt).map(allocation => <ErpDisclosure key={allocation.id} title={`برگشت مصرف · ${dateFa(allocation.createdAt)}`}><div className="grid gap-3 md:grid-cols-2">{allocation.lines.map(line => <ErpField key={line.openItemId} label={account.activityItems.find(item => item.id === line.openItemId)?.invoiceNumber || 'بدهی'} hint={`تخصیص فعلی: ${accountMoney(line.amountRials)}`}><FormattedNumberInput decimalScale={null} value={reversals[allocation.id]?.[line.openItemId] || ''} onTextChange={next => setReversals(current => ({ ...current, [allocation.id]: { ...current[allocation.id], [line.openItemId]: next } }))} placeholder="مبلغ مصرف نامعتبر برای برگشت" /></ErpField>)}</div></ErpDisclosure>)}
        </>}
        {isCheckBank && check && <ErpInlineState kind="stale" title={`${check.bankName} · ${check.serialNumber} · ${accountStatusLabels[check.status] || check.status}؛ نتیجه فقط با مدرک بانک ثبت شود.`} />}
        {kind === 'CHECK_SETTLE' && <ErpField label="مبلغ پرداخت‌نشده (ریال)" required><FormattedNumberInput decimalScale={null} required value={unpaid} onTextChange={next => setUnpaid(next)} /></ErpField>}
        {kind === 'CHECK_DEPOSIT' && <ErpField label="معین اسناد در جریان وصول" required><ErpSearchableSelect required aria-label="معین اسناد در جریان وصول" value={collectionId} onChange={event => setCollectionId(event.target.value)}><option value="">انتخاب معین</option>{context.accounts.filter(row => row.statementRole === 'ASSET' && row.partyRequirement === 'REQUIRED' && row.financialAccountRequirement === 'FORBIDDEN').map(row => <option key={row.id} value={row.id}>{row.code} · {row.titlePersian}</option>)}</ErpSearchableSelect></ErpField>}
        {kind === 'ATTRIBUTION' && <div className="grid gap-3 md:grid-cols-2">
          <ErpField label="قلم افتتاحیه" required><ErpSearchableSelect required aria-label="قلم افتتاحیه" value={lineKey} onChange={event => setLineKey(event.target.value)}><option value="">انتخاب قلم</option>{account.openingReview?.evidence.review.lines.map(line => <option key={line.key} value={line.key}>{line.reference}</option>)}</ErpSearchableSelect></ErpField>
          <ErpField label="قرارداد منطبق"><ErpSearchableSelect aria-label="قرارداد منطبق" value={contractId} onChange={event => { setContractId(event.target.value); setRecordId(''); }}><option value="">فاقد انتساب</option>{account.contracts.map(row => <option key={row.id} value={row.id}>{row.contractNumber}</option>)}</ErpSearchableSelect></ErpField>
          <ErpField label="فاکتور منطبق"><ErpSearchableSelect aria-label="فاکتور منطبق" value={recordId} onChange={event => { setRecordId(event.target.value); setContractId(account.financialRecords.find(row => row.id === event.target.value)?.contractId || ''); }}><option value="">فاقد انتساب</option>{account.financialRecords.filter(row => !contractId || row.contractId === contractId).map(row => <option key={row.id} value={row.id}>{row.systemInvoiceNumber || 'بدون شماره'} · {accountMoney(row.amount, row.currency)}</option>)}</ErpSearchableSelect></ErpField>
          <ErpInlineState kind="empty" title="این ثبت فقط انتساب را اصلاح می‌کند؛ مانده و سند مالی ثابت می‌مانند." />
        </div>}
        <ErpField label="دلیل / شرح عملیات" required><ErpTextarea required minLength={8} value={reason} onChange={event => setReason(event.target.value)} /></ErpField>
        <ErpField label="مرجع مستندات" required><ErpInput required value={reference} onChange={event => setReference(event.target.value)} placeholder="شماره رسید، نامه یا مرجع مدرک" /></ErpField>
        {kind !== 'ATTRIBUTION' && <ErpDisclosure title="دوره و حساب‌های ثبت" expanded={!periodId || !ruleId}>
          <div className="grid gap-4 md:grid-cols-2"><ErpField label="دوره مالی" required><ErpSearchableSelect required value={periodId} onChange={event => setPeriodId(event.target.value)} aria-label="دوره مالی"><option value="">انتخاب دوره</option>{context.periods.map(row => <option key={row.id} value={row.id}>{row.fiscalYear.titlePersian} · {row.titlePersian}</option>)}</ErpSearchableSelect></ErpField>
            <ErpField label="قاعده ثبت مشتری" required><ErpSearchableSelect required value={ruleId} onChange={event => { setRuleId(event.target.value); setBankId(context.rules.find(row => row.id === event.target.value)?.bankClearingAccountId || ''); }} aria-label="قاعده ثبت مشتری"><option value="">انتخاب قاعده</option>{context.rules.map(row => <option key={row.id} value={row.id}>{row.code} · نسخه {row.version.toLocaleString('fa-IR')}</option>)}</ErpSearchableSelect></ErpField>
            {isCash && <ErpField label="حساب دفترکل بانک / صندوق" required><ErpSearchableSelect value={bankId} onChange={event => setBankId(event.target.value)} required aria-label="حساب دفترکل بانک"><option value="">انتخاب حساب</option>{context.accounts.filter(row => row.financialAccountRequirement !== 'FORBIDDEN').map(row => <option key={row.id} value={row.id}>{row.code} · {row.titlePersian}</option>)}</ErpSearchableSelect></ErpField>}
          </div>
        </ErpDisclosure>}
        <ErpCheckbox checked={confirmed} onChange={event => setConfirmed(event.target.checked)} label="اطلاعات و اثر مالی را بررسی کردم؛ ثبت قطعی انجام شود." />
        {error && <ErpInlineState kind="error" title={error} />}
        <div className="flex flex-wrap justify-end gap-3"><ErpButton label="انصراف" tone="neutral" onClick={onClose} disabled={pending} />
          <ErpButton type="submit" label={pending ? 'در حال ثبت…' : 'ثبت قطعی'} tone={kind === 'CANCEL_RECEIPT' ? 'danger' : ['REFUND', 'REVERSE_ALLOCATION', 'CHECK_SETTLE'].includes(kind) ? 'warning' : 'primary'} disabled={pending || !confirmed || (kind !== 'ATTRIBUTION' && (!periodId || !selectedRule)) || (kind === 'OPENING' && (!opening || !identityConfirmed || !totalConfirmed))} /></div>
      </fieldset></form>}
  </ErpSheet>;
}
