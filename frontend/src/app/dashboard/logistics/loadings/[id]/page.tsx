'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { FaBan, FaCheck, FaEdit, FaPlus, FaPrint, FaSync, FaTrash } from 'react-icons/fa';
import { ErpButton, ErpCard, ErpLoading, ErpPage, ErpSection, ErpSummaryGrid, ErpTwoColumn } from '@/components/erp';
import { logisticsAPI } from '@/lib/api';
import { StatusBadge, dateFa, driverName, inputClass, labelClass, numberFa, unitLabels } from '../../logistics-ui';

export default function LoadingDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [loading, setLoading] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [actionError, setActionError] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [correction, setCorrection] = useState({ sourceContractItemId: '', loadingLineId: '', deltaQuantity: '', reason: '' });

  const load = async () => {
    try {
      setIsLoading(true);
      const response = await logisticsAPI.getLoading(params.id);
      if (response.data.success) setLoading(response.data.data);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [params.id]);

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
        { label: 'نهایی‌سازی', icon: FaCheck, onClick: () => runAction(() => logisticsAPI.finalizeLoading(loading.id)), disabled: !canFinalize, tone: 'success', variant: 'solid' },
      ]}
    >
      {actionError && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">{actionError}</div>}

      <ErpTwoColumn
        main={
          <>
            <ErpSection title="خلاصه سند">
              <ErpSummaryGrid
                columns={3}
                items={[
                  { label: 'وضعیت', value: <StatusBadge status={loading.status} /> },
                  { label: 'تاریخ بارگیری', value: dateFa(loading.loadingDate) },
                  { label: 'راننده', value: driverName(driver) },
                  { label: 'پلاک', value: driver.vehiclePlate || '—' },
                  { label: 'نوع ماشین', value: driver.vehicleType || '—' },
                  { label: 'شماره تماس', value: driver.phone || '—' },
                ]}
              />
            </ErpSection>

            <ErpSection title="ردیف‌های بارگیری">
              <div className="space-y-3">
                {loading.lines.map((line: any) => (
                  <ErpCard key={line.id} className="p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="font-semibold text-slate-900 dark:text-white">{line.productSnapshot?.name || line.product?.namePersian || line.product?.name}</p>
                        <p className="mt-1 text-xs text-slate-500">قرارداد {line.sourceContract?.contractNumber} · {line.sourceContractItemId}</p>
                      </div>
                      <p className="rounded-lg bg-[#074747]/10 px-3 py-2 text-sm font-semibold text-[#074747] dark:bg-teal-900/30 dark:text-teal-100">
                        {numberFa(line.quantity)} {unitLabels[line.unit] || line.unit}
                      </p>
                    </div>
                    {(line.khatRas || line.pieceCount) && (
                      <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
                        خط راس {numberFa(line.khatRas)} × تعداد {numberFa(line.pieceCount)} + اضافه {numberFa(line.plus)} - کسر {numberFa(line.minus)}
                      </p>
                    )}
                    {line.corrections?.length > 0 && (
                      <div className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-100">
                        اصلاحات: {line.corrections.map((item: any) => `${numberFa(item.deltaQuantity)} ${unitLabels[item.unit] || item.unit}`).join('، ')}
                      </div>
                    )}
                  </ErpCard>
                ))}
              </div>
            </ErpSection>

            <ErpSection title="برگه چاپی بارگیری" description="این بخش از داده نهایی سند ساخته می‌شود و منبع حقیقت نیست.">
              <div className="rounded-lg border border-slate-200 bg-white p-5 text-sm leading-7 text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 print:border-black print:bg-white print:text-black">
                <div className="mb-4 flex items-start justify-between gap-4 border-b pb-3">
                  <div>
                    <h2 className="text-lg font-bold">برگه بارگیری سبلان</h2>
                    <p>شماره: {loading.loadingNumber}</p>
                  </div>
                  <p>{dateFa(loading.finalizedAt || loading.loadingDate)}</p>
                </div>
                <p>مشتری / پروژه: {loading.customer?.companyName || `${loading.customer?.firstName || ''} ${loading.customer?.lastName || ''}`} · {loading.project?.projectName || loading.project?.address}</p>
                <p>راننده: {driverName(driver)} · پلاک: {driver.vehiclePlate || '—'} · ماشین: {driver.vehicleType || '—'}</p>
                <div className="mt-4 space-y-2">
                  {loading.lines.map((line: any, index: number) => (
                    <div key={line.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-3 border-b border-slate-200 py-2">
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
                  <textarea className={`${inputClass} min-h-24`} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder="دلیل لغو" />
                  <ErpButton label="لغو بارگیری" icon={FaBan} tone="danger" onClick={() => runAction(() => logisticsAPI.cancelLoading(loading.id, cancelReason))} disabled={!cancelReason.trim()} />
                </div>
              </ErpSection>
            )}

            {canCorrect && (
              <ErpSection title="اصلاح مقدار">
                <div className="space-y-3">
                  <label>
                    <span className={labelClass}>ردیف منبع</span>
                    <select className={inputClass} value={correction.sourceContractItemId} onChange={(event) => {
                      const line = loading.lines.find((candidate: any) => candidate.sourceContractItemId === event.target.value);
                      setCorrection((current) => ({ ...current, sourceContractItemId: event.target.value, loadingLineId: line?.id || '' }));
                    }}>
                      <option value="">انتخاب کنید</option>
                      {loading.lines.map((line: any) => <option key={line.id} value={line.sourceContractItemId}>{line.productSnapshot?.name || line.product?.namePersian} · {line.sourceContract?.contractNumber}</option>)}
                    </select>
                  </label>
                  <label><span className={labelClass}>دلتا مقدار</span><input className={inputClass} value={correction.deltaQuantity} onChange={(event) => setCorrection((current) => ({ ...current, deltaQuantity: event.target.value }))} placeholder="مثلا 0.25 یا -0.25" /></label>
                  <label><span className={labelClass}>دلیل اصلاح</span><textarea className={`${inputClass} min-h-24`} value={correction.reason} onChange={(event) => setCorrection((current) => ({ ...current, reason: event.target.value }))} /></label>
                  <ErpButton
                    label="ثبت اصلاح"
                    icon={FaPlus}
                    onClick={() => runAction(() => logisticsAPI.createCorrection(loading.id, correction))}
                    disabled={!correction.sourceContractItemId || !correction.deltaQuantity || !correction.reason.trim()}
                  />
                </div>
              </ErpSection>
            )}
          </>
        }
      />
    </ErpPage>
  );
}
