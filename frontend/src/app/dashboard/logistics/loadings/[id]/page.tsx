'use client';
import { ErpField, ErpInput, ErpSelect, ErpTextarea } from '@/components/erp';
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { FaBan, FaCheck, FaEdit, FaPlus, FaPrint, FaSync, FaTrash } from 'react-icons/fa';
import { ErpButton, ErpCard, ErpInlineState, ErpLoading, ErpPage, ErpSection, ErpSummaryGrid, ErpTwoColumn } from '@/components/erp';
import { logisticsAPI } from '@/lib/api';
import RoleAwareDispatchCases from '@/features/dispatch-case/RoleAwareDispatchCases';
import { StatusBadge, dateFa, inputClass, labelClass, loadingDriversName, numberFa, unitLabels } from '../../logistics-ui';

export default function LoadingDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [actionError, setActionError] = useState('');
  const [dispatchTimelineStale, setDispatchTimelineStale] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [correction, setCorrection] = useState({ sourceContractItemId: '', loadingLineId: '', deltaQuantity: '', reason: '' });

  const load = useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await logisticsAPI.getLoading(params.id);
      if (response.data.success) setLoading(response.data.data);
    } finally {
      setIsLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!isLoading && loading && searchParams.get('print') === '1') {
      window.setTimeout(() => window.print(), 250);
    }
  }, [isLoading, loading, searchParams]);

  const runAction = async (action: () => Promise<any>) => {
    setActionError('');
    try {
      await action();
      await load();
    } catch (err: any) {
      setActionError(err.response?.data?.error || 'عملیات ناموفق بود.');
    }
  };

  const deleteDraft = async () => {
    setActionError('');
    try {
      await logisticsAPI.deleteLoading(loading.id);
      router.push('/dashboard/logistics/loadings');
    } catch (err: any) {
      setActionError(err.response?.data?.error || 'حذف پیش‌نویس ناموفق بود.');
    }
  };

  if (isLoading) return <ErpLoading />;
  if (!loading) return <ErpPage title="بارگیری پیدا نشد" backHref="/dashboard/logistics/loadings"><div /></ErpPage>;

  const driver = loading.driverSnapshot || {};
  const assignedDrivers = loading.driverAssignments || [];
  const driverSummary = loadingDriversName(loading);
  const plateSummary = assignedDrivers.length
    ? assignedDrivers.map((assignment: any) => assignment.driverSnapshot?.vehiclePlate || assignment.vehiclePair?.vehiclePlate).filter(Boolean).join('، ')
    : driver.vehiclePlate || '—';
  const vehicleTypeSummary = assignedDrivers.length
    ? assignedDrivers.map((assignment: any) => assignment.driverSnapshot?.vehicleType || assignment.vehiclePair?.vehicleType).filter(Boolean).join('، ')
    : driver.vehicleType || '—';
  const phoneSummary = assignedDrivers.length
    ? assignedDrivers.map((assignment: any) => assignment.driverSnapshot?.phone || assignment.vehiclePair?.phone).filter(Boolean).join('، ')
    : driver.phone || '—';
  const canFinalize = loading.status === 'DRAFT';
  const canDeleteDraft = loading.status === 'DRAFT';
  const canCancel = loading.status !== 'CANCELLED';
  const canCorrect = loading.status === 'FINALIZED';
  const printPage = () => window.print();

  return (
    <ErpPage
      eyebrow="لجستیک"
      title={`بارگیری ${loading.loadingNumber}`}
      description={`${loading.customer?.firstName || ''} ${loading.customer?.lastName || ''} · ${loading.project?.projectName || loading.project?.address || ''}`}
      backHref="/dashboard/logistics/loadings"
      actions={[
        { label: 'ویرایش پیش‌نویس', icon: FaEdit, href: `/dashboard/logistics/loadings/new?draftId=${loading.id}`, disabled: !canDeleteDraft, tone: 'primary' },
        { label: 'حذف پیش‌نویس', icon: FaTrash, onClick: deleteDraft, disabled: !canDeleteDraft, tone: 'danger' },
        { label: 'چاپ', icon: FaPrint, onClick: printPage, tone: 'neutral' },
        { label: 'به‌روزرسانی', icon: FaSync, onClick: load, tone: 'neutral' },
        { label: 'نهایی‌سازی', icon: FaCheck, onClick: () => runAction(() => logisticsAPI.finalizeLoading(loading.id)), disabled: dispatchTimelineStale || !canFinalize, tone: 'success', variant: 'solid' },
      ]}
    >
      {actionError && <ErpInlineState kind="error" title={actionError} />}

      <ErpTwoColumn
        main={
          <>
            <ErpSection title="خلاصه سند">
              <ErpSummaryGrid
                columns={3}
                items={[
                  { label: 'وضعیت', value: <StatusBadge status={loading.status} /> },
                  { label: 'تاریخ بارگیری', value: dateFa(loading.loadingDate) },
                  { label: 'راننده', value: driverSummary },
                  { label: 'پلاک', value: plateSummary },
                  { label: 'نوع ماشین', value: vehicleTypeSummary },
                  { label: 'شماره تماس', value: phoneSummary },
                ]}
              />
            </ErpSection>

            <ErpSection title="ردیف‌های بارگیری">
              <div className="space-y-3">
                {loading.lines.map((line: any) => (
                  <ErpCard key={line.id} className="p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">{line.productSnapshot?.name || line.product?.namePersian || line.product?.name}</p>
                        <p className="mt-1 text-xs text-[var(--sds-text-secondary)]">قرارداد {line.sourceContract?.contractNumber} · {line.sourceContractItemId}</p>
                      </div>
                      <p className="rounded-lg bg-[var(--sds-accent)]/10 px-3 py-2 text-sm font-semibold text-[var(--sds-accent)] dark:bg-[var(--sds-accent-surface)] dark:text-[var(--sds-accent)]">
                        {numberFa(line.quantity)} {unitLabels[line.unit] || line.unit}
                      </p>
                    </div>
                    {(line.khatRas || line.pieceCount) && (
                      <p className="mt-3 text-sm text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">
                        خط راس {numberFa(line.khatRas)} × تعداد {numberFa(line.pieceCount)} + اضافه {numberFa(line.plus)} - کسر {numberFa(line.minus)}
                      </p>
                    )}
                    {line.corrections?.length > 0 && (
                      <ErpInlineState className="mt-3" kind="stale" title={`اصلاحات: ${line.corrections.map((item: any) => `${numberFa(item.deltaQuantity)} ${unitLabels[item.unit] || item.unit}`).join('، ')}`} />
                    )}
                  </ErpCard>
                ))}
              </div>
            </ErpSection>

            <ErpSection title="برگه چاپی بارگیری" description="این بخش از داده نهایی سند ساخته می‌شود و منبع حقیقت نیست.">
              <div className="rounded-lg border border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] p-5 text-sm leading-7 text-[var(--sds-text-primary)] dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)] dark:text-[var(--sds-text-primary)] print:border-[var(--sds-border-strong)] print:bg-[var(--sds-surface-raised)] print:text-[var(--sds-text-primary)]">
                <div className="mb-4 flex items-start justify-between gap-4 border-b pb-3">
                  <div>
                    <h2 className="text-lg font-bold">برگه بارگیری سبلان</h2>
                    <p>شماره: {loading.loadingNumber}</p>
                  </div>
                  <p>{dateFa(loading.finalizedAt || loading.loadingDate)}</p>
                </div>
                <p>مشتری / پروژه: {loading.customer?.companyName || `${loading.customer?.firstName || ''} ${loading.customer?.lastName || ''}`} · {loading.project?.projectName || loading.project?.address}</p>
                <p>راننده: {driverSummary} · پلاک: {plateSummary} · ماشین: {vehicleTypeSummary}</p>
                <div className="mt-4 space-y-2">
                  {loading.lines.map((line: any, index: number) => (
                    <div key={line.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-3 border-b border-[var(--sds-border-default)] py-2">
                      <span>{(index + 1).toLocaleString('fa-IR')}</span>
                      <span>{line.productSnapshot?.name || line.product?.namePersian || line.product?.name} · قرارداد {line.sourceContract?.contractNumber}</span>
                      <span>{numberFa(line.quantity)} {unitLabels[line.unit] || line.unit}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-8 grid grid-cols-2 gap-8 text-center md:grid-cols-4">
                  <span>انبار</span>
                  <span>راننده</span>
                  <span>نگهبانی</span>
                  <span>نماینده پروژه</span>
                </div>
              </div>
            </ErpSection>
          </>
        }
        aside={
          <>
            {canCancel && (
              <ErpSection title="لغو سند">
                <div className="space-y-3">
                  <ErpTextarea className={`${inputClass} min-h-24`} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder="دلیل لغو" />
                  <ErpButton label="لغو بارگیری" icon={FaBan} tone="danger" onClick={() => runAction(() => logisticsAPI.cancelLoading(loading.id, cancelReason))} disabled={dispatchTimelineStale || !cancelReason.trim()} />
                </div>
              </ErpSection>
            )}

            {canCorrect && (
              <ErpSection title="اصلاح مقدار">
                <div className="space-y-3">
                  <ErpField label="ردیف منبع" required>
                    <ErpSelect value={correction.sourceContractItemId} onChange={(event) => {
                      const line = loading.lines.find((candidate: any) => candidate.sourceContractItemId === event.target.value);
                      setCorrection((current) => ({ ...current, sourceContractItemId: event.target.value, loadingLineId: line?.id || '' }));
                    }}>
                      <option value="">انتخاب کنید</option>
                      {loading.lines.map((line: any) => <option key={line.id} value={line.sourceContractItemId}>{line.productSnapshot?.name || line.product?.namePersian} · {line.sourceContract?.contractNumber}</option>)}
                    </ErpSelect>
                  </ErpField>
                  <ErpField label="دلتا مقدار" required><ErpInput value={correction.deltaQuantity} onChange={(event) => setCorrection((current) => ({ ...current, deltaQuantity: event.target.value }))} placeholder="مثلا 0.25 یا -0.25" /></ErpField>
                  <ErpField label="دلیل اصلاح" required><ErpTextarea className="min-h-24" value={correction.reason} onChange={(event) => setCorrection((current) => ({ ...current, reason: event.target.value }))} /></ErpField>
                  <ErpButton
                    label="ثبت اصلاح"
                    icon={FaPlus}
                    onClick={() => runAction(() => logisticsAPI.createCorrection(loading.id, correction))}
                    disabled={dispatchTimelineStale || !correction.sourceContractItemId || !correction.deltaQuantity || !correction.reason.trim()}
                  />
                </div>
              </ErpSection>
            )}
          </>
        }
      />
      <RoleAwareDispatchCases workspace="logistics" loadingId={params.id} onStaleChange={setDispatchTimelineStale} />
    </ErpPage>
  );
}
