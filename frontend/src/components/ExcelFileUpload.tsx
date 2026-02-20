'use client';

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
      setError('?? ?? Excel (.xlsx, .xls) ?? ???');
      return false;
    }

    // Check file size
    if (file.size > maxSize * 1024 * 1024) {
      setError(`?? ?? ??? ??? ? ${maxSize} ?? ??`);
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
              ? 'border-teal-500 bg-teal-50 dark:bg-teal-900/20' 
              : 'border-slate-300 dark:border-slate-600 hover:border-teal-400'
            }
            ${loading ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}
          `}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          onClick={() => !loading && fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={accept}
            onChange={handleFileInput}
            className="hidden"
            disabled={loading}
          />
          
          <div className="flex flex-col items-center space-y-3">
            <div className="p-3 rounded-full bg-slate-100 dark:bg-slate-700">
              <FaFileExcel className="w-8 h-8 text-green-600 dark:text-green-400" />
            </div>
            
            <div>
              <p className="text-lg font-medium text-slate-700 dark:text-slate-300">
                ?? Excel ? ??? ??? ? ?? ??
              </p>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                ?? ??: .xlsx, .xls (??? {maxSize} ??)
              </p>
            </div>
            
            <button
              type="button"
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-teal-600 hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-teal-500"
              disabled={loading}
            >
              <FaUpload className="w-4 h-4 ml-2" />
              ??? ??
            </button>
          </div>
        </div>
      ) : (
        <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-4 bg-slate-50 dark:bg-slate-800">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3 space-x-reverse">
              <div className="p-2 rounded-full bg-green-100 dark:bg-green-900/30">
                <FaFileExcel className="w-5 h-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="font-medium text-slate-700 dark:text-slate-300">
                  {selectedFile.name}
                </p>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {formatFileSize(selectedFile.size)}
                </p>
              </div>
            </div>
            
            <button
              type="button"
              onClick={handleRemoveFile}
              className="p-2 text-slate-400 hover:text-red-500 transition-colors"
              disabled={loading}
            >
              <FaTimes className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}
    </div>
  );
};

export default ExcelFileUpload;

