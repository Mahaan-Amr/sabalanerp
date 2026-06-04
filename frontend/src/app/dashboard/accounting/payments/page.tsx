'use client';

import { useEffect, useState } from 'react';
import { FaMoneyCheckAlt, FaSync } from 'react-icons/fa';
import { ErpEmptyState, ErpListPage, type ErpAction, type ErpColumn } from '@/components/erp';
import { accountingAPI } from '@/lib/api';
import { StatusBadge, dateFa, money } from '@/features/accounting/accountingUi';

export default function AccountingPaymentsPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadRows = async () => {
    try {
      setLoading(true);
      const response = await accountingAPI.getPayments();
      if (response.data.success) setRows(response.data.data);
    } catch (error) {
      console.error('Error loading payments:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRows();
  }, []);

  const updateCheck = async (row: any, status: string) => {
    try {
      setActionLoading(`${row.id}:${status}`);
      await accountingAPI.executeAction({
        kind: 'UPDATE_CHECK_STATUS',
        paymentEventId: row.id,
        status,
        occurredAt: new Date().toISOString(),
      });
      await loadRows();
    } catch (error) {
      console.error('Error updating check:', error);
    } finally {
      setActionLoading(null);
    }
  };

  const columns: ErpColumn<any>[] = [
    { id: 'payment', header: 'دریافت / چک', priority: 'primary', cell: (row) => <div><p className="font-semibold">{row.method === 'CHECK' ? `چک ${row.checkNumber || ''}` : 'دریافت'}</p><p className="mt-1 text-xs text-slate-500">قرارداد: {row.contractId || '—'}</p></div> },
    { id: 'amount', header: 'مبلغ', mobileLabel: 'مبلغ', priority: 'secondary', align: 'end', cell: (row) => money(row.amount, row.currency) },
    { id: 'due', header: 'سررسید چک', mobileLabel: 'سررسید چک', priority: 'meta', cell: (row) => dateFa(row.checkDueDate) },
    { id: 'status', header: 'وضعیت', mobileLabel: 'وضعیت', priority: 'secondary', cell: (row) => <StatusBadge status={row.checkStatus || row.status} /> },
  ];

  const rowActions = (row: any): ErpAction[] => row.method === 'CHECK'
    ? [
        { label: 'واگذار شد', icon: FaMoneyCheckAlt, tone: 'info', disabled: actionLoading === `${row.id}:DEPOSITED`, onClick: () => updateCheck(row, 'DEPOSITED') },
        { label: 'وصول شد', icon: FaMoneyCheckAlt, tone: 'success', disabled: actionLoading === `${row.id}:CLEARED`, onClick: () => updateCheck(row, 'CLEARED') },
        { label: 'برگشت خورد', icon: FaMoneyCheckAlt, tone: 'danger', disabled: actionLoading === `${row.id}:BOUNCED`, onClick: () => updateCheck(row, 'BOUNCED') },
      ]
    : [];

  return (
    <ErpListPage
      eyebrow="حسابداری"
      title="دریافت‌ها و چک‌ها"
      description="پیگیری وضعیت دریافت نقدی، کارت، حواله و چک بدون تغییر دادن برنامه پرداخت ثبت شده در فروش."
      actions={[{ label: 'به‌روزرسانی', icon: FaSync, onClick: loadRows, tone: 'neutral' }]}
      rows={rows}
      rowKey={(row) => row.id}
      columns={columns}
      rowActions={rowActions}
      isLoading={loading}
      emptyState={<ErpEmptyState icon={FaMoneyCheckAlt} title="دریافت یا چکی ثبت نشده است" description="دریافت‌ها از پرونده حسابداری قرارداد ثبت و پیگیری می‌شوند." />}
    />
  );
}
