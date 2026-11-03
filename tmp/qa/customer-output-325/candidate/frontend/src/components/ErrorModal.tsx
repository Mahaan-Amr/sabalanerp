'use client';
import { ErpButton, ErpInlineState, ErpSheet } from '@/components/erp';
import { FaExclamationCircle } from 'react-icons/fa';

interface ErrorModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  message: string;
  buttonText?: string;
  showIcon?: boolean;
  details?: string;
  returnFocusElement?: HTMLElement | null;
}

export default function ErrorModal({
  isOpen,
  onClose,
  title = 'خطا',
  message,
  buttonText = 'باشه',
  showIcon = true,
  details,
  returnFocusElement
}: ErrorModalProps) {
  return (
    <ErpSheet
      open={isOpen}
      onClose={onClose}
      title={title}
      presentation="modal"
      returnFocusElement={returnFocusElement}
      footer={<div className="flex justify-center"><ErpButton label={buttonText} onClick={onClose} tone="danger" variant="outline" /></div>}
    >
      <div className="space-y-4 text-center">
        {showIcon ? <FaExclamationCircle className="mx-auto h-10 w-10 text-[var(--sds-danger)]" aria-hidden="true" /> : null}
        <p className="sds-text-primary leading-7">{message}</p>
        {details ? <ErpInlineState kind="error" title={details} /> : null}
      </div>
    </ErpSheet>
  );
}
