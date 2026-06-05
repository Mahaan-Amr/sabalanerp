'use client';

import { useEffect, useState } from 'react';
import {
  FaBalanceScale,
  FaCheckCircle,
  FaExclamationTriangle,
  FaFileInvoice,
  FaFlag,
  FaMoneyCheckAlt,
  FaReceipt,
  FaSync,
} from 'react-icons/fa';
import {
  ErpButton,
  ErpLoading,
  ErpPage,
  ErpSection,
  ErpSummaryGrid,
  ErpTwoColumn,
} from '@/components/erp';
import { accountingAPI } from '@/lib/api';
import {
  CompactQueueItem,
  StatusBadge,
  contractStatusLabels,
  dateFa,
  invoiceStatusLabels,
  money,
  receivableStatusLabels,
  sourceStatusLabels,
  taxStatusLabels,
} from '@/features/accounting/accountingUi';

export default function AccountingContractDetailPage({ params }: { params: { contractId: string } }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [approvalForms, setApprovalForms] = useState<Record<string, { systemInvoiceNumber: string; systemInvoiceDate: string }>>({});

  const loadDetail = async () => {
    try {
      setLoading(true);
      const response = await accountingAPI.getContract(params.contractId);
      if (response.data.success) setData(response.data.data);
    } catch (error) {
      console.error('Error loading accounting contract detail:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDetail();
  }, [params.contractId]);

  const execute = async (action: any) => {
    try {
      setActionLoading(true);
      await accountingAPI.executeAction(action);
      await loadDetail();
    } catch (error) {
      console.error('Accounting action failed:', error);
      window.alert((error as any)?.response?.data?.error || 'اقدام حسابداری انجام نشد');
    } finally {
      setActionLoading(false);
    }
  };

  const defaultSystemInvoiceDate = () =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Tehran',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());

  const updateApprovalForm = (recordId: string, field: 'systemInvoiceNumber' | 'systemInvoiceDate', value: string) => {
    setApprovalForms((prev) => ({
      ...prev,
      [recordId]: {
        systemInvoiceNumber: prev[recordId]?.systemInvoiceNumber || '',
        systemInvoiceDate: prev[recordId]?.systemInvoiceDate || defaultSystemInvoiceDate(),
        [field]: value,
      },
    }));
  };

  const approveFinancialInvoice = (record: any) => {
    const form = approvalForms[record.id] || {
      systemInvoiceNumber: '',
      systemInvoiceDate: defaultSystemInvoiceDate(),
    };
    if (!form.systemInvoiceNumber.trim() || !form.systemInvoiceDate.trim()) {
      window.alert('شماره فاکتور سیستمی و تاریخ آن الزامی است');
      return;
    }
    execute({
      kind: 'APPROVE_FINANCIAL_INVOICE',
      invoiceId: record.id,
      systemInvoiceNumber: form.systemInvoiceNumber.trim(),
      systemInvoiceDate: form.systemInvoiceDate.trim(),
    });
  };

  const canApproveInvoice = (record: any) =>
    record.kind === 'INVOICE_CANDIDATE' &&
    !['ISSUED', 'POSTED', 'VOIDED'].includes(record.status);

  if (loading) return <ErpLoading />;
  if (!data?.contract) {
    return (
      <ErpPage eyebrow="حسابداری" title="قرارداد یافت نشد" backHref="/dashboard/accounting/contracts">
        <ErpSection>این قرارداد در رجیستر حسابداری پیدا نشد.</ErpSection>
      </ErpPage>
    );
  }

  const contract = data.contract;
  const source = data.sourceSnapshot;
  const canCreateRecords = contract.accounting.eligibleForFinancialRecords;

  return (
    <ErpPage
      eyebrow="حسابداری"
      title={`پرونده حسابداری قرارداد ${contract.contractNumber}`}
      description="نمای عملیاتی حسابداری از قرارداد، بدون تغییر دادن اصل قرارداد فروش."
      backHref="/dashboard/accounting/contracts"
      actions={[
        { label: 'به‌روزرسانی', icon: FaSync, onClick: loadDetail, tone: 'neutral' },
      ]}
      metrics={[
        { label: 'مبلغ قرارداد', value: money(contract.accounting.totalContractAmount), icon: FaBalanceScale, tone: 'primary' },
        { label: 'صورتحساب شده', value: money(contract.accounting.invoicedAmount), icon: FaFileInvoice, tone: 'info' },
        { label: 'دریافت شده', value: money(contract.accounting.receivedAmount), icon: FaReceipt, tone: 'success' },
        { label: 'مانده', value: money(contract.accounting.remainingAmount), icon: FaMoneyCheckAlt, tone: contract.accounting.receivableStatus === 'OVERDUE' ? 'danger' : 'warning' },
      ]}
    >
      <ErpTwoColumn
        main={
          <>
            <ErpSection title="خلاصه قرارداد">
              <ErpSummaryGrid
                columns={3}
                items={[
                  { label: 'مشتری', value: contract.customer.displayName },
                  { label: 'وضعیت قرارداد', value: <StatusBadge status={contract.status} label={contractStatusLabels[contract.status] || contract.status} /> },
                  { label: 'وضعیت حسابداری', value: <StatusBadge status={contract.accounting.sourceStatus} label={sourceStatusLabels[contract.accounting.sourceStatus] || contract.accounting.sourceStatus} /> },
                  { label: 'صورتحساب', value: invoiceStatusLabels[contract.accounting.invoiceStatus] || contract.accounting.invoiceStatus },
                  { label: 'دریافتنی', value: receivableStatusLabels[contract.accounting.receivableStatus] || contract.accounting.receivableStatus },
                  { label: 'مالیات', value: taxStatusLabels[contract.accounting.taxStatus] || contract.accounting.taxStatus },
                ]}
              />
            </ErpSection>

            <ErpSection title="اقلام قرارداد" description="این اطلاعات از قرارداد فروش خوانده می‌شود و در رکوردهای حسابداری به صورت Snapshot نگهداری می‌شود.">
              <div className="space-y-3">
                {(source.items || []).map((item: any) => (
                  <CompactQueueItem
                    key={item.id}
                    icon={FaFileInvoice}
                    title={item.productName}
                    meta={`مقدار: ${item.quantity} · قیمت واحد: ${money(item.unitPrice)}`}
                    amount={money(item.totalPrice)}
                  />
                ))}
                {(!source.items || source.items.length === 0) && (
                  <p className="text-sm text-slate-500 dark:text-slate-400">قلمی برای قرارداد ثبت نشده است.</p>
                )}
              </div>
            </ErpSection>

            <ErpSection title="رکوردهای مالی">
              <div className="space-y-3">
                {(data.financialRecords || []).map((record: any) => (
                  <CompactQueueItem
                    key={record.id}
                    icon={FaFileInvoice}
                    title={record.kind}
                    meta={[
                      `ایجاد: ${dateFa(record.createdAt)}`,
                      record.systemInvoiceNumber ? `شماره فاکتور سیستمی: ${record.systemInvoiceNumber}` : null,
                      record.systemInvoiceDate ? `تاریخ فاکتور سیستمی: ${dateFa(record.systemInvoiceDate)}` : null,
                    ].filter(Boolean).join(' · ')}
                    amount={money(record.amount, record.currency)}
                    status={<StatusBadge status={record.status} />}
                    footer={canApproveInvoice(record) ? (
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <input
                            className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                            placeholder="شماره فاکتور سیستمی"
                            value={approvalForms[record.id]?.systemInvoiceNumber || ''}
                            onChange={(event) => updateApprovalForm(record.id, 'systemInvoiceNumber', event.target.value)}
                          />
                          <input
                            type="date"
                            className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                            value={approvalForms[record.id]?.systemInvoiceDate || defaultSystemInvoiceDate()}
                            onChange={(event) => updateApprovalForm(record.id, 'systemInvoiceDate', event.target.value)}
                          />
                        </div>
                        <ErpButton
                          label="تایید مالی"
                          icon={FaCheckCircle}
                          tone="success"
                          disabled={actionLoading}
                          onClick={() => approveFinancialInvoice(record)}
                        />
                      </div>
                    ) : record.systemInvoiceNumber ? (
                      <p className="text-xs text-slate-500 dark:text-slate-400">اطلاعات فاکتور سیستمی پس از تایید مالی قفل شده است.</p>
                    ) : undefined}
                  />
                ))}
                {(!data.financialRecords || data.financialRecords.length === 0) && (
                  <p className="text-sm text-slate-500 dark:text-slate-400">هنوز رکورد مالی برای این قرارداد ایجاد نشده است.</p>
                )}
              </div>
            </ErpSection>

            <ErpSection title="دریافتنی‌ها و دریافت‌ها">
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {(data.receivables || []).map((item: any) => (
                  <CompactQueueItem
                    key={item.id}
                    icon={FaReceipt}
                    title="دریافتنی"
                    meta={`سررسید: ${dateFa(item.dueDate)} · پرداخت شده: ${money(item.paidAmount, item.currency)}`}
                    amount={money(item.remainingAmount, item.currency)}
                    status={<StatusBadge status={item.status} />}
                  />
                ))}
                {(data.paymentEvents || []).map((item: any) => (
                  <CompactQueueItem
                    key={item.id}
                    icon={FaMoneyCheckAlt}
                    title={item.method === 'CHECK' ? `چک ${item.checkNumber || ''}` : 'دریافت'}
                    meta={`تاریخ: ${dateFa(item.occurredAt || item.createdAt)}`}
                    amount={money(item.amount, item.currency)}
                    status={<StatusBadge status={item.checkStatus || item.status} />}
                  />
                ))}
              </div>
            </ErpSection>
          </>
        }
        aside={
          <>
            <ErpSection title="اقدام سریع">
              <div className="space-y-2">
                <ErpButton
                  label="ایجاد پیش‌نویس صورتحساب"
                  icon={FaFileInvoice}
                  tone="info"
                  disabled={!canCreateRecords || actionLoading}
                  title={contract.accounting.eligibilityReason}
                  onClick={() => execute({
                    kind: 'CREATE_INVOICE',
                    contractId: contract.contractId,
                    mode: 'FROM_CONTRACT_TOTAL',
                    issueDate: new Date().toISOString(),
                    idempotencyKey: `invoice-candidate:${contract.contractId}:full`,
                  })}
                />
                <ErpButton
                  label="ایجاد دریافتنی"
                  icon={FaReceipt}
                  tone="success"
                  disabled={!canCreateRecords || contract.accounting.invoiceStatus !== 'ISSUED' || actionLoading}
                  title={contract.accounting.eligibilityReason || (contract.accounting.invoiceStatus !== 'ISSUED' ? 'ابتدا صورتحساب را تایید مالی کنید' : undefined)}
                  onClick={() => execute({
                    kind: 'CREATE_RECEIVABLE',
                    contractId: contract.contractId,
                    amount: contract.accounting.remainingAmount || contract.accounting.totalContractAmount,
                    dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
                    idempotencyKey: `receivable:${contract.contractId}:planned`,
                  })}
                />
                <ErpButton
                  label="پرچم حسابداری"
                  icon={FaFlag}
                  tone="warning"
                  disabled={actionLoading}
                  onClick={() => {
                    const note = window.prompt('یادداشت پرچم حسابداری را وارد کنید');
                    if (!note?.trim()) return;
                    execute({
                      kind: 'FLAG_CONTRACT',
                      contractId: contract.contractId,
                      category: 'OTHER',
                      severity: 'MEDIUM',
                      title: 'نیازمند بررسی حسابداری',
                      note: note.trim(),
                    });
                  }}
                />
                <ErpButton
                  label="درخواست اصلاح"
                  icon={FaExclamationTriangle}
                  tone="danger"
                  disabled={actionLoading}
                  onClick={() => {
                    const reason = window.prompt('متن درخواست اصلاح را وارد کنید');
                    if (!reason?.trim()) return;
                    execute({
                      kind: 'REQUEST_CORRECTION',
                      contractId: contract.contractId,
                      category: 'OTHER',
                      priority: 'MEDIUM',
                      reason: reason.trim(),
                    });
                  }}
                />
              </div>
            </ErpSection>

            <ErpSection title="مالیات و سامانه مودیان">
              <div className="space-y-3">
                {(data.tax || []).map((item: any) => (
                  <CompactQueueItem
                    key={item.id}
                    icon={FaBalanceScale}
                    title={taxStatusLabels[item.submissionStatus] || item.submissionStatus}
                    meta={item.missingFields?.length ? `کسری: ${item.missingFields.join('، ')}` : item.trackingCode || 'بدون کد پیگیری'}
                    amount={money(item.taxableAmount)}
                    status={<StatusBadge status={item.submissionStatus} />}
                  />
                ))}
                {(!data.tax || data.tax.length === 0) && <p className="text-sm text-slate-500 dark:text-slate-400">پرونده مالیاتی هنوز ایجاد نشده است.</p>}
              </div>
            </ErpSection>

            <ErpSection title="درخواست‌های اصلاح و پرچم‌ها">
              <div className="space-y-3">
                {(data.flags || []).map((item: any) => (
                  <CompactQueueItem key={item.id} icon={FaFlag} title={item.title} meta={item.note} status={<StatusBadge status={item.status} />} />
                ))}
                {(data.correctionRequests || []).map((item: any) => (
                  <CompactQueueItem key={item.id} icon={FaExclamationTriangle} title={item.accountantNote} meta={`اولویت: ${item.priority}`} status={<StatusBadge status={item.status} />} />
                ))}
              </div>
            </ErpSection>
          </>
        }
      />
    </ErpPage>
  );
}
