'use client';
import { ErpPressable } from '@/components/erp';
import { useState } from 'react';
import { FaEye, FaTimes } from 'react-icons/fa';

interface SignatureDisplayProps {
  signatureData: string;
  employeeName?: string;
  timestamp?: string;
  className?: string;
}

export default function SignatureDisplay({
  signatureData,
  employeeName,
  timestamp,
  className = ''
}: SignatureDisplayProps) {
  const [showModal, setShowModal] = useState(false);

  if (!signatureData) {
    return (
      <div className={`text-[var(--sds-text-secondary)] text-sm ${className}`}>
        امضایی ثبت نشده است
      </div>
    );
  }

  return (
    <>
      <div className={`flex items-center space-x-2 space-x-reverse ${className}`}>
        <div className="w-8 h-8 bg-[var(--sds-surface-raised)] rounded border flex items-center justify-center">
          <img
            src={signatureData}
            alt="امضا"
            className="w-6 h-6 object-contain"
          />
        </div>
        <ErpPressable type="submit"
          onClick={() => setShowModal(true)}
          className="text-[var(--sds-accent)] hover:text-[var(--sds-accent)] text-sm flex items-center space-x-1 space-x-reverse"
        >
          <FaEye className="h-3 w-3" />
          <span>مشاهده امضا</span>
        </ErpPressable>
      </div>

      {/* Signature Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-[var(--sds-surface-overlay)] flex items-center justify-center z-50 p-4">
          <div className="sds-workspace-surface p-6 max-w-md w-full">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-primary">مشاهده امضا</h3>
              <ErpPressable type="submit"
                onClick={() => setShowModal(false)}
                className="text-[var(--sds-text-muted)] hover:text-[var(--sds-text-primary)]"
              >
                <FaTimes className="h-5 w-5" />
              </ErpPressable>
            </div>

            {employeeName && (
              <div className="mb-2">
                <span className="text-sm text-secondary">کارمند: </span>
                <span className="text-sm text-primary">{employeeName}</span>
              </div>
            )}

            {timestamp && (
              <div className="mb-4">
                <span className="text-sm text-secondary">زمان: </span>
                <span className="text-sm text-primary">{timestamp}</span>
              </div>
            )}

            <div className="border border-[var(--sds-border-strong)] rounded-lg p-4 bg-[var(--sds-surface-raised)]">
              <img
                src={signatureData}
                alt="تصویر امضا"
                className="w-full h-auto max-h-64 object-contain"
              />
            </div>

            <div className="mt-4 text-center">
              <ErpPressable type="submit"
                onClick={() => setShowModal(false)}
                className="sds-action px-6 py-2"
              >
                بستن
              </ErpPressable>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

