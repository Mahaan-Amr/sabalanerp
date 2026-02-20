'use client';

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
      <div className={`text-gray-500 text-sm ${className}`}>
        ?? ?? ??
      </div>
    );
  }

  return (
    <>
      <div className={`flex items-center space-x-2 space-x-reverse ${className}`}>
        <div className="w-8 h-8 bg-gray-700 rounded border flex items-center justify-center">
          <img 
            src={signatureData} 
            alt="??" 
            className="w-6 h-6 object-contain"
          />
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="text-teal-400 hover:text-teal-300 text-sm flex items-center space-x-1 space-x-reverse"
        >
          <FaEye className="h-3 w-3" />
          <span>??? ??</span>
        </button>
      </div>

      {/* Signature Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="glass-liquid-card p-6 max-w-md w-full">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-primary">??? ??</h3>
              <button
                onClick={() => setShowModal(false)}
                className="text-gray-400 hover:text-white"
              >
                <FaTimes className="h-5 w-5" />
              </button>
            </div>

            {employeeName && (
              <div className="mb-2">
                <span className="text-sm text-secondary">???: </span>
                <span className="text-sm text-primary">{employeeName}</span>
              </div>
            )}

            {timestamp && (
              <div className="mb-4">
                <span className="text-sm text-secondary">??: </span>
                <span className="text-sm text-primary">{timestamp}</span>
              </div>
            )}

            <div className="border border-gray-600 rounded-lg p-4 bg-white">
              <img 
                src={signatureData} 
                alt="??? ??" 
                className="w-full h-auto max-h-64 object-contain"
              />
            </div>

            <div className="mt-4 text-center">
              <button
                onClick={() => setShowModal(false)}
                className="glass-liquid-btn px-6 py-2"
              >
                ??
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

