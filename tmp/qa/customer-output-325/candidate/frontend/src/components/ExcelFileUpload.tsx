'use client';
import { ErpInput, ErpPressable } from '@/components/erp';
import React, { useState, useRef } from 'react';
import { FaUpload, FaFileExcel, FaTimes, FaCheck } from 'react-icons/fa';

interface ExcelFileUploadProps {
  onFileSelect: (file: File) => void;
  onFileRemove: () => void;
  selectedFile: File | null;
  loading?: boolean;
  accept?: string;
  maxSize?: number; // in MB
  className?: string;
}

const ExcelFileUpload: React.FC<ExcelFileUploadProps> = ({
  onFileSelect,
  onFileRemove,
  selectedFile,
  loading = false,
  accept = '.xlsx,.xls',
  maxSize = 10,
  className = ''
}) => {
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validateFile = (file: File): boolean => {
    // Check file type
    const allowedTypes = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'];
    if (!allowedTypes.includes(file.type) && !file.name.match(/\.(xlsx|xls)$/i)) {
      setError('فقط فایل Excel با پسوند .xlsx یا .xls مجاز است');
      return false;
    }

    // Check file size
    if (file.size > maxSize * 1024 * 1024) {
      setError(`حجم فایل باید کمتر از ${maxSize} مگابایت باشد`);
      return false;
    }

    setError(null);
    return true;
  };

  const handleFile = (file: File) => {
    if (validateFile(file)) {
      onFileSelect(file);
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  };

  const handleRemoveFile = () => {
    onFileRemove();
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className={`w-full ${className}`}>
      {!selectedFile ? (
        <div
          className={`
            relative border-2 border-dashed rounded-lg p-6 text-center transition-colors
            ${dragActive
              ? 'border-[var(--sds-border-strong)] bg-[var(--sds-accent-surface)] dark:bg-[var(--sds-accent-surface)]'
              : 'border-[var(--sds-border-default)] dark:border-[var(--sds-border-strong)] hover:border-[var(--sds-border-strong)]'
            }
            ${loading ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}
          `}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
        >
          <ErpInput
            ref={fileInputRef}
            type="file"
            accept={accept}
            onChange={handleFileInput}
            className="hidden"
            disabled={loading}
          />

          <ErpPressable
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={loading}
            aria-label="انتخاب فایل اکسل"
            className="flex w-full flex-col items-center space-y-3 p-2"
          >
            <div className="p-3 rounded-full bg-[var(--sds-surface-subtle)] dark:bg-[var(--sds-surface-raised)]">
              <FaFileExcel className="w-8 h-8 text-[var(--sds-success)] dark:text-[var(--sds-success)]" />
            </div>

            <div>
              <p className="text-lg font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-muted)]">
                فایل Excel را اینجا رها کنید یا انتخاب کنید
              </p>
              <p className="text-sm text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)] mt-1">
                فرمت مجاز: .xlsx, .xls (حداکثر {maxSize} مگابایت)
              </p>
            </div>

            <span className="inline-flex items-center rounded-md border border-transparent bg-[var(--sds-accent)] px-4 py-2 text-sm font-medium text-[var(--sds-text-on-accent)]">
              <FaUpload className="w-4 h-4 ml-2" />
              انتخاب فایل
            </span>
          </ErpPressable>
        </div>
      ) : (
        <div className="border border-[var(--sds-border-default)] dark:border-[var(--sds-border-strong)] rounded-lg p-4 bg-[var(--sds-surface-subtle)] dark:bg-[var(--sds-surface-raised)]">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3 space-x-reverse">
              <div className="p-2 rounded-full bg-[var(--sds-success-surface)] dark:bg-[var(--sds-success-surface)]">
                <FaFileExcel className="w-5 h-5 text-[var(--sds-success)] dark:text-[var(--sds-success)]" />
              </div>
              <div>
                <p className="font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-muted)]">
                  {selectedFile.name}
                </p>
                <p className="text-sm text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">
                  {formatFileSize(selectedFile.size)}
                </p>
              </div>
            </div>

            <ErpPressable
              type="button"
              onClick={handleRemoveFile}
              className="p-2 text-[var(--sds-text-muted)] hover:text-[var(--sds-danger)] transition-colors"
              disabled={loading}
            >
              <FaTimes className="w-4 h-4" />
            </ErpPressable>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-3 p-3 bg-[var(--sds-danger-surface)] dark:bg-[var(--sds-danger-surface)] border border-[var(--sds-danger-border)] dark:border-[var(--sds-danger-border)] rounded-md">
          <p className="text-sm text-[var(--sds-danger)] dark:text-[var(--sds-danger)]">{error}</p>
        </div>
      )}
    </div>
  );
};

export default ExcelFileUpload;

