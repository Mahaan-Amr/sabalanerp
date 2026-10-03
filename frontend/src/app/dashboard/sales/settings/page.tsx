'use client';
import { useEffect, useState } from 'react';
import SellerCreditSettings from '@/features/sales/SellerCreditSettings';
import { ErpButton, ErpField, ErpInlineState, ErpInput, ErpLoading, ErpPage, ErpSection } from '@/components/erp';
import { salesAPI } from '@/lib/api';
import { assertSuccessfulSalesResponse, getSalesOperationalErrorMessage } from '@/features/sales/salesOperationalError';

export default function SalesSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [canManage, setCanManage] = useState(false);
  const [days, setDays] = useState('10');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let active = true;
    void salesAPI.getCommercialSettings().then(response => {
      assertSuccessfulSalesResponse(response);
      if (active) { setCanManage(response.data.data.canManage === true); setDays(String(response.data.data.expiryDays)); }
    }).catch(failure => { if (active) setError(getSalesOperationalErrorMessage(failure, { failedAction: 'دریافت تنظیمات فروش', nextStep: 'صفحه را تازه‌سازی کنید.' })); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const parsedDays = Number(days);
  const valid = Number.isInteger(parsedDays) && parsedDays > 0 && parsedDays <= 365;
  const save = async () => {
    if (!canManage || !valid || pending) return;
    setPending(true); setError(null); setSaved(false);
    try {
      assertSuccessfulSalesResponse(await salesAPI.updateCommercialSettings(parsedDays));
      setSaved(true);
    } catch (failure) { setError(getSalesOperationalErrorMessage(failure, { failedAction: 'ذخیره مهلت انقضای قرارداد', nextStep: 'دوباره تلاش کنید.' })); }
    finally { setPending(false); }
  };
  return <ErpPage eyebrow="فروش" title="تنظیمات فروش" backHref="/dashboard/sales">
    {loading ? <ErpLoading /> : <>
      {error && <ErpInlineState kind="error" title={error} />}
      {!canManage ? <ErpInlineState kind="permission" title="تنظیم مهلت قرارداد فقط برای مدیر و ادمین فروش مجاز است." /> :
        <ErpSection title="مهلت ثبت اولین رکورد مالی">
          <ErpField label="تعداد روز تقویمی" hint="این مهلت فقط به قراردادهای تازه ایجادشده یا تازه‌وارد به گردش جدید اختصاص می‌یابد. ویرایش قرارداد مهلت را تمدید نمی‌کند.">
            <ErpInput type="number" min={1} max={365} step={1} value={days} disabled={pending}
              onChange={event => { setDays(event.target.value); setSaved(false); }} />
          </ErpField>
          <ErpButton label="ذخیره مهلت" tone="primary" disabled={!valid || pending} onClick={() => void save()} />
          {saved && <ErpInlineState kind="success" title="مهلت انقضای قراردادهای جدید ذخیره شد." />}
        </ErpSection>}
      {canManage && <SellerCreditSettings />}
    </>}
  </ErpPage>;
}
