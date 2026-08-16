'use client';
import { ErpBadge, ErpCard, ErpField as SalesAuthoringField, ErpFieldView, ErpInlineState, ErpInput, ErpLoading, ErpPressable, ErpSelect, ErpTextarea } from '@/components/erp';
import React, { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Product } from '@/types/product';
import { resolveBackendAssetUrl, salesAPI } from '@/lib/api';
import { formatPrice } from '@/lib/numberFormat';
import FormattedNumberInput from '@/components/FormattedNumberInput';
import CatalogImagePicker from '@/components/CatalogImagePicker';
import { SalesAuthoringPage, SalesAuthoringSection, hasSalesDraftChanged } from '@/features/sales/authoring/SalesAuthoringUi';

// Product name generation utilities
const generateFullProductName = (product: Product): string => {
  const parts = [
    product.stoneTypeNamePersian,
    product.cuttingDimensionNamePersian,
    `عرض ${product.widthValue}×ضخامت ${product.thicknessValue}cm`,
    product.mineNamePersian,
    product.finishNamePersian,
    product.colorNamePersian,
    product.qualityNamePersian
  ].filter(part => part && part.trim() !== '');

  return parts.join(' - ');
};

type ProductEditValues = {
  basePrice: string;
  motherLengthValue: string;
  isAvailable: boolean;
  leadTime: string;
  description: string;
  images: string[];
};

const ProductDetailPage: React.FC = () => {
  const router = useRouter();
  const params = useParams();
  const productId = params.id as string;

  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; title: string }>();
  const [editing, setEditing] = useState(false);
  const [savedFormSnapshot, setSavedFormSnapshot] = useState<ProductEditValues | null>(null);
  const [formData, setFormData] = useState<ProductEditValues>({
    basePrice: '',
    motherLengthValue: '',
    isAvailable: true,
    leadTime: '',
    description: '',
    images: [] as string[],
  });

  useEffect(() => {
    if (productId) {
      fetchProduct();
    }
  }, [productId]);

  const fetchProduct = async () => {
    try {
      setLoading(true);
      setLoadError('');
      const response = await salesAPI.getProduct(productId);

      if (response.data.success && response.data.data) {
        const data = response.data;
        setProduct(data.data);
        const nextFormData = {
          basePrice: data.data.basePrice?.toString() || '',
          motherLengthValue: data.data.motherLengthValue?.toString() || '',
          isAvailable: data.data.isAvailable,
          leadTime: data.data.leadTime?.toString() || '',
          description: data.data.description || '',
          images: data.data.images || [],
        };
        setFormData(nextFormData);
        setSavedFormSnapshot(nextFormData);
      } else if (response.data.success) {
        setProduct(null);
        setSavedFormSnapshot(null);
      } else {
        setLoadError('دریافت اطلاعات محصول ناموفق بود. دوباره تلاش کنید.');
      }
    } catch (error) {
      console.error('Error fetching product:', error);
      setLoadError('دریافت اطلاعات محصول ناموفق بود. دوباره تلاش کنید.');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setFeedback(undefined);
      const response = await salesAPI.updateProduct(productId, {
        basePrice: formData.basePrice ? parseFloat(formData.basePrice) : null,
        motherLengthValue: formData.motherLengthValue
          ? parseFloat(formData.motherLengthValue)
          : null,
        isAvailable: formData.isAvailable,
        leadTime: formData.leadTime ? parseInt(formData.leadTime) : null,
        description: formData.description || null,
        images: formData.images,
      });

      if (response.data.success) {
        setProduct(response.data.data);
        setSavedFormSnapshot(formData);
        setEditing(false);
        setFeedback({ kind: 'success', title: 'محصول با موفقیت به‌روزرسانی شد.' });
      } else {
        setFeedback({ kind: 'error', title: 'به‌روزرسانی محصول ناموفق بود.' });
      }
    } catch (error) {
      console.error('Error updating product:', error);
      setFeedback({ kind: 'error', title: 'به‌روزرسانی محصول ناموفق بود.' });
    } finally {
      setSaving(false);
    }
  };

  const formatPrice = (price: number | null) => {
    if (!price) return 'قیمت تعیین نشده';
    return new Intl.NumberFormat('fa-IR').format(price) + ' ریال';
  };

  if (loading) return <ErpLoading />;

  if (loadError) {
    return (
      <SalesAuthoringPage title="جزئیات محصول" backHref="/dashboard/sales/products">
        <ErpInlineState kind="error" title={loadError} action={{ label: 'تلاش دوباره', onClick: fetchProduct }} />
      </SalesAuthoringPage>
    );
  }

  if (!product) {
    return (
      <SalesAuthoringPage title="جزئیات محصول" backHref="/dashboard/sales/products">
        <ErpInlineState kind="empty" title="محصول یافت نشد" action={{ label: 'بازگشت به لیست محصولات', href: '/dashboard/sales/products' }} />
      </SalesAuthoringPage>
    );
  }

  return (
    <SalesAuthoringPage
      title="جزئیات محصول"
      description="مشاهده و ویرایش اطلاعات محصول"
      backHref="/dashboard/sales/products"
      feedback={feedback ?? (editing && savedFormSnapshot && hasSalesDraftChanged(formData, savedFormSnapshot) ? { kind: 'stale', title: 'تغییرات این فرم تا زمان ذخیره نهایی نشده‌اند.' } : undefined)}
    >
      <SalesAuthoringSection title="مشخصات و قیمت‌گذاری محصول">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Product Information */}
          <div className="lg:col-span-2">
            <div className="space-y-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">
                  اطلاعات محصول
                </h2>
                <ErpPressable type="button"
                  onClick={() => setEditing(!editing)}
                  tone="primary"
                  variant="solid"
                  className="px-4 py-2"
                >
                  {editing ? 'لغو ویرایش' : 'ویرایش'}
                </ErpPressable>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Full Product Name */}
                <ErpFieldView label="نام کامل محصول" value={<>{generateFullProductName(product)}</>} />

                {/* Product Name Persian */}
                <ErpFieldView label="نام فارسی" value={<>{product.namePersian}</>} />

                {/* Product Name English */}
                <ErpFieldView label="نام انگلیسی" value={<>{product.name}</>} />

                {/* Stone Type */}
                <ErpFieldView label="نوع سنگ" value={<>{product.stoneTypeNamePersian}</>} />

                {/* Dimensions */}
                <ErpFieldView label="ابعاد" value={<>{product.widthValue} × {product.thicknessValue} سانتی‌متر</>} />

                {/* Mine */}
                {editing ? (
                  <SalesAuthoringField label="طول مادر">
                    <ErpInput
                      value={formData.motherLengthValue}
                      onChange={(event) => setFormData({
                        ...formData,
                        motherLengthValue: event.target.value
                      })}
                      inputMode="decimal"
                    />
                  </SalesAuthoringField>
                ) : <ErpFieldView label="طول مادر" value={product.motherLengthValue ? `${product.motherLengthValue} متر` : 'در موجودی ثبت نشده است'} />}

                {/* Mine */}
                <ErpFieldView label="معدن" value={<>{product.mineNamePersian}</>} />

                {/* Finish */}
                <ErpFieldView label="نوع پرداخت" value={<>{product.finishNamePersian}</>} />

                {/* Color */}
                <ErpFieldView label="رنگ" value={<>{product.colorNamePersian}</>} />

                {/* Quality */}
                <ErpFieldView label="کیفیت" value={<>{product.qualityNamePersian}</>} />

                {/* Cutting Dimension */}
                <ErpFieldView label="ابعاد برش" value={<>{product.cuttingDimensionNamePersian}</>} />
              </div>
            </div>
          </div>

          {/* Pricing and Management */}
          <div className="space-y-6">
            {/* Pricing */}
            <ErpCard className="p-5">
              <h3 className="text-lg font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)] mb-4">
                قیمت‌گذاری
              </h3>

              <div className="space-y-4">
                {/* Base Price */}
                {editing ? (
                  <SalesAuthoringField label="قیمت پایه (ریال)">
                    <FormattedNumberInput
                      value={formData.basePrice ? parseFloat(formData.basePrice) : 0}
                      onChange={(value) => setFormData({ ...formData, basePrice: value.toString() })}
                      placeholder="قیمت را وارد کنید"
                      min={0}
                    />
                  </SalesAuthoringField>
                ) : <ErpFieldView label="قیمت پایه (ریال)" value={formatPrice(product.basePrice)} />}

                {/* Currency */}
                <ErpFieldView label="واحد پول" value={<>{product.currency}</>} />

                {/* Lead Time */}
                {editing ? (
                  <SalesAuthoringField label="زمان تحویل (روز)">
                    <FormattedNumberInput
                      value={formData.leadTime ? parseFloat(formData.leadTime) : 0}
                      onChange={(value) => setFormData({ ...formData, leadTime: value.toString() })}
                      placeholder="تعداد روز"
                      min={0}
                    />
                  </SalesAuthoringField>
                ) : <ErpFieldView label="زمان تحویل (روز)" value={product.leadTime ? `${product.leadTime} روز` : 'تعیین نشده'} />}
              </div>
            </ErpCard>

            {/* Status */}
            <ErpCard className="p-5">
              <h3 className="text-lg font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)] mb-4">
                وضعیت
              </h3>

              <div className="space-y-4">
                {/* Availability */}
                {editing ? (
                  <SalesAuthoringField label="وضعیت موجودی">
                    <ErpSelect
                      value={formData.isAvailable.toString()}
                      onChange={(e) => setFormData({ ...formData, isAvailable: e.target.value === 'true' })}
                    >
                      <option value="true">موجود</option>
                      <option value="false">ناموجود</option>
                    </ErpSelect>
                  </SalesAuthoringField>
                ) : <ErpFieldView label="وضعیت موجودی" value={<ErpBadge tone={product.isAvailable ? 'success' : 'danger'}>{product.isAvailable ? 'موجود' : 'ناموجود'}</ErpBadge>} />}

                {/* Active Status */}
                <ErpFieldView label="وضعیت فعال" value={<ErpBadge tone={product.isActive ? 'success' : 'danger'}>{product.isActive ? 'فعال' : 'غیرفعال'}</ErpBadge>} />
              </div>
            </ErpCard>

            {/* Description */}
            <ErpCard className="p-5">
              {editing ? (
                <SalesAuthoringField label="توضیحات">
                <ErpTextarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={4}
                  placeholder="توضیحات محصول را وارد کنید"
                />
                </SalesAuthoringField>
              ) : <ErpFieldView label="توضیحات" value={product.description || 'توضیحی وارد نشده است'} />}
            </ErpCard>

            <ErpCard className="p-5">
              {editing ? (
                <CatalogImagePicker
                  images={formData.images}
                  onChange={(images) => setFormData({ ...formData, images })}
                />
              ) : (
                <>
                  <h3 className="text-lg font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)] mb-4">تصاویر</h3>
                  {product.images && product.images.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {product.images.slice(0, 3).map((image, index) => (
                        <img key={`${image}-${index}`} src={resolveBackendAssetUrl(image)} alt={product.namePersian} className="h-16 w-16 rounded-lg object-cover" />
                      ))}
                    </div>
                  ) : (
                    <div className="px-4 py-2 bg-[var(--sds-surface-subtle)] dark:bg-[var(--sds-surface-raised)] rounded-lg">تصویری ثبت نشده است</div>
                  )}
                </>
              )}
            </ErpCard>

            {/* Save Button */}
            {editing && (
              <div className="flex space-x-3">
                <ErpPressable type="button"
                  onClick={handleSave}
                  disabled={saving}
                  tone="primary"
                  variant="solid"
                  className="flex-1 px-6 py-3"
                >
                  {saving ? 'در حال ذخیره…' : 'ذخیره تغییرات'}
                </ErpPressable>
                <ErpPressable type="button"
                  onClick={() => setEditing(false)}
                  variant="ghost"
                  className="flex-1 px-6 py-3"
                >
                  لغو
                </ErpPressable>
              </div>
            )}
          </div>
        </div>
      </SalesAuthoringSection>
    </SalesAuthoringPage>
  );
};

export default ProductDetailPage;
