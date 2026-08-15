'use client';
import { ErpInput, ErpLoading, ErpPressable, ErpSelect, ErpTextarea } from '@/components/erp';
import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { FaSave, FaTimes, FaTrash } from 'react-icons/fa';
import { servicesAPI } from '@/lib/api';
import CatalogImagePicker from '@/components/CatalogImagePicker';
import { InventoryMasterDataActions, InventoryMasterDataPage } from '@/features/inventory/master-data/InventoryMasterDataUi';

const EditStoneFinishingPage: React.FC = () => {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const finishingId = params?.id;

  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [formData, setFormData] = useState({
    code: '',
    namePersian: '',
    name: '',
    description: '',
    pricePerSquareMeter: '',
    calculationBase: 'squareMeters' as 'length' | 'squareMeters',
    images: [] as string[],
    isActive: true
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const loadFinishing = async () => {
      if (!finishingId) return;
      try {
        const response = await servicesAPI.getStoneFinishing(finishingId);
        if (response.data.success) {
          const data = response.data.data;
          setFormData({
            code: data.code || '',
            namePersian: data.namePersian || '',
            name: data.name || '',
            description: data.description || '',
            pricePerSquareMeter: (data.unitPrice ?? data.pricePerSquareMeter)?.toString() || '',
            calculationBase: data.calculationBase === 'length' ? 'length' : 'squareMeters',
            images: data.images || [],
            isActive: data.isActive
          });
        } else {
          setErrors({ general: 'فرآوری سنگ یافت نشد' });
        }
      } catch (error) {
        console.error('Error loading stone finishing:', error);
        setErrors({ general: 'فرآوری سنگ یافت نشد' });
      } finally {
        setInitialLoading(false);
      }
    };

    loadFinishing();
  }, [finishingId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!finishingId) return;
    setLoading(true);
    setErrors({});

    if (!formData.code.trim()) {
      setErrors({ code: 'کد فرآوری سنگ الزامی است' });
      setLoading(false);
      return;
    }

    try {
      const response = await servicesAPI.updateStoneFinishing(finishingId, {
        ...formData,
        unitPrice: parseFloat(formData.pricePerSquareMeter || '0'),
        pricePerSquareMeter: parseFloat(formData.pricePerSquareMeter || '0')
      });

      if (response.data.success) {
        router.push('/dashboard/inventory/services');
      } else {
        setErrors({ general: 'فرآوری سنگ یافت نشد' });
      }
    } catch (error: any) {
      console.error('Error updating stone finishing:', error);
      if (error.response?.data?.details) {
        const newErrors: Record<string, string> = {};
        error.response.data.details.forEach((detail: any) => {
          const key = Array.isArray(detail.path) ? detail.path.join('.') : detail.path;
          newErrors[key] = detail.msg;
        });
        setErrors(newErrors);
      } else {
        setErrors({ general: 'فرآوری سنگ یافت نشد' });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!finishingId) return;
    if (!confirm('آیا از حذف این فرآوری سنگ مطمئن هستید؟')) return;
    try {
      await servicesAPI.deleteStoneFinishing(finishingId);
      router.push('/dashboard/inventory/services');
    } catch (error) {
      console.error('Error deleting stone finishing:', error);
      setErrors({ general: 'فرآوری سنگ یافت نشد' });
    }
  };

  const handleCancel = () => {
    router.push('/dashboard/inventory/services');
  };

  if (initialLoading) return <ErpLoading />;

  return (
    <InventoryMasterDataPage title="ویرایش فرآوری سنگ" description="اطلاعات فرآوری سنگ، قیمت و وضعیت آن را به‌روزرسانی کنید" backHref="/dashboard/inventory/services" error={errors.general}>
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-2xl mx-auto">
          <div>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-muted)] mb-2" htmlFor="inventory-code">
                  کد فرآوری سنگ *
                </label>
                <ErpInput
                  type="text"
                  value={formData.code}
                  onChange={(e) => setFormData(prev => ({ ...prev, code: e.target.value }))}
                  className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-[var(--sds-focus-ring)] focus:border-transparent bg-[var(--sds-surface-raised)] dark:bg-[var(--sds-surface-raised)] text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)] ${
                    errors.code ? 'border-[var(--sds-danger-border)]' : 'border-[var(--sds-border-default)] dark:border-[var(--sds-border-strong)]'
                  }`}
                  placeholder="مثال: SF-001"
                 id="inventory-code" aria-invalid={Boolean(errors.code)} aria-describedby={errors.code ? 'inventory-code-error' : undefined} />
                {errors.code && (
                  <p id="inventory-code-error" role="alert" className="text-[var(--sds-danger)] text-sm mt-1">{errors.code}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-muted)] mb-2" htmlFor="inventory-namePersian">



                  نام فارسی فرآوری سنگ *



                </label>
                <ErpInput
                  type="text"
                  value={formData.namePersian}
                  onChange={(e) => setFormData(prev => ({ ...prev, namePersian: e.target.value }))}
                  className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-[var(--sds-focus-ring)] focus:border-transparent bg-[var(--sds-surface-raised)] dark:bg-[var(--sds-surface-raised)] text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)] ${
                    errors.namePersian ? 'border-[var(--sds-danger-border)]' : 'border-[var(--sds-border-default)] dark:border-[var(--sds-border-strong)]'
                  }`}
                  placeholder="مثال: ساب نهایی"
                 id="inventory-namePersian" aria-invalid={Boolean(errors.namePersian)} aria-describedby={errors.namePersian ? 'inventory-namePersian-error' : undefined} />
                {errors.namePersian && (
                  <p id="inventory-namePersian-error" role="alert" className="text-[var(--sds-danger)] text-sm mt-1">{errors.namePersian}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-muted)] mb-2">



                  نام انگلیسی



                </label>
                <ErpInput
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2 border border-[var(--sds-border-default)] dark:border-[var(--sds-border-strong)] rounded-lg focus:ring-2 focus:ring-[var(--sds-focus-ring)] focus:border-transparent bg-[var(--sds-surface-raised)] dark:bg-[var(--sds-surface-raised)] text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]"
                  placeholder="مثال: Final Polish"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-muted)] mb-2">



                  توضیحات



                </label>
                <ErpTextarea
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  rows={3}
                  className="w-full px-3 py-2 border border-[var(--sds-border-default)] dark:border-[var(--sds-border-strong)] rounded-lg focus:ring-2 focus:ring-[var(--sds-focus-ring)] focus:border-transparent bg-[var(--sds-surface-raised)] dark:bg-[var(--sds-surface-raised)] text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]"
                  placeholder="توضیحات فرآوری سنگ..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-muted)] mb-2">
                  واحد محاسبه
                </label>
                <ErpSelect
                  value={formData.calculationBase}
                  onChange={(e) => setFormData(prev => ({ ...prev, calculationBase: e.target.value as 'length' | 'squareMeters' }))}
                  className="w-full px-3 py-2 border border-[var(--sds-border-default)] dark:border-[var(--sds-border-strong)] rounded-lg focus:ring-2 focus:ring-[var(--sds-focus-ring)] focus:border-transparent bg-[var(--sds-surface-raised)] dark:bg-[var(--sds-surface-raised)] text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]"
                >
                  <option value="squareMeters">متر مربع</option>
                  <option value="length">متر</option>
                </ErpSelect>
                <p className="text-xs text-[var(--sds-warning)] dark:text-[var(--sds-warning)] mt-1">
                  در صورت تغییر واحد، قیمت را برای واحد جدید بررسی و تأیید کنید.
                </p>
              </div>

              <CatalogImagePicker
                images={formData.images}
                onChange={(images) => setFormData(prev => ({ ...prev, images }))}
              />

              <div>
                <label className="block text-sm font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-muted)] mb-2" htmlFor="inventory-unitPrice">
                  {formData.calculationBase === 'length' ? 'قیمت هر متر طول (تومان)' : 'قیمت هر متر مربع (تومان)'}
                </label>
                <ErpInput
                  type="number"
                  min="0"
                  step="1000"
                  value={formData.pricePerSquareMeter}
                  onChange={(e) => setFormData(prev => ({ ...prev, pricePerSquareMeter: e.target.value }))}
                  className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-[var(--sds-focus-ring)] focus:border-transparent bg-[var(--sds-surface-raised)] dark:bg-[var(--sds-surface-raised)] text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)] ${
                    errors.pricePerSquareMeter ? 'border-[var(--sds-danger-border)]' : 'border-[var(--sds-border-default)] dark:border-[var(-<p id="inventory-pricePerSquareMeter-error" role="alert"ds-border-strong)]'
                  }`}
                  placeholder="مثال: 50000"
                 id="inventory-unitPrice" aria-invalid={Boolean(errors.unitPrice)} aria-describedby={errors.unitPrice ? 'inventory-unitPrice-error' : undefined} />
                {errors.pricePerSquareMeter && (
                  <p className="text-[var(--sds-danger)] text-sm mt-1">{errors.pricePerSquareMeter}</p>
                )}
                {errors.unitPrice && (
                  <p id="inventory-unitPrice-error" role="alert" className="text-[var(--sds-danger)] text-sm mt-1">{errors.unitPrice}</p>
                )}
                <p className="text-xs text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)] mt-1">
                  {formData.calculationBase === 'length'
                    ? 'قیمت پایه فرآوری برای هر متر طول را وارد کنید.'
                    : 'قیمت پایه فرآوری برای هر متر مربع سنگ را وارد کنید.'}
                </p>
              </div>

              <div>
                <label className="flex items-center space-x-3 space-x-reverse">
                  <ErpInput
                    type="checkbox"
                    checked={formData.isActive}
                    onChange={(e) => setFormData(prev => ({ ...prev, isActive: e.target.checked }))}
                    className="w-4 h-4 text-[var(--sds-accent)] bg-[var(--sds-surface-subtle)] border-[var(--sds-border-default)] rounded focus:ring-[var(--sds-focus-ring)] dark:focus:ring-[var(--sds-focus-ring)] dark:ring-offset-gray-800 focus:ring-2 dark:bg-[var(--sds-surface-raised)] dark:border-[var(--sds-border-strong)]"
                  />
                  <span className="text-sm font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-muted)]">
                    فعال</span>
                </label>
              </div>

              {errors.general && (
                <div className="bg-[var(--sds-danger-surface)] dark:bg-[var(--sds-danger-surface)] border border-[var(--sds-danger-border)] dark:border-[var(--sds-danger-border)] rounded-lg p-4">
                  <p className="text-[var(--sds-danger)] dark:text-[var(--sds-danger)] text-sm">{errors.general}</p>
                </div>
              )}

              <InventoryMasterDataActions pending={loading} submitLabel="ذخیره فرآوری سنگ" onCancel={handleCancel} deleteAction={{ label: 'حذف فرآوری سنگ', onClick: handleDelete }} />
            </form>
          </div>
        </div>
      </div>
    </InventoryMasterDataPage>
  );
};

export default EditStoneFinishingPage;
