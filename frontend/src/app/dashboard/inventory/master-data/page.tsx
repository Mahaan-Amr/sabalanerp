'use client';

import React, { useEffect, useState } from 'react';
import { FaBoxes, FaCog, FaEdit, FaEye, FaPlus, FaToggleOff, FaToggleOn, FaTrash, FaWarehouse } from 'react-icons/fa';
import { ErpBadge, ErpButton, ErpEmptyState, ErpIconButton, ErpListPage, ErpLoading, ErpQuickFilters } from '@/components/erp';
import { dashboardAPI, inventoryAPI } from '@/lib/api';
import { getInventoryMasterDataPermissions } from '@/lib/permissions';
import SuccessModal from '@/components/SuccessModal';
import ErrorModal from '@/components/ErrorModal';

interface User {
  id: string;
  role: string;
  departmentId?: string;
  permissions?: {
    features: Array<{ feature: string; permissionLevel: string; workspace: string }>;
    workspaces: Array<{ workspace: string; permissionLevel: string }>;
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

type FieldConfig = {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'number';
  required?: boolean;
  options?: Array<string | { value: boolean | string; label: string }>;
};

type MasterDataSection = {
  id: string;
  title: string;
  titlePersian: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  apiMethod: (params?: any) => Promise<any>;
  createMethod: (data: any) => Promise<any>;
  updateMethod: (id: string, data: any) => Promise<any>;
  deleteMethod: (id: string) => Promise<any>;
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  fields: FieldConfig[];
};

const baseFields: FieldConfig[] = [
  { key: 'code', label: 'کد', type: 'text', required: true },
  { key: 'namePersian', label: 'نام فارسی', type: 'text', required: true },
  { key: 'name', label: 'نام انگلیسی', type: 'text' },
  { key: 'description', label: 'توضیحات', type: 'textarea' },
  {
    key: 'isActive',
    label: 'وضعیت',
    type: 'select',
    options: [
      { value: true, label: 'فعال' },
      { value: false, label: 'غیرفعال' },
    ],
  },
];

const measurableFields: FieldConfig[] = [
  { key: 'code', label: 'کد', type: 'text', required: true },
  { key: 'namePersian', label: 'نام فارسی', type: 'text', required: true },
  { key: 'name', label: 'نام انگلیسی', type: 'text' },
  { key: 'value', label: 'مقدار', type: 'number', required: true },
  { key: 'unit', label: 'واحد', type: 'select', required: true, options: ['mm', 'cm', 'm'] },
  { key: 'description', label: 'توضیحات', type: 'textarea' },
];

const createSections = (): MasterDataSection[] => [
  { id: 'cut-types', title: 'Cut Types', titlePersian: 'نوع برش', description: 'مدیریت انواع برش سنگ', icon: FaCog, apiMethod: inventoryAPI.getCutTypes, createMethod: inventoryAPI.createCutType, updateMethod: inventoryAPI.updateCutType, deleteMethod: inventoryAPI.deleteCutType, canView: false, canCreate: false, canEdit: false, canDelete: false, fields: baseFields },
  { id: 'stone-materials', title: 'Stone Materials', titlePersian: 'جنس سنگ', description: 'مدیریت جنس و متریال سنگ', icon: FaBoxes, apiMethod: inventoryAPI.getStoneMaterials, createMethod: inventoryAPI.createStoneMaterial, updateMethod: inventoryAPI.updateStoneMaterial, deleteMethod: inventoryAPI.deleteStoneMaterial, canView: false, canCreate: false, canEdit: false, canDelete: false, fields: baseFields },
  { id: 'cut-widths', title: 'Cut Widths', titlePersian: 'عرض برش', description: 'مدیریت عرض های قابل استفاده در برش', icon: FaCog, apiMethod: inventoryAPI.getCutWidths, createMethod: inventoryAPI.createCutWidth, updateMethod: inventoryAPI.updateCutWidth, deleteMethod: inventoryAPI.deleteCutWidth, canView: false, canCreate: false, canEdit: false, canDelete: false, fields: measurableFields },
  { id: 'thicknesses', title: 'Thicknesses', titlePersian: 'ضخامت', description: 'مدیریت ضخامت های سنگ', icon: FaCog, apiMethod: inventoryAPI.getThicknesses, createMethod: inventoryAPI.createThickness, updateMethod: inventoryAPI.updateThickness, deleteMethod: inventoryAPI.deleteThickness, canView: false, canCreate: false, canEdit: false, canDelete: false, fields: measurableFields },
  { id: 'mines', title: 'Mines', titlePersian: 'معادن', description: 'مدیریت معادن و منابع سنگ', icon: FaWarehouse, apiMethod: inventoryAPI.getMines, createMethod: inventoryAPI.createMine, updateMethod: inventoryAPI.updateMine, deleteMethod: inventoryAPI.deleteMine, canView: false, canCreate: false, canEdit: false, canDelete: false, fields: baseFields },
  { id: 'finish-types', title: 'Finish Types', titlePersian: 'نوع فرآوری', description: 'مدیریت انواع فرآوری و پرداخت سنگ', icon: FaCog, apiMethod: inventoryAPI.getFinishTypes, createMethod: inventoryAPI.createFinishType, updateMethod: inventoryAPI.updateFinishType, deleteMethod: inventoryAPI.deleteFinishType, canView: false, canCreate: false, canEdit: false, canDelete: false, fields: baseFields },
  { id: 'colors', title: 'Colors', titlePersian: 'رنگ/طرح', description: 'مدیریت رنگ ها و طرح های سنگ', icon: FaCog, apiMethod: inventoryAPI.getColors, createMethod: inventoryAPI.createColor, updateMethod: inventoryAPI.updateColor, deleteMethod: inventoryAPI.deleteColor, canView: false, canCreate: false, canEdit: false, canDelete: false, fields: baseFields },
];

const inputClass = 'min-h-11 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-[#074747] focus:bg-white focus:ring-2 focus:ring-[#074747]/15 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:border-teal-500 dark:focus:bg-slate-900';

const MasterDataManagement: React.FC = () => {
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
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [modalMessage, setModalMessage] = useState('');
  const [modalDetails, setModalDetails] = useState('');
  const [loading, setLoading] = useState(false);
  const [masterDataSections, setMasterDataSections] = useState<MasterDataSection[]>(createSections);

  useEffect(() => {
    const loadUserProfile = async () => {
      try {
        const response = await dashboardAPI.getProfile();
        if (response.data.success) {
          const user = response.data.data as User;
          const permissions = getInventoryMasterDataPermissions(user);
          setInventoryPermissions(permissions);
          setMasterDataSections((prevSections) =>
            prevSections.map((section) => {
              const sectionKey = section.id.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase()) as keyof typeof permissions;
              if (!permissions[sectionKey]) return section;
              return {
                ...section,
                canView: permissions[sectionKey].canView,
                canCreate: permissions[sectionKey].canCreate,
                canEdit: permissions[sectionKey].canEdit,
                canDelete: permissions[sectionKey].canDelete,
              };
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

  const currentSection = masterDataSections.find((section) => section.id === activeSection);

  const loadSectionData = async () => {
    const section = masterDataSections.find((item) => item.id === activeSection);
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
      ...(item.unit && { unit: item.unit }),
    });
    setFormErrors({});
    setShowCreateModal(true);
  };

  const handleDelete = async (item: MasterDataItem) => {
    if (!confirm(`آیا از حذف "${item.namePersian}" مطمئن هستید؟`)) return;
    const section = masterDataSections.find((item) => item.id === activeSection);
    if (!section || !section.canDelete) return;

    setLoading(true);
    try {
      await section.deleteMethod(item.id);
      setModalMessage(`وضعیت ${item.namePersian} با موفقیت تغییر کرد.`);
      setShowSuccessModal(true);
      loadSectionData();
    } catch (error: any) {
      console.error('Error deleting item:', error);
      setModalMessage('عملیات با خطا مواجه شد.');
      setModalDetails(error.response?.data?.error || 'لطفا دوباره تلاش کنید.');
      setShowErrorModal(true);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleStatus = async (item: MasterDataItem) => {
    const section = masterDataSections.find((item) => item.id === activeSection);
    if (!section || !section.canEdit) return;

    setLoading(true);
    try {
      await section.updateMethod(item.id, { isActive: !item.isActive });
      setModalMessage(`وضعیت ${item.namePersian} با موفقیت تغییر کرد.`);
      setShowSuccessModal(true);
      loadSectionData();
    } catch (error: any) {
      console.error('Error toggling status:', error);
      setModalMessage('عملیات با خطا مواجه شد.');
      setModalDetails(error.response?.data?.error || 'لطفا دوباره تلاش کنید.');
      setShowErrorModal(true);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
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
        await currentSection?.updateMethod(editingItem.id, formData);
        setModalMessage(`${editingItem.namePersian} با موفقیت به روزرسانی شد.`);
      } else {
        await currentSection?.createMethod(formData);
        setModalMessage('مورد جدید با موفقیت ایجاد شد.');
      }

      setShowSuccessModal(true);
      loadSectionData();
      setShowCreateModal(false);
      setFormData({});
      setFormErrors({});
      setEditingItem(null);
    } catch (error: any) {
      console.error('Error saving item:', error);
      setModalMessage('عملیات با خطا مواجه شد.');
      setModalDetails(error.response?.data?.error || 'لطفا دوباره تلاش کنید.');
      setShowErrorModal(true);
    } finally {
      setLoading(false);
    }
  };

  const filteredData = data.filter((item) => {
    const query = searchTerm.toLowerCase();
    return item.namePersian.toLowerCase().includes(query) || item.code.toLowerCase().includes(query) || (item.name && item.name.toLowerCase().includes(query));
  });

  if (initialLoading) {
    return <ErpLoading />;
  }

  return (
    <>
      <ErpListPage
        eyebrow="انبار"
        title="مدیریت اطلاعات پایه"
        description="مدیریت داده های پایه انبار، سنگ، برش و فرآوری با دسترسی های کنترل شده."
        backHref="/dashboard/inventory"
        actions={currentSection?.canCreate ? [{ label: 'ایجاد مورد جدید', onClick: handleCreate, icon: FaPlus, tone: 'primary', variant: 'solid' }] : []}
        metrics={[
          { label: 'بخش ها', value: masterDataSections.length.toLocaleString('fa-IR'), icon: FaCog, tone: 'primary' },
          { label: 'دارای دسترسی', value: masterDataSections.filter((section) => section.canView).length.toLocaleString('fa-IR'), icon: FaEye, tone: 'success' },
          { label: 'رکوردهای بخش', value: data.length.toLocaleString('fa-IR'), icon: FaBoxes, tone: 'info' },
          { label: 'نتیجه جستجو', value: filteredData.length.toLocaleString('fa-IR'), icon: FaWarehouse, tone: 'neutral' },
        ]}
        filters={[
          { id: 'search', label: 'جستجو', type: 'search', value: searchTerm, placeholder: 'جستجو بر اساس کد، نام فارسی یا نام انگلیسی...', onChange: setSearchTerm },
        ]}
        rows={currentSection?.canView ? filteredData : []}
        rowKey={(item) => item.id}
        isLoading={dataLoading}
        columns={[
          {
            id: 'name',
            header: 'عنوان',
            priority: 'primary',
            cell: (item) => (
              <div>
                <p className="font-semibold text-slate-900 dark:text-white">{item.namePersian}</p>
                <p className="mt-1 font-mono text-xs text-slate-500 dark:text-slate-400">{item.code}</p>
              </div>
            ),
          },
          { id: 'englishName', header: 'نام انگلیسی', mobileLabel: 'نام انگلیسی', cell: (item) => item.name || '-' },
          {
            id: 'measure',
            header: 'مقدار',
            mobileLabel: 'مقدار',
            cell: (item) => item.value ? `${item.value.toLocaleString('fa-IR')} ${item.unit || ''}` : '-',
          },
          {
            id: 'status',
            header: 'وضعیت',
            mobileLabel: 'وضعیت',
            cell: (item) => (
              <div className="flex items-center gap-2">
                <ErpBadge tone={item.isActive ? 'success' : 'danger'}>{item.isActive ? 'فعال' : 'غیرفعال'}</ErpBadge>
                {currentSection?.canEdit && (
                  <ErpIconButton
                    label={item.isActive ? 'غیرفعال کردن' : 'فعال کردن'}
                    onClick={() => handleToggleStatus(item)}
                    icon={item.isActive ? FaToggleOn : FaToggleOff}
                    tone={item.isActive ? 'success' : 'danger'}
                    disabled={loading}
                  />
                )}
              </div>
            ),
          },
        ]}
        rowActions={(item) => [
          ...(currentSection?.canEdit ? [{ label: 'ویرایش', onClick: () => handleEdit(item), icon: FaEdit, tone: 'info' as const }] : []),
          ...(currentSection?.canDelete ? [{ label: 'حذف', onClick: () => handleDelete(item), icon: FaTrash, tone: 'danger' as const }] : []),
        ]}
        emptyState={
          currentSection?.canView ? (
            <ErpEmptyState
              title={searchTerm ? 'موردی مطابق جستجو پیدا نشد' : 'هنوز موردی ثبت نشده است'}
              description={searchTerm ? 'عبارت جستجو را تغییر دهید.' : 'برای شروع، یک مورد جدید ایجاد کنید.'}
              icon={FaBoxes}
              action={currentSection?.canCreate && !searchTerm ? { label: 'ایجاد مورد جدید', onClick: handleCreate, icon: FaPlus, tone: 'primary', variant: 'solid' } : undefined}
            />
          ) : (
            <ErpEmptyState title="دسترسی به این بخش ندارید" description="برای مشاهده یا مدیریت این اطلاعات با مدیر سیستم تماس بگیرید." icon={FaWarehouse} />
          )
        }
      >
        <ErpQuickFilters
          value={activeSection}
          onChange={handleSectionChange}
          items={masterDataSections.map((section) => ({
            id: section.id,
            label: section.titlePersian,
            value: section.id,
            count: section.canView ? 1 : 0,
            tone: section.canView ? 'primary' : 'neutral',
          }))}
        />
      </ErpListPage>

      {showCreateModal && currentSection && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
              {editingItem ? 'ویرایش' : 'ایجاد'} {currentSection.titlePersian}
            </h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              اطلاعات مورد را وارد کنید و سپس ذخیره کنید.
            </p>

            <div className="mt-5 space-y-4">
              {currentSection.fields.map((field) => (
                <div key={field.key}>
                  <label htmlFor={field.key} className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                    {field.label}
                    {field.required && <span className="mr-1 text-red-500">*</span>}
                  </label>
                  {field.type === 'textarea' ? (
                    <textarea
                      id={field.key}
                      value={formData[field.key] || ''}
                      onChange={(event) => setFormData({ ...formData, [field.key]: event.target.value })}
                      className={inputClass}
                      placeholder={`${field.label} را وارد کنید`}
                      rows={3}
                    />
                  ) : field.type === 'select' ? (
                    <select
                      id={field.key}
                      value={formData[field.key] !== undefined ? String(formData[field.key]) : ''}
                      onChange={(event) => {
                        const value = field.key === 'isActive' ? event.target.value === 'true' : event.target.value;
                        setFormData({ ...formData, [field.key]: value });
                      }}
                      className={inputClass}
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
                      onChange={(event) => setFormData({ ...formData, [field.key]: event.target.value })}
                      className={inputClass}
                      placeholder={`${field.label} را وارد کنید`}
                    />
                  )}
                  {formErrors[field.key] && <p className="mt-1 text-sm text-red-500">{formErrors[field.key]}</p>}
                </div>
              ))}
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <ErpButton label="بازگشت" onClick={() => { setShowCreateModal(false); setFormData({}); setFormErrors({}); setEditingItem(null); }} tone="neutral" variant="outline" />
              <ErpButton label={loading ? 'در حال ذخیره...' : editingItem ? 'ذخیره تغییرات' : 'ایجاد'} onClick={handleSave} tone="primary" variant="solid" disabled={loading} />
            </div>
          </div>
        </div>
      )}

      <SuccessModal isOpen={showSuccessModal} onClose={() => setShowSuccessModal(false)} title="عملیات موفق" message={modalMessage} buttonText="باشه" autoClose autoCloseDelay={2000} />
      <ErrorModal isOpen={showErrorModal} onClose={() => setShowErrorModal(false)} title="خطا" message={modalMessage} details={modalDetails} buttonText="باشه" />
    </>
  );
};

export default MasterDataManagement;
