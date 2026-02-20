'use client';

import React, { useState } from 'react';
import { FaDownload, FaUpload, FaTimes, FaFileExcel, FaSpinner, FaCheck, FaExclamationTriangle } from 'react-icons/fa';
import ExcelFileUpload from './ExcelFileUpload';
import { salesAPI } from '@/lib/api';
import { canImportProducts, canExportProducts, User as PermissionUser } from '@/lib/permissions';

interface ProductImportExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportComplete?: (results: any) => void;
  currentFilters?: any;
  currentUser?: PermissionUser | null;
}

interface ImportResults {
  total: number;
  success: number;
  failed: number;
  errors: Array<{
    row: number;
    error: string;
    data: any;
  }>;
}

const ProductImportExportModal: React.FC<ProductImportExportModalProps> = ({
  isOpen,
  onClose,
  onImportComplete,
  currentFilters,
  currentUser
}) => {
  const [activeTab, setActiveTab] = useState<'import' | 'export'>('import');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [importResults, setImportResults] = useState<ImportResults | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFileSelect = (file: File) => {
    setSelectedFile(file);
    setError(null);
    setImportResults(null);
  };

  const handleFileRemove = () => {
    setSelectedFile(null);
    setError(null);
    setImportResults(null);
  };

  const handleDownloadTemplate = async () => {
    try {
      setLoading(true);
      const response = await salesAPI.downloadProductTemplate();
      
      // Create blob and download
      const blob = new Blob([response.data], { 
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'product-import-template.xlsx';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error: any) {
      console.error('Template download error:', error);
      setError('?? ? ??? ?? Excel');
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async () => {
    if (!selectedFile) {
      setError('??? ?? Excel ? ??? ??');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      
      const response = await salesAPI.importProducts(selectedFile);
      
      if (response.data.success) {
        setImportResults(response.data.data);
        if (onImportComplete) {
          onImportComplete(response.data.data);
        }
      } else {
        setError(response.data.error || '?? ? ?? ?? ??');
      }
    } catch (error: any) {
      console.error('Import error:', error);
      setError(error.response?.data?.error || '?? ? ?? ?? ?? Excel');
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await salesAPI.exportProducts(currentFilters);
      
      // Create blob and download
      const blob = new Blob([response.data], { 
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `products-export-${new Date().toISOString().split('T')[0]}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error: any) {
      console.error('Export error:', error);
      setError(error.response?.data?.error || '?? ? ?? ?? ??');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setActiveTab('import');
    setSelectedFile(null);
    setLoading(false);
    setImportResults(null);
    setError(null);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-700">
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
            ?? ?? / ?? ?? ??
          </h2>
          <button
            onClick={handleClose}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
          >
            <FaTimes className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-200 dark:border-slate-700">
          {canImportProducts(currentUser || null) && (
            <button
              onClick={() => setActiveTab('import')}
              className={`flex-1 px-6 py-3 text-sm font-medium transition-colors ${
                activeTab === 'import'
                  ? 'text-teal-600 dark:text-teal-400 border-b-2 border-teal-600 dark:border-teal-400 bg-teal-50 dark:bg-teal-900/20'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              <FaUpload className="w-4 h-4 inline ml-2" />
              ?? ??
            </button>
          )}
          {canExportProducts(currentUser || null) && (
            <button
              onClick={() => setActiveTab('export')}
              className={`flex-1 px-6 py-3 text-sm font-medium transition-colors ${
                activeTab === 'export'
                  ? 'text-teal-600 dark:text-teal-400 border-b-2 border-teal-600 dark:border-teal-400 bg-teal-50 dark:bg-teal-900/20'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              <FaDownload className="w-4 h-4 inline ml-2" />
              ?? ??
            </button>
          )}
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[60vh]">
          {activeTab === 'import' && canImportProducts(currentUser || null) ? (
            <div className="space-y-6">
              {/* Template Download */}
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                <div className="flex items-start space-x-3 space-x-reverse">
                  <FaFileExcel className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5" />
                  <div className="flex-1">
                    <h3 className="font-medium text-blue-900 dark:text-blue-100">
                      ??? ?? Excel
                    </h3>
                    <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
                      ??? ?? Excel ? ??? ?? ? ? ? ? ?? ?? ? ??
                    </p>
                    <button
                      onClick={handleDownloadTemplate}
                      disabled={loading}
                      className="mt-3 inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-md text-blue-700 bg-blue-100 hover:bg-blue-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
                    >
                      {loading ? (
                        <FaSpinner className="w-4 h-4 ml-2 animate-spin" />
                      ) : (
                        <FaDownload className="w-4 h-4 ml-2" />
                      )}
                      ??? ??
                    </button>
                  </div>
                </div>
              </div>

              {/* File Upload */}
              <div>
                <h3 className="text-lg font-medium text-slate-900 dark:text-slate-100 mb-3">
                  ??? ?? Excel
                </h3>
                <ExcelFileUpload
                  onFileSelect={handleFileSelect}
                  onFileRemove={handleFileRemove}
                  selectedFile={selectedFile}
                  loading={loading}
                />
              </div>

              {/* Import Button */}
              {selectedFile && (
                <div className="flex justify-end">
                  <button
                    onClick={handleImport}
                    disabled={loading}
                    className="inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-teal-600 hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-teal-500 disabled:opacity-50"
                  >
                    {loading ? (
                      <FaSpinner className="w-5 h-5 ml-2 animate-spin" />
                    ) : (
                      <FaUpload className="w-5 h-5 ml-2" />
                    )}
                    ?? ?? ??
                  </button>
                </div>
              )}

              {/* Import Results */}
              {importResults && (
                <div className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-4">
                  <h4 className="font-medium text-slate-900 dark:text-slate-100 mb-3">
                    ??? ?? ??
                  </h4>
                  <div className="grid grid-cols-3 gap-4 mb-4">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                        {importResults.total}
                      </div>
                      <div className="text-sm text-slate-500 dark:text-slate-400">?</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                        {importResults.success}
                      </div>
                      <div className="text-sm text-slate-500 dark:text-slate-400">??</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-red-600 dark:text-red-400">
                        {importResults.failed}
                      </div>
                      <div className="text-sm text-slate-500 dark:text-slate-400">???</div>
                    </div>
                  </div>

                  {importResults.errors.length > 0 && (
                    <div className="mt-4">
                      <h5 className="font-medium text-red-600 dark:text-red-400 mb-2">
                        ???:
                      </h5>
                      <div className="max-h-32 overflow-y-auto space-y-2">
                        {importResults.errors.slice(0, 10).map((error, index) => (
                          <div key={index} className="text-sm text-red-600 dark:text-red-400">
                            <span className="font-medium">?? {error.row}:</span> {error.error}
                          </div>
                        ))}
                        {importResults.errors.length > 10 && (
                          <div className="text-sm text-slate-500 dark:text-slate-400">
                            ? {importResults.errors.length - 10} ?? ??...
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : activeTab === 'export' && canExportProducts(currentUser || null) ? (
            <div className="space-y-6">
              {/* Export Info */}
              <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
                <div className="flex items-start space-x-3 space-x-reverse">
                  <FaDownload className="w-5 h-5 text-green-600 dark:text-green-400 mt-0.5" />
                  <div className="flex-1">
                    <h3 className="font-medium text-green-900 dark:text-green-100">
                      ?? ?? ??
                    </h3>
                    <p className="text-sm text-green-700 dark:text-green-300 mt-1">
                      ?? ?? ? ?? ?? ? ?? ?? Excel ?? ??
                    </p>
                  </div>
                </div>
              </div>

              {/* Export Button */}
              <div className="flex justify-end">
                <button
                  onClick={handleExport}
                  disabled={loading}
                  className="inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-teal-600 hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-teal-500 disabled:opacity-50"
                >
                  {loading ? (
                    <FaSpinner className="w-5 h-5 ml-2 animate-spin" />
                  ) : (
                    <FaDownload className="w-5 h-5 ml-2" />
                  )}
                  ?? ?? ??
                </button>
              </div>
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-slate-500 dark:text-slate-400">
                ?? ??? ?? ?? ?? ??? ? ???
              </p>
            </div>
          )}

          {/* Error Display */}
          {error && (
            <div className="mt-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <div className="flex items-start space-x-3 space-x-reverse">
                <FaExclamationTriangle className="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5" />
                <div>
                  <h4 className="font-medium text-red-900 dark:text-red-100">??</h4>
                  <p className="text-sm text-red-700 dark:text-red-300 mt-1">{error}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end space-x-3 space-x-reverse p-6 border-t border-slate-200 dark:border-slate-700">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-md transition-colors"
          >
            ??
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProductImportExportModal;

