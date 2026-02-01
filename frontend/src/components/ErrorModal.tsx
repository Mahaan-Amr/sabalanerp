'use client';

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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="glass-liquid-card p-6 max-w-md w-full mx-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            {showIcon && (
              <div className="w-10 h-10 bg-red-500/20 rounded-full flex items-center justify-center">
                <FaExclamationCircle className="w-6 h-6 text-red-500" />
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
          <p className="text-slate-700 dark:text-slate-300 text-center leading-relaxed mb-3">
            {message}
          </p>
          
          {details && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
              <p className="text-sm text-red-700 dark:text-red-300 text-right">
                {details}
              </p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-center">
          <button
            onClick={onClose}
            className="glass-liquid-btn px-8 py-3 text-slate-700 dark:text-slate-300 font-medium hover:scale-105 transition-all duration-200 border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-900/20"
          >
            {buttonText}
          </button>
        </div>
      </div>
    </div>
  );
}
