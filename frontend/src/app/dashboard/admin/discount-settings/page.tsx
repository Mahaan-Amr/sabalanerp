'use client';

import { useEffect, useState } from 'react';
import { FaPercent, FaPlus, FaSave, FaTrash, FaUndo } from 'react-icons/fa';
import { ErpButton, ErpEmptyState, ErpLoading, ErpPage, ErpSection } from '@/components/erp';
import FormattedNumberInput from '@/components/FormattedNumberInput';
import { salesAPI } from '@/lib/api';
import { formatDisplayNumber, formatPrice } from '@/lib/numberFormat';

interface DiscountRange {
  id: string;
  minAmount: number;
  maxAmount: number | null;
  maxDiscountPercent: number;
  isActive: boolean;
}

const emptyForm = {
  minAmount: 0,
  maxAmount: null as number | null,
  maxDiscountPercent: 0,
  isActive: true
};

const inputClass = 'min-h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-[#074747] focus:bg-white focus:ring-2 focus:ring-[#074747]/15 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:border-teal-500 dark:focus:bg-slate-900';
const labelClass = 'mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300';

export default function ContractDiscountSettingsPage() {
  const [ranges, setRanges] = useState<DiscountRange[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRanges = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await salesAPI.getDiscountRanges();
      if (response.data.success) {
        setRanges(response.data.data || []);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'خطا در دریافت بازه‌های تخفیف');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadRanges();
  }, []);

  const resetForm = () => {
    setForm(emptyForm);
    setEditingId(null);
    setError(null);
  };

  const handleEdit = (range: DiscountRange) => {
    setEditingId(range.id);
    setForm({
      minAmount: range.minAmount,
      maxAmount: range.maxAmount,
      maxDiscountPercent: range.maxDiscountPercent,
      isActive: range.isActive
    });
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      const payload = {
        ...form,
        maxAmount: form.maxAmount && form.maxAmount > 0 ? form.maxAmount : null
      };
      if (editingId) {
        await salesAPI.updateDiscountRange(editingId, payload);
      } else {
        await salesAPI.createDiscountRange(payload);
      }
      resetForm();
      await loadRanges();
    } catch (err: any) {
      const apiError = err.response?.data?.error;
      setError(apiError === 'Discount ranges cannot overlap'
        ? 'بازه‌های تخفیف نباید با هم هم‌پوشانی داشته باشند.'
        : apiError || 'خطا در ذخیره بازه تخفیف');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      setError(null);
      await salesAPI.deleteDiscountRange(id);
      await loadRanges();
      if (editingId === id) resetForm();
    } catch (err: any) {
      setError(err.response?.data?.error || 'خطا در حذف بازه تخفیف');
    }
  };

  if (loading) return <ErpLoading />;

  return (
    <ErpPage
      eyebrow="مدیریت فروش"
      title="تنظیمات تخفیف قرارداد"
      description="بازه‌های مجاز تخفیف بر اساس جمع پایه محصولات سنگی قرارداد، به تومان."
      actions={[
        { label: editingId ? 'ذخیره تغییرات' : 'افزودن بازه', onClick: handleSave, icon: editingId ? FaSave : FaPlus, tone: 'primary', variant: 'solid', disabled: saving },
        { label: 'پاک کردن فرم', onClick: resetForm, icon: FaUndo, tone: 'neutral', variant: 'outline' }
      ]}
    >
      {error && (
        <ErpSection className="border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20">
          <p className="text-sm font-medium text-red-700 dark:text-red-200">{error}</p>
        </ErpSection>
      )}

      <ErpSection title={editingId ? 'ویرایش بازه' : 'افزودن بازه'} description="حد پایین شامل بازه است و حد بالا شامل نمی‌شود. حد بالا می‌تواند خالی باشد.">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_1fr_220px_160px]">
          <div>
            <label className={labelClass}>از مبلغ (تومان)</label>
            <FormattedNumberInput value={form.minAmount} onChange={(value) => setForm({ ...form, minAmount: value || 0 })} min={0} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>تا مبلغ (اختیاری)</label>
            <FormattedNumberInput value={form.maxAmount ?? 0} onChange={(value) => setForm({ ...form, maxAmount: value && value > 0 ? value : null })} min={0} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>حداکثر درصد تخفیف</label>
            <FormattedNumberInput value={form.maxDiscountPercent} onChange={(value) => setForm({ ...form, maxDiscountPercent: value || 0 })} min={0} max={100} step={0.1} className={inputClass} />
          </div>
          <label className="flex min-h-10 items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 md:mt-5">
            <span>فعال</span>
            <input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} className="h-4 w-4 rounded border-slate-300 text-[#074747] focus:ring-[#074747]" />
          </label>
        </div>
      </ErpSection>

      <ErpSection title="بازه‌های تخفیف" description="بازه‌ها بر اساس مبلغ پایه محصولات مرتب شده‌اند.">
        {ranges.length === 0 ? (
          <ErpEmptyState icon={FaPercent} title="بازه‌ای تعریف نشده است" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-right text-slate-600 dark:border-slate-700 dark:text-slate-300">
                  <th className="py-2">بازه</th>
                  <th className="py-2">سقف تخفیف</th>
                  <th className="py-2">وضعیت</th>
                  <th className="py-2">عملیات</th>
                </tr>
              </thead>
              <tbody>
                {ranges.map((range) => (
                  <tr key={range.id} className="border-b border-slate-100 dark:border-slate-800">
                    <td className="py-3 text-slate-800 dark:text-slate-100">
                      {formatPrice(range.minAmount, 'تومان')} تا {range.maxAmount ? formatPrice(range.maxAmount, 'تومان') : 'بدون سقف'}
                    </td>
                    <td className="py-3 text-slate-800 dark:text-slate-100">{formatDisplayNumber(range.maxDiscountPercent)}٪</td>
                    <td className="py-3 text-slate-800 dark:text-slate-100">{range.isActive ? 'فعال' : 'غیرفعال'}</td>
                    <td className="py-3">
                      <div className="flex flex-wrap gap-2">
                        <ErpButton label="ویرایش" onClick={() => handleEdit(range)} icon={FaSave} tone="neutral" variant="outline" />
                        <ErpButton label="حذف" onClick={() => handleDelete(range.id)} icon={FaTrash} tone="danger" variant="outline" />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ErpSection>
    </ErpPage>
  );
}
