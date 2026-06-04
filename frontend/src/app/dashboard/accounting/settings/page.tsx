'use client';

import { useEffect, useState } from 'react';
import { FaCog, FaSave, FaSync } from 'react-icons/fa';
import { ErpButton, ErpLoading, ErpPage, ErpSection } from '@/components/erp';
import { accountingAPI } from '@/lib/api';

const fieldClass = 'min-h-12 w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[#074747] focus:bg-white focus:ring-2 focus:ring-[#074747]/15 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:border-teal-500 dark:focus:bg-slate-900';

export default function AccountingSettingsPage() {
  const [settings, setSettings] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadSettings = async () => {
    try {
      setLoading(true);
      const response = await accountingAPI.getSettings();
      if (response.data.success) setSettings(response.data.data);
    } catch (error) {
      console.error('Error loading accounting settings:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const updateField = (field: string, value: string) => {
    setSettings((current: any) => ({ ...current, [field]: value }));
  };

  const saveSettings = async () => {
    try {
      setSaving(true);
      const response = await accountingAPI.updateSettings(settings);
      if (response.data.success) setSettings(response.data.data);
    } catch (error) {
      console.error('Error saving accounting settings:', error);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <ErpLoading />;

  return (
    <ErpPage
      eyebrow="حسابداری"
      title="تنظیمات حسابداری"
      description="پایه‌های کوچک فاز اول برای مالیات، شماره‌گذاری صورتحساب و پیش‌فرض‌های آینده سند حسابداری."
      actions={[
        { label: 'به‌روزرسانی', icon: FaSync, onClick: loadSettings, tone: 'neutral' },
        { label: saving ? 'در حال ذخیره...' : 'ذخیره', icon: FaSave, onClick: saveSettings, tone: 'primary', variant: 'solid', disabled: saving },
      ]}
    >
      <ErpSection title="پروفایل مالیاتی شرکت">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">کد اقتصادی</span>
            <input className={fieldClass} value={settings?.companyEconomicCode || ''} onChange={(event) => updateField('companyEconomicCode', event.target.value)} />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">شناسه ملی</span>
            <input className={fieldClass} value={settings?.companyNationalId || ''} onChange={(event) => updateField('companyNationalId', event.target.value)} />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">کد شعبه</span>
            <input className={fieldClass} value={settings?.branchCode || ''} onChange={(event) => updateField('branchCode', event.target.value)} />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">شناسه یکتای حافظه مالیاتی</span>
            <input className={fieldClass} value={settings?.fiscalMemoryId || ''} onChange={(event) => updateField('fiscalMemoryId', event.target.value)} />
          </label>
        </div>
      </ErpSection>

      <ErpSection title="پیش‌فرض‌های صورتحساب و دریافتنی">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">نرخ ارزش افزوده پیش‌فرض</span>
            <input className={fieldClass} type="number" value={settings?.defaultVatRate || ''} onChange={(event) => updateField('defaultVatRate', event.target.value)} />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">واحد پول پیش‌فرض</span>
            <input className={fieldClass} value={settings?.defaultCurrency || 'TOMAN'} onChange={(event) => updateField('defaultCurrency', event.target.value)} />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">پیشوند شماره صورتحساب</span>
            <input className={fieldClass} value={settings?.invoiceNumberPrefix || ''} onChange={(event) => updateField('invoiceNumberPrefix', event.target.value)} />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">مهلت پیش‌فرض دریافتنی</span>
            <input className={fieldClass} type="number" value={settings?.defaultInvoiceDueDays || 0} onChange={(event) => updateField('defaultInvoiceDueDays', event.target.value)} />
          </label>
        </div>
      </ErpSection>

      <ErpSection title="آماده‌سازی سند حسابداری">
        <div className="rounded-lg border border-dashed border-slate-300 p-4 text-sm leading-7 text-slate-600 dark:border-slate-700 dark:text-slate-300">
          <FaCog className="mb-3 h-5 w-5 text-[#074747] dark:text-teal-200" />
          پیش‌فرض حساب‌های کل، معین و تفصیلی در مدل داده آماده است. در فاز اول این بخش فقط پایه نگهداری تنظیمات را فراهم می‌کند و UI کامل صدور سند بعد از تایید چارت حساب‌ها فعال می‌شود.
        </div>
      </ErpSection>
    </ErpPage>
  );
}
