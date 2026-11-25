'use client';

import { useEffect, useState } from 'react';
import { FaEye } from 'react-icons/fa';
import { ErpButton, ErpEmptyState, ErpInlineState, ErpListPage, ErpStatus } from '@/components/erp';
import { userFacingError } from '@/features/dispatch/userFacingError';
import { projectReturnReceiptApi, projectReturnReceiptHref, projectReturnReceiptStatus, type ProjectReturnReceipt } from './projectReturnReceiptApi';

export function ProjectReturnReceiptList() {
  const [items, setItems] = useState<ProjectReturnReceipt[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [after, setAfter] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError('');
    void projectReturnReceiptApi.list(after).then(page => {
      if (!current) return;
      setItems(previous => after ? [...previous, ...page.items] : page.items);
      setNextCursor(page.nextCursor);
    }).catch(reason => {
      if (current) setError(userFacingError(reason, 'دریافت پرونده‌های مرجوعی ناموفق بود.'));
    }).finally(() => {
      if (current) setLoading(false);
    });
    return () => { current = false; };
  }, [after, retry]);

  return <ErpListPage title="پرونده‌های مرجوعی پروژه" backHref="/dashboard/logistics/returns"
    rows={items} rowKey={row => row.id}
    columns={[
      { id: 'customer', header: 'مشتری', mobileLabel: 'مشتری', priority: 'primary', cell: row => row.customerName },
      { id: 'projects', header: 'پروژه', mobileLabel: 'پروژه', cell: row => row.version.projects.map(project => project.projectName).join('، ') || '—' },
      { id: 'products', header: 'محصول', mobileLabel: 'محصول', cell: row => row.version.items.map(item => item.productName).join('، ') },
      { id: 'status', header: 'وضعیت', mobileLabel: 'وضعیت', cell: row => <ErpStatus {...projectReturnReceiptStatus(row)} /> },
      { id: 'date', header: 'زمان ثبت', mobileLabel: 'زمان ثبت', cell: row => new Date(row.createdAt).toLocaleString('fa-IR') },
    ]}
    rowActionMode="menu"
    rowActions={row => [{ label: row.legacyFinalizationId ? 'مشاهده اصلاح' : 'مشاهده رسید', href: projectReturnReceiptHref(row.id), icon: FaEye, tone: 'primary' }]}
    isLoading={loading && items.length === 0}
    emptyState={error ? null : <ErpEmptyState title="پروندهٔ مرجوعی پروژه وجود ندارد" />}
    footer={nextCursor && !error && <ErpButton label="نمایش موارد بیشتر" variant="soft" disabled={loading} onClick={() => setAfter(nextCursor)} />}
  >
    {error && <ErpInlineState kind="error" title={error} action={{ label: 'تلاش دوباره', onClick: () => setRetry(value => value + 1) }} />}
  </ErpListPage>;
}
