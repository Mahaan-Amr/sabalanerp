'use client';

import { useEffect, useState } from 'react';
import { ErpBadge, ErpEmptyState, ErpInlineState, ErpLoading, ErpSection } from '@/components/erp';
import { shipmentQuantityAPI } from '@/lib/api';
import { formatShipmentQuantity, shipmentHealthPresentation, type ShipmentQuantityRow } from './shipmentQuantityPresentation';

interface ProjectionResponse {
  cutoff: string;
  rows: ShipmentQuantityRow[];
  totalsByUnit: Array<{
    unit: string;
    contracted: string;
    finalizedReserved: string;
    physicallyDispatched: string;
    availableToLoad: string;
    affectedRowCount: number;
    isComplete: boolean;
  }>;
}

const unitLabel = (unit: string) => ({ meter: 'متر طول', squareMeter: 'متر مربع', count: 'عدد', ton: 'تن' }[unit] || unit);

export function ShipmentQuantitySummary({ contractId, customerId }: { contractId?: string; customerId?: string }) {
  const [data, setData] = useState<ProjectionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshError, setRefreshError] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const request = contractId ? shipmentQuantityAPI.getContract(contractId) : shipmentQuantityAPI.getCustomer(customerId!);
    request.then((response) => {
      if (!active) return;
      setData(response.data.data);
      setRefreshError(false);
    }).catch(() => {
      if (active) setRefreshError(true);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [contractId, customerId]);

  if (loading && !data) return <ErpLoading />;
  if (!data && refreshError) return <ErpInlineState kind="error" title="اطلاعات ارسال در دسترس نیست" />;

  return (
    <ErpSection title="مانده ارسال" description="مقادیر قرارداد، رزروشده، خارج‌شده و قابل بارگیری از شواهد ثبت‌شده محاسبه می‌شوند.">
      {refreshError && <ErpInlineState kind="stale" title="آخرین اطلاعات موفق نمایش داده می‌شود؛ به‌روزرسانی انجام نشد." className="mb-4" />}
      {!data?.rows.length ? (
        <ErpEmptyState title="هنوز شواهد ارسال قابل نمایش نیست" />
      ) : (
        <div className="space-y-4">
          {data.totalsByUnit.map((total) => (
            <div key={total.unit} className="rounded-xl border border-[var(--sds-border-subtle)] bg-[var(--sds-surface-subtle)] p-3">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="sds-text-primary text-sm font-semibold">جمع {unitLabel(total.unit)}</h3>
                {!total.isComplete && <ErpBadge tone="warning">جمع شناخته‌شده · {total.affectedRowCount.toLocaleString('fa-IR')} ردیف نیازمند بررسی</ErpBadge>}
              </div>
              <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {[
                  ['قرارداد', total.contracted], ['رزروشده', total.finalizedReserved],
                  ['خارج‌شده', total.physicallyDispatched], ['قابل بارگیری', total.availableToLoad],
                ].map(([label, value]) => <div key={label}><dt className="sds-text-muted text-xs">{label}</dt><dd className="sds-text-primary mt-1 font-semibold">{formatShipmentQuantity(value)}</dd></div>)}
              </dl>
            </div>
          ))}
          <div className="overflow-x-auto">
            <table className="min-w-full text-right text-sm">
              <thead><tr className="border-b border-[var(--sds-border-default)] sds-text-muted"><th className="p-3">قرارداد و ردیف</th><th className="p-3">واحد</th><th className="p-3">قرارداد</th><th className="p-3">رزروشده</th><th className="p-3">خارج‌شده</th><th className="p-3">قابل بارگیری</th><th className="p-3">سلامت</th></tr></thead>
              <tbody>{data.rows.map((row) => {
                const health = shipmentHealthPresentation(row.health);
                return <tr key={`${row.contractItemId}:${row.unit}`} className="border-b border-[var(--sds-border-subtle)]"><td className="p-3"><p className="font-medium">{row.contractNumber || '—'} · {row.productName || 'محصول'}</p><p className="sds-text-muted mt-1 text-xs">{row.productRowId}</p></td><td className="p-3">{unitLabel(row.unit)}</td><td className="p-3">{formatShipmentQuantity(row.quantities?.contracted)}</td><td className="p-3">{formatShipmentQuantity(row.quantities?.finalizedReserved)}</td><td className="p-3">{formatShipmentQuantity(row.quantities?.physicallyDispatched)}</td><td className="p-3">{formatShipmentQuantity(row.quantities?.availableToLoad)}</td><td className="p-3"><ErpBadge tone={health.tone}>{health.label}</ErpBadge>{row.healthReasons.length > 0 && <p className="sds-text-muted mt-1 max-w-xs text-xs">{row.healthReasons.join('، ')}</p>}</td></tr>;
              })}</tbody>
            </table>
          </div>
        </div>
      )}
    </ErpSection>
  );
}
