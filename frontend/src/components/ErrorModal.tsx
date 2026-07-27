'use client';
import { ErpPressable } from '@/components/erp';
import React from 'react';
import { FaExclamationTriangle, FaTimes, FaExclamationCircle } from 'react-icons/fa';

interface ErrorModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  message: string;
  buttonText?: string;
  showIcon?: boolean;
  details?: string;
}

export default function ErrorModal({
  isOpen,
  onClose,
  title = 'خطا',
  message,
  buttonText = 'باشه',
  showIcon = true,
  details
}: ErrorModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-[var(--sds-surface-overlay)] flex items-center justify-center z-50 p-4">
      <div className="sds-workspace-surface p-6 max-w-md w-full mx-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            {showIcon && (
              <div className="w-10 h-10 bg-[var(--sds-danger-surface)] rounded-full flex items-center justify-center">
                <FaExclamationCircle className="w-6 h-6 text-[var(--sds-danger)]" />
              </div>
            )}
            <h3 className="text-lg font-bold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">
              {title}
            </h3>
          </div>
          <ErpPressable type="submit"
            onClick={onClose}
            className="text-[var(--sds-text-muted)] hover:text-[var(--sds-text-secondary)] dark:hover:text-[var(--sds-text-muted)] transition-colors duration-200"
          >
            <FaTimes className="h-5 w-5" />
          </ErpPressable>
        </div>

        {/* Content */}
        <div className="mb-6">
          <p className="text-[var(--sds-text-primary)] dark:text-[var(--sds-text-muted)] text-center leading-relaxed mb-3">
            {message}
          </p>

          {details && (
            <div className="bg-[var(--sds-danger-surface)] dark:bg-[var(--sds-danger-surface)] border border-[var(--sds-danger-border)] dark:border-[var(--sds-danger-border)] rounded-lg p-3">
              <p className="text-sm text-[var(--sds-danger)] dark:text-[var(--sds-danger)] text-right">
                {details}
              </p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-center">
          <ErpPressable type="submit"
            onClick={onClose}
            className="sds-action px-8 py-3 text-[var(--sds-text-primary)] dark:text-[var(--sds-text-muted)] font-medium hover:scale-105 transition-all duration-200 border-[var(--sds-danger-border)] dark:border-[var(--sds-danger-border)] hover:bg-[var(--sds-danger-surface)] dark:hover:bg-[var(--sds-danger-surface)]"
          >
            {buttonText}
          </ErpPressable>
        </div>
      </div>
    </div>
  );
}

