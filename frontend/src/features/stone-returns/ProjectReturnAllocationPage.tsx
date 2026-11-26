'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ErpButton, ErpCard, ErpField, ErpFieldView, ErpInlineState, ErpInput,
  ErpPage, ErpSection, ErpSheet, ErpSkeleton, ErpStatus,
} from '@/components/erp';
import { userFacingError } from '@/features/dispatch/userFacingError';
import {
  isProjectReturnAllocationEditable, projectReturnAccountingHref, projectReturnAllocationApi, projectReturnAllocationStatuses,
  type ProjectAllocationInput, type ProjectFinancialAllocationSource, type ProjectReturnAllocationReview,
} from './projectReturnAllocationApi';
import { displayExactDecimal, displayStoneReturnQuantity, stoneReturnUnitLabels, type StoneReturnSourceKey } from './stoneReturnApi';
import { normalizeStoneReturnQuantity, stoneReturnQuantityAtoms } from './stoneReturnQuantityInput';
import { ProjectReturnFacts } from './ProjectReturnFacts';
import { projectReturnQuantityFacts } from './projectReturnAreaFacts';
import { ProjectReturnPriorPosting } from './ProjectReturnPriorPosting';
import { rateLabel } from './StoneReturnPosting';

type DraftFields = { rate: string; quantities: Record<string, string> };
type FieldErrors = { rate?: string; quantities: Record<string, string> };
type ReviewItem = ProjectReturnAllocationReview['items'][number];

const sourceKey = (row: StoneReturnSourceKey | ProjectFinancialAllocationSource) => JSON.stringify('financialRecordId' in row
  ? [row.financialRecordId, row.financialLineId]
  : [row.originalInvoiceId, row.originalLineId, row.dispatchEvidenceId]);
const nonzero = (value: string) => !/^0(?:\.0+)?$/.test(value);
const dateText = (iso: string) => new Date(iso).toLocaleString('fa-IR', { dateStyle: 'short', timeStyle: 'short' });
const contractDateText = (value: string) => /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value)
  ? new Date(value).toLocaleDateString('fa-IR', { dateStyle: 'short', timeZone: 'Asia/Tehran' })
  : value;
const blankFields: DraftFields = { rate: '', quantities: {} };

function fieldsFromReview(review: ProjectReturnAllocationReview) {
  return Object.fromEntries(review.items.map(item => [
    item.id, {
      rate: item.agreedUnitRateRials ?? '',
      quantities: Object.fromEntries(item.rows.map(row => [sourceKey(row), normalizeStoneReturnQuantity(row.quantity)])),
    },
  ]));
}

function unavailableRows(item: ReviewItem, fields: DraftFields) {
  const available = new Set(item.candidates.map(sourceKey));
  return item.rows.filter(row => !available.has(sourceKey(row)) && fields.quantities[sourceKey(row)]);
}

function ItemReview({ item, projects, fields, errors, editable, pending, onChange }: {
  item: ReviewItem;
  projects: Map<string, string>;
  fields: DraftFields;
  errors?: FieldErrors;
  editable: boolean;
  pending: boolean;
  onChange: (next: DraftFields) => void;
}) {
  const quantity = (value: string) => displayStoneReturnQuantity(value, item.unit);
  const healthy = nonzero(item.healthyQuantity);
  const savedRows = new Map(item.rows.map(row => [sourceKey(row), row.quantity]));
  const changeQuantity = (key: string, value: string) => onChange({ ...fields, quantities: { ...fields.quantities, [key]: value } });

  return <div className="min-w-0 space-y-2 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <h3 className="break-words text-sm font-semibold">{item.productName}</h3>
        <p className="text-xs sds-text-secondary"><bdi dir="ltr">{item.productCode}</bdi> · {stoneReturnUnitLabels[item.unit] ?? item.unit}</p>
      </div>
      <ProjectReturnFacts className="grid-cols-2 md:grid-cols-4" items={[
        ...projectReturnQuantityFacts(item),
        ...(healthy ? [
          { label: 'تخصیص ذخیره‌شده', value: quantity(item.allocatedQuantity) },
          { label: item.candidates.length ? 'تخصیص‌نیافته' : 'فاقد مرجع', value: quantity(item.unallocatedQuantity) },
        ] : []),
      ]} />
      {healthy && <>
        {editable ? <div className="max-w-xs"><ErpField label={rateLabel(item.unit)} error={errors?.rate}>
          <ErpInput numberFormat="money" value={fields.rate} disabled={pending}
            onChange={event => onChange({ ...fields, rate: event.target.value })} />
        </ErpField></div> : <ErpFieldView label={rateLabel(item.unit)}
          value={item.agreedUnitRateRials === null ? '—' : displayExactDecimal(item.agreedUnitRateRials)} />}
        {item.allocationError && <ErpInlineState kind="stale" title={item.allocationError} />}
        {item.candidates.length === 0 && <p className="text-sm sds-text-secondary">{item.blockedReason
          ?? (item.hasUnlinkedOriginals
            ? 'برای فروش شناسایی‌شده، ردیف مالی معتبر یا پیوند قابل تأیید به ارسال پیدا نشد.'
            : 'برای این مشتری، پروژه، محصول و واحد، مرجع فروش دارای پشتوانهٔ مالی معتبر پیدا نشد.')}</p>}
        {item.candidates.length > 0 && <ul aria-label="مراجع فروش"
          className="divide-y divide-[var(--sds-border-subtle)] border-y border-[var(--sds-border-subtle)]">
          {item.candidates.map(candidate => {
            const key = sourceKey(candidate);
            const entered = fields.quantities[key] ?? '';
            const project = projects.size > 1 ? projects.get(candidate.projectId) : undefined;
            const financial = 'financialRecordId' in candidate;
            const delivery = financial ? null : candidate.loadingNumber ?? dateText(candidate.deliveredAt);
            return <li key={key} className="grid min-w-0 gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(9rem,13rem)] sm:items-start sm:gap-4">
              <div className="min-w-0 space-y-0.5 text-sm">
                <h4 className="break-words font-semibold">{financial ? 'رکورد مالی' : 'صورتحساب'} <bdi dir="ltr">{candidate.originalInvoiceNumber}</bdi></h4>
                <p className="break-words sds-text-secondary">قرارداد <bdi dir="ltr">{candidate.contractNumber}</bdi>
                  {project && <> · {project}</>}
                </p>
                <p className="flex flex-wrap items-baseline gap-x-3 text-xs sds-text-secondary">
                  <span>مانده قابل تخصیص <strong className="font-semibold">{quantity(candidate.draftRemainingQuantity)}</strong></span>
                  {candidate.originalNetRateRials !== null && <span>نرخ فروش هر {stoneReturnUnitLabels[item.unit] ?? item.unit} <strong className="font-semibold">{displayExactDecimal(candidate.originalNetRateRials)} ریال</strong></span>}
                </p>
                <p className="flex flex-wrap items-baseline gap-x-3 text-xs sds-text-secondary">
                  <span>{candidate.contractDate || !candidate.contractCreatedAt ? 'تاریخ قرارداد' : 'تاریخ ثبت قرارداد'} <bdi>{candidate.contractDate
                    ? contractDateText(candidate.contractDate) : candidate.contractCreatedAt ? contractDateText(candidate.contractCreatedAt) : '—'}</bdi></span>
                  <span>فروشنده <bdi>{candidate.sellerName || '—'}</bdi></span>
                </p>
                {financial
                  ? <p className="text-xs sds-text-secondary">{candidate.financialParty.kind === 'PARTNER' ? 'فروش سبلان به همکار' : 'فروش مستقیم'}</p>
                  : <p className="break-words text-xs sds-text-secondary">{candidate.loadingNumber ? 'بارگیری' : 'تاریخ تحویل'} <bdi>{delivery}</bdi></p>}
              </div>
              {editable && (nonzero(candidate.remainingQuantity) || entered) ? <ErpField label="مقدار تخصیص" error={errors?.quantities[key]}>
                <ErpInput aria-label={`مقدار تخصیص ${financial ? 'رکورد مالی' : 'صورتحساب'} ${candidate.originalInvoiceNumber}${delivery ? ` · ${delivery}` : ''}`}
                  inputMode="decimal" maxLength={100} value={entered} disabled={pending}
                  onChange={event => changeQuantity(key, event.target.value)} />
              </ErpField> : savedRows.has(key) && <ErpFieldView label="مقدار تخصیص‌یافته" value={quantity(savedRows.get(key)!)} />}
            </li>;
          })}
        </ul>}
        {unavailableRows(item, fields).map(row => <ErpCard key={sourceKey(row)} className="min-w-0 space-y-2">
          <ErpInlineState kind="stale" title={`مرجع فروش ${row.originalInvoiceNumber} دیگر برای این محصول معتبر نیست.`} />
          <ErpFieldView label="مقدار تخصیص‌یافته" value={quantity(row.quantity)} />
          {editable && <ErpButton type="button" label="حذف این تخصیص" variant="soft" tone="danger" disabled={pending}
            onClick={() => changeQuantity(sourceKey(row), '')} />}
        </ErpCard>)}
      </>}
  </div>;
}

export function ProjectReturnAllocationPage({ caseId }: { caseId: string }) {
  const [review, setReview] = useState<ProjectReturnAllocationReview>();
  const [fields, setFields] = useState<Record<string, DraftFields>>({});
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, FieldErrors>>({});
  const [confirmReturn, setConfirmReturn] = useState(false);
  const [saved, setSaved] = useState(false);
  const [reload, setReload] = useState(0);
  const busy = useRef(false);

  function apply(next: ProjectReturnAllocationReview) {
    setReview(next);
    setFields(fieldsFromReview(next));
    setFieldErrors({});
  }

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError('');
    setSaved(false);
    void projectReturnAllocationApi.review(caseId).then(next => {
      if (current) apply(next);
    }).catch(reason => {
      if (current) setError(userFacingError(reason, 'دریافت پرونده مرجوعی پروژه ناموفق بود.'));
    }).finally(() => {
      if (current) setLoading(false);
    });
    return () => { current = false; };
  }, [caseId, reload]);

  const editable = review?.canAllocate === true && !review.prior?.sourceChanged
    && isProjectReturnAllocationEditable(review.allocationStatus);
  const canReturn = review?.canAllocate && review.prior && !review.prior.sourceChanged && review.receipt.version.submittedAt;
  const projects = new Map(review?.receipt.version.projects.map(project => [project.projectId, project.projectName]));

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!review || !editable || busy.current) return;
    setSaved(false);
    setError('');
    const items: ProjectAllocationInput[] = [];
    const invalidFields: Record<string, FieldErrors> = {};
    let unavailable = false;
    for (const item of review.items) {
      if (!nonzero(item.healthyQuantity)) continue;
      const input = fields[item.id] ?? blankFields;
      if (unavailableRows(item, input).length) unavailable = true;
      const errors: FieldErrors = { quantities: {} };
      const rate = normalizeStoneReturnQuantity(input.rate, true);
      if (input.rate.trim() && (!/^\d+(?:\.\d+)?$/.test(rate) || !nonzero(rate))) {
        errors.rate = 'نرخ توافقی را به ریال و بزرگ‌تر از صفر وارد کنید.';
      }
      const rows: ProjectAllocationInput['rows'] = [];
      for (const candidate of item.candidates) {
        const key = sourceKey(candidate);
        const inputQuantity = input.quantities[key] ?? '';
        if (!inputQuantity.trim()) continue;
        const quantity = normalizeStoneReturnQuantity(inputQuantity);
        const atoms = stoneReturnQuantityAtoms(quantity, item.unit);
        if (atoms === null) {
          errors.quantities[key] = 'مقدار تخصیص را با واحد محصول بررسی کنید.';
          continue;
        }
        if (atoms === BigInt(0)) continue;
        const remaining = stoneReturnQuantityAtoms(normalizeStoneReturnQuantity(candidate.remainingQuantity), item.unit);
        if (remaining !== null && atoms > remaining) {
          errors.quantities[key] = 'مقدار تخصیص از ماندهٔ این مرجع بیشتر است.';
          continue;
        }
        if ('financialRecordId' in candidate) {
          rows.push({ financialRecordId: candidate.financialRecordId, financialLineId: candidate.financialLineId, quantity });
        } else {
          const { originalInvoiceId, originalLineId, dispatchEvidenceId } = candidate;
          rows.push({ originalInvoiceId, originalLineId, dispatchEvidenceId, quantity });
        }
      }
      if (errors.rate || Object.keys(errors.quantities).length) invalidFields[item.id] = errors;
      items.push({ itemId: item.id, agreedUnitRateRials: rate || null, rows });
    }
    setFieldErrors(invalidFields);
    if (unavailable) setError('تخصیص‌های فاقد مرجع معتبر را حذف کنید.');
    if (unavailable || Object.keys(invalidFields).length) return;

    busy.current = true;
    setPending(true);
    try {
      apply(await projectReturnAllocationApi.save(caseId, {
        expectedVersionId: review.receipt.version.id, expectedDraftNumber: review.draft?.number ?? 0, items,
      }));
      setSaved(true);
    } catch (failure) {
      setError(userFacingError(failure, 'ذخیره پیش‌نویس تخصیص ناموفق بود.'));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  async function returnCorrection() {
    if (!review || !canReturn || busy.current) return;
    busy.current = true;
    setPending(true);
    setError('');
    setSaved(false);
    try {
      await projectReturnAllocationApi.returnCorrection(caseId, {
        expectedVersionId: review.receipt.version.id, expectedDraftNumber: review.draft?.number ?? 0,
      });
      setReload(value => value + 1);
    } catch (failure) {
      setError(userFacingError(failure, 'ارجاع نسخهٔ اصلاحی ناموفق بود.'));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  async function returnToLogistics() {
    if (!review?.operational?.canReturnToLogistics || busy.current) return;
    busy.current = true;
    setPending(true);
    setError('');
    try {
      apply(await projectReturnAllocationApi.returnToLogistics(caseId, review.receipt.version.id));
      setSaved(false);
    } catch (failure) {
      setError(userFacingError(failure, 'بازگشت پرونده به لجستیک ناموفق بود.'));
    } finally {
      setConfirmReturn(false);
      setPending(false);
      busy.current = false;
    }
  }

  return <ErpPage title="رسیدگی مرجوعی پروژه" eyebrow="حسابداری · مرجوعی‌ها" backHref={projectReturnAccountingHref}>
    {loading ? <ErpSkeleton label="دریافت پرونده مرجوعی پروژه" /> : review ? <form className="space-y-3" noValidate onSubmit={save}>
      {review.prior && <ProjectReturnPriorPosting prior={review.prior} />}
      <ErpSection title={review.prior ? 'نسخهٔ پیشنهادی' : undefined}>
        <div className="space-y-3">
          <ErpStatus {...projectReturnAllocationStatuses[review.allocationStatus]} />
          <ProjectReturnFacts className="grid-cols-2 md:grid-cols-3" items={[
            { label: 'مشتری', value: review.receipt.customerName },
            { label: 'پروژه‌ها', value: Array.from(projects.values()).join('، ') || '—' },
            { label: review.receipt.version.assignedAt ? 'زمان ارجاع' : 'زمان ثبت',
              value: dateText(review.receipt.version.submittedAt ?? review.receipt.version.assignedAt ?? review.receipt.createdAt) },
          ]} />
        </div>
      </ErpSection>
      {review.allocationStatus === 'REWORK_REQUESTED' && review.operational && <ErpSection title="وابستگی‌های پرونده">
        {review.operational.stockBlock && <ErpInlineState kind="stale" title={review.operational.stockBlock} />}
        {review.operational.hasAllocations && <p className="mb-2 text-sm">پرونده تخصیص ذخیره‌شده دارد.</p>}
        {review.operational.reservations.length > 0 && <ul className="mb-3 space-y-2 text-sm" aria-label="رزروهای فعال">
          {review.operational.reservations.map(reservation => {
            const item = review.items.find(row => row.inventoryIdentityId === reservation.identityId);
            return <li key={reservation.id}>
              {item?.productName} · {displayStoneReturnQuantity(reservation.quantity, reservation.unit)} · {reservation.purposeId}
            </li>;
          })}
        </ul>}
        {review.canAllocate && review.operational.canReturnToLogistics && <ErpButton type="button" tone="primary"
          label="بازگشت به لجستیک" disabled={pending} onClick={() => setConfirmReturn(true)} />}
      </ErpSection>}
      <ErpSection title="اقلام مرجوعی">
        <div className="divide-y divide-[var(--sds-border-subtle)]">
        {review.items.map(item => <ItemReview key={item.id} item={item} projects={projects} fields={fields[item.id] ?? blankFields}
        errors={fieldErrors[item.id]} editable={editable} pending={pending} onChange={next => {
          const previous = fields[item.id] ?? blankFields;
          setFields(current => ({ ...current, [item.id]: next }));
          setFieldErrors(current => {
            const errors = current[item.id];
            if (!errors) return current;
            const quantities = { ...errors.quantities };
            for (const key of Object.keys(quantities)) {
              if (previous.quantities[key] !== next.quantities[key]) delete quantities[key];
            }
            return { ...current, [item.id]: { rate: previous.rate === next.rate ? errors.rate : undefined, quantities } };
          });
          setSaved(false);
        }} />)}
        </div>
      </ErpSection>
      {saved && <ErpInlineState kind="success" title="پیش‌نویس تخصیص ذخیره شد." />}
      {error && <ErpInlineState kind="error" title={error} action={{ label: 'بارگذاری دوباره', onClick: () => setReload(value => value + 1) }} />}
      {editable && <ErpButton type="submit" label={pending ? 'در حال ذخیره…' : 'ذخیره پیش‌نویس'} tone="primary" variant="solid" disabled={pending} />}
      {canReturn && <ErpButton type="button" label="ارجاع دوباره به لجستیک" tone="warning" variant="soft" disabled={pending}
        onClick={() => void returnCorrection()} />}
      {review.correctionBlocks.map(block => <ErpInlineState key={block.code} kind="stale" title={block.message} />)}
      {review.postingBlock.code !== 'ALLOCATION_INCOMPLETE'
        && !review.correctionBlocks.some(block => block.code === review.postingBlock.code)
        && <ErpInlineState kind="stale" title={review.postingBlock.message} />}
      <ErpSheet open={confirmReturn} onClose={() => setConfirmReturn(false)} presentation="modal" pending={pending}
        title="بازگشت پرونده به لجستیک" footer={<>
          <ErpButton type="button" label="بازگشت" variant="ghost" disabled={pending} onClick={() => setConfirmReturn(false)} />
          <ErpButton type="button" label="تأیید و ارجاع" tone="danger" disabled={pending} onClick={() => void returnToLogistics()} />
        </>}>
        <p>تخصیص فعال کنار گذاشته می‌شود، رزروهای فعال آزاد می‌شوند و سوابق در پرونده باقی می‌مانند.</p>
      </ErpSheet>
    </form> : <ErpInlineState kind="error" title={error} action={{ label: 'تلاش دوباره', onClick: () => setReload(value => value + 1) }} />}
  </ErpPage>;
}
