'use client';

import React, { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ErpButton, ErpCard, ErpField, ErpFieldView, ErpInlineState, ErpInput, ErpPersianDateField, ErpSection,
  ErpSelect, ErpSkeleton, ErpSummaryGrid, ErpTextarea,
} from '@/components/erp';
import { userFacingError } from '@/features/dispatch/userFacingError';
import {
  displayExactDecimal, displayStoneReturnQuantity, stoneReturnApi, stoneReturnUnitLabels,
  type StoneReturnFinalization, type StoneReturnReview, type StoneReturnPostingContext,
} from './stoneReturnApi';
import { describeStoneReturnRate } from './stoneReturnRate';

const displayRials = (amount: string) => `${displayExactDecimal(amount)} ریال`;
const rateLabel = (unit: string) => `نرخ توافقی هر ${stoneReturnUnitLabels[unit] ?? unit} (ریال)`;

export function StoneReturnPosting({ receiptId, draft, acceptedQuantity, unit, posting, onPostingChange, onPosted }: {
  receiptId: string;
  draft: { id: string; version: number };
  acceptedQuantity: string;
  unit: string;
  posting: boolean;
  onPostingChange: (posting: boolean) => void;
  onPosted: (finalization: StoneReturnFinalization) => void;
}) {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [context, setContext] = useState<StoneReturnPostingContext | null>(null);
  const [periodId, setPeriodId] = useState('');
  const [postingRuleId, setPostingRuleId] = useState('');
  const [loading, setLoading] = useState(true);
  const [rateInput, setRateInput] = useState('');
  const [rateDifferenceReason, setRateDifferenceReason] = useState('');
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const busy = useRef(false);

  useEffect(() => {
    let active = true;
    setContext(null);
    setError('');
    if (!date) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void stoneReturnApi.postingContext(receiptId, date).then(next => {
      if (!active) return;
      if (next.draftVersion !== draft.version) {
        setError('نسخه تخصیص تغییر کرده است. پرونده را دوباره باز کنید.');
        return;
      }
      setContext(next);
      setPeriodId(next.periods.length === 1 ? next.periods[0].id : '');
      setPostingRuleId(next.rules.length === 1 ? next.rules[0].id : '');
    }).catch(error => {
      if (active) setError(userFacingError(error, 'دریافت دوره و قاعده ثبت مرجوعی ممکن نشد.'));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [date, receiptId, draft.version, reload]);

  const preview = context && describeStoneReturnRate(rateInput, acceptedQuantity, context.originalRates);
  const canPost = preview && preview.customerCreditRials !== '0' && (!preview.requiresReason || rateDifferenceReason.trim())
    && periodId && postingRuleId && date;
  const rateError = rateInput && !preview
    ? 'نرخ توافقی هر واحد باید مبلغ ریالی مثبت باشد.'
    : preview?.customerCreditRials === '0' ? 'مبلغ بستانکاری پس از گرد کردن باید دست‌کم یک ریال باشد.' : undefined;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || !canPost || !preview) return;
    busy.current = true;
    onPostingChange(true);
    setError('');
    try {
      const result = await stoneReturnApi.finalize(receiptId, {
        expectedVersion: draft.version, requestId: draft.id, date, periodId, postingRuleId, confirmed: true,
        agreedUnitRateRials: preview.agreedUnitRateRials,
        rateDifferenceReason: preview.requiresReason ? rateDifferenceReason.trim() : null,
      });
      onPosted(result.data);
    } catch (error) {
      setError(userFacingError(error, 'ثبت قطعی مرجوعی ممکن نشد.'));
    } finally {
      busy.current = false;
      onPostingChange(false);
    }
  }

  return <ErpSection title="ثبت قطعی مرجوعی">
    <form className="space-y-4" onSubmit={submit}>
      <ErpPersianDateField label="تاریخ سند" value={date} onChange={next => { setContext(null); setDate(next); }}
        valueFormat="iso-date" disableFutureDates disabled={posting} required />
      {loading && <ErpSkeleton />}
      {error && <ErpInlineState kind="error" title={error} action={!context ? {
        label: 'تلاش دوباره', onClick: () => setReload(value => value + 1),
      } : undefined} />}
      {context && <>
        <ErpField label={rateLabel(unit)} error={rateError} required>
          <ErpInput inputMode="decimal" maxLength={100} value={rateInput} disabled={posting} required
            onChange={event => setRateInput(event.target.value)} />
        </ErpField>
        <ErpSummaryGrid columns={3} items={[
          { label: 'مبلغ خالص فروش اولیه', value: displayRials(context.originalAmounts.originalNetRials) },
          { label: 'مالیات مرجع', value: displayRials(context.originalAmounts.originalTaxRials) },
          { label: 'بستانکاری توافقی', value: preview ? displayRials(preview.customerCreditRials) : '—', tone: 'info' },
        ]} />
        {preview?.requiresReason && <ErpField label="دلیل تفاوت نرخ با فروش اولیه" required>
          <ErpTextarea maxLength={2000} value={rateDifferenceReason} disabled={posting} required
            onChange={event => setRateDifferenceReason(event.target.value)} />
        </ErpField>}
        {(!context.periods.length || !context.rules.length) &&
          <ErpInlineState kind="stale" title="برای این تاریخ، دوره باز و قاعده مؤثر ثبت مشتری در دفتر مرجع پیدا نشد." />}
        {context.periods.length > 1 && <ErpField label="دوره ثبت" required>
          <ErpSelect value={periodId} onChange={event => setPeriodId(event.target.value)} disabled={posting}>
            <option value="">انتخاب دوره</option>
            {context.periods.map(period => <option key={period.id} value={period.id}>{period.fiscalYear.titlePersian} · {period.titlePersian}</option>)}
          </ErpSelect>
        </ErpField>}
        {context.rules.length > 1 && <ErpField label="قاعده ثبت مشتری" required>
          <ErpSelect value={postingRuleId} onChange={event => setPostingRuleId(event.target.value)} disabled={posting}>
            <option value="">انتخاب قاعده</option>
            {context.rules.map(rule => <option key={rule.id} value={rule.id}>{rule.code} · نسخه {rule.version.toLocaleString('fa-IR')}</option>)}
          </ErpSelect>
        </ErpField>}
        <ErpButton type="submit" label={posting ? 'در حال ثبت…' : 'ثبت قطعی بستانکاری'} tone="primary" variant="solid"
          disabled={posting || !canPost} />
      </>}
    </form>
  </ErpSection>;
}

export function StoneReturnPostingResult({ finalization, draft, unit }: {
  finalization: StoneReturnFinalization;
  draft: StoneReturnReview['draft'];
  unit: string;
}) {
  const { summary } = finalization;
  const allocations = new Map(draft?.rows.map(row => [row.id, row]));
  return <ErpSection title="اسناد قطعی مرجوعی">
    <ErpSummaryGrid columns={3} items={[
      { label: 'تاریخ سند', value: new Date(finalization.documentDate).toLocaleDateString('fa-IR', { timeZone: 'UTC' }) },
      { label: 'نسخه تخصیص', value: finalization.draftVersion.toLocaleString('fa-IR') },
      { label: rateLabel(unit), value: displayExactDecimal(summary.agreedUnitRateRials) },
      { label: 'مبلغ خالص فروش اولیه', value: displayRials(summary.originalNetRials) },
      { label: 'مالیات مرجع', value: displayRials(summary.originalTaxRials) },
      { label: 'بستانکاری توافقی', value: displayRials(summary.customerCreditRials), tone: 'success' },
    ]} />
    {draft?.attributionReason && <ErpFieldView label="دلیل انتخاب ردیف‌های فروش" value={draft.attributionReason} />}
    {summary.rateDifferenceReason && <ErpFieldView label="دلیل تفاوت نرخ با فروش اولیه" value={summary.rateDifferenceReason} />}
    {summary.credits.map(credit => <ErpCard key={credit.creditInvoiceId}>
      <h3 className="mb-3 font-semibold break-words">صورتحساب مرجع {credit.originalInvoiceNumber}</h3>
      <ErpSummaryGrid items={[
        { label: 'بستانکاری مشتری', value: displayRials(credit.customerCreditRials), tone: 'success' },
        { label: 'شماره سند حسابداری', value: credit.voucherNumber?.toLocaleString('fa-IR') ?? <bdi className="break-all">{credit.voucherId}</bdi> },
      ]} />
      {credit.shares.map(share => {
        const row = allocations.get(share.draftRowId);
        const loadingReference = share.loadingNumber || share.loadingId;
        const reference = (value: string) => <bdi className="break-all">{value}</bdi>;
        return <div key={share.draftRowId} className="mt-4">
          <ErpSummaryGrid items={[
            ...(row ? [
              { label: 'قرارداد مرجع', value: reference(row.contractNumber) },
              { label: 'شناسه ردیف فروش مرجع', value: reference(row.originalLineId) },
              { label: 'شناسه ردیف سنگ', value: reference(row.productRowId) },
              { label: 'شناسه شاهد خروج بارگیری', value: reference(row.dispatchEvidenceId) },
            ] : []),
            ...(loadingReference ? [{ label: 'بارگیری مرجع', value: reference(loadingReference) }] : []),
            { label: 'مقدار ثبت‌شده', value: displayStoneReturnQuantity(share.quantity, unit) },
          ]} />
        </div>;
      })}
    </ErpCard>)}
  </ErpSection>;
}
