'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { FaSave, FaArrowRight, FaTimes } from 'react-icons/fa';
import { servicesAPI } from '@/lib/api';

const EditCuttingTypePage: React.FC = () => {
  const router = useRouter();
  const params = useParams();
  const cuttingTypeId = params.id as string;
  
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [formData, setFormData] = useState({
    code: '',
    name: '',
    namePersian: '',
    description: '',
    pricePerMeter: '',
    isActive: true
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    loadCuttingType();
  }, [cuttingTypeId]);

  const loadCuttingType = async () => {
    try {
      setInitialLoading(true);
      const response = await servicesAPI.getCuttingType(cuttingTypeId);
      
      if (response.data.success) {
        const cuttingType = response.data.data;
        setFormData({
          code: cuttingType.code,
          name: cuttingType.name || '',
          namePersian: cuttingType.namePersian,
          description: cuttingType.description || '',
          pricePerMeter: cuttingType.pricePerMeter ? cuttingType.pricePerMeter.toString() : '',
          isActive: cuttingType.isActive
        });
      } else {
        setErrors({ general: '?? ? ?? ?? ??' });
      }
    } catch (error) {
      console.error('Error loading cutting type:', error);
      setErrors({ general: '?? ? ?? ?? ??' });
    } finally {
      setInitialLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrors({});

    try {
      const response = await servicesAPI.updateCuttingType(cuttingTypeId, formData);
      
      if (response.data.success) {
        // Redirect back to services page
        router.push('/dashboard/inventory/services');
      } else {
        setErrors({ general: '?? ? ?? ?? ??' });
      }
    } catch (error: any) {
      console.error('Error updating cutting type:', error);
      
      if (error.response?.data?.details) {
        const newErrors: Record<string, string> = {};
        error.response.data.details.forEach((detail: any) => {
          newErrors[detail.path] = detail.msg;
        });
        setErrors(newErrors);
      } else {
        setErrors({ general: '?? ? ?? ?? ??' });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    router.push('/dashboard/inventory/services');
  };

  if (initialLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-slate-800 dark:text-slate-200 mb-2">
                ??? ?? ??
              </h1>
              <p className="text-slate-600 dark:text-slate-400">
                ?? ?? ?? ? ??? ??
              </p>
            </div>
            <button
              onClick={handleCancel}
              className="p-2 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 transition-colors"
            >
              <FaTimes className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Form */}
        <div className="max-w-2xl mx-auto">
          <div className="bg-white/70 dark:bg-slate-800/70 backdrop-blur-sm rounded-xl border border-slate-200/50 dark:border-slate-700/50 shadow-lg p-6">
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Code */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  ? ?? ?? *
                </label>
                <input
                  type="text"
                  value={formData.code}
                  onChange={(e) => setFormData(prev => ({ ...prev, code: e.target.value }))}
                  className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent bg-white dark:bg-slate-800 text-slate-900 dark:text-white ${
                    errors.code ? 'border-red-500' : 'border-slate-300 dark:border-slate-600'
                  }`}
                  placeholder="??: LONG, CROSS"
                />
                {errors.code && (
                  <p className="text-red-500 text-sm mt-1">{errors.code}</p>
                )}
              </div>

              {/* Persian Name */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  ?? ??? *
                </label>
                <input
                  type="text"
                  value={formData.namePersian}
                  onChange={(e) => setFormData(prev => ({ ...prev, namePersian: e.target.value }))}
                  className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent bg-white dark:bg-slate-800 text-slate-900 dark:text-white ${
                    errors.namePersian ? 'border-red-500' : 'border-slate-300 dark:border-slate-600'
                  }`}
                  placeholder="??: ?? ??"
                />
                {errors.namePersian && (
                  <p className="text-red-500 text-sm mt-1">{errors.namePersian}</p>
                )}
              </div>

              {/* English Name */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  ?? ??
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  placeholder="??: Longitudinal Cut"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  ??
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  rows={3}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  placeholder="?? ?? ??..."
                />
              </div>

              {/* Price Per Meter */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  ?? ? ?? ? ?? (???)
                </label>
                <input
                  type="number"
                  value={formData.pricePerMeter}
                  onChange={(e) => setFormData(prev => ({ ...prev, pricePerMeter: e.target.value }))}
                  className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent bg-white dark:bg-slate-800 text-slate-900 dark:text-white ${
                    errors.pricePerMeter ? 'border-red-500' : 'border-slate-300 dark:border-slate-600'
                  }`}
                  placeholder="??: 50000"
                  min={0}
                  step={1000}
                />
                {errors.pricePerMeter && (
                  <p className="text-red-500 text-sm mt-1">{errors.pricePerMeter}</p>
                )}
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  ?? ?? ?? ??? ??? ??? ?? ? ??? ?? ???
                </p>
              </div>

              {/* Status */}
              <div>
                <label className="flex items-center space-x-3 space-x-reverse">
                  <input
                    type="checkbox"
                    checked={formData.isActive}
                    onChange={(e) => setFormData(prev => ({ ...prev, isActive: e.target.checked }))}
                    className="w-4 h-4 text-teal-600 bg-gray-100 border-gray-300 rounded focus:ring-teal-500 dark:focus:ring-teal-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                  />
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    ??
                  </span>
                </label>
              </div>

              {/* General Error */}
              {errors.general && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
                  <p className="text-red-800 dark:text-red-200 text-sm">{errors.general}</p>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center justify-end space-x-4 space-x-reverse pt-6 border-t border-slate-200 dark:border-slate-700">
                <button
                  type="button"
                  onClick={handleCancel}
                  className="px-6 py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                >
                  ???
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-6 py-2 bg-teal-500 hover:bg-teal-600 disabled:bg-teal-300 text-white rounded-lg transition-colors flex items-center space-x-2 space-x-reverse"
                >
                  {loading ? (
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  ) : (
                    <FaSave className="w-4 h-4" />
                  )}
                  <span>{loading ? '? ?? ??...' : '?? ?? ??'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EditCuttingTypePage;

