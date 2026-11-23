'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ErpButton, ErpCard, ErpEmptyState, ErpField, ErpFieldView, ErpInlineState,
  ErpInput, ErpPage, ErpSection, ErpSkeleton, ErpStatus, ErpSummaryGrid, ErpTextarea,
} from '@/components/erp';
import { useAuth } from '@/contexts/AuthContext';
import { hasFeatureAccess } from '@/lib/permissions';
import { StoneReturnPosting, StoneReturnPostingResult } from './StoneReturnPosting';
import { userFacingError } from '@/features/dispatch/userFacingError';
import { normalizeStoneReturnQuantity as quantityInput, stoneReturnQuantityAtoms } from './stoneReturnQuantityInput';
import {
  displayExactDecimal, displayStoneReturnQuantity, stoneReturnAllocationStatuses, stoneReturnApi,
  type StoneReturnAllocationInput, type StoneReturnCandidate, type StoneReturnReview, type StoneReturnSourceKey,
} from './stoneReturnApi';

const listHref = '/dashboard/accounting/returns';
const candidateKey = (row: StoneReturnSourceKey) => JSON.stringify([row.originalInvoiceId, row.originalLineId, row.dispatchEvidenceId]);

function candidateRate(rate: string) {
  const [whole, fraction] = rate.split('.');
  const shortened = fraction && fraction.length > 8;
  const text = shortened ? `${whole}.${fraction.slice(0, 8)}` : rate;
  return <span title={shortened ? `${displayExactDecimal(rate)} ریال` : undefined}>
    {shortened && 'حدود '}{displayExactDecimal(text)} ریال
  </span>;
}

function StoneReturnCandidateFields({ candidate, quantity, editable, disabled, error, onChange }: {
  candidate: StoneReturnCandidate;
  quantity: string;
  editable: boolean;
  disabled: boolean;
  error?: string;
  onChange: (value: string) => void;
}) {
  const readable = (value: string) => displayStoneReturnQuantity(value, candidate.unit);
  const deliveryDate = new Date(candidate.deliveredAt).toLocaleString('fa-IR', { dateStyle: 'short', timeStyle: 'short' });
  return <ErpCard className="space-y-4">
    <h3 className="font-semibold break-words">قرارداد {candidate.contractNumber} · صورتحساب {candidate.originalInvoiceNumber}</h3>
    <ErpSummaryGrid columns={3} items={[
      { label: 'تحویل این بارگیری', value: readable(candidate.deliveredQuantity), hint: candidate.loadingNumber ? `بارگیری ${candidate.loadingNumber} · ${deliveryDate}` : deliveryDate },
      { label: 'نرخ خالص هر واحد', value: candidateRate(candidate.originalNetRateRials) },
      { label: 'مانده قابل تخصیص', value: readable(candidate.remainingQuantity), tone: 'info' },
      { label: 'مرجوعی قبلی ردیف فروش', value: readable(candidate.linePriorReturnedQuantity) },
      { label: 'مرجوعی قبلی بارگیری', value: readable(candidate.dispatchPriorReturnedQuantity) },
    ]} />
    {editable && (!/^0(?:\.0+)?$/.test(candidate.remainingQuantity) || quantity) ? <ErpField
      error={error} label={`مقدار تخصیص صورتحساب ${candidate.originalInvoiceNumber} · ${candidate.loadingNumber ?? deliveryDate}`}>
      <ErpInput inputMode="decimal" maxLength={100} value={quantity} disabled={disabled} onChange={event => onChange(event.target.value)} />
    </ErpField> : quantity && <ErpFieldView label="مقدار تخصیص‌یافته" value={readable(quantity)} />}
  </ErpCard>;
}

export function StoneReturnReviewPage({ receiptId }: { receiptId: string }) {
  const { user } = useAuth();
  const [review, setReview] = useState<StoneReturnReview | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [saved, setSaved] = useState(false);
  const busy = useRef(false);

  function apply(next: StoneReturnReview) {
    setReview(next);
    setAttempted(false);
    setAmounts(Object.fromEntries((next.draft?.rows ?? []).map(row => [candidateKey(row), row.quantity])));
    setReason(next.draft?.attributionReason ?? '');
  }

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError('');
    setStale(false);
    setSaved(false);
    void stoneReturnApi.review(receiptId).then(next => {
      if (current) apply(next);
    }).catch(error => {
      if (current) setError(userFacingError(error, 'دریافت پرونده مرجوعی ممکن نشد.'));
    }).finally(() => {
      if (current) setLoading(false);
    });
    return () => { current = false; };
  }, [receiptId, reload]);

  const receipt = review?.receipt;
  const editable = review?.canAllocate === true && review.allocationStatus !== 'REJECTED' && review.allocationStatus !== 'FINALIZED' && !review.blockedReason;
  const candidateIds = new Set(review?.candidates.map(candidateKey));
  const unavailableRows = review?.draft?.rows.filter(row => !candidateIds.has(candidateKey(row)) && amounts[candidateKey(row)]) ?? [];
  const draftHasUnsavedChanges = !!review?.draft && (reason !== (review.draft.attributionReason ?? '')
    || review.draft.rows.length
      !== Object.values(amounts).filter(amount => quantityInput(amount) && quantityInput(amount) !== '0').length
    || review.draft.rows.some(row => quantityInput(row.quantity) !== quantityInput(amounts[candidateKey(row)] ?? '')));
  const canPost = editable && !pending && !draftHasUnsavedChanges && !unavailableRows.length
    && /^0(?:\.0+)?$/.test(review.unallocatedQuantity)
    && hasFeatureAccess(user, 'accounting_customer_posting_manage', 'edit');
  const hasAllocations = Object.values(amounts).some(amount => quantityInput(amount) && quantityInput(amount) !== '0');

  const amountErrors = new Map(review?.candidates.flatMap<readonly [string, string]>(candidate => {
    const key = candidateKey(candidate);
    const amount = quantityInput(amounts[key] ?? '');
    if (!amount || amount === '0') return [];
    const quantity = stoneReturnQuantityAtoms(amount, candidate.unit);
    const remaining = stoneReturnQuantityAtoms(quantityInput(candidate.remainingQuantity), candidate.unit);
    if (!quantity) {
      return [[key, candidate.unit === 'count' ? 'مقدار تخصیص باید عدد صحیح مثبت باشد.' : 'مقدار تخصیص باید عدد مثبت معتبر باشد.']];
    }
    if (remaining !== null && quantity > remaining) return [[key, 'مقدار تخصیص از مانده این ردیف بیشتر است.']];
    return [];
  }));
  const reasonRequired = Boolean(review && !review.originKnown && hasAllocations);
  const reasonError = reasonRequired && !reason.trim() ? 'دلیل انتخاب ردیف‌های فروش را وارد کنید.' : undefined;

  function changeQuantity(key: string, value: string) {
    setAmounts(previous => ({ ...previous, [key]: value }));
    setSaved(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!review || busy.current || !editable || posting || unavailableRows.length) return;
    setAttempted(true);
    if (amountErrors.size || reasonError) return;
    const rows: StoneReturnAllocationInput[] = review.candidates.flatMap(row => {
      const quantity = quantityInput(amounts[candidateKey(row)] ?? '');
      return quantity && quantity !== '0' ? [{
        originalInvoiceId: row.originalInvoiceId, originalLineId: row.originalLineId, dispatchEvidenceId: row.dispatchEvidenceId, quantity,
      }] : [];
    });
    busy.current = true;
    setPending(true);
    setSaved(false);
    setError('');
    setStale(false);
    try {
      apply(await stoneReturnApi.saveAllocations(receiptId, { expectedVersion: review.draft?.version ?? 0, rows, attributionReason: reason }));
      setSaved(true);
    } catch (error) {
      setError(userFacingError(error, 'ذخیره پیش‌نویس تخصیص ممکن نشد.'));
      setStale((error as { response?: { status?: number } }).response?.status === 409);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return <ErpPage eyebrow="حسابداری · مرجوعی‌ها" title={receipt ? `مرجوعی ${receipt.productName}` : 'پرونده مرجوعی'} backHref={listHref}>
    {loading ? <ErpSkeleton /> : <>
      {error && <ErpInlineState kind="error" title={error} action={stale || !review ? {
        label: stale ? 'بارگذاری دوباره پرونده' : 'تلاش دوباره', onClick: () => setReload(value => value + 1),
      } : undefined} />}
      {receipt && review && <>
        <ErpSection title="دریافت سنگ">
          <ErpStatus {...stoneReturnAllocationStatuses[review.allocationStatus]} />
          <ErpSummaryGrid columns={3} items={[
            { label: 'مشتری', value: receipt.customerName },
            { label: 'شناسه سنگ', value: receipt.productCode },
            { label: 'زمان ثبت', value: new Date(receipt.createdAt).toLocaleString('fa-IR', { dateStyle: 'short', timeStyle: 'short' }) },
            { label: 'مقدار دریافتی', value: displayStoneReturnQuantity(receipt.receivedQuantity, receipt.unit) },
            { label: 'مقدار پذیرفته‌شده', value: displayStoneReturnQuantity(receipt.acceptedQuantity, receipt.unit) },
            { label: 'مقدار ردشده', value: displayStoneReturnQuantity(receipt.rejectedQuantity, receipt.unit), hint: receipt.rejectionReason },
          ]} />
        </ErpSection>
        {review.allocationStatus !== 'REJECTED' && review.allocationStatus !== 'FINALIZED' && <ErpSection title="تخصیص به فروش">
          <form className="space-y-4" onSubmit={submit} noValidate>
            <ErpSummaryGrid items={[
              { label: 'تخصیص ذخیره‌شده', value: displayStoneReturnQuantity(review.allocatedQuantity, receipt.unit) },
              { label: 'مقدار باقی‌مانده برای تخصیص', value: displayStoneReturnQuantity(review.unallocatedQuantity, receipt.unit) },
            ]} />
            {saved && <ErpInlineState kind="success" title="پیش‌نویس تخصیص ذخیره شد." />}
            {review.blockedReason && <ErpInlineState kind="error" title={review.blockedReason} />}
            {review.hasUnlinkedOriginals && <ErpInlineState kind="stale" title="برای بعضی از ردیف‌های فروش، پیوند قابل استناد بین صورتحساب و ارسال فیزیکی موجود نیست." />}
            {!review.candidates.length && !review.blockedReason && <ErpEmptyState title="ردیف فروش هم‌خوان با سند ارسال فیزیکی پیدا نشد" />}
            {review.candidates.map(candidate => {
              const key = candidateKey(candidate);
              return <StoneReturnCandidateFields key={key} candidate={candidate} quantity={amounts[key] ?? ''}
                editable={editable} disabled={pending || posting} error={attempted ? amountErrors.get(key) : undefined} onChange={value => changeQuantity(key, value)} />;
            })}
            {unavailableRows.map(row => <ErpCard className="space-y-3" key={row.id}>
              <ErpInlineState kind="stale" title={`قرارداد ${row.contractNumber} · صورتحساب ${row.originalInvoiceNumber} دیگر قابل تخصیص نیست.`} />
              <ErpFieldView label="مقدار ذخیره‌شده" value={displayStoneReturnQuantity(row.quantity, receipt.unit)} />
              {editable && <ErpButton type="button" label="حذف این تخصیص" tone="danger" variant="soft" disabled={pending || posting}
                onClick={() => changeQuantity(candidateKey(row), '')} />}
            </ErpCard>)}
            {editable && (review.candidates.length > 0 || review.draft) ? <>
              <ErpField label="دلیل انتخاب ردیف‌های فروش" required={reasonRequired} error={attempted ? reasonError : undefined}>
                <ErpTextarea maxLength={2000} required={reasonRequired} value={reason} disabled={pending || posting}
                  onChange={event => { setReason(event.target.value); setSaved(false); }} />
              </ErpField>
              <ErpButton type="submit" tone="primary" variant="solid" disabled={pending || posting || unavailableRows.length > 0}
                label={pending ? 'در حال ذخیره…' : 'ذخیره پیش‌نویس'} />
            </> : review.draft?.attributionReason && <ErpFieldView label="دلیل انتخاب ردیف‌های فروش" value={review.draft.attributionReason} />}
          </form>
        </ErpSection>}
        {canPost && review.draft && <StoneReturnPosting key={review.draft.id} receiptId={receiptId} draft={review.draft}
          acceptedQuantity={receipt.acceptedQuantity} unit={receipt.unit} posting={posting} onPostingChange={setPosting}
          onPosted={finalization => setReview({ ...review, finalization, allocationStatus: 'FINALIZED' })} />}
        {review.finalization && <StoneReturnPostingResult finalization={review.finalization} draft={review.draft} unit={receipt.unit} />}
      </>}
    </>}
  </ErpPage>;
}
