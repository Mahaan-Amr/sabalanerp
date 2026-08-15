'use client';
import { ErpButton, ErpInlineState, ErpSegmentedControl, ErpSheet } from '@/components/erp';
import React, { useState } from 'react';
import { FaDownload, FaExclamationTriangle, FaFileExcel, FaUpload } from 'react-icons/fa';
import ExcelFileUpload from './ExcelFileUpload';

interface CatalogSyncPlan {
  importId: string;
  sourceFormat: string;
  canApply: boolean;
  summary: {
    totalRows: number;
    creates: number;
    updates: number;
    removals: number;
    errors: number;
    warnings: number;
  };
  creates: Array<{ key: string; rowNumber: number; label: string }>;
  updates: Array<{ key: string; rowNumber: number; label: string; changes: Record<string, unknown> }>;
  removals: Array<{ key: string; label: string; action: 'hardDelete' | 'deactivate'; reason: string }>;
  errors: Array<{ row?: number; key?: string; error: string }>;
  warnings: Array<{ row?: number; key?: string; warning: string }>;
}

interface CatalogExcelSyncModalProps {
  isOpen: boolean;
  title: string;
  onClose: () => void;
  onComplete?: (plan: CatalogSyncPlan) => void;
  downloadTemplate: () => Promise<any>;
  exportData: () => Promise<any>;
  previewImport: (file: File) => Promise<any>;
  applyImport: (importId: string) => Promise<any>;
  filenamePrefix: string;
}

const downloadBlob = (response: any, filename: string) => {
  const blob = new Blob([response.data], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
};

const PreviewList = ({ title, items, tone }: { title: string; items: any[]; tone: string }) => (
  <div className="rounded-lg border border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] p-3 dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)]">
    <div className={`mb-2 text-sm font-semibold ${tone}`}>{title}</div>
    {items.length === 0 ? (
      <p className="text-sm text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">موردی وجود ندارد</p>
    ) : (
      <div className="max-h-36 space-y-1 overflow-y-auto text-sm text-[var(--sds-text-primary)] dark:text-[var(--sds-text-muted)]">
        {items.slice(0, 30).map((item, index) => (
          <div key={`${item.key || index}-${index}`} className="flex items-start justify-between gap-3 border-b border-[var(--sds-border-default)] py-1 last:border-0 dark:border-[var(--sds-border-strong)]">
            <span className="min-w-0 truncate">{item.label || item.error || item.warning}</span>
            <span className="shrink-0 text-xs text-[var(--sds-text-muted)]">{item.action === 'hardDelete' ? 'حذف کامل' : item.action === 'deactivate' ? 'غیرفعال' : item.rowNumber ? `ردیف ${item.rowNumber}` : item.row ? `ردیف ${item.row}` : ''}</span>
          </div>
        ))}
        {items.length > 30 && <div className="text-xs text-[var(--sds-text-muted)]">و {items.length - 30} مورد دیگر...</div>}
      </div>
    )}
  </div>
);

const CatalogExcelSyncModal: React.FC<CatalogExcelSyncModalProps> = ({
  isOpen,
  title,
  onClose,
  onComplete,
  downloadTemplate,
  exportData,
  previewImport,
  applyImport,
  filenamePrefix
}) => {
  const [activeTab, setActiveTab] = useState<'import' | 'export'>('import');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [plan, setPlan] = useState<CatalogSyncPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setActiveTab('import');
    setSelectedFile(null);
    setPlan(null);
    setLoading(false);
    setError(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  const handleTemplate = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await downloadTemplate();
      downloadBlob(response, `${filenamePrefix}-template.xlsx`);
    } catch (err: any) {
      setError(err.response?.data?.error || 'خطا در دانلود قالب اکسل');
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await exportData();
      downloadBlob(response, `${filenamePrefix}-export-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (err: any) {
      setError(err.response?.data?.error || 'خطا در خروجی اکسل');
    } finally {
      setLoading(false);
    }
  };

  const handlePreview = async () => {
    if (!selectedFile) {
      setError('لطفا فایل اکسل را انتخاب کنید');
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const response = await previewImport(selectedFile);
      setPlan(response.data.data);
    } catch (err: any) {
      setError(err.response?.data?.error || 'خطا در بررسی فایل اکسل');
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async () => {
    if (!plan?.importId) return;
    try {
      setLoading(true);
      setError(null);
      const response = await applyImport(plan.importId);
      const appliedPlan = response.data.data;
      onComplete?.(appliedPlan);
      close();
    } catch (err: any) {
      setError(err.response?.data?.error || 'خطا در اعمال تغییرات اکسل');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <ErpSheet
      open={isOpen}
      onClose={close}
      title={title}
      presentation="modal"
      size="wide"
      pending={loading}
      footer={<div className="flex justify-end"><ErpButton label="بستن" onClick={close} tone="neutral" variant="outline" disabled={loading} /></div>}
    >
        <ErpSegmentedControl
          value={activeTab}
          onChange={setActiveTab}
          options={[
            { value: 'import', label: 'ورود اطلاعات', icon: FaUpload },
            { value: 'export', label: 'خروج اطلاعات', icon: FaDownload }
          ]}
        />

        <div className="mt-5">
          {activeTab === 'import' ? (
            <div className="space-y-5">
              <div className="rounded-lg border border-[var(--sds-info-border)] bg-[var(--sds-info-surface)] p-4 dark:border-[var(--sds-info-border)] dark:bg-[var(--sds-info-surface)]">
                <div className="flex items-start gap-3">
                  <FaFileExcel className="mt-1 text-[var(--sds-info)] dark:text-[var(--sds-info)]" />
                  <div className="flex-1">
                    <div className="font-medium text-[var(--sds-info)] dark:text-[var(--sds-info)]">قالب اختصاصی اکسل</div>
                    <p className="mt-1 text-sm text-[var(--sds-info)] dark:text-[var(--sds-info)]">ابتدا قالب همین کاتالوگ را دانلود کنید یا خروجی فعلی را ویرایش و دوباره بارگذاری کنید.</p>
                    <div className="mt-3"><ErpButton label="دانلود قالب" onClick={handleTemplate} disabled={loading} tone="info" variant="outline" /></div>
                  </div>
                </div>
              </div>

              <ExcelFileUpload
                onFileSelect={(file) => { setSelectedFile(file); setPlan(null); setError(null); }}
                onFileRemove={() => { setSelectedFile(null); setPlan(null); }}
                selectedFile={selectedFile}
                loading={loading}
              />

              <div className="flex justify-end">
                <ErpButton label={loading ? 'در حال بررسی...' : 'بررسی و پیش‌نمایش'} icon={FaUpload} onClick={handlePreview} disabled={loading || !selectedFile} tone="primary" variant="solid" />
              </div>

              {plan && (
                <div className="space-y-4 rounded-lg border border-[var(--sds-border-default)] bg-[var(--sds-surface-subtle)] p-4 dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)]">
                  <div className="grid grid-cols-2 gap-3 text-center sm:grid-cols-6">
                    <div><div className="text-xl font-bold">{plan.summary.totalRows}</div><div className="text-xs text-[var(--sds-text-secondary)]">ردیف</div></div>
                    <div><div className="text-xl font-bold text-[var(--sds-success)]">{plan.summary.creates}</div><div className="text-xs text-[var(--sds-text-secondary)]">ایجاد</div></div>
                    <div><div className="text-xl font-bold text-[var(--sds-info)]">{plan.summary.updates}</div><div className="text-xs text-[var(--sds-text-secondary)]">به‌روزرسانی</div></div>
                    <div><div className="text-xl font-bold text-[var(--sds-warning)]">{plan.summary.removals}</div><div className="text-xs text-[var(--sds-text-secondary)]">حذف/غیرفعال</div></div>
                    <div><div className="text-xl font-bold text-[var(--sds-warning)]">{plan.summary.warnings || 0}</div><div className="text-xs text-[var(--sds-text-secondary)]">هشدار</div></div>
                    <div><div className="text-xl font-bold text-[var(--sds-danger)]">{plan.summary.errors}</div><div className="text-xs text-[var(--sds-text-secondary)]">خطا</div></div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <PreviewList title="رکوردهای جدید" items={plan.creates} tone="text-[var(--sds-success)]" />
                    <PreviewList title="رکوردهای قابل به‌روزرسانی" items={plan.updates} tone="text-[var(--sds-info)]" />
                    <PreviewList title="رکوردهای حذف یا غیرفعال" items={plan.removals} tone="text-[var(--sds-warning)]" />
                    <PreviewList title="هشدارها" items={plan.warnings || []} tone="text-[var(--sds-warning)]" />
                    <PreviewList title="خطاهای اعتبارسنجی" items={plan.errors} tone="text-[var(--sds-danger)]" />
                  </div>

                  {plan.removals.length > 0 && (
                    <div className="flex items-start gap-2 rounded-lg border border-[var(--sds-warning-border)] bg-[var(--sds-warning-surface)] p-3 text-sm text-[var(--sds-warning)] dark:border-[var(--sds-warning-border)] dark:bg-[var(--sds-warning-surface)] dark:text-[var(--sds-warning)]">
                      <FaExclamationTriangle className="mt-0.5 shrink-0" />
                      <span>با تأیید، رکوردهای حذف‌شده از فایل اکسل طبق پیش‌نمایش حذف کامل یا غیرفعال می‌شوند.</span>
                    </div>
                  )}

                  <div className="flex justify-end">
                    <ErpButton label={loading ? 'در حال اعمال...' : 'تأیید و اعمال تغییرات'} onClick={handleApply} disabled={loading || !plan.canApply} tone="success" variant="solid" />
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-5">
              <div className="rounded-lg border border-[var(--sds-success-border)] bg-[var(--sds-success-surface)] p-4 text-sm text-[var(--sds-success)] dark:border-[var(--sds-success-border)] dark:bg-[var(--sds-success-surface)] dark:text-[var(--sds-success)]">
                خروجی فعلی همین کاتالوگ دانلود می‌شود و بعد از ویرایش قابل ورود دوباره است.
              </div>
              <div className="flex justify-end">
                <ErpButton label={loading ? 'در حال آماده‌سازی...' : 'دانلود خروجی'} icon={FaDownload} onClick={handleExport} disabled={loading} tone="primary" variant="solid" />
              </div>
            </div>
          )}

          {error ? <ErpInlineState kind="error" title={error} className="mt-4" /> : null}
        </div>
    </ErpSheet>
  );
};

export default CatalogExcelSyncModal;
