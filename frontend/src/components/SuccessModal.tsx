'use client';
import { ErpButton, ErpSheet } from '@/components/erp';
import React from 'react';
import { FaCheckCircle } from 'react-icons/fa';

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
    if (!isOpen || !autoClose) return;
    const timer = window.setTimeout(onClose, autoCloseDelay);
    return () => window.clearTimeout(timer);
  }, [isOpen, autoClose, autoCloseDelay, onClose]);

  return (
    <ErpSheet
      open={isOpen}
      onClose={onClose}
      title={title}
      presentation="modal"
      footer={<div className="flex justify-center"><ErpButton label={buttonText} onClick={onClose} tone="success" variant="solid" /></div>}
    >
      <div className="space-y-4 text-center">
        {showIcon ? <FaCheckCircle className="mx-auto h-10 w-10 text-[var(--sds-success)]" aria-hidden="true" /> : null}
        <p className="sds-text-primary leading-7">{message}</p>
        {autoClose ? <p className="sds-text-muted text-xs">این پنجره تا {autoCloseDelay / 1000} ثانیه دیگر بسته می‌شود</p> : null}
      </div>
    </ErpSheet>
  );
}
