'use client';
import { ErpPressable } from '@/components/erp';
import React from 'react';
import { FaCheck, FaTimes, FaCheckCircle } from 'react-icons/fa';

interface SuccessModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  message: string;
  buttonText?: string;
  showIcon?: boolean;
  autoClose?: boolean;
  autoCloseDelay?: number;
}

export default function SuccessModal({
  isOpen,
  onClose,
  title = 'موفقیت',
  message,
  buttonText = 'باشه',
  showIcon = true,
  autoClose = false,
  autoCloseDelay = 3000
}: SuccessModalProps) {
  React.useEffect(() => {
    if (isOpen && autoClose) {
      const timer = setTimeout(() => {
        onClose();
      }, autoCloseDelay);

      return () => clearTimeout(timer);
    }
  }, [isOpen, autoClose, autoCloseDelay, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-[var(--sds-surface-overlay)] flex items-center justify-center z-50 p-4">
      <div className="sds-workspace-surface p-6 max-w-md w-full mx-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            {showIcon && (
              <div className="w-10 h-10 bg-[var(--sds-success-surface)] rounded-full flex items-center justify-center">
                <FaCheckCircle className="w-6 h-6 text-[var(--sds-success)]" />
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
          <p className="text-[var(--sds-text-primary)] dark:text-[var(--sds-text-muted)] text-center leading-relaxed">
            {message}
          </p>
        </div>

        {/* Actions */}
        <div className="flex justify-center">
          <ErpPressable type="submit"
            onClick={onClose}
            className="sds-action sds-tone-primary sds-action-solid px-8 py-3 text-[var(--sds-text-primary)] font-medium hover:scale-105 transition-all duration-200"
          >
            {buttonText}
          </ErpPressable>
        </div>

        {/* Auto-close indicator */}
        {autoClose && (
          <div className="mt-4 text-center">
            <div className="text-xs text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">
              این پنجره تا {autoCloseDelay / 1000} ثانیه دیگر بسته می‌شود
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

