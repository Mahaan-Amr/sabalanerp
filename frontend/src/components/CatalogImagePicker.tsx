'use client';
import { ErpInput, ErpPressable } from '@/components/erp';
import React from 'react';
import { FaPlus, FaTimes } from 'react-icons/fa';
import { resolveBackendAssetUrl, salesAPI } from '@/lib/api';

interface CatalogImagePickerProps {
  images?: string[];
  label?: string;
  onChange: (images: string[]) => void;
}

const CatalogImagePicker: React.FC<CatalogImagePickerProps> = ({
  images = [],
  label = 'تصاویر',
  onChange
}) => {
  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    const response = await salesAPI.uploadImage(file);
    const url = response.data?.data?.url;
    if (url) {
      onChange([...images, url]);
    }
  };

  const visibleImages = images.slice(0, 3);
  const overflow = Math.max(0, images.length - visibleImages.length);

  return (
    <div>
      <p className="mb-2 block text-sm font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-muted)]">
        {label}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {visibleImages.map((image, index) => (
          <div key={`${image}-${index}`} className="relative h-16 w-16 overflow-hidden rounded-lg border border-[var(--sds-border-default)] bg-[var(--sds-surface-subtle)] dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)]">
            <img src={resolveBackendAssetUrl(image)} alt={label} className="h-full w-full object-cover" />
            <ErpPressable
              type="button"
              onClick={() => onChange(images.filter((_, imageIndex) => imageIndex !== index))}
              className="absolute left-1 top-1 inline-flex h-11 w-11 items-center justify-center rounded-full bg-[var(--sds-surface-raised)] text-[var(--sds-text-primary)]"
              aria-label="حذف تصویر"
              title="حذف تصویر"
            >
              <FaTimes className="h-3 w-3" />
            </ErpPressable>
          </div>
        ))}
        {overflow > 0 && (
          <span className="inline-flex h-16 min-w-16 items-center justify-center rounded-lg border border-[var(--sds-border-default)] bg-[var(--sds-surface-subtle)] px-2 text-xs font-semibold text-[var(--sds-text-secondary)] dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)] dark:text-[var(--sds-text-muted)]">
            +{overflow}
          </span>
        )}
        <label className="inline-flex h-16 w-16 cursor-pointer items-center justify-center rounded-lg border border-dashed border-[var(--sds-border-strong)] bg-[var(--sds-accent-surface)] text-[var(--sds-accent)] transition hover:bg-[var(--sds-accent-surface)] dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-accent-surface)] dark:text-[var(--sds-accent)]">
          <FaPlus className="h-5 w-5" />
          <ErpInput aria-label={`افزودن ${label}`} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={handleUpload} />
        </label>
      </div>
    </div>
  );
};

export default CatalogImagePicker;
