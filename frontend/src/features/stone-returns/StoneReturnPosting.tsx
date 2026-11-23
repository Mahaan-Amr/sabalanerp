'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ErpButton, ErpCard, ErpField, ErpInlineState, ErpPersianDateField, ErpSection, ErpSelect, ErpSkeleton, ErpSummaryGrid } from '@/components/erp';
import { userFacingError } from '@/features/dispatch/userFacingError';
import { displayExactDecimal, displayStoneReturnQuantity, stoneReturnApi, type StoneReturnFinalization, type StoneReturnPostingContext } from './stoneReturnApi';

export function StoneReturnPosting({ receiptId, draft, onPosted }: {
  receiptId: string;
  draft: { id: string; version: number };
  onPosted: (finalization: StoneReturnFinalization) => void;
}) {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [context, setContext] = useState<StoneReturnPostingContext | null>(null);
  const [periodId, setPeriodId] = useState('');
  const [postingRuleId, setPostingRuleId] = useState('');
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || !context || !periodId || !postingRuleId || !date) return;
    busy.current = true;
    setPosting(true);
    setError('');
    try {
      const result = await stoneReturnApi.finalize(receiptId, {
        expectedVersion: draft.version, requestId: draft.id, date, periodId, postingRuleId, confirmed: true,
      });
      onPosted(result.data);
    } catch (error) {
      setError(userFacingError(error, 'ثبت قطعی مرجوعی ممکن نشد.'));
    } finally {
      busy.current = false;
      setPosting(false);
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
          disabled={posting || !periodId || !postingRuleId} />
      </>}
    </form>
  </ErpSection>;
}

export function StoneReturnPostingResult({ finalization, unit }: { finalization: StoneReturnFinalization; unit: string }) {
  return <ErpSection title="اسناد قطعی مرجوعی">
    <ErpSummaryGrid items={[
      { label: 'تاریخ سند', value: new Date(finalization.documentDate).toLocaleDateString('fa-IR', { timeZone: 'UTC' }) },
      { label: 'نسخه تخصیص', value: finalization.draftVersion.toLocaleString('fa-IR') },
    ]} />
    {finalization.summary.credits.map(credit => <ErpCard key={credit.creditInvoiceId}>
      <h3 className="mb-3 font-semibold break-words">صورتحساب مرجع {credit.originalInvoiceNumber}</h3>
      <ErpSummaryGrid items={[
        { label: 'بستانکاری مشتری', value: `${displayExactDecimal(credit.customerCreditRials)} ریال`, tone: 'success' },
        { label: 'شماره سند حسابداری', value: credit.voucherNumber?.toLocaleString('fa-IR') ?? <bdi className="break-all">{credit.voucherId}</bdi> },
        ...credit.shares.map(share => ({ label: 'مقدار ثبت‌شده', value: displayStoneReturnQuantity(share.quantity, unit) })),
      ]} />
    </ErpCard>)}
  </ErpSection>;
}
