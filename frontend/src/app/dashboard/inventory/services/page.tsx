'use client';
import { ErpBadge, ErpField, ErpInput, ErpSelect } from '@/components/erp';
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { FaPlus, FaEdit, FaTrash, FaToggleOn, FaToggleOff, FaFileExcel } from 'react-icons/fa';
import { dashboardAPI, servicesAPI } from '@/lib/api';
import { ErpButton, ErpInlineState, ErpLoading, ErpQuickFilters, ErpListPage, ErpEmptyState, ErpPresentationProvider, ErpSheet } from '@/components/erp';
import CatalogExcelSyncModal from '@/components/CatalogExcelSyncModal';
import { formatPrice } from '@/lib/numberFormat';

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
  pricePerMeter: number; // هزینه پایه ابزار (تومان)
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
  calculationUnit: 'set' | 'physicalPiece' | 'meter' | 'squareMeter';
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface StoneFinishing {
  id: string;
  code: string;
  name?: string;
  namePersian: string;
  description?: string;
  pricePerSquareMeter: number;
  unitPrice?: number | null;
  calculationBase?: 'length' | 'squareMeters';
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

type ActiveTab = 'services' | 'cutting-types' | 'sub-services' | 'stair-lengths' | 'layer-types' | 'stone-finishings';
type Availability = Record<string, { visible: boolean; enabled: boolean; reason: string | null }>;
const tabActionKey: Record<ActiveTab, string> = {
  services: 'SERVICE', 'cutting-types': 'CUTTING_TYPES', 'sub-services': 'SUB_SERVICES',
  'stair-lengths': 'STAIR_LENGTHS', 'layer-types': 'LAYER_TYPES', 'stone-finishings': 'STONE_FINISHINGS',
};
const mutationTab: Record<'service' | 'cutting-type' | 'sub-service' | 'stair-length' | 'layer-type' | 'stone-finishing', ActiveTab> = {
  service: 'services', 'cutting-type': 'cutting-types', 'sub-service': 'sub-services',
  'stair-length': 'stair-lengths', 'layer-type': 'layer-types', 'stone-finishing': 'stone-finishings',
};

const ServicesPage: React.FC = () => {
  const router = useRouter();
  const [showInlineForm, setShowInlineForm] = useState(false);
  const [formError, setFormError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<{ type: keyof typeof mutationTab; id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
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
    calculationUnit: 'set' | 'physicalPiece' | 'meter' | 'squareMeter';
    description: string;
  }>({
    name: '',
    pricePerLayer: '',
    calculationUnit: 'set',
    description: ''
  });
  const [editingLayerTypeId, setEditingLayerTypeId] = useState<string | null>(null);
  const [savingLayerType, setSavingLayerType] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [showExcelModal, setShowExcelModal] = useState(false);
  const [availability, setAvailability] = useState<Availability>({});

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      setLoadError('');
      const availabilityResponse = await dashboardAPI.getActionAvailability('inventory');
      const actions = (availabilityResponse.data.data || {}) as Availability;
      setAvailability(actions);
      const permitted = (action: string) => actions[action]?.enabled === true;
      const firstVisibleTab = (Object.keys(tabActionKey) as ActiveTab[])
        .find((tab) => permitted(`VIEW_${tabActionKey[tab]}`));
      if (firstVisibleTab && !permitted(`VIEW_${tabActionKey[activeTab]}`)) setActiveTab(firstVisibleTab);
      const [
        servicesResponse,
        cuttingTypesResponse,
        subServicesResponse,
        stairLengthsResponse,
        layerTypesResponse,
        finishingResponse
      ] = await Promise.all([
        permitted('VIEW_SERVICE') ? servicesAPI.getServices({ limit: 1000 }) : Promise.resolve(null),
        permitted('VIEW_CUTTING_TYPES') ? servicesAPI.getCuttingTypes({ limit: 1000 }) : Promise.resolve(null),
        permitted('VIEW_SUB_SERVICES') ? servicesAPI.getSubServices({ limit: 1000 }) : Promise.resolve(null),
        permitted('VIEW_STAIR_LENGTHS') ? servicesAPI.getStairStandardLengths({ limit: 1000 }) : Promise.resolve(null),
        permitted('VIEW_LAYER_TYPES') ? servicesAPI.getLayerTypes({ limit: 1000 }) : Promise.resolve(null),
        permitted('VIEW_STONE_FINISHINGS') ? servicesAPI.getStoneFinishings({ limit: 1000 }) : Promise.resolve(null)
      ]);

      if (servicesResponse?.data.success) {
        setServices(servicesResponse.data.data);
      }

      if (cuttingTypesResponse?.data.success) {
        setCuttingTypes(cuttingTypesResponse.data.data);
      }

      if (subServicesResponse?.data.success) {
        setSubServices(subServicesResponse.data.data);
      }

      if (stairLengthsResponse?.data.success) {
        setStairLengths(stairLengthsResponse.data.data);
      }

      if (layerTypesResponse?.data.success) {
        setLayerTypes(layerTypesResponse.data.data);
      }

      if (finishingResponse?.data.success) {
        setStoneFinishings(finishingResponse.data.data);
      }
    } catch (error) {
      console.error('Error loading data:', error);
      setLoadError('دریافت فهرست داده‌های پایه ناموفق بود.');
    } finally {
      setLoading(false);
    }
  };

  const can = (action: 'VIEW' | 'CREATE' | 'EDIT' | 'DELETE' | 'TOGGLE', tab: ActiveTab = activeTab) => (
    availability[`${action}_${tabActionKey[tab]}`]?.enabled === true
  );

  const handleToggleStatus = async (type: 'service' | 'cutting-type' | 'sub-service' | 'stair-length' | 'layer-type' | 'stone-finishing', id: string) => {
    if (!can('TOGGLE', mutationTab[type])) return;
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
    if (!can('DELETE', mutationTab[type])) return;

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
    setShowInlineForm(false);
    setFormError('');
    setEditingStairLengthId(null);
    setStairLengthForm({
      label: '',
      value: '',
      unit: 'm',
      description: ''
    });
  };

  const handleEditStairLength = (item: StairStandardLength) => {
    if (!can('EDIT', 'stair-lengths')) return;
    setShowInlineForm(true);
    setFormError('');
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
    if (!can(editingStairLengthId ? 'EDIT' : 'CREATE', 'stair-lengths')) return;
    if (!stairLengthForm.value?.trim()) {
      setFormError('مقدار استاندارد را وارد کنید');
      return;
    }
    const numericValue = parseFloat(stairLengthForm.value);
    if (isNaN(numericValue) || numericValue <= 0) {
      setFormError('مقدار باید عددی مثبت باشد');
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
      setFormError('خطا در ذخیره طول استاندارد');
    } finally {
      setSavingStairLength(false);
    }
  };

  const resetLayerTypeForm = () => {
    setShowInlineForm(false);
    setFormError('');
    setEditingLayerTypeId(null);
    setLayerTypeForm({
      name: '',
      pricePerLayer: '',
      calculationUnit: 'set',
      description: ''
    });
  };

  const handleEditLayerType = (item: LayerType) => {
    if (!can('EDIT', 'layer-types')) return;
    setShowInlineForm(true);
    setFormError('');
    setEditingLayerTypeId(item.id);
    setLayerTypeForm({
      id: item.id,
      name: item.name,
      pricePerLayer: item.pricePerLayer?.toString() || '',
      calculationUnit: item.calculationUnit || 'set',
      description: item.description || ''
    });
  };

  const handleSaveLayerType = async () => {
    if (!can(editingLayerTypeId ? 'EDIT' : 'CREATE', 'layer-types')) return;
    if (!layerTypeForm.name.trim()) {
      setFormError('نام نوع لایه را وارد کنید');
      return;
    }
    if (!layerTypeForm.pricePerLayer.trim()) {
      setFormError('قیمت هر لایه را وارد کنید');
      return;
    }
    const numericValue = parseFloat(layerTypeForm.pricePerLayer);
    if (isNaN(numericValue) || numericValue <= 0) {
      setFormError('قیمت باید عددی مثبت باشد');
      return;
    }

    try {
      setSavingLayerType(true);
      const payload = {
        name: layerTypeForm.name.trim(),
        pricePerLayer: numericValue,
        calculationUnit: layerTypeForm.calculationUnit,
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
      setFormError('خطا در ذخیره نوع لایه');
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
    finishing.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (finishing.name && finishing.name.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (finishing.description && finishing.description.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const tabLabels: Record<ActiveTab, string> = {
    services: 'خدمات',
    'cutting-types': 'انواع ابزار',
    'sub-services': 'ابزارها',
    'stair-lengths': 'طول استاندارد پله',
    'layer-types': 'نوع لایه',
    'stone-finishings': 'فرآوری سنگ'
  };
  const tabOptions = [
    { id: 'services', label: 'خدمات', value: 'services', count: services.length, tone: 'primary' as const },
    { id: 'cutting-types', label: 'انواع ابزار', value: 'cutting-types', count: cuttingTypes.length, tone: 'info' as const },
    { id: 'sub-services', label: 'ابزارها', value: 'sub-services', count: subServices.length, tone: 'success' as const },
    { id: 'stair-lengths', label: 'طول پله', value: 'stair-lengths', count: stairLengths.length, tone: 'warning' as const },
    { id: 'layer-types', label: 'نوع لایه', value: 'layer-types', count: layerTypes.length, tone: 'purple' as const },
    { id: 'stone-finishings', label: 'فرآوری سنگ', value: 'stone-finishings', count: stoneFinishings.length, tone: 'neutral' as const },
  ].filter((tab) => can('VIEW', tab.value as ActiveTab));

  const searchPlaceholder = `جستجو در ${tabLabels[activeTab]}...`;

  if (loading && !savingStairLength && !savingLayerType) {
    return <ErpLoading />;
  }

  type CatalogRow = { id: string; title: string; code?: string; englishName?: string; description?: string; isActive: boolean; rate?: number | null; unit?: string; edit: () => void };
  const rowsByTab: Record<ActiveTab, CatalogRow[]> = {
    services: filteredServices.map(item => ({ ...item, title: item.namePersian, englishName: item.name, edit: () => router.push(`/dashboard/inventory/services/services/edit/${item.id}`) })),
    'cutting-types': filteredCuttingTypes.map(item => ({ ...item, title: item.namePersian, englishName: item.name, rate: item.pricePerMeter, unit: 'متر طول', edit: () => router.push(`/dashboard/inventory/services/cutting-types/edit/${item.id}`) })),
    'sub-services': filteredSubServices.map(item => ({ ...item, title: item.namePersian, englishName: item.name, rate: item.pricePerMeter, unit: item.calculationBase === 'squareMeters' ? 'متر مربع' : 'متر طول', edit: () => router.push(`/dashboard/inventory/services/sub-services/edit/${item.id}`) })),
    'stair-lengths': stairLengths.map(item => ({ ...item, title: item.label || 'طول استاندارد', unit: `${item.value.toLocaleString('fa-IR')} ${item.unit === 'cm' ? 'سانتی‌متر' : 'متر'}`, edit: () => handleEditStairLength(item) })),
    'layer-types': filteredLayerTypes.map(item => ({ ...item, title: item.name, rate: item.pricePerLayer, unit: { set: 'هر مجموعه', physicalPiece: 'هر قطعه فیزیکی', meter: 'متر طول', squareMeter: 'مترمربع' }[item.calculationUnit || 'set'], edit: () => handleEditLayerType(item) })),
    'stone-finishings': filteredStoneFinishings.map(item => ({ ...item, title: item.namePersian, englishName: item.name, rate: item.unitPrice ?? item.pricePerSquareMeter, unit: item.calculationBase === 'length' ? 'متر طول' : 'متر مربع', edit: () => router.push(`/dashboard/inventory/services/stone-finishings/edit/${item.id}`) })),
  };
  const typeByTab: Record<ActiveTab, keyof typeof mutationTab> = { services: 'service', 'cutting-types': 'cutting-type', 'sub-services': 'sub-service', 'stair-lengths': 'stair-length', 'layer-types': 'layer-type', 'stone-finishings': 'stone-finishing' };
  const inline = activeTab === 'stair-lengths' || activeTab === 'layer-types';
  const editingInline = activeTab === 'stair-lengths' ? Boolean(editingStairLengthId) : Boolean(editingLayerTypeId);
  const savingInline = activeTab === 'stair-lengths' ? savingStairLength : savingLayerType;
  const closeInline = () => activeTab === 'stair-lengths' ? resetStairLengthForm() : resetLayerTypeForm();
  const addItem = () => {
    if (inline) { closeInline(); setShowInlineForm(true); }
    else router.push(`/dashboard/inventory/services/${activeTab}/create`);
  };
  return (
    <>
    <ErpPresentationProvider scope="workspace"><div className="sds-neumorphic-scope sds-neumorphic-workflow-scope">
    <ErpListPage<CatalogRow>
      title="خدمات" eyebrow="انبار" backHref="/dashboard/inventory" rowActionMode="menu"
      actions={[
        ...(can('CREATE') || can('EDIT') ? [{ label: 'اکسل', icon: FaFileExcel, onClick: () => setShowExcelModal(true), tone: 'neutral' as const, variant: 'outline' as const }] : []),
        ...(can('CREATE') ? [{ label: `افزودن ${tabLabels[activeTab]}`, icon: FaPlus, onClick: addItem }] : []),
      ]}
      sectionNavigation={<ErpQuickFilters value={activeTab} onChange={value => { closeInline(); setActiveTab(value as ActiveTab); }} items={tabOptions} />}
      filters={[{ id: 'search', label: 'جست‌وجو', type: 'search', value: searchTerm, onChange: setSearchTerm, placeholder: searchPlaceholder }]}
      rows={can('VIEW') ? rowsByTab[activeTab] : []} rowKey={item => item.id}
      isLoading={loading}
      columns={[
        { id: 'name', header: 'نام', priority: 'primary', cell: item => <div className="min-w-0"><p className="break-words font-semibold">{item.title}</p>{item.code && <p dir="ltr" className="mt-1 break-all text-xs text-[var(--sds-text-secondary)]">{item.code}</p>}</div> },
        ...(!inline ? [{ id: 'englishName', header: 'نام انگلیسی', cell: (item: CatalogRow) => item.englishName || '—' }] : []),
        ...(activeTab !== 'services' && activeTab !== 'stair-lengths' ? [{ id: 'rate', header: 'قیمت (تومان)', cell: (item: CatalogRow) => item.rate == null ? '—' : formatPrice(item.rate) }] : []),
        ...(activeTab !== 'services' ? [{ id: 'unit', header: activeTab === 'stair-lengths' ? 'طول / واحد' : 'واحد محاسبه', cell: (item: CatalogRow) => item.unit || '—' }] : []),
        { id: 'description', header: 'توضیحات', cell: item => <span className="break-words">{item.description || '—'}</span> },
        { id: 'status', header: 'وضعیت', cell: item => <ErpBadge tone={item.isActive ? 'success' : 'neutral'}>{item.isActive ? 'فعال' : 'غیرفعال'}</ErpBadge> },
      ]}
      rowActions={item => [
        ...(can('EDIT') ? [{ label: 'ویرایش', icon: FaEdit, onClick: item.edit, tone: 'neutral' as const }] : []),
        ...(can('TOGGLE') ? [{ label: item.isActive ? 'غیرفعال کردن' : 'فعال کردن', icon: item.isActive ? FaToggleOn : FaToggleOff, onClick: () => handleToggleStatus(typeByTab[activeTab], item.id), tone: 'neutral' as const }] : []),
        ...(can('DELETE') ? [{ label: 'حذف', icon: FaTrash, onClick: () => setDeleteTarget({ type: typeByTab[activeTab], id: item.id, name: item.title }), tone: 'danger' as const }] : []),
      ]}
      emptyState={<ErpEmptyState title={can('VIEW') ? 'موردی یافت نشد' : 'دسترسی مشاهده این بخش را ندارید'} description={can('VIEW') ? 'عبارت جست‌وجو را تغییر دهید یا مورد جدید اضافه کنید.' : undefined} />}
    >
      {loadError && <ErpInlineState kind="error" title={loadError} action={{ label: 'تلاش مجدد', onClick: loadData }} />}
    </ErpListPage>
    </div></ErpPresentationProvider>
    <ErpSheet open={showInlineForm && inline} onClose={closeInline} title={`${editingInline ? 'ویرایش' : 'افزودن'} ${tabLabels[activeTab]}`} presentation="modal" size="wide" pending={savingInline}
      footer={<div className="flex flex-wrap justify-end gap-3"><ErpButton label="انصراف" variant="outline" disabled={savingInline} onClick={closeInline} /><ErpButton label={savingInline ? 'در حال ذخیره…' : editingInline ? 'ذخیره تغییرات' : 'ثبت'} disabled={savingInline || !can(editingInline ? 'EDIT' : 'CREATE')} onClick={activeTab === 'stair-lengths' ? handleSaveStairLength : handleSaveLayerType} /></div>}
    >
      {formError && <ErpInlineState kind="error" title={formError} />}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {activeTab === 'stair-lengths' ? <>
          <ErpField label="برچسب (اختیاری)"><ErpInput id="stair-label" value={stairLengthForm.label} onChange={event => setStairLengthForm(prev => ({ ...prev, label: event.target.value }))} /></ErpField>
          <ErpField label="مقدار طول" required><ErpInput id="stair-value" type="number" step="0.01" min="0" value={stairLengthForm.value} onChange={event => setStairLengthForm(prev => ({ ...prev, value: event.target.value }))} /></ErpField>
          <ErpField label="واحد"><ErpSelect id="stair-unit" value={stairLengthForm.unit} onChange={event => setStairLengthForm(prev => ({ ...prev, unit: event.target.value as 'm' | 'cm' }))}><option value="m">متر</option><option value="cm">سانتی‌متر</option></ErpSelect></ErpField>
          <ErpField label="توضیحات"><ErpInput id="stair-description" value={stairLengthForm.description} onChange={event => setStairLengthForm(prev => ({ ...prev, description: event.target.value }))} /></ErpField>
        </> : <>
          <ErpField label="نام نوع لایه" required><ErpInput id="layer-name" value={layerTypeForm.name} onChange={event => setLayerTypeForm(prev => ({ ...prev, name: event.target.value }))} /></ErpField>
          <ErpField label="قیمت هر لایه (تومان)" required><ErpInput id="layer-price" numberFormat="money" type="number" min="0" step="1000" value={layerTypeForm.pricePerLayer} onChange={event => setLayerTypeForm(prev => ({ ...prev, pricePerLayer: event.target.value }))} /></ErpField>
          <ErpField label="واحد محاسبه"><ErpSelect id="layer-unit" value={layerTypeForm.calculationUnit} onChange={event => setLayerTypeForm(prev => ({ ...prev, calculationUnit: event.target.value as LayerType['calculationUnit'] }))}><option value="set">هر مجموعه</option><option value="physicalPiece">هر قطعه فیزیکی</option><option value="meter">متر طول</option><option value="squareMeter">مترمربع</option></ErpSelect></ErpField>
          <ErpField label="توضیحات"><ErpInput id="layer-description" value={layerTypeForm.description} onChange={event => setLayerTypeForm(prev => ({ ...prev, description: event.target.value }))} /></ErpField>
        </>}
      </div>
    </ErpSheet>
    <ErpSheet open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} title="تأیید حذف" presentation="modal" pending={deleting}
      footer={<div className="flex flex-wrap gap-3"><ErpButton label="حذف" tone="danger" disabled={deleting} onClick={async () => { if (!deleteTarget) return; setDeleting(true); try { await handleDelete(deleteTarget.type, deleteTarget.id); setDeleteTarget(null); } finally { setDeleting(false); } }} /><ErpButton label="انصراف" variant="outline" disabled={deleting} onClick={() => setDeleteTarget(null)} /></div>}
    ><p>آیا از حذف «{deleteTarget?.name}» اطمینان دارید؟</p></ErpSheet>

      <CatalogExcelSyncModal
        isOpen={showExcelModal}
        title={`ورود و خروج اکسل ${tabLabels[activeTab]}`}
        onClose={() => setShowExcelModal(false)}
        onComplete={() => loadData()}
        downloadTemplate={() => servicesAPI.downloadCatalogTemplate(activeTab)}
        exportData={() => servicesAPI.exportCatalog(activeTab)}
        previewImport={(file) => servicesAPI.previewCatalogImport(activeTab, file)}
        applyImport={(importId) => servicesAPI.applyCatalogImport(activeTab, importId)}
        filenamePrefix={activeTab}
      />
    </>
  );
};

export default ServicesPage;
