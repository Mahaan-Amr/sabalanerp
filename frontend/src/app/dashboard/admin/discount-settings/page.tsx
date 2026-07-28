'use client';
import { ErpInput } from '@/components/erp';
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

const inputClass = 'min-h-10 w-full rounded-lg border border-[var(--sds-border-default)] bg-[var(--sds-surface-subtle)] px-3 py-2 text-sm text-[var(--sds-text-primary)] outline-none transition focus:border-[var(--sds-accent)] focus:bg-[var(--sds-surface-raised)] focus:ring-2 focus:ring-[var(--sds-accent)]/15 dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)] dark:text-[var(--sds-text-primary)] dark:focus:border-[var(--sds-border-strong)] dark:focus:bg-[var(--sds-surface-raised)]';
const labelClass = 'mb-1 block text-xs font-medium text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]';

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
        <ErpSection className="border-[var(--sds-danger-border)] bg-[var(--sds-danger-surface)] dark:border-[var(--sds-danger-border)] dark:bg-[var(--sds-danger-surface)]">
          <p className="text-sm font-medium text-[var(--sds-danger)] dark:text-[var(--sds-danger)]">{error}</p>
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
          <label className="flex min-h-10 items-center justify-between rounded-lg border border-[var(--sds-border-default)] bg-[var(--sds-surface-subtle)] px-3 py-2 text-sm font-semibold text-[var(--sds-text-primary)] dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)] dark:text-[var(--sds-text-primary)] md:mt-5">
            <span>فعال</span>
            <ErpInput type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} className="h-4 w-4 rounded border-[var(--sds-border-default)] text-[var(--sds-accent)] focus:ring-[var(--sds-accent)]" />
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
                <tr className="border-b border-[var(--sds-border-default)] text-right text-[var(--sds-text-secondary)] dark:border-[var(--sds-border-strong)] dark:text-[var(--sds-text-muted)]">
                  <th className="py-2">بازه</th>
                  <th className="py-2">سقف تخفیف</th>
                  <th className="py-2">وضعیت</th>
                  <th className="py-2">عملیات</th>
                </tr>
              </thead>
              <tbody>
                {ranges.map((range) => (
                  <tr key={range.id} className="border-b border-[var(--sds-border-default)] dark:border-[var(--sds-border-strong)]">
                    <td className="py-3 text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">
                      {formatPrice(range.minAmount, 'تومان')} تا {range.maxAmount ? formatPrice(range.maxAmount, 'تومان') : 'بدون سقف'}
                    </td>
                    <td className="py-3 text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">{formatDisplayNumber(range.maxDiscountPercent)}٪</td>
                    <td className="py-3 text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">{range.isActive ? 'فعال' : 'غیرفعال'}</td>
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
