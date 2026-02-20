'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { FaSave, FaTimes, FaTrash } from 'react-icons/fa';
import { servicesAPI } from '@/lib/api';

const EditStoneFinishingPage: React.FC = () => {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const finishingId = params?.id;

  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [formData, setFormData] = useState({
    namePersian: '',
    name: '',
    description: '',
    pricePerSquareMeter: '',
    isActive: true
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const loadFinishing = async () => {
      if (!finishingId) return;
      try {
        const response = await servicesAPI.getStoneFinishing(finishingId);
        if (response.data.success) {
          const data = response.data.data;
          setFormData({
            namePersian: data.namePersian || '',
            name: data.name || '',
            description: data.description || '',
            pricePerSquareMeter: data.pricePerSquareMeter?.toString() || '',
            isActive: data.isActive
          });
        } else {
          setErrors({ general: '??? ?? ?? ?? ??' });
        }
      } catch (error) {
        console.error('Error loading stone finishing:', error);
        setErrors({ general: '?? ? ??? ???' });
      } finally {
        setInitialLoading(false);
      }
    };

    loadFinishing();
  }, [finishingId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!finishingId) return;
    setLoading(true);
    setErrors({});

    try {
      const response = await servicesAPI.updateStoneFinishing(finishingId, {
        ...formData,
        pricePerSquareMeter: parseFloat(formData.pricePerSquareMeter || '0')
      });

      if (response.data.success) {
        router.push('/dashboard/inventory/services');
      } else {
        setErrors({ general: '?? ? ??? ???' });
      }
    } catch (error: any) {
      console.error('Error updating stone finishing:', error);
      if (error.response?.data?.details) {
        const newErrors: Record<string, string> = {};
        error.response.data.details.forEach((detail: any) => {
          const key = Array.isArray(detail.path) ? detail.path.join('.') : detail.path;
          newErrors[key] = detail.msg;
        });
        setErrors(newErrors);
      } else {
        setErrors({ general: '?? ? ??? ???' });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!finishingId) return;
    if (!confirm('?? ? ?? ?? ??? ?? ???')) return;
    try {
      await servicesAPI.deleteStoneFinishing(finishingId);
      router.push('/dashboard/inventory/services');
    } catch (error) {
      console.error('Error deleting stone finishing:', error);
      setErrors({ general: '?? ? ?? ???' });
    }
  };

  const handleCancel = () => {
    router.push('/dashboard/inventory/services');
  };

  if (initialLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-slate-800 dark:text-slate-200 mb-2">
                ??? ???
              </h1>
              <p className="text-slate-600 dark:text-slate-400">
                ??? ??? ?? ? ??? ??
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

        <div className="max-w-2xl mx-auto">
          <div className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm rounded-xl border border-slate-200/60 dark:border-slate-700/60 shadow-lg p-6">
            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  ?? ??? ??? *
                </label>
                <input
                  type="text"
                  value={formData.namePersian}
                  onChange={(e) => setFormData(prev => ({ ...prev, namePersian: e.target.value }))}
                  className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent bg-white dark:bg-slate-800 text-slate-900 dark:text-white ${
                    errors.namePersian ? 'border-red-500' : 'border-slate-300 dark:border-slate-600'
                  }`}
                  placeholder="??: ?? ???"
                />
                {errors.namePersian && (
                  <p className="text-red-500 text-sm mt-1">{errors.namePersian}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  ?? ??
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  placeholder="??: Final Polish"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  ??
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  rows={3}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  placeholder="?? ??? ??? ???..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  ?? ? ?? ?? (???) *
                </label>
                <input
                  type="number"
                  min="0"
                  step="1000"
                  value={formData.pricePerSquareMeter}
                  onChange={(e) => setFormData(prev => ({ ...prev, pricePerSquareMeter: e.target.value }))}
                  className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent bg-white dark:bg-slate-800 text-slate-900 dark:text-white ${
                    errors.pricePerSquareMeter ? 'border-red-500' : 'border-slate-300 dark:border-slate-600'
                  }`}
                  placeholder="??: 150000"
                />
                {errors.pricePerSquareMeter && (
                  <p className="text-red-500 text-sm mt-1">{errors.pricePerSquareMeter}</p>
                )}
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  ?? ?? ? ?? ??? ?? ?? ? ?? ??? ? ??? ???.
                </p>
              </div>

              <div>
                <label className="flex items-center space-x-3 space-x-reverse">
                  <input
                    type="checkbox"
                    checked={formData.isActive}
                    onChange={(e) => setFormData(prev => ({ ...prev, isActive: e.target.checked }))}
                    className="w-4 h-4 text-teal-600 bg-gray-100 border-gray-300 rounded focus:ring-teal-500 dark:focus:ring-teal-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                  />
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    ?? ?? ?? ? ???
                  </span>
                </label>
              </div>

              {errors.general && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
                  <p className="text-red-800 dark:text-red-200 text-sm">{errors.general}</p>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 pt-6 border-t border-slate-200 dark:border-slate-700">
                <button
                  type="button"
                  onClick={handleDelete}
                  className="px-4 py-2 flex items-center gap-2 text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 transition-colors"
                >
                  <FaTrash className="w-4 h-4" />
                  <span>?? ???</span>
                </button>
                <div className="flex items-center gap-3">
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
                    <span>{loading ? '? ?? ???...' : '??? ??'}</span>
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EditStoneFinishingPage;


