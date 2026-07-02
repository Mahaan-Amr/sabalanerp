'use client';

import { useEffect, useState } from 'react';
import {
  FaBalanceScale,
  FaCheckCircle,
  FaDownload,
  FaEdit,
  FaExclamationTriangle,
  FaFileInvoice,
  FaFlag,
  FaMoneyCheckAlt,
  FaPrint,
  FaReceipt,
  FaSync,
  FaTrashAlt,
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
import { downloadBlobResponse } from '@/lib/downloadFile';
import {
  CompactQueueItem,
  FinancialInvoiceApprovalForm,
  FinancialInvoiceApprovalPayload,
  StatusBadge,
  contractStatusLabels,
  dateFa,
  invoiceStatusLabels,
  money,
  receivableStatusLabels,
  sourceStatusLabels,
  taxStatusLabels,
} from '@/features/accounting/accountingUi';

const toPdfViewerUrl = (url: string) => `${url}#page=1&zoom=page-fit`;

type SalesPdfVariant = 'original' | 'accounting' | 'workshop' | 'custom';
type CustomPrintPreset = 'accounting' | 'workshop' | 'detailed' | 'summarized';
type CustomProductRowsMode = 'detailed' | 'summarized';

type CustomPrintSettings = {
  preset: CustomPrintPreset;
  productRowsMode: CustomProductRowsMode;
  showCustomerSection: boolean;
  showProductsSection: boolean;
  showPrices: boolean;
  showExplanatoryRows: boolean;
  showDeliverySection: boolean;
  showPaymentSection: boolean;
  showTotals: boolean;
  showNotes: boolean;
  columns: {
    index: boolean;
    code: boolean;
    description: boolean;
    category: boolean;
    length: boolean;
    width: boolean;
    measurement: boolean;
    count: boolean;
    rate: boolean;
    total: boolean;
  };
};

const salesPdfVariantLabels: Record<SalesPdfVariant, string> = {
  original: 'چاپ نسخه اصلی',
  accounting: 'چاپ حسابداری',
  workshop: 'چاپ نمره کارگاه',
  custom: 'چاپ سفارشی',
};

const defaultCustomPrintSettings: CustomPrintSettings = {
  preset: 'accounting',
  productRowsMode: 'detailed',
  showCustomerSection: true,
  showProductsSection: true,
  showPrices: true,
  showExplanatoryRows: true,
  showDeliverySection: true,
  showPaymentSection: true,
  showTotals: true,
  showNotes: true,
  columns: {
    index: true,
    code: true,
    description: true,
    category: true,
    length: true,
    width: true,
    measurement: true,
    count: true,
    rate: true,
    total: true,
  },
};

export default function AccountingContractDetailPage({ params }: { params: { contractId: string } }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [pdfActionLoading, setPdfActionLoading] = useState<string | null>(null);
  const [salesPdfVariant, setSalesPdfVariant] = useState<SalesPdfVariant>('accounting');
  const [customPrintSettings, setCustomPrintSettings] = useState<CustomPrintSettings>(defaultCustomPrintSettings);

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

  const approveFinancialInvoice = (payload: FinancialInvoiceApprovalPayload) => {
    execute({
      kind: 'APPROVE_FINANCIAL_INVOICE',
      invoiceId: payload.invoiceId,
      systemInvoiceNumber: payload.systemInvoiceNumber,
      systemInvoiceDate: payload.systemInvoiceDate,
      sepidarAmount: payload.sepidarAmount,
    });
  };

  const deleteDraftRecord = (record: any) => {
    if (!window.confirm('این پیش‌نویس رکورد مالی حذف شود؟')) return;
    execute({
      kind: 'DELETE_DRAFT_ACCOUNTING_RECORD',
      recordId: record.id,
      note: 'Deleted draft from accounting contract detail',
    });
  };

  const resolveCorrection = (request: any) => {
    const resolutionNote = window.prompt('یادداشت بستن درخواست اصلاح را وارد کنید');
    if (resolutionNote === null) return;
    execute({
      kind: 'RESOLVE_CORRECTION',
      correctionRequestId: request.id,
      resolutionNote: resolutionNote?.trim() || undefined,
    });
  };

  const openPdfUrl = (url: string, tryPrint: boolean) => {
    const viewerUrl = toPdfViewerUrl(url);
    const pdfWindow = window.open(viewerUrl, '_blank', 'noopener,noreferrer');
    if (!pdfWindow) {
      window.location.href = viewerUrl;
      return;
    }

    if (!tryPrint) return;

    const triggerPrint = () => {
      try {
        pdfWindow.focus();
        pdfWindow.print();
      } catch (error) {
        console.error('Print trigger failed:', error);
      }
    };

    try {
      pdfWindow.addEventListener('load', triggerPrint, { once: true });
      setTimeout(triggerPrint, 1200);
    } catch (error) {
      console.error('Print setup failed:', error);
    }
  };

  const applyCustomPreset = (preset: CustomPrintPreset) => {
    setCustomPrintSettings((current) => {
      const next: CustomPrintSettings = {
        ...current,
        preset,
        productRowsMode: preset === 'summarized' ? 'summarized' : 'detailed',
      };

      if (preset === 'workshop') {
        return {
          ...next,
          showPrices: false,
          showPaymentSection: false,
          showTotals: false,
          columns: {
            ...next.columns,
            rate: false,
            total: false,
          },
        };
      }

      return {
        ...next,
        showPrices: true,
        showPaymentSection: true,
        showTotals: true,
        columns: {
          ...next.columns,
          rate: true,
          total: true,
        },
      };
    });
  };

  const buildCustomPrintParams = () => {
    if (salesPdfVariant !== 'custom') return {};
    const params: Record<string, any> = {
      preset: customPrintSettings.preset,
      productRowsMode: customPrintSettings.productRowsMode,
      showCustomerSection: customPrintSettings.showCustomerSection,
      showProductsSection: customPrintSettings.showProductsSection,
      showPrices: customPrintSettings.showPrices,
      showExplanatoryRows: customPrintSettings.showExplanatoryRows,
      showDeliverySection: customPrintSettings.showDeliverySection,
      showPaymentSection: customPrintSettings.showPaymentSection,
      showTotals: customPrintSettings.showTotals,
      showNotes: customPrintSettings.showNotes,
    };

    Object.entries(customPrintSettings.columns).forEach(([key, value]) => {
      params[`column_${key}`] = value;
    });

    return params;
  };

  const openSalesContractPdf = async (tryPrint = false) => {
    const actionKey = tryPrint ? 'PRINT_SALES_PDF' : 'DOWNLOAD_SALES_PDF';
    setPdfActionLoading(actionKey);
    try {
      const pdfParams = { fresh: true, variant: salesPdfVariant, ...buildCustomPrintParams() };
      if (!tryPrint) {
        const response = await accountingAPI.downloadSalesContractPdf(params.contractId, pdfParams);
        downloadBlobResponse(response, `sales_contract_${params.contractId}_${salesPdfVariant}.pdf`);
        return;
      }

      const response = await accountingAPI.getSalesContractPdf(params.contractId, pdfParams);
      const url = response.data?.data?.url;
      if (!response.data?.success || !url) throw new Error('Sales contract PDF url was not returned');
      openPdfUrl(url, tryPrint);
    } catch (error) {
      console.error('Sales contract PDF failed:', error);
      window.alert(tryPrint ? 'پرینت قرارداد انجام نشد' : 'دانلود PDF قرارداد انجام نشد');
    } finally {
      setPdfActionLoading(null);
    }
  };

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
      <ErpSection title="خروجی چاپ قرارداد" description="نسخه مورد نیاز حسابداری را انتخاب کنید و سپس چاپ یا دانلود بگیرید.">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
            نسخه چاپ
            <select
              value={salesPdfVariant}
              onChange={(event) => setSalesPdfVariant(event.target.value as SalesPdfVariant)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            >
              <option value="original">{salesPdfVariantLabels.original}</option>
              <option value="accounting">{salesPdfVariantLabels.accounting}</option>
              <option value="workshop">{salesPdfVariantLabels.workshop}</option>
              <option value="custom">{salesPdfVariantLabels.custom}</option>
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <ErpButton
              label="دانلود PDF"
              icon={FaDownload}
              tone="success"
              disabled={pdfActionLoading === 'DOWNLOAD_SALES_PDF'}
              onClick={() => openSalesContractPdf(false)}
            />
            <ErpButton
              label="چاپ"
              icon={FaPrint}
              tone="purple"
              disabled={pdfActionLoading === 'PRINT_SALES_PDF'}
              onClick={() => openSalesContractPdf(true)}
            />
          </div>
        </div>
        {salesPdfVariant === 'custom' && (
          <div className="mt-4 space-y-4 rounded-xl border border-dashed border-teal-300 bg-teal-50/50 p-4 dark:border-teal-800 dark:bg-teal-950/20">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                الگوی چاپ
                <select
                  value={customPrintSettings.preset}
                  onChange={(event) => applyCustomPreset(event.target.value as CustomPrintPreset)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                >
                  <option value="accounting">حسابداری</option>
                  <option value="workshop">کارگاه بدون قیمت</option>
                  <option value="detailed">جزئیات کامل</option>
                  <option value="summarized">خلاصه خدمات و ابزارها</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                نمایش محصولات
                <select
                  value={customPrintSettings.productRowsMode}
                  onChange={(event) => setCustomPrintSettings((current) => ({
                    ...current,
                    productRowsMode: event.target.value as CustomProductRowsMode,
                  }))}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                >
                  <option value="detailed">جزئیات کامل</option>
                  <option value="summarized">ردیف خلاصه خدمات و ابزارها</option>
                </select>
              </label>
            </div>

            <div>
              <p className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">بخش‌ها</p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  ['showCustomerSection', 'مشخصات مشتری'],
                  ['showProductsSection', 'جدول محصولات'],
                  ['showPrices', 'قیمت‌ها'],
                  ['showExplanatoryRows', 'ردیف‌های توضیحی'],
                  ['showDeliverySection', 'برنامه تحویل'],
                  ['showPaymentSection', 'برنامه پرداخت'],
                  ['showTotals', 'جمع‌ها و تخفیف'],
                  ['showNotes', 'توضیحات'],
                ].map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                    <input
                      type="checkbox"
                      checked={Boolean(customPrintSettings[key as keyof CustomPrintSettings])}
                      onChange={(event) => setCustomPrintSettings((current) => ({
                        ...current,
                        [key]: event.target.checked,
                      }))}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">ستون‌های جدول محصولات</p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                {[
                  ['index', 'ردیف'],
                  ['code', 'کد'],
                  ['description', 'شرح'],
                  ['category', 'دسته'],
                  ['length', 'طول'],
                  ['width', 'عرض'],
                  ['measurement', 'متراژ/مقدار'],
                  ['count', 'تعداد'],
                  ['rate', 'نرخ'],
                  ['total', 'مبلغ کل'],
                ].map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                    <input
                      type="checkbox"
                      checked={customPrintSettings.columns[key as keyof CustomPrintSettings['columns']]}
                      onChange={(event) => setCustomPrintSettings((current) => ({
                        ...current,
                        columns: {
                          ...current.columns,
                          [key]: event.target.checked,
                        },
                      }))}
                      disabled={!customPrintSettings.showPrices && (key === 'rate' || key === 'total')}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}
      </ErpSection>

      <div className="accounting-print-view">
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
                    footer={record.kind === 'INVOICE_CANDIDATE' ? (
                      <div className="space-y-3">
                        {contract.accounting.openCorrections > 0 && !['ISSUED', 'POSTED', 'VOIDED'].includes(record.status) ? (
                          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-100">
                            ابتدا درخواست‌های اصلاح باز را بررسی و ببندید؛ سپس تایید مالی انجام می‌شود.
                          </div>
                        ) : (
                          <FinancialInvoiceApprovalForm
                            invoice={record}
                            busy={actionLoading}
                            onApprove={approveFinancialInvoice}
                          />
                        )}
                        {record.status === 'DRAFT' && (
                          <div className="flex justify-end">
                            <ErpButton
                              label="حذف پیش‌نویس"
                              icon={FaTrashAlt}
                              tone="danger"
                              variant="outline"
                              disabled={actionLoading}
                              onClick={() => deleteDraftRecord(record)}
                            />
                          </div>
                        )}
                      </div>
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
                  <CompactQueueItem
                    key={item.id}
                    icon={FaExclamationTriangle}
                    title={item.accountantNote}
                    meta={`اولویت: ${item.priority}`}
                    status={<StatusBadge status={item.status} />}
                    footer={['OPEN', 'ACKNOWLEDGED'].includes(item.status) ? (
                      <div className="flex flex-wrap gap-2">
                        {contract.accounting.invoiceStatus !== 'ISSUED' && (
                          <ErpButton
                            label="ویرایش فروش"
                            href={`/dashboard/sales/contracts/${contract.contractId}/edit`}
                            icon={FaEdit}
                            tone="info"
                            variant="outline"
                          />
                        )}
                        <ErpButton
                          label="بستن اصلاح"
                          icon={FaCheckCircle}
                          tone="success"
                          disabled={actionLoading}
                          onClick={() => resolveCorrection(item)}
                        />
                      </div>
                    ) : undefined}
                  />
                ))}
              </div>
            </ErpSection>
            </>
          }
        />
      </div>
    </ErpPage>
  );
}
