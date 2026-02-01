'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { FaCog, FaBoxes, FaWarehouse, FaPlus, FaEye, FaEdit, FaTrash, FaToggleOn, FaToggleOff } from 'react-icons/fa';
import { dashboardAPI, inventoryAPI } from '@/lib/api';
import { getInventoryMasterDataPermissions } from '@/lib/permissions';
import SuccessModal from '@/components/SuccessModal';
import ErrorModal from '@/components/ErrorModal';

interface User {
  id: string;
  role: string;
  departmentId?: string;
  permissions?: {
    features: Array<{
      feature: string;
      permissionLevel: string;
      workspace: string;
    }>;
    workspaces: Array<{
      workspace: string;
      permissionLevel: string;
    }>;
  };
}

interface MasterDataItem {
  id: string;
  code: string;
  name?: string;
  namePersian: string;
  description?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  value?: number;
  unit?: string;
}

const MasterDataManagement: React.FC = () => {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [inventoryPermissions, setInventoryPermissions] = useState<any>(null);
  const [activeSection, setActiveSection] = useState<string>('cut-types');
  const [data, setData] = useState<MasterDataItem[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingItem, setEditingItem] = useState<MasterDataItem | null>(null);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  
  // Modal state
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [modalMessage, setModalMessage] = useState('');
  const [modalDetails, setModalDetails] = useState('');
  const [loading, setLoading] = useState(false);

  const [masterDataSections, setMasterDataSections] = useState([
    {
      id: 'cut-types',
      title: 'نوع برش',
      titlePersian: 'نوع برش',
      description: 'مدیریت انواع برش سنگ',
      icon: FaCog,
      apiMethod: inventoryAPI.getCutTypes,
      createMethod: inventoryAPI.createCutType,
      updateMethod: inventoryAPI.updateCutType,
      deleteMethod: inventoryAPI.deleteCutType,
      canView: false,
      canCreate: false,
      canEdit: false,
      canDelete: false,
      fields: [
        { key: 'code', label: 'کد', type: 'text', required: true },
        { key: 'namePersian', label: 'نام فارسی', type: 'text', required: true },
        { key: 'name', label: 'نام انگلیسی', type: 'text', required: false },
        { key: 'description', label: 'توضیحات', type: 'textarea', required: false },
        { key: 'isActive', label: 'وضعیت', type: 'select', required: false, options: [
          { value: true, label: 'فعال' },
          { value: false, label: 'غیرفعال' }
        ]}
      ]
    },
    {
      id: 'stone-materials',
      title: 'جنس سنگ',
      titlePersian: 'جنس سنگ',
      description: 'مدیریت جنس‌های مختلف سنگ',
      icon: FaBoxes,
      apiMethod: inventoryAPI.getStoneMaterials,
      createMethod: inventoryAPI.createStoneMaterial,
      updateMethod: inventoryAPI.updateStoneMaterial,
      deleteMethod: inventoryAPI.deleteStoneMaterial,
      canView: false,
      canCreate: false,
      canEdit: false,
      canDelete: false,
      fields: [
        { key: 'code', label: 'کد', type: 'text', required: true },
        { key: 'namePersian', label: 'نام فارسی', type: 'text', required: true },
        { key: 'name', label: 'نام انگلیسی', type: 'text', required: false },
        { key: 'description', label: 'توضیحات', type: 'textarea', required: false },
        { key: 'isActive', label: 'وضعیت', type: 'select', required: false, options: [
          { value: true, label: 'فعال' },
          { value: false, label: 'غیرفعال' }
        ]}
      ]
    },
    {
      id: 'cut-widths',
      title: 'عرض برش',
      titlePersian: 'عرض برش',
      description: 'مدیریت عرض‌های مختلف برش',
      icon: FaCog,
      apiMethod: inventoryAPI.getCutWidths,
      createMethod: inventoryAPI.createCutWidth,
      updateMethod: inventoryAPI.updateCutWidth,
      deleteMethod: inventoryAPI.deleteCutWidth,
      canView: false,
      canCreate: false,
      canEdit: false,
      canDelete: false,
      fields: [
        { key: 'code', label: 'کد', type: 'text', required: true },
        { key: 'namePersian', label: 'نام فارسی', type: 'text', required: true },
        { key: 'name', label: 'نام انگلیسی', type: 'text', required: false },
        { key: 'value', label: 'مقدار', type: 'number', required: true },
        { key: 'unit', label: 'واحد', type: 'select', required: true, options: ['mm', 'cm', 'm'] },
        { key: 'description', label: 'توضیحات', type: 'textarea', required: false }
      ]
    },
    {
      id: 'thicknesses',
      title: 'ضخامت',
      titlePersian: 'ضخامت',
      description: 'مدیریت ضخامت‌های مختلف',
      icon: FaCog,
      apiMethod: inventoryAPI.getThicknesses,
      createMethod: inventoryAPI.createThickness,
      updateMethod: inventoryAPI.updateThickness,
      deleteMethod: inventoryAPI.deleteThickness,
      canView: false,
      canCreate: false,
      canEdit: false,
      canDelete: false,
      fields: [
        { key: 'code', label: 'کد', type: 'text', required: true },
        { key: 'namePersian', label: 'نام فارسی', type: 'text', required: true },
        { key: 'name', label: 'نام انگلیسی', type: 'text', required: false },
        { key: 'value', label: 'مقدار', type: 'number', required: true },
        { key: 'unit', label: 'واحد', type: 'select', required: true, options: ['mm', 'cm', 'm'] },
        { key: 'description', label: 'توضیحات', type: 'textarea', required: false }
      ]
    },
    {
      id: 'mines',
      title: 'معدن',
      titlePersian: 'معدن',
      description: 'مدیریت معادن مختلف',
      icon: FaWarehouse,
      apiMethod: inventoryAPI.getMines,
      createMethod: inventoryAPI.createMine,
      updateMethod: inventoryAPI.updateMine,
      deleteMethod: inventoryAPI.deleteMine,
      canView: false,
      canCreate: false,
      canEdit: false,
      canDelete: false,
      fields: [
        { key: 'code', label: 'کد', type: 'text', required: true },
        { key: 'namePersian', label: 'نام فارسی', type: 'text', required: true },
        { key: 'name', label: 'نام انگلیسی', type: 'text', required: false },
        { key: 'description', label: 'توضیحات', type: 'textarea', required: false },
        { key: 'isActive', label: 'وضعیت', type: 'select', required: false, options: [
          { value: true, label: 'فعال' },
          { value: false, label: 'غیرفعال' }
        ]}
      ]
    },
    {
      id: 'finish-types',
      title: 'نوع پرداخت',
      titlePersian: 'نوع پرداخت',
      description: 'مدیریت انواع پرداخت',
      icon: FaCog,
      apiMethod: inventoryAPI.getFinishTypes,
      createMethod: inventoryAPI.createFinishType,
      updateMethod: inventoryAPI.updateFinishType,
      deleteMethod: inventoryAPI.deleteFinishType,
      canView: false,
      canCreate: false,
      canEdit: false,
      canDelete: false,
      fields: [
        { key: 'code', label: 'کد', type: 'text', required: true },
        { key: 'namePersian', label: 'نام فارسی', type: 'text', required: true },
        { key: 'name', label: 'نام انگلیسی', type: 'text', required: false },
        { key: 'description', label: 'توضیحات', type: 'textarea', required: false },
        { key: 'isActive', label: 'وضعیت', type: 'select', required: false, options: [
          { value: true, label: 'فعال' },
          { value: false, label: 'غیرفعال' }
        ]}
      ]
    },
    {
      id: 'colors',
      title: 'رنگ/خصوصیات',
      titlePersian: 'رنگ/خصوصیات',
      description: 'مدیریت رنگ‌ها و خصوصیات',
      icon: FaCog,
      apiMethod: inventoryAPI.getColors,
      createMethod: inventoryAPI.createColor,
      updateMethod: inventoryAPI.updateColor,
      deleteMethod: inventoryAPI.deleteColor,
      canView: false,
      canCreate: false,
      canEdit: false,
      canDelete: false,
      fields: [
        { key: 'code', label: 'کد', type: 'text', required: true },
        { key: 'namePersian', label: 'نام فارسی', type: 'text', required: true },
        { key: 'name', label: 'نام انگلیسی', type: 'text', required: false },
        { key: 'description', label: 'توضیحات', type: 'textarea', required: false },
        { key: 'isActive', label: 'وضعیت', type: 'select', required: false, options: [
          { value: true, label: 'فعال' },
          { value: false, label: 'غیرفعال' }
        ]}
      ]
    }
  ]);

  useEffect(() => {
    const loadUserProfile = async () => {
      try {
        const response = await dashboardAPI.getProfile();
        if (response.data.success) {
          setCurrentUser(response.data.data);
          const permissions = getInventoryMasterDataPermissions(response.data.data);
          setInventoryPermissions(permissions);
          
          // Update section permissions
          setMasterDataSections(prevSections => 
            prevSections.map(section => {
              // Convert section ID to camelCase for permission key mapping
              const sectionKey = section.id.replace(/-([a-z])/g, (match, letter) => letter.toUpperCase()) as keyof typeof permissions;
              if (permissions[sectionKey]) {
                const updatedSection = {
                  ...section,
                  canView: permissions[sectionKey].canView,
                  canCreate: permissions[sectionKey].canCreate,
                  canEdit: permissions[sectionKey].canEdit,
                  canDelete: permissions[sectionKey].canDelete
                };
                return updatedSection;
              } else {
                return section;
              }
            })
          );
        }
      } catch (error) {
        console.error('Error loading user profile:', error);
      } finally {
        setInitialLoading(false);
      }
    };

    loadUserProfile();
  }, []);

  useEffect(() => {
    if (activeSection && inventoryPermissions) {
      loadSectionData();
    }
  }, [activeSection, inventoryPermissions]);

  const loadSectionData = async () => {
    const section = masterDataSections.find(s => s.id === activeSection);
    if (!section || !section.canView) return;

    setDataLoading(true);
    try {
      const response = await section.apiMethod({ search: searchTerm });
      if (response.data.success) {
        setData(response.data.data || []);
      }
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setDataLoading(false);
    }
  };

  const handleSectionChange = (sectionId: string) => {
    setActiveSection(sectionId);
    setSearchTerm('');
  };

  const handleCreate = () => {
    setEditingItem(null);
    setFormData({});
    setFormErrors({});
    setShowCreateModal(true);
  };

  const handleEdit = (item: MasterDataItem) => {
    setEditingItem(item);
    setFormData({
      code: item.code,
      namePersian: item.namePersian,
      name: item.name || '',
      description: item.description || '',
      isActive: item.isActive,
      ...(item.value && { value: item.value }),
      ...(item.unit && { unit: item.unit })
    });
    setFormErrors({});
    setShowCreateModal(true);
  };

  const handleDelete = async (item: MasterDataItem) => {
    if (!confirm(`آیا مطمئن هستید که می‌خواهید "${item.namePersian}" را حذف کنید؟`)) {
      return;
    }

    const section = masterDataSections.find(s => s.id === activeSection);
    if (!section || !section.canDelete) return;

    setLoading(true);
    try {
      await section.deleteMethod(item.id);
      setModalMessage(`${item.namePersian} با موفقیت حذف شد`);
      setShowSuccessModal(true);
      loadSectionData(); // Reload data
    } catch (error: any) {
      console.error('Error deleting item:', error);
      setModalMessage('خطا در حذف آیتم');
      setModalDetails(error.response?.data?.error || 'خطای غیرمنتظره رخ داده است');
      setShowErrorModal(true);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleStatus = async (item: MasterDataItem) => {
    const section = masterDataSections.find(s => s.id === activeSection);
    if (!section || !section.canEdit) return;

    setLoading(true);
    try {
      await section.updateMethod(item.id, { isActive: !item.isActive });
      setModalMessage(`وضعیت ${item.namePersian} با موفقیت تغییر کرد`);
      setShowSuccessModal(true);
      loadSectionData(); // Reload data
    } catch (error: any) {
      console.error('Error toggling status:', error);
      setModalMessage('خطا در تغییر وضعیت');
      setModalDetails(error.response?.data?.error || 'خطای غیرمنتظره رخ داده است');
      setShowErrorModal(true);
    } finally {
      setLoading(false);
    }
  };

  const filteredData = data.filter(item =>
    item.namePersian.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (item.name && item.name.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  if (initialLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-600"></div>
      </div>
    );
  }

  const currentSection = masterDataSections.find(s => s.id === activeSection);
  

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-slate-800 dark:text-slate-200 mb-2">
                مدیریت داده‌های پایه
              </h1>
              <p className="text-slate-600 dark:text-slate-400">
                مدیریت انواع برش، جنس سنگ، ابعاد، معادن، نوع پرداخت و رنگ‌ها
              </p>
            </div>
            <button
              onClick={() => router.push('/dashboard/inventory')}
              className="bg-slate-500 hover:bg-slate-600 text-white px-4 py-2 rounded-lg transition-colors duration-200"
            >
              بازگشت
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Sidebar - Section Selection */}
          <div className="lg:col-span-1">
            <div className="bg-white/70 dark:bg-slate-800/70 backdrop-blur-sm rounded-xl p-4 border border-slate-200/50 dark:border-slate-700/50 shadow-lg">
              <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mb-4">
                بخش‌ها
              </h3>
              <div className="space-y-2">
                {masterDataSections.map((section) => {
                  const IconComponent = section.icon;
                  return (
                    <button
                      key={section.id}
                      onClick={() => handleSectionChange(section.id)}
                      className={`w-full text-right p-3 rounded-lg transition-all duration-200 flex items-center space-x-3 space-x-reverse ${
                        activeSection === section.id
                          ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 border border-orange-200 dark:border-orange-700'
                          : section.canView
                          ? 'bg-slate-50 dark:bg-slate-700/50 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-500 cursor-not-allowed'
                      }`}
                      disabled={!section.canView}
                    >
                      <IconComponent className="w-5 h-5" />
                      <div className="flex-1">
                        <div className="font-medium">{section.titlePersian}</div>
                        <div className="text-xs opacity-75">{section.description}</div>
                      </div>
                      {!section.canView && (
                        <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Main Content */}
          <div className="lg:col-span-3">
            {currentSection && currentSection.canView ? (
              <div className="bg-white/70 dark:bg-slate-800/70 backdrop-blur-sm rounded-xl border border-slate-200/50 dark:border-slate-700/50 shadow-lg">
                {/* Section Header */}
                <div className="p-6 border-b border-slate-200/50 dark:border-slate-700/50">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3 space-x-reverse">
                      <div className="p-2 bg-orange-100 dark:bg-orange-900/30 rounded-lg">
                        <currentSection.icon className="w-6 h-6 text-orange-600 dark:text-orange-400" />
                      </div>
                      <div>
                        <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-200">
                          {currentSection.titlePersian}
                        </h2>
                        <p className="text-slate-600 dark:text-slate-400">
                          {currentSection.description}
                        </p>
                      </div>
                    </div>
                    {currentSection.canCreate && (
                      <button
                        onClick={handleCreate}
                        className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg transition-colors duration-200 flex items-center space-x-2 space-x-reverse"
                      >
                        <FaPlus className="w-4 h-4" />
                        <span>افزودن جدید</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Search and Filters */}
                <div className="p-6 border-b border-slate-200/50 dark:border-slate-700/50">
                  <div className="flex items-center space-x-4 space-x-reverse">
                    <div className="flex-1">
                      <input
                        type="text"
                        placeholder="جستجو در کد، نام فارسی یا نام انگلیسی..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                      />
                    </div>
                  </div>
                </div>

                {/* Data Table */}
                <div className="p-6">
                  {dataLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-600"></div>
                    </div>
                  ) : filteredData.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-slate-200 dark:border-slate-700">
                            <th className="text-right py-3 px-4 font-medium text-slate-800 dark:text-slate-200">کد</th>
                            <th className="text-right py-3 px-4 font-medium text-slate-800 dark:text-slate-200">نام فارسی</th>
                            <th className="text-right py-3 px-4 font-medium text-slate-800 dark:text-slate-200">نام انگلیسی</th>
                            {(currentSection.id === 'cut-widths' || currentSection.id === 'thicknesses') && (
                              <>
                                <th className="text-right py-3 px-4 font-medium text-slate-800 dark:text-slate-200">مقدار</th>
                                <th className="text-right py-3 px-4 font-medium text-slate-800 dark:text-slate-200">واحد</th>
                              </>
                            )}
                            <th className="text-right py-3 px-4 font-medium text-slate-800 dark:text-slate-200">وضعیت</th>
                            <th className="text-right py-3 px-4 font-medium text-slate-800 dark:text-slate-200">عملیات</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredData.map((item) => (
                            <tr key={item.id} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/50">
                              <td className="py-3 px-4 text-slate-800 dark:text-slate-200 font-mono">{item.code}</td>
                              <td className="py-3 px-4 text-slate-800 dark:text-slate-200">{item.namePersian}</td>
                              <td className="py-3 px-4 text-slate-600 dark:text-slate-400">{item.name || '-'}</td>
                              {(currentSection.id === 'cut-widths' || currentSection.id === 'thicknesses') && (
                                <>
                                  <td className="py-3 px-4 text-slate-800 dark:text-slate-200">{item.value}</td>
                                  <td className="py-3 px-4 text-slate-600 dark:text-slate-400">{item.unit}</td>
                                </>
                              )}
                              <td className="py-3 px-4">
                                <div className="flex items-center space-x-2 space-x-reverse">
                                  <span className={`px-2 py-1 rounded-full text-xs ${
                                    item.isActive
                                      ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                                      : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                                  }`}>
                                    {item.isActive ? 'فعال' : 'غیرفعال'}
                                  </span>
                                  {currentSection.canEdit && (
                                    <button
                                      onClick={() => handleToggleStatus(item)}
                                      className={`p-1 transition-colors ${
                                        item.isActive
                                          ? 'text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300'
                                          : 'text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300'
                                      }`}
                                      title={item.isActive ? 'غیرفعال کردن' : 'فعال کردن'}
                                      disabled={loading}
                                    >
                                      {item.isActive ? (
                                        <FaToggleOn className="w-4 h-4" />
                                      ) : (
                                        <FaToggleOff className="w-4 h-4" />
                                      )}
                                    </button>
                                  )}
                                </div>
                              </td>
                              <td className="py-3 px-4">
                                <div className="flex items-center space-x-2 space-x-reverse">
                                  {currentSection.canEdit && (
                                    <button
                                      onClick={() => handleEdit(item)}
                                      className="p-1.5 text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400 transition-colors"
                                      title="ویرایش"
                                    >
                                      <FaEdit className="w-4 h-4" />
                                    </button>
                                  )}
                                  {currentSection.canDelete && (
                                    <button
                                      onClick={() => handleDelete(item)}
                                      className="p-1.5 text-slate-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400 transition-colors"
                                      title="حذف"
                                    >
                                      <FaTrash className="w-4 h-4" />
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <div className="text-slate-500 dark:text-slate-400 mb-2">
                        {searchTerm ? 'هیچ آیتمی یافت نشد' : 'هیچ داده‌ای موجود نیست'}
                      </div>
                      {currentSection.canCreate && !searchTerm && (
                        <button
                          onClick={handleCreate}
                          className="text-orange-600 dark:text-orange-400 hover:text-orange-700 dark:hover:text-orange-300 font-medium"
                        >
                          اولین آیتم را ایجاد کنید
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="bg-white/70 dark:bg-slate-800/70 backdrop-blur-sm rounded-xl p-8 border border-slate-200/50 dark:border-slate-700/50 shadow-lg text-center">
                <div className="text-slate-500 dark:text-slate-400 mb-4">
                  دسترسی محدود
                </div>
                <p className="text-slate-600 dark:text-slate-400">
                  شما دسترسی لازم برای مشاهده این بخش را ندارید.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Create/Edit Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="p-6">
              <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mb-2">
                {editingItem ? 'ویرایش' : 'افزودن'} {currentSection?.titlePersian}
              </h3>
              <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
                {editingItem ? 'اطلاعات را ویرایش کنید' : 'اطلاعات جدید را وارد کنید'}
              </p>
              
              <div className="space-y-4">
                {currentSection?.fields.map((field) => (
                  <div key={field.key}>
                    <label htmlFor={field.key} className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                      {field.label}
                      {field.required && <span className="text-red-500 mr-1">*</span>}
                    </label>
                    {field.type === 'textarea' ? (
                      <textarea
                        id={field.key}
                        value={formData[field.key] || ''}
                        onChange={(e) => setFormData({ ...formData, [field.key]: e.target.value })}
                        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                        placeholder={`${field.label} را وارد کنید`}
                        rows={3}
                      />
                    ) : field.type === 'select' ? (
                      <select
                        id={field.key}
                        value={formData[field.key] !== undefined ? formData[field.key] : ''}
                        onChange={(e) => {
                          const value = field.key === 'isActive' ? e.target.value === 'true' : e.target.value;
                          setFormData({ ...formData, [field.key]: value });
                        }}
                        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                      >
                        <option value="">انتخاب کنید</option>
                        {field.options?.map((option) => (
                          <option key={typeof option === 'string' ? option : String(option.value)} value={typeof option === 'string' ? option : String(option.value)}>
                            {typeof option === 'string' ? option : option.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        id={field.key}
                        type={field.type}
                        value={formData[field.key] || ''}
                        onChange={(e) => setFormData({ ...formData, [field.key]: e.target.value })}
                        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                        placeholder={`${field.label} را وارد کنید`}
                      />
                    )}
                    {formErrors[field.key] && (
                      <p className="text-sm text-red-500 mt-1">{formErrors[field.key]}</p>
                    )}
                  </div>
                ))}
              </div>
              
              <div className="flex justify-end space-x-3 space-x-reverse mt-6">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateModal(false);
                    setFormData({});
                    setFormErrors({});
                    setEditingItem(null);
                  }}
                  className="px-4 py-2 text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                >
                  انصراف
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    // Validate form
                    const errors: Record<string, string> = {};
                    currentSection?.fields.forEach((field) => {
                      if (field.required && !formData[field.key]) {
                        errors[field.key] = `${field.label} الزامی است`;
                      }
                    });

                    if (Object.keys(errors).length > 0) {
                      setFormErrors(errors);
                      return;
                    }

                    setLoading(true);
                    try {
                      if (editingItem) {
                        // Update existing item
                        await currentSection?.updateMethod(editingItem.id, formData);
                        setModalMessage(`${editingItem.namePersian} با موفقیت به‌روزرسانی شد`);
                      } else {
                        // Create new item
                        await currentSection?.createMethod(formData);
                        setModalMessage('آیتم جدید با موفقیت ایجاد شد');
                      }
                      
                      setShowSuccessModal(true);
                      
                      // Reload data
                      loadSectionData();
                      
                      // Close modal and reset form
                      setShowCreateModal(false);
                      setFormData({});
                      setFormErrors({});
                      setEditingItem(null);
                    } catch (error: any) {
                      console.error('Error saving item:', error);
                      setModalMessage('خطا در ذخیره اطلاعات');
                      setModalDetails(error.response?.data?.error || 'خطای غیرمنتظره رخ داده است');
                      setShowErrorModal(true);
                    } finally {
                      setLoading(false);
                    }
                  }}
                  className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition-colors"
                >
                  {editingItem ? 'ذخیره تغییرات' : 'افزودن'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Success Modal */}
      <SuccessModal
        isOpen={showSuccessModal}
        onClose={() => setShowSuccessModal(false)}
        title="عملیات موفق"
        message={modalMessage}
        buttonText="باشه"
        autoClose={true}
        autoCloseDelay={2000}
      />

      {/* Error Modal */}
      <ErrorModal
        isOpen={showErrorModal}
        onClose={() => setShowErrorModal(false)}
        title="خطا"
        message={modalMessage}
        details={modalDetails}
        buttonText="باشه"
      />
    </div>
  );
};

export default MasterDataManagement;
