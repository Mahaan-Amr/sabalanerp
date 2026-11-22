'use client';

import { ErpBadge, ErpField, ErpSelect } from '@/components/erp';

export type CustomerActivityCategory = 'BUILDER' | 'ARCHITECT' | 'NONE';

export function CustomerActivityCategoryEditor({ value, onChange, error }: {
  value: CustomerActivityCategory | ''; onChange: (value: CustomerActivityCategory | '') => void; error?: string;
}) {
  return <ErpField label="دسته‌بندی فعالیت مشتری" required error={error}>
    <ErpSelect required value={value} onChange={event => onChange(event.target.value as CustomerActivityCategory | '')}>
      <option value="" disabled>انتخاب کنید</option>
      <option value="BUILDER">سازنده معتبر</option>
      <option value="ARCHITECT">معمار</option>
      <option value="NONE">هیچ کدام</option>
    </ErpSelect>
  </ErpField>;
}

export function CustomerActivityCategoryBadge({ value }: { value?: string | null }) {
  if (value === 'NONE') return null;
  const label = value === 'BUILDER' ? 'سازنده' : value === 'ARCHITECT' ? 'معمار' : 'تعیین‌نشده';
  return <ErpBadge tone={value === 'BUILDER' ? 'info' : value === 'ARCHITECT' ? 'purple' : 'neutral'}>{label}</ErpBadge>;
}
