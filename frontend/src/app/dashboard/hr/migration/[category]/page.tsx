'use client';
import { ErpInlineState } from "@/components/erp";

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { FaDatabase } from 'react-icons/fa';
import { ErpBadge, ErpCard, ErpLoading, ErpPage } from '@/components/erp';
import { apiError } from '@/features/hr/hrUi';
import { hrDisplayLabel } from '@/features/hr/hrDisplay';
import { hrAPI } from '@/lib/api';

type MigrationRecord = {
  id: string;
  title: string;
  subtitle?: string;
  detail?: string;
  status?: string;
};

type MigrationRecordResponse = {
  category: string;
  title: string;
  count: number;
  records: MigrationRecord[];
};

const statusTone = (status?: string) => {
  if (status === 'فعال' || status === 'متصل' || status === 'ACTIVE') return 'success' as const;
  if (status === 'غیرفعال') return 'danger' as const;
  if (status === 'بدون پرسنل') return 'warning' as const;
  return 'neutral' as const;
};

export default function HrMigrationRecordsPage() {
  const params = useParams<{ category: string }>();
  const category = String(params.category || '');
  const [data, setData] = useState<MigrationRecordResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const response = await hrAPI.getMigrationRecords(category);
      setData(response.data.data);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setLoading(false);
    }
  }, [category]);

  useEffect(() => { void load(); }, [load]);

  if (loading && !data) return <ErpLoading />;

  return (
    <ErpPage
      eyebrow="منابع انسانی · کنترل انتقال"
      title={data?.title || 'رکوردهای مهاجرت'}
      description="رکوردهای دقیق متناظر با آمار پیش‌نمایش مهاجرت"
      backHref="/dashboard/hr/migration"
      metrics={[{
        label: 'تعداد رکورد',
        value: Number(data?.count || 0).toLocaleString('fa-IR'),
        icon: FaDatabase,
        tone: 'info',
      }]}
    >
      {error && <ErpInlineState kind="error" title={error} />}
      {data && (
        <>
          <ErpCard className="hidden overflow-x-auto md:block">
            <table className="w-full text-right text-sm">
              <thead className="bg-[var(--sds-surface-subtle)]">
                <tr>
                  <th className="p-4 font-bold">رکورد</th>
                  <th className="p-4 font-bold">شناسه یا توضیح</th>
                  <th className="p-4 font-bold">جزئیات</th>
                  <th className="p-4 font-bold">وضعیت</th>
                </tr>
              </thead>
              <tbody>
                {data.records.map((record) => (
                  <tr key={record.id} className="border-t border-[var(--sds-border-subtle)]">
                    <td className="p-4 font-bold">{record.title}</td>
                    <td className="p-4 text-[var(--sds-text-secondary)]" dir="auto">{record.subtitle || '—'}</td>
                    <td className="p-4 text-[var(--sds-text-secondary)]">{record.detail || '—'}</td>
                    <td className="p-4"><ErpBadge tone={statusTone(record.status)}>{hrDisplayLabel(record.status || 'ثبت‌شده')}</ErpBadge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ErpCard>

          <div className="space-y-3 md:hidden">
            {data.records.map((record) => (
              <ErpCard key={record.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="font-bold text-[var(--sds-text-primary)]">{record.title}</h2>
                    <p className="mt-1 break-words text-xs text-[var(--sds-text-secondary)]" dir="auto">{record.subtitle || '—'}</p>
                  </div>
                  <ErpBadge tone={statusTone(record.status)}>{hrDisplayLabel(record.status || 'ثبت‌شده')}</ErpBadge>
                </div>
                {record.detail && <p className="mt-3 border-t border-[var(--sds-border-subtle)] pt-3 text-sm text-[var(--sds-text-secondary)]">{record.detail}</p>}
              </ErpCard>
            ))}
          </div>

          {!data.records.length && (
            <ErpCard className="p-10 text-center text-sm text-[var(--sds-text-secondary)]">
              رکوردی در این دسته وجود ندارد.
            </ErpCard>
          )}
        </>
      )}
    </ErpPage>
  );
}
