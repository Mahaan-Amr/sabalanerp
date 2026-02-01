'use client';

import { useState, useEffect } from 'react';
import { FaCog, FaSave, FaUndo, FaInfoCircle } from 'react-icons/fa';

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

export default function AdminSettingsPage() {
  const [settings, setSettings] = useState<SystemSettings>({
    companyName: 'Soblan Stone',
    companyNamePersian: 'سبلان استون',
    defaultCurrency: 'IRR',
    defaultLanguage: 'fa',
    timezone: 'Asia/Tehran',
    dateFormat: 'jalali',
    contractNumberPrefix: 'SAB',
    emailNotifications: true,
    smsNotifications: false,
    autoBackup: true,
    sessionTimeout: 30
  });

  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    setLoading(true);
    try {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1000));
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (error) {
      console.error('Error saving settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setSettings({
      companyName: 'Soblan Stone',
      companyNamePersian: 'سبلان استون',
      defaultCurrency: 'IRR',
      defaultLanguage: 'fa',
      timezone: 'Asia/Tehran',
      dateFormat: 'jalali',
      contractNumberPrefix: 'SAB',
      emailNotifications: true,
      smsNotifications: false,
      autoBackup: true,
      sessionTimeout: 30
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="glass-liquid-card p-6">
        <div className="flex items-center gap-4">
          <div className="glass-liquid-card p-3">
            <FaCog className="h-8 w-8 text-orange-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">تنظیمات سیستم</h1>
            <p className="text-gray-300">پیکربندی و تنظیمات کلی سیستم</p>
          </div>
        </div>
      </div>

      {/* Settings Form */}
      <div className="glass-liquid-card p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Company Information */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
              <FaInfoCircle className="h-5 w-5 text-blue-400" />
              اطلاعات شرکت
            </h3>
            
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">
                نام شرکت (انگلیسی)
              </label>
              <input
                type="text"
                value={settings.companyName}
                onChange={(e) => setSettings({...settings, companyName: e.target.value})}
                className="w-full px-4 py-2 bg-white/10 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">
                نام شرکت (فارسی)
              </label>
              <input
                type="text"
                value={settings.companyNamePersian}
                onChange={(e) => setSettings({...settings, companyNamePersian: e.target.value})}
                className="w-full px-4 py-2 bg-white/10 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">
                پیشوند شماره قرارداد
              </label>
              <input
                type="text"
                value={settings.contractNumberPrefix}
                onChange={(e) => setSettings({...settings, contractNumberPrefix: e.target.value})}
                className="w-full px-4 py-2 bg-white/10 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>
          </div>

          {/* System Preferences */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
              <FaCog className="h-5 w-5 text-green-400" />
              تنظیمات سیستم
            </h3>

            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">
                ارز پیش‌فرض
              </label>
              <select
                value={settings.defaultCurrency}
                onChange={(e) => setSettings({...settings, defaultCurrency: e.target.value})}
                className="w-full px-4 py-2 bg-white/10 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
              >
                <option value="IRR">ریال (IRR)</option>
                <option value="USD">دلار (USD)</option>
                <option value="EUR">یورو (EUR)</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">
                زبان پیش‌فرض
              </label>
              <select
                value={settings.defaultLanguage}
                onChange={(e) => setSettings({...settings, defaultLanguage: e.target.value})}
                className="w-full px-4 py-2 bg-white/10 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
              >
                <option value="fa">فارسی</option>
                <option value="en">English</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">
                منطقه زمانی
              </label>
              <select
                value={settings.timezone}
                onChange={(e) => setSettings({...settings, timezone: e.target.value})}
                className="w-full px-4 py-2 bg-white/10 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
              >
                <option value="Asia/Tehran">تهران (UTC+3:30)</option>
                <option value="UTC">UTC</option>
                <option value="America/New_York">نیویورک (UTC-5)</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">
                فرمت تاریخ
              </label>
              <select
                value={settings.dateFormat}
                onChange={(e) => setSettings({...settings, dateFormat: e.target.value})}
                className="w-full px-4 py-2 bg-white/10 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
              >
                <option value="jalali">جلالی (هجری شمسی)</option>
                <option value="gregorian">میلادی</option>
              </select>
            </div>
          </div>
        </div>

        {/* Notifications */}
        <div className="mt-8 space-y-4">
          <h3 className="text-lg font-semibold text-white">تنظیمات اعلان‌ها</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={settings.emailNotifications}
                onChange={(e) => setSettings({...settings, emailNotifications: e.target.checked})}
                className="w-4 h-4 text-orange-500 bg-white/10 border-gray-600 rounded focus:ring-orange-500"
              />
              <span className="text-white">اعلان‌های ایمیل</span>
            </label>

            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={settings.smsNotifications}
                onChange={(e) => setSettings({...settings, smsNotifications: e.target.checked})}
                className="w-4 h-4 text-orange-500 bg-white/10 border-gray-600 rounded focus:ring-orange-500"
              />
              <span className="text-white">اعلان‌های پیامک</span>
            </label>

            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={settings.autoBackup}
                onChange={(e) => setSettings({...settings, autoBackup: e.target.checked})}
                className="w-4 h-4 text-orange-500 bg-white/10 border-gray-600 rounded focus:ring-orange-500"
              />
              <span className="text-white">پشتیبان‌گیری خودکار</span>
            </label>
          </div>
        </div>

        {/* Security */}
        <div className="mt-8 space-y-4">
          <h3 className="text-lg font-semibold text-white">تنظیمات امنیتی</h3>
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-2">
              زمان انقضای جلسه (دقیقه)
            </label>
            <input
              type="number"
              min="5"
              max="480"
              value={settings.sessionTimeout}
              onChange={(e) => setSettings({...settings, sessionTimeout: parseInt(e.target.value)})}
              className="w-full px-4 py-2 bg-white/10 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
          </div>
        </div>

        {/* Action Buttons */}
        <div className="mt-8 flex items-center gap-4">
          <button
            onClick={handleSave}
            disabled={loading}
            className="glass-liquid-btn-primary px-6 py-2 flex items-center gap-2 disabled:opacity-50"
          >
            {loading ? (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
            ) : (
              <FaSave className="h-4 w-4" />
            )}
            {loading ? 'در حال ذخیره...' : 'ذخیره تنظیمات'}
          </button>

          <button
            onClick={handleReset}
            className="glass-liquid-btn px-6 py-2 flex items-center gap-2"
          >
            <FaUndo className="h-4 w-4" />
            بازنشانی
          </button>

          {saved && (
            <div className="text-green-400 flex items-center gap-2">
              <FaSave className="h-4 w-4" />
              تنظیمات با موفقیت ذخیره شد
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
