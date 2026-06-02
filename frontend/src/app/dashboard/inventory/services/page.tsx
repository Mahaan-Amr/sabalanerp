'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { FaPlus, FaEdit, FaTrash, FaToggleOn, FaToggleOff, FaTools, FaCut, FaLayerGroup, FaRuler, FaShapes, FaPaintBrush } from 'react-icons/fa';
import { servicesAPI } from '@/lib/api';
import { ErpButton, ErpLoading, ErpPage, ErpQuickFilters, ErpSection } from '@/components/erp';

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
  pricePerMeter: number; // هزینه هر متر ساب (تومان)
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

type ActiveTab = 'services' | 'cutting-types' | 'sub-services' | 'stair-lengths' | 'layer-types' | 'stone-finishings';

const ServicesPage: React.FC = () => {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<ActiveTab>('services');
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
    if (!confirm('آیا از حذف این مورد اطمینان دارید؟')) {
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
      alert('مقدار استاندارد را وارد کنید');
      return;
    }
    const numericValue = parseFloat(stairLengthForm.value);
    if (isNaN(numericValue) || numericValue <= 0) {
      alert('مقدار باید عددی مثبت باشد');
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
      alert('خطا در ذخیره طول استاندارد');
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
      alert('نام نوع لایه را وارد کنید');
      return;
    }
    if (!layerTypeForm.pricePerLayer.trim()) {
      alert('قیمت هر لایه را وارد کنید');
      return;
    }
    const numericValue = parseFloat(layerTypeForm.pricePerLayer);
    if (isNaN(numericValue) || numericValue <= 0) {
      alert('قیمت باید عددی مثبت باشد');
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

  const tabLabels: Record<ActiveTab, string> = {
    services: 'خدمات',
    'cutting-types': 'انواع ابزار',
    'sub-services': 'ساب‌ها',
    'stair-lengths': 'طول استاندارد پله',
    'layer-types': 'نوع لایه',
    'stone-finishings': 'فرآوری سنگ'
  };
  const tabOptions = [
    { id: 'services', label: 'خدمات', value: 'services', count: services.length, tone: 'primary' as const },
    { id: 'cutting-types', label: 'انواع ابزار', value: 'cutting-types', count: cuttingTypes.length, tone: 'info' as const },
    { id: 'sub-services', label: 'ساب‌ها', value: 'sub-services', count: subServices.length, tone: 'success' as const },
    { id: 'stair-lengths', label: 'طول پله', value: 'stair-lengths', count: stairLengths.length, tone: 'warning' as const },
    { id: 'layer-types', label: 'نوع لایه', value: 'layer-types', count: layerTypes.length, tone: 'purple' as const },
    { id: 'stone-finishings', label: 'فرآوری سنگ', value: 'stone-finishings', count: stoneFinishings.length, tone: 'neutral' as const },
  ];

  const searchPlaceholder = `جستجو در ${tabLabels[activeTab]}...`;

  if (loading) {
    return <ErpLoading />;
  }

  return (
    <ErpPage
      eyebrow="انبار"
      title="مدیریت خدمات"
      description="مدیریت خدمات، ابزار، ساب، طول پله، نوع لایه و فرآوری سنگ برای محاسبات قرارداد."
      backHref="/dashboard/inventory"
      metrics={[
        { label: 'خدمات', value: services.length.toLocaleString('fa-IR'), icon: FaTools, tone: 'primary' },
        { label: 'انواع ابزار', value: cuttingTypes.length.toLocaleString('fa-IR'), icon: FaCut, tone: 'info' },
        { label: 'ساب‌ها', value: subServices.length.toLocaleString('fa-IR'), icon: FaLayerGroup, tone: 'success' },
        { label: 'فرآوری سنگ', value: stoneFinishings.length.toLocaleString('fa-IR'), icon: FaPaintBrush, tone: 'neutral' },
      ]}
    >
      <ErpSection title="بخش خدمات" description="یک بخش را انتخاب کنید و فهرست همان بخش را مدیریت کنید.">
        <ErpQuickFilters value={activeTab} onChange={(value) => setActiveTab(value as ActiveTab)} items={tabOptions} />
      </ErpSection>

      <ErpSection title={`فیلتر ${tabLabels[activeTab]}`} description="جستجو و ایجاد رکورد جدید برای بخش انتخاب‌شده.">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="min-w-0 flex-1">
            <input
              type="text"
              placeholder={searchPlaceholder}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="min-h-12 w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[#074747] focus:bg-white focus:ring-2 focus:ring-[#074747]/15 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder-slate-400 dark:focus:border-teal-500 dark:focus:bg-slate-900"
            />
          </div>
          {activeTab !== 'stair-lengths' && activeTab !== 'layer-types' && (
            <ErpButton
              label={`افزودن ${
                activeTab === 'services'
                  ? 'خدمت'
                  : activeTab === 'cutting-types'
                  ? 'نوع ابزار'
                  : activeTab === 'sub-services'
                  ? 'ساب'
                  : 'فرآوری'
              }`}
              onClick={() => router.push(`/dashboard/inventory/services/${activeTab}/create`)}
              icon={FaPlus}
              variant="solid"
            />
          )}
        </div>
      </ErpSection>

      <ErpSection title={tabLabels[activeTab]}>
          {activeTab === 'services' ? (
            <div className="p-6">
              <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-200 mb-4">
                فهرست خدمات
              </h2>
              
              {filteredServices.length === 0 ? (
                <div className="text-center py-8">
                  <FaTools className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                  <p className="text-slate-500 dark:text-slate-400">
                    {searchTerm ? 'نتیجه‌ای یافت نشد' : 'هنوز خدمتی ثبت نشده است'}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-700">
                        <th className="text-right py-3 px-4 text-slate-600 dark:text-slate-400">کد خدمت</th>
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
                فهرست انواع ابزار
              </h2>
              
              {filteredCuttingTypes.length === 0 ? (
                <div className="text-center py-8">
                  <FaCut className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                  <p className="text-slate-500 dark:text-slate-400">
                    {searchTerm ? 'نتیجه‌ای یافت نشد' : 'هنوز نوع ابزاری ثبت نشده است'}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-700">
                        <th className="text-right py-3 px-4 text-slate-600 dark:text-slate-400">کد ابزار</th>
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
                فهرست ساب‌ها
              </h2>
              
              {filteredSubServices.length === 0 ? (
                <div className="text-center py-8">
                  <FaLayerGroup className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                  <p className="text-slate-500 dark:text-slate-400">
                    {searchTerm ? 'نتیجه‌ای یافت نشد' : 'هنوز سابی ثبت نشده است'}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-700">
                        <th className="text-right py-3 px-4 text-slate-600 dark:text-slate-400">کد ساب</th>
                    <th className="text-right py-3 px-4 text-slate-600 dark:text-slate-400">نام فارسی</th>
                    <th className="text-right py-3 px-4 text-slate-600 dark:text-slate-400">نام انگلیسی</th>
                    <th className="text-right py-3 px-4 text-slate-600 dark:text-slate-400">توضیحات</th>
                    <th className="text-right py-3 px-4 text-slate-600 dark:text-slate-400">قیمت/متر</th>
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
                طول استاندارد پله
              </h2>
              <div className="mb-6 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/30">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                      برچسب (اختیاری)
                    </label>
                    <input
                      type="text"
                      value={stairLengthForm.label}
                      onChange={(e) => setStairLengthForm(prev => ({ ...prev, label: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                      placeholder="مثال: کف پله ۱.۲۰"
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
                      placeholder="مثال: طول رایج برای کف پله"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3 mt-4">
                  <button
                    onClick={handleSaveStairLength}
                    disabled={savingStairLength}
                    className="rounded-lg bg-[#074747] px-6 py-2 text-white transition-colors hover:bg-[#0b5c5c] disabled:bg-[#074747]/60"
                  >
                    {savingStairLength ? 'در حال ذخیره...' : editingStairLengthId ? 'به‌روزرسانی طول' : 'افزودن طول'}
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
                    طول استاندارد برای محاسبات پله و قرارداد استفاده می‌شود.
                  </p>
                </div>
              </div>
              {stairLengths.length === 0 ? (
                <div className="text-center py-8">
                  <FaRuler className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                  <p className="text-slate-500 dark:text-slate-400">
                    {savingStairLength ? 'در حال ذخیره...' : 'طولی ثبت نشده است'}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-700">
                        <th className="text-right py-3 px-4 text-slate-600 dark:text-slate-400">برچسب</th>
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
              <div className="mb-6 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/30">
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
                      placeholder="مثال: لایه دوبل"
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
                      placeholder="مثال: هزینه اضافه برای هر لایه"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3 mt-4">
                  <button
                    onClick={handleSaveLayerType}
                    disabled={savingLayerType}
                    className="rounded-lg bg-[#074747] px-6 py-2 text-white transition-colors hover:bg-[#0b5c5c] disabled:bg-[#074747]/60"
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
                    نوع لایه برای محاسبه هزینه لایه‌های اضافه استفاده می‌شود.
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
                فرآوری سنگ
              </h2>
              {filteredStoneFinishings.length === 0 ? (
                <div className="text-center py-8">
                  <FaPaintBrush className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                  <p className="text-slate-500 dark:text-slate-400">
                    {searchTerm ? 'نتیجه‌ای یافت نشد' : 'فرآوری سنگی ثبت نشده است'}
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
      </ErpSection>
    </ErpPage>
  );
};

export default ServicesPage;

