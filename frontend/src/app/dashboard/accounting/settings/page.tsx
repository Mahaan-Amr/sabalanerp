'use client';
import { ErpInput } from '@/components/erp';
import { useEffect, useState } from 'react';
import { FaCog, FaSave, FaSync } from 'react-icons/fa';
import { ErpButton, ErpLoading, ErpPage, ErpSection } from '@/components/erp';
import { accountingAPI } from '@/lib/api';

const fieldClass = 'min-h-12 w-full rounded-lg border border-[var(--sds-border-default)] bg-[var(--sds-surface-subtle)] px-4 py-3 text-sm text-[var(--sds-text-primary)] outline-none transition focus:border-[var(--sds-accent)] focus:bg-[var(--sds-surface-raised)] focus:ring-2 focus:ring-[var(--sds-accent)]/15 dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)] dark:text-[var(--sds-text-primary)] dark:focus:border-[var(--sds-border-strong)] dark:focus:bg-[var(--sds-surface-raised)]';

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
            <span className="mb-2 block text-sm font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">کد اقتصادی</span>
            <ErpInput className={fieldClass} value={settings?.companyEconomicCode || ''} onChange={(event) => updateField('companyEconomicCode', event.target.value)} />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">شناسه ملی</span>
            <ErpInput className={fieldClass} value={settings?.companyNationalId || ''} onChange={(event) => updateField('companyNationalId', event.target.value)} />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">کد شعبه</span>
            <ErpInput className={fieldClass} value={settings?.branchCode || ''} onChange={(event) => updateField('branchCode', event.target.value)} />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">شناسه یکتای حافظه مالیاتی</span>
            <ErpInput className={fieldClass} value={settings?.fiscalMemoryId || ''} onChange={(event) => updateField('fiscalMemoryId', event.target.value)} />
          </label>
        </div>
      </ErpSection>

      <ErpSection title="پیش‌فرض‌های صورتحساب و دریافتنی">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">نرخ ارزش افزوده پیش‌فرض</span>
            <ErpInput className={fieldClass} type="number" value={settings?.defaultVatRate || ''} onChange={(event) => updateField('defaultVatRate', event.target.value)} />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">واحد پول پیش‌فرض</span>
            <ErpInput className={fieldClass} value={settings?.defaultCurrency || 'TOMAN'} onChange={(event) => updateField('defaultCurrency', event.target.value)} />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">پیشوند شماره صورتحساب</span>
            <ErpInput className={fieldClass} value={settings?.invoiceNumberPrefix || ''} onChange={(event) => updateField('invoiceNumberPrefix', event.target.value)} />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">مهلت پیش‌فرض دریافتنی</span>
            <ErpInput className={fieldClass} type="number" value={settings?.defaultInvoiceDueDays || 0} onChange={(event) => updateField('defaultInvoiceDueDays', event.target.value)} />
          </label>
        </div>
      </ErpSection>

      <ErpSection title="آماده‌سازی سند حسابداری">
        <div className="rounded-lg border border-dashed border-[var(--sds-border-default)] p-4 text-sm leading-7 text-[var(--sds-text-secondary)] dark:border-[var(--sds-border-strong)] dark:text-[var(--sds-text-muted)]">
          <FaCog className="mb-3 h-5 w-5 text-[var(--sds-accent)] dark:text-[var(--sds-accent)]" />
          پیش‌فرض حساب‌های کل، معین و تفصیلی در مدل داده آماده است. در فاز اول این بخش فقط پایه نگهداری تنظیمات را فراهم می‌کند و UI کامل صدور سند بعد از تایید چارت حساب‌ها فعال می‌شود.
        </div>
      </ErpSection>
    </ErpPage>
  );
}
