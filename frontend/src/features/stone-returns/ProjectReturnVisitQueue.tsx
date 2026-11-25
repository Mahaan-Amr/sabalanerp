'use client';

import { useEffect, useRef, useState } from 'react';
import { ErpButton, ErpCard, ErpEmptyState, ErpInlineState, ErpSection, ErpSheet, ErpSkeleton, ErpStatus } from '@/components/erp';
import { userFacingError } from '@/features/dispatch/userFacingError';
import { projectReturnStatuses, projectReturnVisitApi, type ProjectReturnVisit } from './projectReturnVisitApi';

export function ProjectReturnVisitQueue() {
  const [visits, setVisits] = useState<ProjectReturnVisit[]>();
  const [canCancel, setCanCancel] = useState(false);
  const [target, setTarget] = useState<ProjectReturnVisit>();
  const [loadError, setLoadError] = useState('');
  const [cancelError, setCancelError] = useState('');
  const [retry, setRetry] = useState(0);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);

  useEffect(() => {
    let current = true;
    setLoadError('');
    void projectReturnVisitApi.list().then(response => {
      if (!current) return;
      setVisits(response.data);
      setCanCancel(response.capabilities.canCancel);
    }).catch(error => {
      if (current) setLoadError(userFacingError(error, 'دریافت صف مرجوعی ناموفق بود.'));
    });
    return () => { current = false; };
  }, [retry]);

  async function cancelVisit(visit: ProjectReturnVisit) {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setCancelError('');
    try {
      const updated = await projectReturnVisitApi.cancel(visit.id);
      setVisits(previous => previous?.map(row => row.id === updated.id ? updated : row));
      setTarget(undefined);
    } catch (error) {
      setCancelError(userFacingError(error, 'لغو مراجعه ناموفق بود.'));
      setRetry(value => value + 1);
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  return <ErpSection title="صف ورود برای مرجوعی">
    {loadError && <ErpInlineState kind="error" title={loadError} action={{ label: 'تلاش دوباره', onClick: () => setRetry(value => value + 1) }} />}
    {!loadError && !visits && <ErpSkeleton label="دریافت صف مرجوعی" />}
    {!loadError && visits?.length === 0 && <ErpEmptyState title="مراجعه‌ای در صف مرجوعی وجود ندارد" />}
    <div className="space-y-3">
      {visits?.map(visit => <ErpCard key={visit.id} className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold">{visit.driverName} · {visit.plate}</p>
            <p className="text-sm sds-text-secondary">{visit.vehicleType} · {new Date(visit.admittedAt).toLocaleString('fa-IR')}</p>
          </div>
          <ErpStatus {...projectReturnStatuses[visit.projectReturnStatus]} />
          {canCancel && !loadError && visit.projectReturnStatus === 'AWAITING_RECEIPT' &&
            <div className="flex flex-wrap gap-2">
              <ErpButton label="ثبت دریافت" tone="primary" variant="soft" href={`/dashboard/logistics/returns/new?visitId=${encodeURIComponent(visit.id)}`} />
              <ErpButton label="لغو بدون تحویل" tone="danger" variant="ghost" onClick={() => {
                setCancelError('');
                setTarget(visit);
              }} />
            </div>}
        </div>
      </ErpCard>)}
    </div>
    <ErpSheet open={Boolean(target)} onClose={() => setTarget(undefined)} title="لغو مرجوعی بدون تحویل" presentation="modal" pending={pending}
      footer={<div className="flex flex-wrap justify-end gap-2">
        <ErpButton label="انصراف" variant="ghost" disabled={pending} onClick={() => setTarget(undefined)} />
        <ErpButton label="تأیید لغو" tone="danger" disabled={pending} onClick={() => target && void cancelVisit(target)} />
      </div>}>
      {cancelError && <ErpInlineState kind="error" title={cancelError} />}
      <p>{target?.driverName} · {target?.plate}</p>
      <p>پس از لغو، گارد می‌تواند خروج خودرو را ثبت کند.</p>
    </ErpSheet>
  </ErpSection>;
}
