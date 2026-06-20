'use client';

import React from 'react';
import { FaPlus, FaTimes } from 'react-icons/fa';
import { API_ORIGIN, salesAPI } from '@/lib/api';

const resolveImageUrl = (url: string) => {
  if (!url) return '';
  if (/^https?:\/\//i.test(url) || url.startsWith('data:')) return url;
  return `${API_ORIGIN}${url.startsWith('/') ? url : `/${url}`}`;
};

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
      <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">
        {label}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        {visibleImages.map((image, index) => (
          <div key={`${image}-${index}`} className="relative h-16 w-16 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
            <img src={resolveImageUrl(image)} alt={label} className="h-full w-full object-cover" />
            <button
              type="button"
              onClick={() => onChange(images.filter((_, imageIndex) => imageIndex !== index))}
              className="absolute left-1 top-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-950/70 text-white"
              aria-label="حذف تصویر"
              title="حذف تصویر"
            >
              <FaTimes className="h-3 w-3" />
            </button>
          </div>
        ))}
        {overflow > 0 && (
          <span className="inline-flex h-16 min-w-16 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 px-2 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
            +{overflow}
          </span>
        )}
        <label className="inline-flex h-16 w-16 cursor-pointer items-center justify-center rounded-lg border border-dashed border-teal-300 bg-teal-50 text-teal-700 transition hover:bg-teal-100 dark:border-teal-700 dark:bg-teal-900/20 dark:text-teal-200">
          <FaPlus className="h-5 w-5" />
          <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={handleUpload} />
        </label>
      </div>
    </div>
  );
};

export default CatalogImagePicker;
