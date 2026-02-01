'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { FaPlus, FaEdit, FaTrash, FaToggleOn, FaToggleOff, FaTools, FaCut, FaLayerGroup, FaRuler, FaShapes, FaPaintBrush } from 'react-icons/fa';
import { servicesAPI } from '@/lib/api';

interface Service {
  id: string;
  code: string;
  name?: string;
  namePersian: string;
  description?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface CuttingType {
  id: string;
  code: string;
  name?: string;
  namePersian: string;
  description?: string;
  pricePerMeter?: number | null; // قیمت به ازای هر متر (تومان)
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface SubService {
  id: string;
  code: string;
  name?: string;
  namePersian: string;
  description?: string;
  pricePerMeter: number; // هزینه هر متر ابزار (تومان)
  calculationBase: 'length' | 'squareMeters'; // بر اساس طول یا متر مربع
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface StairStandardLength {
  id: string;
  label?: string;
  value: number;
  unit: 'm' | 'cm';
  description?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface LayerType {
  id: string;
  name: string;
  description?: string;
  pricePerLayer: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface StoneFinishing {
  id: string;
  name?: string;
  namePersian: string;
  description?: string;
  pricePerSquareMeter: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

const ServicesPage: React.FC = () => {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'services' | 'cutting-types' | 'sub-services' | 'stair-lengths' | 'layer-types' | 'stone-finishings'>('services');
  const [services, setServices] = useState<Service[]>([]);
  const [cuttingTypes, setCuttingTypes] = useState<CuttingType[]>([]);
  const [subServices, setSubServices] = useState<SubService[]>([]);
  const [stairLengths, setStairLengths] = useState<StairStandardLength[]>([]);
  const [layerTypes, setLayerTypes] = useState<LayerType[]>([]);
  const [stoneFinishings, setStoneFinishings] = useState<StoneFinishing[]>([]);
  const [stairLengthForm, setStairLengthForm] = useState<{
    id?: string;
    label: string;
    value: string;
    unit: 'm' | 'cm';
    description: string;
  }>({
    label: '',
    value: '',
    unit: 'm',
    description: ''
  });
  const [editingStairLengthId, setEditingStairLengthId] = useState<string | null>(null);
  const [savingStairLength, setSavingStairLength] = useState(false);
  const [layerTypeForm, setLayerTypeForm] = useState<{
    id?: string;
    name: string;
    pricePerLayer: string;
    description: string;
  }>({
    name: '',
    pricePerLayer: '',
    description: ''
  });
  const [editingLayerTypeId, setEditingLayerTypeId] = useState<string | null>(null);
  const [savingLayerType, setSavingLayerType] = useState(false);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [
        servicesResponse,
        cuttingTypesResponse,
        subServicesResponse,
        stairLengthsResponse,
        layerTypesResponse,
        finishingResponse
      ] = await Promise.all([
        servicesAPI.getServices(),
        servicesAPI.getCuttingTypes(),
        servicesAPI.getSubServices(),
        servicesAPI.getStairStandardLengths(),
        servicesAPI.getLayerTypes(),
        servicesAPI.getStoneFinishings()
      ]);

      if (servicesResponse.data.success) {
        setServices(servicesResponse.data.data);
      }

      if (cuttingTypesResponse.data.success) {
        setCuttingTypes(cuttingTypesResponse.data.data);
      }

      if (subServicesResponse.data.success) {
        setSubServices(subServicesResponse.data.data);
      }

      if (stairLengthsResponse.data.success) {
        setStairLengths(stairLengthsResponse.data.data);
      }

      if (layerTypesResponse.data.success) {
        setLayerTypes(layerTypesResponse.data.data);
      }

      if (finishingResponse.data.success) {
        setStoneFinishings(finishingResponse.data.data);
      }
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleStatus = async (type: 'service' | 'cutting-type' | 'sub-service' | 'stair-length' | 'layer-type' | 'stone-finishing', id: string) => {
    try {
      const response = type === 'service' 
        ? await servicesAPI.toggleServiceStatus(id)
        : type === 'cutting-type'
        ? await servicesAPI.toggleCuttingTypeStatus(id)
        : type === 'sub-service'
        ? await servicesAPI.toggleSubServiceStatus(id)
        : type === 'stair-length'
        ? await servicesAPI.toggleStairStandardLengthStatus(id)
        : type === 'layer-type'
        ? await servicesAPI.toggleLayerTypeStatus(id)
        : await servicesAPI.toggleStoneFinishingStatus(id);
      
      if (response.data.success) {
        if (type === 'service') {
          setServices(prev => prev.map(item => 
            item.id === id ? { ...item, isActive: !item.isActive } : item
          ));
        } else if (type === 'cutting-type') {
          setCuttingTypes(prev => prev.map(item => 
            item.id === id ? { ...item, isActive: !item.isActive } : item
          ));
        } else if (type === 'sub-service') {
          setSubServices(prev => prev.map(item => 
            item.id === id ? { ...item, isActive: !item.isActive } : item
          ));
        } else if (type === 'stair-length') {
          setStairLengths(prev => prev.map(item => 
            item.id === id ? { ...item, isActive: !item.isActive } : item
          ));
        } else if (type === 'layer-type') {
          setLayerTypes(prev => prev.map(item => 
            item.id === id ? { ...item, isActive: !item.isActive } : item
          ));
        } else {
          setStoneFinishings(prev => prev.map(item =>
            item.id === id ? { ...item, isActive: !item.isActive } : item
          ));
        }
      }
    } catch (error) {
      console.error('Error toggling status:', error);
    }
  };

  const handleDelete = async (type: 'service' | 'cutting-type' | 'sub-service' | 'stair-length' | 'layer-type' | 'stone-finishing', id: string) => {
    if (!confirm('آیا مطمئن هستید که می‌خواهید این مورد را حذف کنید؟')) {
      return;
    }

    try {
      const response = type === 'service' 
        ? await servicesAPI.deleteService(id)
        : type === 'cutting-type'
        ? await servicesAPI.deleteCuttingType(id)
        : type === 'sub-service'
        ? await servicesAPI.deleteSubService(id)
        : type === 'stair-length'
        ? await servicesAPI.deleteStairStandardLength(id)
        : type === 'layer-type'
        ? await servicesAPI.deleteLayerType(id)
        : await servicesAPI.deleteStoneFinishing(id);
      
      if (response.data.success) {
        if (type === 'service') {
          setServices(prev => prev.filter(item => item.id !== id));
        } else if (type === 'cutting-type') {
          setCuttingTypes(prev => prev.filter(item => item.id !== id));
        } else if (type === 'sub-service') {
          setSubServices(prev => prev.filter(item => item.id !== id));
        } else if (type === 'stair-length') {
          setStairLengths(prev => prev.filter(item => item.id !== id));
        } else if (type === 'layer-type') {
          setLayerTypes(prev => prev.filter(item => item.id !== id));
        } else {
          setStoneFinishings(prev => prev.filter(item => item.id !== id));
        }
      }
    } catch (error) {
      console.error('Error deleting item:', error);
    }
  };

  const resetStairLengthForm = () => {
    setEditingStairLengthId(null);
    setStairLengthForm({
      label: '',
      value: '',
      unit: 'm',
      description: ''
    });
  };

  const handleEditStairLength = (item: StairStandardLength) => {
    setEditingStairLengthId(item.id);
    setStairLengthForm({
      id: item.id,
      label: item.label || '',
      value: item.value?.toString() || '',
      unit: item.unit,
      description: item.description || ''
    });
  };

  const handleSaveStairLength = async () => {
    if (!stairLengthForm.value?.trim()) {
      alert('لطفاً مقدار طول را وارد کنید');
      return;
    }
    const numericValue = parseFloat(stairLengthForm.value);
    if (isNaN(numericValue) || numericValue <= 0) {
      alert('مقدار طول باید عددی بزرگتر از صفر باشد');
      return;
    }

    try {
      setSavingStairLength(true);
      const payload = {
        label: stairLengthForm.label?.trim() || null,
        value: numericValue,
        unit: stairLengthForm.unit,
        description: stairLengthForm.description?.trim() || ''
      };
      if (editingStairLengthId) {
        await servicesAPI.updateStairStandardLength(editingStairLengthId, payload);
      } else {
        await servicesAPI.createStairStandardLength(payload);
      }
      await loadData();
      resetStairLengthForm();
    } catch (error) {
      console.error('Error saving stair standard length:', error);
      alert('خطا در ذخیره طول استاندارد پله');
    } finally {
      setSavingStairLength(false);
    }
  };

  const resetLayerTypeForm = () => {
    setEditingLayerTypeId(null);
    setLayerTypeForm({
      name: '',
      pricePerLayer: '',
      description: ''
    });
  };

  const handleEditLayerType = (item: LayerType) => {
    setEditingLayerTypeId(item.id);
    setLayerTypeForm({
      id: item.id,
      name: item.name,
      pricePerLayer: item.pricePerLayer?.toString() || '',
      description: item.description || ''
    });
  };

  const handleSaveLayerType = async () => {
    if (!layerTypeForm.name.trim()) {
      alert('لطفاً نام نوع لایه را وارد کنید');
      return;
    }
    if (!layerTypeForm.pricePerLayer.trim()) {
      alert('لطفاً قیمت نوع لایه را وارد کنید');
      return;
    }
    const numericValue = parseFloat(layerTypeForm.pricePerLayer);
    if (isNaN(numericValue) || numericValue <= 0) {
      alert('قیمت باید عددی بزرگتر از صفر باشد');
      return;
    }

    try {
      setSavingLayerType(true);
      const payload = {
        name: layerTypeForm.name.trim(),
        pricePerLayer: numericValue,
        description: layerTypeForm.description?.trim() || ''
      };

      if (editingLayerTypeId) {
        await servicesAPI.updateLayerType(editingLayerTypeId, payload);
      } else {
        await servicesAPI.createLayerType(payload);
      }

      await loadData();
      resetLayerTypeForm();
    } catch (error) {
      console.error('Error saving layer type:', error);
      alert('خطا در ذخیره نوع لایه');
    } finally {
      setSavingLayerType(false);
    }
  };

  const filteredServices = services.filter(service =>
    service.namePersian.toLowerCase().includes(searchTerm.toLowerCase()) ||
    service.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (service.description && service.description.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const filteredCuttingTypes = cuttingTypes.filter(cuttingType =>
    cuttingType.namePersian.toLowerCase().includes(searchTerm.toLowerCase()) ||
    cuttingType.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (cuttingType.description && cuttingType.description.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const filteredSubServices = subServices.filter(subService =>
    subService.namePersian.toLowerCase().includes(searchTerm.toLowerCase()) ||
    subService.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (subService.description && subService.description.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const filteredLayerTypes = layerTypes.filter(layerType =>
    layerType.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (layerType.description && layerType.description.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const filteredStoneFinishings = stoneFinishings.filter(finishing =>
    finishing.namePersian.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (finishing.name && finishing.name.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (finishing.description && finishing.description.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const tabLabels: Record<typeof activeTab, string> = {
    services: 'خدمات',
    'cutting-types': 'انواع برش',
    'sub-services': 'ابزارها',
    'stair-lengths': 'طول‌های استاندارد پله',
    'layer-types': 'نوع لایه',
    'stone-finishings': 'پرداخت‌ها'
  };

  const searchPlaceholder = `جستجو در ${tabLabels[activeTab]}...`;

  if (loading) {
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
          <h1 className="text-3xl font-bold text-slate-800 dark:text-slate-200 mb-2">
            مدیریت خدمات
          </h1>
          <p className="text-slate-600 dark:text-slate-400">
            مدیریت خدمات برش و انواع برش ارائه شده به مشتریان
          </p>
        </div>

        {/* Tabs */}
        <div className="mb-6">
          <div className="flex space-x-1 space-x-reverse bg-slate-200 dark:bg-slate-700 rounded-lg p-1">
            <button
              onClick={() => setActiveTab('services')}
              className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'services'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              <div className="flex items-center justify-center space-x-2 space-x-reverse">
                <FaTools className="w-4 h-4" />
                <span>خدمات</span>
              </div>
            </button>
            <button
              onClick={() => setActiveTab('cutting-types')}
              className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'cutting-types'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              <div className="flex items-center justify-center space-x-2 space-x-reverse">
                <FaCut className="w-4 h-4" />
                <span>انواع برش</span>
              </div>
            </button>
            <button
              onClick={() => setActiveTab('sub-services')}
              className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'sub-services'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              <div className="flex items-center justify-center space-x-2 space-x-reverse">
                <FaLayerGroup className="w-4 h-4" />
                <span>ابزارها</span>
              </div>
            </button>
            <button
              onClick={() => setActiveTab('stair-lengths')}
              className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'stair-lengths'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              <div className="flex items-center justify-center space-x-2 space-x-reverse">
                <FaRuler className="w-4 h-4" />
                <span>طول‌های استاندارد پله</span>
              </div>
            </button>
            <button
              onClick={() => setActiveTab('layer-types')}
              className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'layer-types'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              <div className="flex items-center justify-center space-x-2 space-x-reverse">
                <FaShapes className="w-4 h-4" />
                <span>نوع لایه</span>
              </div>
            </button>
            <button
              onClick={() => setActiveTab('stone-finishings')}
              className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'stone-finishings'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              <div className="flex items-center justify-center space-x-2 space-x-reverse">
                <FaPaintBrush className="w-4 h-4" />
                <span>پرداخت‌ها</span>
              </div>
            </button>
          </div>
        </div>

        {/* Search and Actions */}
        <div className="mb-6 flex flex-col sm:flex-row gap-4">
          <div className="flex-1">
            <input
              type="text"
              placeholder={searchPlaceholder}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
            />
          </div>
          {activeTab !== 'stair-lengths' && activeTab !== 'layer-types' && (
            <button
              onClick={() => router.push(`/dashboard/inventory/services/${activeTab}/create`)}
              className="px-6 py-2 bg-teal-500 hover:bg-teal-600 text-white rounded-lg transition-colors flex items-center space-x-2 space-x-reverse"
            >
              <FaPlus className="w-4 h-4" />
              <span>
                افزودن {activeTab === 'services'
                  ? 'خدمت'
                  : activeTab === 'cutting-types'
                  ? 'نوع برش'
                  : activeTab === 'sub-services'
                  ? 'ابزار'
                  : 'پرداخت'}
              </span>
            </button>
          )}
        </div>

        {/* Content */}
        <div className="bg-white/70 dark:bg-slate-800/70 backdrop-blur-sm rounded-xl border border-slate-200/50 dark:border-slate-700/50 shadow-lg">
          {activeTab === 'services' ? (
            <div className="p-6">
              <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-200 mb-4">
                لیست خدمات
              </h2>
              
              {filteredServices.length === 0 ? (
                <div className="text-center py-8">
                  <FaTools className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                  <p className="text-slate-500 dark:text-slate-400">
                    {searchTerm ? 'خدمتی یافت نشد' : 'هنوز خدمتی تعریف نشده است'}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-700">
                        <th className="text-right py-3 px-4 text-slate-600 dark:text-slate-400">کد</th>
                        <th className="text-right py-3 px-4 text-slate-600 dark:text-slate-400">نام فارسی</th>
                        <th className="text-right py-3 px-4 text-slate-600 dark:text-slate-400">نام انگلیسی</th>
                        <th className="text-right py-3 px-4 text-slate-600 dark:text-slate-400">توضیحات</th>
                        <th className="text-right py-3 px-4 text-slate-600 dark:text-slate-400">وضعیت</th>
                        <th className="text-right py-3 px-4 text-slate-600 dark:text-slate-400">عملیات</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredServices.map((service) => (
                        <tr key={service.id} className="border-b border-slate-100 dark:border-slate-700">
                          <td className="py-3 px-4 text-slate-900 dark:text-slate-100 font-mono text-sm">
                            {service.code}
                          </td>
                          <td className="py-3 px-4 text-slate-900 dark:text-slate-100">
                            {service.namePersian}
                          </td>
                          <td className="py-3 px-4 text-slate-600 dark:text-slate-400">
                            {service.name || '-'}
                          </td>
                          <td className="py-3 px-4 text-slate-600 dark:text-slate-400">
                            {service.description || '-'}
                          </td>
                          <td className="py-3 px-4">
                            <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                              service.isActive
                                ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400'
                                : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400'
                            }`}>
                              {service.isActive ? 'فعال' : 'غیرفعال'}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center space-x-2 space-x-reverse">
                              <button
                                onClick={() => handleToggleStatus('service', service.id)}
                                className="p-2 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
                                title={service.isActive ? 'غیرفعال کردن' : 'فعال کردن'}
                              >
                                {service.isActive ? (
                                  <FaToggleOn className="w-4 h-4 text-green-500" />
                                ) : (
                                  <FaToggleOff className="w-4 h-4 text-red-500" />
                                )}
                              </button>
                              <button
                                onClick={() => router.push(`/dashboard/inventory/services/services/edit/${service.id}`)}
                                className="p-2 text-slate-600 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                                title="ویرایش"
                              >
                                <FaEdit className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleDelete('service', service.id)}
                                className="p-2 text-slate-600 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                                title="حذف"
                              >
                                <FaTrash className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : activeTab === 'cutting-types' ? (
            <div className="p-6">
              <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-200 mb-4">
                لیست انواع برش
              </h2>
              
              {filteredCuttingTypes.length === 0 ? (
                <div className="text-center py-8">
                  <FaCut className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                  <p className="text-slate-500 dark:text-slate-400">
                    {searchTerm ? 'نوع برشی یافت نشد' : 'هنوز نوع برشی تعریف نشده است'}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-700">
                        <th className="text-right py-3 px-4 text-slate-600 dark:text-slate-400">کد</th>
                        <th className="text-right py-3 px-4 text-slate-600 dark:text-slate-400">نام فارسی</th>
                        <th className="text-right py-3 px-4 text-slate-600 dark:text-slate-400">نام انگلیسی</th>
                        <th className="text-right py-3 px-4 text-slate-600 dark:text-slate-400">توضیحات</th>
                        <th className="text-right py-3 px-4 text-slate-600 dark:text-slate-400">وضعیت</th>
                        <th className="text-right py-3 px-4 text-slate-600 dark:text-slate-400">عملیات</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCuttingTypes.map((cuttingType) => (
                        <tr key={cuttingType.id} className="border-b border-slate-100 dark:border-slate-700">
                          <td className="py-3 px-4 text-slate-900 dark:text-slate-100 font-mono text-sm">
                            {cuttingType.code}
                          </td>
                          <td className="py-3 px-4 text-slate-900 dark:text-slate-100">
                            {cuttingType.namePersian}
                          </td>
                          <td className="py-3 px-4 text-slate-600 dark:text-slate-400">
                            {cuttingType.name || '-'}
                          </td>
                          <td className="py-3 px-4 text-slate-600 dark:text-slate-400">
                            {cuttingType.description || '-'}
                          </td>
                          <td className="py-3 px-4 text-slate-900 dark:text-slate-100">
                            {cuttingType.pricePerMeter 
                              ? `${cuttingType.pricePerMeter.toLocaleString('fa-IR')} تومان`
                              : '-'}
                          </td>
                          <td className="py-3 px-4">
                            <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                              cuttingType.isActive
                                ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400'
                                : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400'
                            }`}>
                              {cuttingType.isActive ? 'فعال' : 'غیرفعال'}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center space-x-2 space-x-reverse">
                              <button
                                onClick={() => handleToggleStatus('cutting-type', cuttingType.id)}
                                className="p-2 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
                                title={cuttingType.isActive ? 'غیرفعال کردن' : 'فعال کردن'}
                              >
                                {cuttingType.isActive ? (
                                  <FaToggleOn className="w-4 h-4 text-green-500" />
                                ) : (
                                  <FaToggleOff className="w-4 h-4 text-red-500" />
                                )}
                              </button>
                              <button
                                onClick={() => router.push(`/dashboard/inventory/services/cutting-types/edit/${cuttingType.id}`)}
                                className="p-2 text-slate-600 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                                title="ویرایش"
                              >
                                <FaEdit className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleDelete('cutting-type', cuttingType.id)}
                                className="p-2 text-slate-600 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                                title="حذف"
                              >
                                <FaTrash className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : activeTab === 'sub-services' ? (
            <div className="p-6">
              <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-200 mb-4">
                لیست ابزارها
              </h2>
              
              {filteredSubServices.length === 0 ? (
                <div className="text-center py-8">
                  <FaLayerGroup className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                  <p className="text-slate-500 dark:text-slate-400">
                    {searchTerm ? 'ابزاری یافت نشد' : 'هنوز ابزاری تعریف نشده است'}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-700">
                        <th className="text-right py-3 px-4 text-slate-600 dark:text-slate-400">کد</th>
                        <th className="text-right py-3 px-4 text-slate-600 dark:text-slate-400">نام فارسی</th>
                        <th className="text-right py-3 px-4 text-slate-600 dark:text-slate-400">نام انگلیسی</th>
                        <th className="text-right py-3 px-4 text-slate-600 dark:text-slate-400">توضیحات</th>
                        <th className="text-right py-3 px-4 text-slate-600 dark:text-slate-400">هزینه/متر</th>
                        <th className="text-right py-3 px-4 text-slate-600 dark:text-slate-400">مبنای محاسبه</th>
                        <th className="text-right py-3 px-4 text-slate-600 dark:text-slate-400">وضعیت</th>
                        <th className="text-right py-3 px-4 text-slate-600 dark:text-slate-400">عملیات</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredSubServices.map((subService) => (
                        <tr key={subService.id} className="border-b border-slate-100 dark:border-slate-700">
                          <td className="py-3 px-4 text-slate-900 dark:text-slate-100 font-mono text-sm">
                            {subService.code}
                          </td>
                          <td className="py-3 px-4 text-slate-900 dark:text-slate-100">
                            {subService.namePersian}
                          </td>
                          <td className="py-3 px-4 text-slate-600 dark:text-slate-400">
                            {subService.name || '-'}
                          </td>
                          <td className="py-3 px-4 text-slate-600 dark:text-slate-400">
                            {subService.description || '-'}
                          </td>
                          <td className="py-3 px-4 text-slate-900 dark:text-slate-100">
                            {subService.pricePerMeter.toLocaleString('fa-IR')} تومان
                          </td>
                          <td className="py-3 px-4 text-slate-600 dark:text-slate-400">
                            {subService.calculationBase === 'length' ? 'طول' : 'متر مربع'}
                          </td>
                          <td className="py-3 px-4">
                            <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                              subService.isActive
                                ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400'
                                : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400'
                            }`}>
                              {subService.isActive ? 'فعال' : 'غیرفعال'}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center space-x-2 space-x-reverse">
                              <button
                                onClick={() => handleToggleStatus('sub-service', subService.id)}
                                className="p-2 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
                                title={subService.isActive ? 'غیرفعال کردن' : 'فعال کردن'}
                              >
                                {subService.isActive ? (
                                  <FaToggleOn className="w-4 h-4 text-green-500" />
                                ) : (
                                  <FaToggleOff className="w-4 h-4 text-red-500" />
                                )}
                              </button>
                              <button
                                onClick={() => router.push(`/dashboard/inventory/services/sub-services/edit/${subService.id}`)}
                                className="p-2 text-slate-600 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                                title="ویرایش"
                              >
                                <FaEdit className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleDelete('sub-service', subService.id)}
                                className="p-2 text-slate-600 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                                title="حذف"
                              >
                                <FaTrash className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : activeTab === 'stair-lengths' ? (
            <div className="p-6">
              <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-200 mb-4">
                طول‌های استاندارد پله
              </h2>
              <div className="bg-slate-50 dark:bg-slate-900/30 border border-slate-200 dark:border-slate-700 rounded-xl p-4 mb-6">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                      عنوان (اختیاری)
                    </label>
                    <input
                      type="text"
                      value={stairLengthForm.label}
                      onChange={(e) => setStairLengthForm(prev => ({ ...prev, label: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                      placeholder="مثال: طول استاندارد ۱.۲۰"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                      مقدار طول
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={stairLengthForm.value}
                      onChange={(e) => setStairLengthForm(prev => ({ ...prev, value: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                      placeholder="مثال: 1.20"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                      واحد
                    </label>
                    <select
                      value={stairLengthForm.unit}
                      onChange={(e) => setStairLengthForm(prev => ({ ...prev, unit: e.target.value as 'm' | 'cm' }))}
                      className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                    >
                      <option value="m">متر</option>
                      <option value="cm">سانتی‌متر</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                      توضیحات
                    </label>
                    <input
                      type="text"
                      value={stairLengthForm.description}
                      onChange={(e) => setStairLengthForm(prev => ({ ...prev, description: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                      placeholder="مثال: طول استاندارد محبوب برای پله"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3 mt-4">
                  <button
                    onClick={handleSaveStairLength}
                    disabled={savingStairLength}
                    className="px-6 py-2 bg-teal-500 hover:bg-teal-600 disabled:bg-teal-400 text-white rounded-lg transition-colors"
                  >
                    {savingStairLength ? 'در حال ذخیره...' : editingStairLengthId ? 'به‌روزرسانی طول استاندارد' : 'افزودن طول استاندارد'}
                  </button>
                  {editingStairLengthId && (
                    <button
                      onClick={resetStairLengthForm}
                      className="px-4 py-2 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors"
                    >
                      انصراف از ویرایش
                    </button>
                  )}
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    این طول‌ها برای قیمت‌گذاری پله در قرارداد استفاده می‌شوند.
                  </p>
                </div>
              </div>
              {stairLengths.length === 0 ? (
                <div className="text-center py-8">
                  <FaRuler className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                  <p className="text-slate-500 dark:text-slate-400">
                    {savingStairLength ? 'در حال ذخیره...' : 'طول استانداردی ثبت نشده است'}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-700">
                        <th className="text-right py-3 px-4 text-slate-600 dark:text-slate-400">عنوان</th>
                        <th className="text-right py-3 px-4 text-slate-600 dark:text-slate-400">مقدار</th>
                        <th className="text-right py-3 px-4 text-slate-600 dark:text-slate-400">توضیحات</th>
                        <th className="text-right py-3 px-4 text-slate-600 dark:text-slate-400">وضعیت</th>
                        <th className="text-right py-3 px-4 text-slate-600 dark:text-slate-400">عملیات</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stairLengths.map((length) => (
                        <tr key={length.id} className="border-b border-slate-100 dark:border-slate-700">
                          <td className="py-3 px-4 text-slate-900 dark:text-slate-100">
                            {length.label || '-'}
                          </td>
                          <td className="py-3 px-4 text-slate-900 dark:text-slate-100 font-mono">
                            {length.value.toLocaleString('fa-IR', { maximumFractionDigits: 2 })} {length.unit === 'm' ? 'متر' : 'سانتی‌متر'}
                          </td>
                          <td className="py-3 px-4 text-slate-600 dark:text-slate-400">
                            {length.description || '-'}
                          </td>
                          <td className="py-3 px-4">
                            <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                              length.isActive
                                ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400'
                                : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400'
                            }`}>
                              {length.isActive ? 'فعال' : 'غیرفعال'}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center space-x-2 space-x-reverse">
                              <button
                                onClick={() => handleToggleStatus('stair-length', length.id)}
                                className="p-2 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
                                title={length.isActive ? 'غیرفعال کردن' : 'فعال کردن'}
                              >
                                {length.isActive ? (
                                  <FaToggleOn className="w-4 h-4 text-green-500" />
                                ) : (
                                  <FaToggleOff className="w-4 h-4 text-red-500" />
                                )}
                              </button>
                              <button
                                onClick={() => handleEditStairLength(length)}
                                className="p-2 text-slate-600 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                                title="ویرایش"
                              >
                                <FaEdit className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleDelete('stair-length', length.id)}
                                className="p-2 text-slate-600 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                                title="حذف"
                              >
                                <FaTrash className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : activeTab === 'layer-types' ? (
            <div className="p-6">
              <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-200 mb-4">
                نوع لایه
              </h2>
              <div className="bg-slate-50 dark:bg-slate-900/30 border border-slate-200 dark:border-slate-700 rounded-xl p-4 mb-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                      نام نوع لایه
                    </label>
                    <input
                      type="text"
                      value={layerTypeForm.name}
                      onChange={(e) => setLayerTypeForm(prev => ({ ...prev, name: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                      placeholder="مثال: ابزار دوبل"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                      قیمت هر لایه (تومان)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="1000"
                      value={layerTypeForm.pricePerLayer}
                      onChange={(e) => setLayerTypeForm(prev => ({ ...prev, pricePerLayer: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                      placeholder="مثال: 50000"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                      توضیحات
                    </label>
                    <input
                      type="text"
                      value={layerTypeForm.description}
                      onChange={(e) => setLayerTypeForm(prev => ({ ...prev, description: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                      placeholder="مثال: هزینه اضافی برای لایه خاص"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3 mt-4">
                  <button
                    onClick={handleSaveLayerType}
                    disabled={savingLayerType}
                    className="px-6 py-2 bg-teal-500 hover:bg-teal-600 disabled:bg-teal-400 text-white rounded-lg transition-colors"
                  >
                    {savingLayerType ? 'در حال ذخیره...' : editingLayerTypeId ? 'به‌روزرسانی نوع لایه' : 'افزودن نوع لایه'}
                  </button>
                  {editingLayerTypeId && (
                    <button
                      onClick={resetLayerTypeForm}
                      className="px-4 py-2 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors"
                    >
                      انصراف از ویرایش
                    </button>
                  )}
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    این هزینه به ازای هر لایه به صورت خودکار در قرارداد‌ها اعمال می‌شود.
                  </p>
                </div>
              </div>
              {filteredLayerTypes.length === 0 ? (
                <div className="text-center py-8">
                  <FaShapes className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                  <p className="text-slate-500 dark:text-slate-400">
                    {savingLayerType ? 'در حال ذخیره...' : 'نوع لایه‌ای ثبت نشده است'}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-700">
                        <th className="text-right py-3 px-4 text-slate-600 dark:text-slate-400">نام</th>
                        <th className="text-right py-3 px-4 text-slate-600 dark:text-slate-400">قیمت هر لایه</th>
                        <th className="text-right py-3 px-4 text-slate-600 dark:text-slate-400">توضیحات</th>
                        <th className="text-right py-3 px-4 text-slate-600 dark:text-slate-400">وضعیت</th>
                        <th className="text-right py-3 px-4 text-slate-600 dark:text-slate-400">عملیات</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredLayerTypes.map((layerType) => (
                        <tr key={layerType.id} className="border-b border-slate-100 dark:border-slate-700">
                          <td className="py-3 px-4 text-slate-900 dark:text-slate-100">
                            {layerType.name}
                          </td>
                          <td className="py-3 px-4 text-slate-900 dark:text-slate-100 font-mono">
                            {layerType.pricePerLayer.toLocaleString('fa-IR')} تومان
                          </td>
                          <td className="py-3 px-4 text-slate-600 dark:text-slate-400">
                            {layerType.description || '-'}
                          </td>
                          <td className="py-3 px-4">
                            <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                              layerType.isActive
                                ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400'
                                : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400'
                            }`}>
                              {layerType.isActive ? 'فعال' : 'غیرفعال'}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center space-x-2 space-x-reverse">
                              <button
                                onClick={() => handleToggleStatus('layer-type', layerType.id)}
                                className="p-2 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
                                title={layerType.isActive ? 'غیرفعال کردن' : 'فعال کردن'}
                              >
                                {layerType.isActive ? (
                                  <FaToggleOn className="w-4 h-4 text-green-500" />
                                ) : (
                                  <FaToggleOff className="w-4 h-4 text-red-500" />
                                )}
                              </button>
                              <button
                                onClick={() => handleEditLayerType(layerType)}
                                className="p-2 text-slate-600 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                                title="ویرایش"
                              >
                                <FaEdit className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleDelete('layer-type', layerType.id)}
                                className="p-2 text-slate-600 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                                title="حذف"
                              >
                                <FaTrash className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : (
            <div className="p-6">
              <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-200 mb-4">
                پرداخت‌ها (Stone Finishing)
              </h2>
              {filteredStoneFinishings.length === 0 ? (
                <div className="text-center py-8">
                  <FaPaintBrush className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                  <p className="text-slate-500 dark:text-slate-400">
                    {searchTerm ? 'پرداختی یافت نشد' : 'هنوز پرداختی ثبت نشده است'}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-700">
                        <th className="text-right py-3 px-4 text-slate-600 dark:text-slate-400">نام فارسی</th>
                        <th className="text-right py-3 px-4 text-slate-600 dark:text-slate-400">نام انگلیسی</th>
                        <th className="text-right py-3 px-4 text-slate-600 dark:text-slate-400">قیمت هر متر مربع</th>
                        <th className="text-right py-3 px-4 text-slate-600 dark:text-slate-400">توضیحات</th>
                        <th className="text-right py-3 px-4 text-slate-600 dark:text-slate-400">وضعیت</th>
                        <th className="text-right py-3 px-4 text-slate-600 dark:text-slate-400">عملیات</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredStoneFinishings.map((finishing) => (
                        <tr key={finishing.id} className="border-b border-slate-100 dark:border-slate-700">
                          <td className="py-3 px-4 text-slate-900 dark:text-slate-100">
                            {finishing.namePersian}
                          </td>
                          <td className="py-3 px-4 text-slate-600 dark:text-slate-400">
                            {finishing.name || '-'}
                          </td>
                          <td className="py-3 px-4 text-slate-900 dark:text-slate-100 font-mono">
                            {finishing.pricePerSquareMeter.toLocaleString('fa-IR')} تومان
                          </td>
                          <td className="py-3 px-4 text-slate-600 dark:text-slate-400">
                            {finishing.description || '-'}
                          </td>
                          <td className="py-3 px-4">
                            <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                              finishing.isActive
                                ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400'
                                : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400'
                            }`}>
                              {finishing.isActive ? 'فعال' : 'غیرفعال'}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center space-x-2 space-x-reverse">
                              <button
                                onClick={() => handleToggleStatus('stone-finishing', finishing.id)}
                                className="p-2 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
                                title={finishing.isActive ? 'غیرفعال کردن' : 'فعال کردن'}
                              >
                                {finishing.isActive ? (
                                  <FaToggleOn className="w-4 h-4 text-green-500" />
                                ) : (
                                  <FaToggleOff className="w-4 h-4 text-red-500" />
                                )}
                              </button>
                              <button
                                onClick={() => router.push(`/dashboard/inventory/services/stone-finishings/edit/${finishing.id}`)}
                                className="p-2 text-slate-600 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                                title="ویرایش"
                              >
                                <FaEdit className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleDelete('stone-finishing', finishing.id)}
                                className="p-2 text-slate-600 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                                title="حذف"
                              >
                                <FaTrash className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ServicesPage;
