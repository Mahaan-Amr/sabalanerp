'use client';

import { useState } from 'react';
import { FaCog, FaInfoCircle, FaSave, FaUndo } from 'react-icons/fa';
import { ErpBadge, ErpButton, ErpPage, ErpSection } from '@/components/erp';

interface SystemSettings {
  companyName: string;
  companyNamePersian: string;
  defaultCurrency: string;
  defaultLanguage: string;
  timezone: string;
  dateFormat: string;
  contractNumberPrefix: string;
  emailNotifications: boolean;
  smsNotifications: boolean;
  autoBackup: boolean;
  sessionTimeout: number;
}

const defaultSettings: SystemSettings = {
  companyName: 'Soblan Stone',
  companyNamePersian: 'سنگ سبلان',
  defaultCurrency: 'IRR',
  defaultLanguage: 'fa',
  timezone: 'Asia/Tehran',
  dateFormat: 'jalali',
  contractNumberPrefix: 'SAB',
  emailNotifications: true,
  smsNotifications: false,
  autoBackup: true,
  sessionTimeout: 30,
};

const inputClassName = 'min-h-11 w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-900 outline-none transition focus:border-[#074747] focus:bg-white focus:ring-2 focus:ring-[#074747]/15 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:border-teal-500 dark:focus:bg-slate-900';
const labelClassName = 'mb-2 block text-sm font-medium text-slate-600 dark:text-slate-300';

export default function AdminSettingsPage() {
  const [settings, setSettings] = useState<SystemSettings>(defaultSettings);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    setLoading(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (error) {
      console.error('Error saving settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setSettings(defaultSettings);
  };

  return (
    <ErpPage
      eyebrow="مدیریت سیستم"
      title="تنظیمات سیستم"
      description="مدیریت تنظیمات عمومی شرکت، زبان، واحد پول، اعلان‌ها و امنیت نشست."
      actions={[
        { label: loading ? 'در حال ذخیره...' : 'ذخیره تنظیمات', onClick: handleSave, icon: FaSave, tone: 'primary', variant: 'solid', disabled: loading },
        { label: 'بازنشانی', onClick: handleReset, icon: FaUndo, tone: 'neutral', variant: 'outline' },
      ]}
    >
      {saved && (
        <ErpSection className="border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-900/20">
          <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-200">
            <FaSave className="h-4 w-4" />
            تنظیمات با موفقیت ذخیره شد
          </div>
        </ErpSection>
      )}

      <ErpSection title="اطلاعات شرکت" description="نام‌ها و پیشوندهای رسمی مورد استفاده در قراردادها." actions={[]}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <label className={labelClassName}>نام شرکت (انگلیسی)</label>
            <input type="text" value={settings.companyName} onChange={(event) => setSettings({ ...settings, companyName: event.target.value })} className={inputClassName} />
          </div>
          <div>
            <label className={labelClassName}>نام شرکت (فارسی)</label>
            <input type="text" value={settings.companyNamePersian} onChange={(event) => setSettings({ ...settings, companyNamePersian: event.target.value })} className={inputClassName} />
          </div>
          <div>
            <label className={labelClassName}>پیشوند شماره قرارداد</label>
            <input type="text" value={settings.contractNumberPrefix} onChange={(event) => setSettings({ ...settings, contractNumberPrefix: event.target.value })} className={inputClassName} />
          </div>
        </div>
      </ErpSection>

      <ErpSection title="تنظیمات سیستم" description="گزینه‌های پایه برای زبان، تاریخ، منطقه زمانی و واحد پول.">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div>
            <label className={labelClassName}>واحد پول</label>
            <select value={settings.defaultCurrency} onChange={(event) => setSettings({ ...settings, defaultCurrency: event.target.value })} className={inputClassName}>
              <option value="IRR">ریال (IRR)</option>
              <option value="USD">دلار (USD)</option>
              <option value="EUR">یورو (EUR)</option>
            </select>
          </div>
          <div>
            <label className={labelClassName}>زبان پیش‌فرض</label>
            <select value={settings.defaultLanguage} onChange={(event) => setSettings({ ...settings, defaultLanguage: event.target.value })} className={inputClassName}>
              <option value="fa">فارسی</option>
              <option value="en">English</option>
            </select>
          </div>
          <div>
            <label className={labelClassName}>منطقه زمانی</label>
            <select value={settings.timezone} onChange={(event) => setSettings({ ...settings, timezone: event.target.value })} className={inputClassName}>
              <option value="Asia/Tehran">تهران (UTC+3:30)</option>
              <option value="UTC">UTC</option>
              <option value="America/New_York">نیویورک (UTC-5)</option>
            </select>
          </div>
          <div>
            <label className={labelClassName}>قالب تاریخ</label>
            <select value={settings.dateFormat} onChange={(event) => setSettings({ ...settings, dateFormat: event.target.value })} className={inputClassName}>
              <option value="jalali">شمسی (جلالی)</option>
              <option value="gregorian">میلادی</option>
            </select>
          </div>
        </div>
      </ErpSection>

      <ErpSection title="اعلان‌ها و امنیت" description="تنظیمات ارتباطی و مدت اعتبار نشست کاربران.">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {[
              ['emailNotifications', 'اعلان ایمیلی'],
              ['smsNotifications', 'اعلان پیامکی'],
              ['autoBackup', 'پشتیبان‌گیری خودکار'],
            ].map(([key, label]) => (
              <label key={key} className="flex min-h-12 items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                <span>{label}</span>
                <input
                  type="checkbox"
                  checked={Boolean(settings[key as keyof SystemSettings])}
                  onChange={(event) => setSettings({ ...settings, [key]: event.target.checked })}
                  className="h-4 w-4 rounded border-slate-300 text-[#074747] focus:ring-[#074747]"
                />
              </label>
            ))}
          </div>
          <div>
            <label className={labelClassName}>مهلت نشست کاربر (دقیقه)</label>
            <input
              type="number"
              min="5"
              max="480"
              value={settings.sessionTimeout}
              onChange={(event) => setSettings({ ...settings, sessionTimeout: parseInt(event.target.value, 10) })}
              className={inputClassName}
            />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <FaInfoCircle className="h-4 w-4" />
          <span>این صفحه هنوز از داده شبیه‌سازی‌شده استفاده می‌کند؛ فقط پوسته و خوانایی آن به الگوی ERP منتقل شده است.</span>
          <ErpBadge tone="warning">فرم متوسط</ErpBadge>
        </div>
      </ErpSection>

      <div className="flex flex-wrap gap-2">
        <ErpButton label={loading ? 'در حال ذخیره...' : 'ذخیره تنظیمات'} onClick={handleSave} icon={FaCog} tone="primary" variant="solid" disabled={loading} />
        <ErpButton label="بازنشانی" onClick={handleReset} icon={FaUndo} tone="neutral" variant="outline" />
      </div>
    </ErpPage>
  );
}
