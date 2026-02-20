'use client';

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
  title = '???',
  message,
  buttonText = '??',
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="glass-liquid-card p-6 max-w-md w-full mx-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            {showIcon && (
              <div className="w-10 h-10 bg-green-500/20 rounded-full flex items-center justify-center">
                <FaCheckCircle className="w-6 h-6 text-green-500" />
              </div>
            )}
            <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200">
              {title}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors duration-200"
          >
            <FaTimes className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="mb-6">
          <p className="text-slate-700 dark:text-slate-300 text-center leading-relaxed">
            {message}
          </p>
        </div>

        {/* Actions */}
        <div className="flex justify-center">
          <button
            onClick={onClose}
            className="glass-liquid-btn-primary px-8 py-3 text-white font-medium hover:scale-105 transition-all duration-200"
          >
            {buttonText}
          </button>
        </div>

        {/* Auto-close indicator */}
        {autoClose && (
          <div className="mt-4 text-center">
            <div className="text-xs text-slate-500 dark:text-slate-400">
              ?? ?? ? {autoCloseDelay / 1000} ??? ?? ???
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

