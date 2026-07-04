'use client';

import React, { useState } from 'react';
import { FaDownload, FaExclamationTriangle, FaFileExcel, FaSpinner, FaTimes, FaUpload } from 'react-icons/fa';
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
  <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
    <div className={`mb-2 text-sm font-semibold ${tone}`}>{title}</div>
    {items.length === 0 ? (
      <p className="text-sm text-slate-500 dark:text-slate-400">موردی وجود ندارد</p>
    ) : (
      <div className="max-h-36 space-y-1 overflow-y-auto text-sm text-slate-700 dark:text-slate-300">
        {items.slice(0, 30).map((item, index) => (
          <div key={`${item.key || index}-${index}`} className="flex items-start justify-between gap-3 border-b border-slate-100 py-1 last:border-0 dark:border-slate-800">
            <span className="min-w-0 truncate">{item.label || item.error || item.warning}</span>
            <span className="shrink-0 text-xs text-slate-400">{item.action === 'hardDelete' ? 'حذف کامل' : item.action === 'deactivate' ? 'غیرفعال' : item.rowNumber ? `ردیف ${item.rowNumber}` : item.row ? `ردیف ${item.row}` : ''}</span>
          </div>
        ))}
        {items.length > 30 && <div className="text-xs text-slate-400">و {items.length - 30} مورد دیگر...</div>}
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-lg bg-white shadow-xl dark:bg-slate-800">
        <div className="flex items-center justify-between border-b border-slate-200 p-5 dark:border-slate-700">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{title}</h2>
          <button onClick={close} className="rounded p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
            <FaTimes />
          </button>
        </div>

        <div className="flex border-b border-slate-200 dark:border-slate-700">
          <button onClick={() => setActiveTab('import')} className={`flex-1 px-4 py-3 text-sm font-medium ${activeTab === 'import' ? 'border-b-2 border-teal-600 text-teal-600' : 'text-slate-500'}`}>
            <FaUpload className="ml-2 inline" /> ورود اطلاعات
          </button>
          <button onClick={() => setActiveTab('export')} className={`flex-1 px-4 py-3 text-sm font-medium ${activeTab === 'export' ? 'border-b-2 border-teal-600 text-teal-600' : 'text-slate-500'}`}>
            <FaDownload className="ml-2 inline" /> خروج اطلاعات
          </button>
        </div>

        <div className="max-h-[65vh] overflow-y-auto p-5">
          {activeTab === 'import' ? (
            <div className="space-y-5">
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-900/20">
                <div className="flex items-start gap-3">
                  <FaFileExcel className="mt-1 text-blue-600 dark:text-blue-300" />
                  <div className="flex-1">
                    <div className="font-medium text-blue-900 dark:text-blue-100">قالب اختصاصی اکسل</div>
                    <p className="mt-1 text-sm text-blue-700 dark:text-blue-300">ابتدا قالب همین کاتالوگ را دانلود کنید یا خروجی فعلی را ویرایش و دوباره بارگذاری کنید.</p>
                    <button onClick={handleTemplate} disabled={loading} className="mt-3 rounded-md bg-blue-100 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-200 disabled:opacity-50">
                      دانلود قالب
                    </button>
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
                <button onClick={handlePreview} disabled={loading || !selectedFile} className="inline-flex items-center rounded-md bg-teal-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50">
                  {loading ? <FaSpinner className="ml-2 animate-spin" /> : <FaUpload className="ml-2" />}
                  بررسی و پیش‌نمایش
                </button>
              </div>

              {plan && (
                <div className="space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/50">
                  <div className="grid grid-cols-2 gap-3 text-center sm:grid-cols-6">
                    <div><div className="text-xl font-bold">{plan.summary.totalRows}</div><div className="text-xs text-slate-500">ردیف</div></div>
                    <div><div className="text-xl font-bold text-green-600">{plan.summary.creates}</div><div className="text-xs text-slate-500">ایجاد</div></div>
                    <div><div className="text-xl font-bold text-blue-600">{plan.summary.updates}</div><div className="text-xs text-slate-500">به‌روزرسانی</div></div>
                    <div><div className="text-xl font-bold text-amber-600">{plan.summary.removals}</div><div className="text-xs text-slate-500">حذف/غیرفعال</div></div>
                    <div><div className="text-xl font-bold text-orange-600">{plan.summary.warnings || 0}</div><div className="text-xs text-slate-500">هشدار</div></div>
                    <div><div className="text-xl font-bold text-red-600">{plan.summary.errors}</div><div className="text-xs text-slate-500">خطا</div></div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <PreviewList title="رکوردهای جدید" items={plan.creates} tone="text-green-600" />
                    <PreviewList title="رکوردهای قابل به‌روزرسانی" items={plan.updates} tone="text-blue-600" />
                    <PreviewList title="رکوردهای حذف یا غیرفعال" items={plan.removals} tone="text-amber-600" />
                    <PreviewList title="هشدارها" items={plan.warnings || []} tone="text-orange-600" />
                    <PreviewList title="خطاهای اعتبارسنجی" items={plan.errors} tone="text-red-600" />
                  </div>

                  {plan.removals.length > 0 && (
                    <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
                      <FaExclamationTriangle className="mt-0.5 shrink-0" />
                      <span>با تأیید، رکوردهای حذف‌شده از فایل اکسل طبق پیش‌نمایش حذف کامل یا غیرفعال می‌شوند.</span>
                    </div>
                  )}

                  <div className="flex justify-end">
                    <button onClick={handleApply} disabled={loading || !plan.canApply} className="inline-flex items-center rounded-md bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                      {loading ? <FaSpinner className="ml-2 animate-spin" /> : null}
                      تأیید و اعمال تغییرات
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-5">
              <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-200">
                خروجی فعلی همین کاتالوگ دانلود می‌شود و بعد از ویرایش قابل ورود دوباره است.
              </div>
              <div className="flex justify-end">
                <button onClick={handleExport} disabled={loading} className="inline-flex items-center rounded-md bg-teal-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50">
                  {loading ? <FaSpinner className="ml-2 animate-spin" /> : <FaDownload className="ml-2" />}
                  دانلود خروجی
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end border-t border-slate-200 p-4 dark:border-slate-700">
          <button onClick={close} className="rounded-md bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600">
            بستن
          </button>
        </div>
      </div>
    </div>
  );
};

export default CatalogExcelSyncModal;
