'use client';

import { useEffect, useState } from 'react';
import { FaEye } from 'react-icons/fa';
import { ErpButton, ErpEmptyState, ErpInlineState, ErpListPage, ErpStatus } from '@/components/erp';
import { userFacingError } from '@/features/dispatch/userFacingError';
import { displayStoneReturnQuantity, stoneReturnAllocationStatuses, stoneReturnApi, type StoneReturnReceipt } from './stoneReturnApi';

export function StoneReturnList({ workspace }: { workspace: 'logistics' | 'accounting' }) {
  const [items, setItems] = useState<StoneReturnReceipt[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [after, setAfter] = useState<string>();
  const [canRecord, setCanRecord] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError('');
    void stoneReturnApi.list(workspace, after).then(page => {
      if (!current) return;
      setItems(previous => after ? [...previous, ...page.items] : page.items);
      setNextCursor(page.nextCursor);
      setCanRecord(page.canRecord === true);
    }).catch(error => {
      if (current) setError(userFacingError(error, 'دریافت فهرست مرجوعی‌ها ناموفق بود.'));
    }).finally(() => {
      if (current) setLoading(false);
    });
    return () => { current = false; };
  }, [workspace, after, retry]);

  const logistics = workspace === 'logistics';
  return <ErpListPage
    title="مرجوعی‌ها"
    eyebrow={logistics ? 'لجستیک' : 'بررسی و پیگیری'}
    backHref={logistics ? '/dashboard/logistics' : '/dashboard/accounting/workflows/review'}
    actions={logistics && canRecord ? [{ label: 'ثبت دریافت سنگ', href: '/dashboard/logistics/returns/new', tone: 'primary', variant: 'solid' }] : []}
    rows={items}
    rowKey={row => row.id}
    rowActionMode="menu"
    rowActions={row => logistics ? [] : [{
      label: 'مشاهده پرونده', href: `/dashboard/accounting/returns/${encodeURIComponent(row.id)}`, icon: FaEye, tone: 'primary',
    }]}
    isLoading={loading && items.length === 0}
    columns={[
      { id: 'customer', header: 'مشتری', mobileLabel: 'مشتری', priority: 'primary', cell: row => row.customerName },
      { id: 'stone', header: 'سنگ', mobileLabel: 'سنگ', cell: row => <div>{row.productName}<p className="text-xs sds-text-secondary" dir="ltr">{row.productCode}</p></div> },
      { id: 'date', header: 'زمان ثبت', mobileLabel: 'زمان ثبت', cell: row => new Date(row.createdAt).toLocaleString('fa-IR', { dateStyle: 'short', timeStyle: 'short' }) },
      { id: 'received', header: 'دریافتی', mobileLabel: 'دریافتی', cell: row => displayStoneReturnQuantity(row.receivedQuantity, row.unit) },
      { id: 'accepted', header: 'پذیرفته‌شده', mobileLabel: 'پذیرفته‌شده', cell: row => displayStoneReturnQuantity(row.acceptedQuantity, row.unit) },
      { id: 'rejected', header: 'ردشده', mobileLabel: 'ردشده', cell: row => displayStoneReturnQuantity(row.rejectedQuantity, row.unit) },
      ...(!logistics ? [{ id: 'status', header: 'وضعیت', mobileLabel: 'وضعیت', cell: (row: StoneReturnReceipt) =>
        row.allocationStatus ? <ErpStatus {...stoneReturnAllocationStatuses[row.allocationStatus]} /> : '—',
      }] : []),
      { id: 'reason', header: 'علت رد', mobileLabel: 'علت رد', cell: row => row.rejectionReason ?? '—' },
    ]}
    emptyState={error ? null : <ErpEmptyState title="مرجوعی سنگی ثبت نشده است" />}
    footer={nextCursor && !error ? <ErpButton label="نمایش موارد بیشتر" variant="soft" disabled={loading} onClick={() => setAfter(nextCursor)} /> : null}
  >
    {error && <ErpInlineState kind="error" title={error} action={{ label: 'تلاش دوباره', onClick: () => setRetry(value => value + 1) }} />}
  </ErpListPage>;
}
