'use client';
import { ErpInput, ErpPressable } from '@/components/erp';
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  FaCheck,
  FaTimes,
  FaCut,
  FaGem,
  FaRuler,
  FaMountain,
  FaPaintBrush,
  FaPalette,
  FaCode,
  FaSearch
} from 'react-icons/fa';
import { salesAPI, inventoryAPI } from '@/lib/api';
import SuccessModal from '@/components/SuccessModal';
import ErrorModal from '@/components/ErrorModal';
import { WizardNavigation } from '@/features/contract-creation/components/shared/WizardNavigation';

// Stone type definitions
const STONE_TYPES = [
  { value: 'LONGITUDINAL', label: 'سنگ های طولی', description: 'عرض و ضخامت مشخص با طول‌های مختلف' },
  { value: 'DIMENSIONAL', label: 'سنگ حکمی', description: 'عرض، ضخامت و طول مشخص' },
  { value: 'TILE', label: 'سنگ تایل', description: 'برش‌های استاندارد مثل 60×60 یا 120×120' },
  { value: 'SLAB', label: 'سنگ اسلب', description: 'سنگ‌های بزرگ‌تر از تایل' },
  { value: 'VOLUMETRIC', label: 'سنگ های حجمی', description: 'قطر معمولاً بیش از 6 سانتی‌متر' }
];

// Unit options
const UNITS = [
  { value: 'mm', label: 'میلی‌متر' },
  { value: 'cm', label: 'سانتی‌متر' },
  { value: 'm', label: 'متر' }
];

// Wizard step definitions
const WIZARD_STEPS = [
  {
    id: 1,
    title: 'نوع برش',
    titleEn: 'Cut Type',
    icon: FaCut,
    description: 'انتخاب نوع سنگ'
  },
  {
    id: 2,
    title: 'جنس سنگ',
    titleEn: 'Stone Material',
    icon: FaGem,
    description: 'نوع جنس سنگ'
  },
  {
    id: 3,
    title: 'عرض برش',
    titleEn: 'Cut Width',
    icon: FaRuler,
    description: 'عرض سنگ'
  },
  {
    id: 4,
    title: 'ضخامت',
    titleEn: 'Thickness',
    icon: FaRuler,
    description: 'ضخامت سنگ'
  },
  {
    id: 5,
    title: 'معدن یا اسم سنگ',
    titleEn: 'Mine or Stone Name',
    icon: FaMountain,
    description: 'معدن یا نام سنگ'
  },
  {
    id: 6,
    title: 'نوع پرداخت',
    titleEn: 'Finish Type',
    icon: FaPaintBrush,
    description: 'نوع پرداخت'
  },
  {
    id: 7,
    title: 'خصوصیات یا رنگ',
    titleEn: 'Properties or Color',
    icon: FaPalette,
    description: 'خصوصیات یا رنگ'
  }
];

type ContractVisibilityOption = 'longitudinal' | 'stair' | 'slab' | 'volumetric';

const CONTRACT_VISIBILITY_OPTIONS: Array<{
  id: ContractVisibilityOption;
  label: string;
  description: string;
}> = [
  { id: 'longitudinal', label: 'طولی', description: 'نمایش در قراردادهای سنگ طولی' },
  { id: 'stair', label: 'سنگ پله', description: 'نمایش در قراردادهای پله' },
  { id: 'slab', label: 'اسلب', description: 'نمایش در قراردادهای اسلب' },
  { id: 'volumetric', label: 'کیوبیک و قطعات آماده', description: 'نمایش در قراردادهای کیوبیک و قطعات آماده' }
];

const EMPTY_CONTRACT_VISIBILITY: Record<ContractVisibilityOption, boolean> = {
  longitudinal: false,
  stair: false,
  slab: false,
  volumetric: false
};

const normalizePersianText = (input?: string | null) => (input || '')
  .replace(/ي/g, 'ی')
  .replace(/ك/g, 'ک')
  .replace(/\s+/g, ' ')
  .trim();

const getDefaultContractVisibilityForCutType = (cutType?: MasterDataItem | null): Record<ContractVisibilityOption, boolean> => {
  const label = normalizePersianText(`${cutType?.namePersian || ''} ${cutType?.name || ''}`);

  if (label.includes('اسلب')) {
    return { ...EMPTY_CONTRACT_VISIBILITY, slab: true };
  }

  if (label.includes('کیوبیک') || label.includes('قطعات آماده') || label.includes('حجمی')) {
    return { ...EMPTY_CONTRACT_VISIBILITY, volumetric: true };
  }

  if (label.includes('طولی') || label.includes('تایل')) {
    return { ...EMPTY_CONTRACT_VISIBILITY, longitudinal: true, stair: true };
  }

  return { ...EMPTY_CONTRACT_VISIBILITY };
};

interface MasterDataItem {
  id: string;
  code: string;
  name?: string;
  namePersian: string;
  description?: string;
  value?: number;
  unit?: string;
  isActive: boolean;
}

type MasterDataKey = 'cutTypes' | 'stoneMaterials' | 'cutWidths' | 'thicknesses' | 'mines' | 'finishTypes' | 'colors';

interface SearchableDropdownProps {
  type: MasterDataKey;
  label: string;
  placeholder: string;
  error?: string;
  selectedItem: MasterDataItem | null;
  filteredData: MasterDataItem[];
  searchTerm: string;
  onSearchChange: (type: MasterDataKey, value: string) => void;
  onSelect: (type: MasterDataKey, item: MasterDataItem) => void;
}

const SearchableDropdown = ({
  type,
  label,
  placeholder,
  error,
  selectedItem,
  filteredData,
  searchTerm,
  onSearchChange,
  onSelect
}: SearchableDropdownProps) => (
  <div className="space-y-4">
    <div>
      <label className="block text-sm font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-muted)] mb-2">
        {label} *
      </label>

      <div className="relative mb-4">
        <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
          <FaSearch className="h-5 w-5 text-[var(--sds-text-muted)]" />
        </div>
        <ErpInput
          type="text"
          placeholder={placeholder}
          value={searchTerm}
          onChange={(e) => onSearchChange(type, e.target.value)}
          className="w-full pr-10 pl-4 py-3 border border-[var(--sds-border-default)] dark:border-[var(--sds-border-strong)] rounded-lg bg-[var(--sds-surface-raised)] dark:bg-[var(--sds-surface-raised)] text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)] placeholder:text-[var(--sds-text-muted)] dark:placeholder:text-[var(--sds-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--sds-focus-ring)] focus:border-transparent"
        />
      </div>

      <div className="max-h-60 overflow-y-auto border border-[var(--sds-border-default)] dark:border-[var(--sds-border-strong)] rounded-lg bg-[var(--sds-surface-raised)] dark:bg-[var(--sds-surface-raised)]">
        {filteredData.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">
              {searchTerm ? 'هیچ آیتمی با این جستجو یافت نشد' : 'هیچ آیتمی موجود نیست'}
            </p>
          </div>
        ) : (
          filteredData.map((item) => (
            <ErpPressable
              type="button"
              key={item.id}
              onClick={() => onSelect(type, item)}
              className={`block w-full p-4 text-right border-b border-[var(--sds-border-default)] dark:border-[var(--sds-border-strong)] cursor-pointer transition-all ${
                selectedItem?.id === item.id
                  ? 'bg-[var(--sds-accent-surface)] dark:bg-[var(--sds-accent-surface)] border-[var(--sds-border-strong)] dark:border-[var(--sds-border-strong)]'
                  : 'hover:bg-[var(--sds-surface-subtle)] dark:hover:bg-[var(--sds-surface-raised)]'
              }`}
            >
              <div className="flex justify-between items-start">
                <div>
                  <h4 className="font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">
                    {item.namePersian}
                  </h4>
                  <p className="text-sm text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">
                    کد: {item.code}
                    {item.value && item.unit && ` ⬢ ${item.value} ${item.unit}`}
                  </p>
                  {item.description && (
                    <p className="text-sm text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)] mt-1">
                      {item.description}
                    </p>
                  )}
                </div>
                {selectedItem?.id === item.id && (
                  <FaCheck className="text-[var(--sds-accent)]" />
                )}
              </div>
            </ErpPressable>
          ))
        )}
      </div>

      {error && <p className="text-[var(--sds-danger)] text-sm mt-1">{error}</p>}
    </div>

    {selectedItem && (
      <div className="p-4 bg-[var(--sds-accent-surface)] dark:bg-[var(--sds-accent-surface)] rounded-lg border border-[var(--sds-border-strong)] dark:border-[var(--sds-border-strong)]">
        <h4 className="font-medium text-[var(--sds-accent)] dark:text-[var(--sds-accent)] mb-2">انتخاب شده:</h4>
        <p className="text-[var(--sds-accent)] dark:text-[var(--sds-accent)]">
          <strong>{selectedItem.namePersian}</strong> ({selectedItem.code})
          {selectedItem.value && selectedItem.unit && ` - ${selectedItem.value} ${selectedItem.unit}`}
        </p>
        {selectedItem.description && (
          <p className="text-sm text-[var(--sds-accent)] dark:text-[var(--sds-accent)] mt-1">
            {selectedItem.description}
          </p>
        )}
      </div>
    )}
  </div>
);

interface StoneProductWizardData {
  // Step 1: Cut Type
  cutTypeId: string;
  cutType: MasterDataItem | null;

  // Step 2: Stone Material
  stoneMaterialId: string;
  stoneMaterial: MasterDataItem | null;

  // Step 3: Cut Width
  cutWidthId: string;
  cutWidth: MasterDataItem | null;

  // Step 4: Thickness
  thicknessId: string;
  thickness: MasterDataItem | null;

  // Step 5: Mine or Stone Name
  mineId: string;
  mine: MasterDataItem | null;

  // Step 6: Finish Type
  finishTypeId: string;
  finishType: MasterDataItem | null;

  // Step 7: Properties or Color
  colorId: string;
  color: MasterDataItem | null;

  // Contract visibility
  contractVisibility: Record<ContractVisibilityOption, boolean>;
  motherLengthValue: string;
}

export default function CreateStoneProductWizard() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Master data state
  const [masterData, setMasterData] = useState({
    cutTypes: [] as MasterDataItem[],
    stoneMaterials: [] as MasterDataItem[],
    cutWidths: [] as MasterDataItem[],
    thicknesses: [] as MasterDataItem[],
    mines: [] as MasterDataItem[],
    finishTypes: [] as MasterDataItem[],
    colors: [] as MasterDataItem[]
  });

  // Search state for each step
  const [searchTerms, setSearchTerms] = useState({
    cutTypes: '',
    stoneMaterials: '',
    cutWidths: '',
    thicknesses: '',
    mines: '',
    finishTypes: '',
    colors: ''
  });

  // Modal state
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [modalMessage, setModalMessage] = useState('');
  const [modalDetails, setModalDetails] = useState('');

  // Wizard data
  const [wizardData, setWizardData] = useState<StoneProductWizardData>({
    cutTypeId: '',
    cutType: null,
    stoneMaterialId: '',
    stoneMaterial: null,
    cutWidthId: '',
    cutWidth: null,
    thicknessId: '',
    thickness: null,
    mineId: '',
    mine: null,
    finishTypeId: '',
    finishType: null,
    colorId: '',
  color: null,
  contractVisibility: { ...EMPTY_CONTRACT_VISIBILITY },
  motherLengthValue: ''
  });

  // Load master data
  useEffect(() => {
    loadMasterData();
  }, []);

  const loadMasterData = async () => {
    try {
      setLoading(true);

      // Load all master data in parallel
      const [
        cutTypesResponse,
        stoneMaterialsResponse,
        cutWidthsResponse,
        thicknessesResponse,
        minesResponse,
        finishTypesResponse,
        colorsResponse
      ] = await Promise.all([
        inventoryAPI.getCutTypes({ limit: 100, isActive: true }),
        inventoryAPI.getStoneMaterials({ limit: 100, isActive: true }),
        inventoryAPI.getCutWidths({ limit: 100, isActive: true }),
        inventoryAPI.getThicknesses({ limit: 100, isActive: true }),
        inventoryAPI.getMines({ limit: 100, isActive: true }),
        inventoryAPI.getFinishTypes({ limit: 100, isActive: true }),
        inventoryAPI.getColors({ limit: 100, isActive: true })
      ]);

      setMasterData({
        cutTypes: cutTypesResponse.data.success ? cutTypesResponse.data.data : [],
        stoneMaterials: stoneMaterialsResponse.data.success ? stoneMaterialsResponse.data.data : [],
        cutWidths: cutWidthsResponse.data.success ? cutWidthsResponse.data.data : [],
        thicknesses: thicknessesResponse.data.success ? thicknessesResponse.data.data : [],
        mines: minesResponse.data.success ? minesResponse.data.data : [],
        finishTypes: finishTypesResponse.data.success ? finishTypesResponse.data.data : [],
        colors: colorsResponse.data.success ? colorsResponse.data.data : []
      });
    } catch (error) {
      console.error('Error loading master data:', error);
    } finally {
      setLoading(false);
    }
  };

  const updateWizardData = (field: keyof StoneProductWizardData, value: any) => {
    setWizardData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const selectMasterDataItem = (type: keyof typeof masterData, item: MasterDataItem) => {
    const fieldMap = {
      cutTypes: { idField: 'cutTypeId', itemField: 'cutType' },
      stoneMaterials: { idField: 'stoneMaterialId', itemField: 'stoneMaterial' },
      cutWidths: { idField: 'cutWidthId', itemField: 'cutWidth' },
      thicknesses: { idField: 'thicknessId', itemField: 'thickness' },
      mines: { idField: 'mineId', itemField: 'mine' },
      finishTypes: { idField: 'finishTypeId', itemField: 'finishType' },
      colors: { idField: 'colorId', itemField: 'color' }
    };

    const mapping = fieldMap[type];
    if (mapping) {
      setWizardData(prev => ({
        ...prev,
        [mapping.idField]: item.id,
        [mapping.itemField]: item,
        ...(type === 'cutTypes'
          ? { contractVisibility: getDefaultContractVisibilityForCutType(item) }
          : {})
      }));
    }
  };

  const toggleContractVisibility = (option: ContractVisibilityOption) => {
    setWizardData(prev => ({
      ...prev,
      contractVisibility: {
        ...prev.contractVisibility,
        [option]: !prev.contractVisibility[option]
      }
    }));
  };

  const updateSearchTerm = (type: keyof typeof searchTerms, value: string) => {
    setSearchTerms(prev => ({
      ...prev,
      [type]: value
    }));
  };

  // Filter functions for each master data type
  const getFilteredData = (type: keyof typeof masterData, searchTerm: string) => {
    const data = masterData[type];
    if (!searchTerm.trim()) return data;

    const searchLower = searchTerm.toLowerCase();
    return data.filter(item =>
      item.namePersian.toLowerCase().includes(searchLower) ||
      item.code.toLowerCase().includes(searchLower) ||
      (item.name && item.name.toLowerCase().includes(searchLower)) ||
      (item.description && item.description.toLowerCase().includes(searchLower))
    );
  };

  const validateCurrentStep = (): boolean => {
    const newErrors: Record<string, string> = {};

    switch (currentStep) {
      case 1:
        if (!wizardData.cutTypeId) {
          newErrors.cutType = 'انتخاب نوع برش الزامی است';
        }
        break;
      case 2:
        if (!wizardData.stoneMaterialId) {
          newErrors.stoneMaterial = 'انتخاب جنس سنگ الزامی است';
        }
        break;
      case 3:
        if (!wizardData.cutWidthId) {
          newErrors.cutWidth = 'انتخاب عرض برش الزامی است';
        }
        break;
      case 4:
        if (!wizardData.thicknessId) {
          newErrors.thickness = 'انتخاب ضخامت الزامی است';
        }
        break;
      case 5:
        if (!wizardData.mineId) {
          newErrors.mine = 'انتخاب معدن یا اسم سنگ الزامی است';
        }
        break;
      case 6:
        if (!wizardData.finishTypeId) {
          newErrors.finishType = 'انتخاب نوع پرداخت الزامی است';
        }
        break;
      case 7:
        if (!wizardData.colorId) {
          newErrors.color = 'انتخاب خصوصیات یا رنگ الزامی است';
        }
        if (!Object.values(wizardData.contractVisibility || {}).some(Boolean)) {
          newErrors.contractVisibility = 'حداقل یک قرارداد باید انتخاب شود';
        }
        if (
          wizardData.motherLengthValue &&
          (!Number.isFinite(Number(wizardData.motherLengthValue)) ||
            Number(wizardData.motherLengthValue) <= 0)
        ) {
          newErrors.motherLengthValue = 'طول مادر باید بیشتر از صفر باشد';
        }
        break;
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const goToNextStep = () => {
    if (validateCurrentStep()) {
      setCurrentStep(prev => Math.min(prev + 1, WIZARD_STEPS.length));
      setErrors({});
      // Clear search terms when moving to next step
      setSearchTerms({
        cutTypes: '',
        stoneMaterials: '',
        cutWidths: '',
        thicknesses: '',
        mines: '',
        finishTypes: '',
        colors: ''
      });
    }
  };

  const goToPreviousStep = () => {
    setCurrentStep(prev => Math.max(prev - 1, 1));
    setErrors({});
    // Clear search terms when moving to previous step
    setSearchTerms({
      cutTypes: '',
      stoneMaterials: '',
      cutWidths: '',
      thicknesses: '',
      mines: '',
      finishTypes: '',
      colors: ''
    });
  };

  const generateFinalCode = () => {
    return [
      wizardData.cutType?.code,
      wizardData.stoneMaterial?.code,
      wizardData.cutWidth?.code,
      wizardData.thickness?.code,
      wizardData.mine?.code,
      wizardData.finishType?.code,
      wizardData.color?.code
    ].filter(Boolean).join('');
  };

  const generateCanonicalProductName = () => {
    const widthLabel = wizardData.cutWidth?.value ? `ع${wizardData.cutWidth.value}` : '';
    const thicknessLabel = wizardData.thickness?.value ? `ض${wizardData.thickness.value}` : '';
    return [
      wizardData.cutType?.namePersian,
      wizardData.stoneMaterial?.namePersian,
      widthLabel,
      thicknessLabel,
      wizardData.mine?.namePersian,
      wizardData.finishType?.namePersian
    ].filter(Boolean).join(' ');
  };

  const handleCreateProduct = async () => {
    if (!validateCurrentStep()) return;

    try {
      setLoading(true);

      const finalCode = generateFinalCode();
      const canonicalProductName = generateCanonicalProductName();

      const productData = {
        code: finalCode,
        name: canonicalProductName,
        namePersian: canonicalProductName,
        cuttingDimensionCode: wizardData.cutType?.code || '',
        cuttingDimensionName: wizardData.cutType?.name || '',
        cuttingDimensionNamePersian: wizardData.cutType?.namePersian || '',
        stoneTypeCode: wizardData.stoneMaterial?.code || '',
        stoneTypeName: wizardData.stoneMaterial?.name || '',
        stoneTypeNamePersian: wizardData.stoneMaterial?.namePersian || '',
        widthCode: wizardData.cutWidth?.code || '',
        widthValue: wizardData.cutWidth?.value || 0,
        widthName: wizardData.cutWidth?.value ? `ع${wizardData.cutWidth.value}` : '',
        motherLengthValue: wizardData.motherLengthValue
          ? Number(wizardData.motherLengthValue)
          : null,
        thicknessCode: wizardData.thickness?.code || '',
        thicknessValue: wizardData.thickness?.value || 0,
        thicknessName: wizardData.thickness?.value ? `ض${wizardData.thickness.value}` : '',
        mineCode: wizardData.mine?.code || '',
        mineName: wizardData.mine?.name || '',
        mineNamePersian: wizardData.mine?.namePersian || '',
        finishCode: wizardData.finishType?.code || '',
        finishName: wizardData.finishType?.name || '',
        finishNamePersian: wizardData.finishType?.namePersian || '',
        colorCode: wizardData.color?.code || '',
        colorName: wizardData.color?.name || '',
        colorNamePersian: wizardData.color?.namePersian || '',
        qualityCode: 'QUALITY-001', // Default quality
        qualityName: 'Standard',
        qualityNamePersian: 'استاندارد',
        currency: 'ریال',
        isAvailable: true,
        description: `سنگ ${wizardData.cutType?.namePersian} از جنس ${wizardData.stoneMaterial?.namePersian} با عرض ${wizardData.cutWidth?.value || 0} ${wizardData.cutWidth?.unit || 'cm'} و ضخامت ${wizardData.thickness?.value || 0} ${wizardData.thickness?.unit || 'cm'}`,
        images: [],
        isActive: true,
        availableInLongitudinalContracts: wizardData.contractVisibility.longitudinal,
        availableInStairContracts: wizardData.contractVisibility.stair,
        availableInSlabContracts: wizardData.contractVisibility.slab,
        availableInVolumetricContracts: wizardData.contractVisibility.volumetric
      };

      console.log('Sending product data:', JSON.stringify(productData, null, 2));
      const response = await salesAPI.createProduct(productData);

      if (response.data.success) {
        setModalMessage('محصول با موفقیت ایجاد شد!');
        setShowSuccessModal(true);
        // Auto redirect after modal closes
        setTimeout(() => {
          // Check if we should return to contract wizard
          const urlParams = new URLSearchParams(window.location.search);
          const returnTo = urlParams.get('returnTo');
          const step = urlParams.get('step');

          if (returnTo === 'contract' && step) {
            // Redirect back to contract wizard
            router.push(`/dashboard/sales/contracts/create?returnTo=contract&step=${step}`);
          } else {
            // Default redirect to products list
            router.push('/dashboard/sales/products');
          }
        }, 2000);
      } else {
        setModalMessage('خطا در ایجاد محصول');
        setModalDetails(response.data.error);
        setShowErrorModal(true);
      }
    } catch (error: any) {
      console.error('Error creating product:', error);

      // Show detailed error message from backend
      if (error.response?.data?.details) {
        const errorDetails = error.response.data.details;
        const errorMessages = errorDetails.map((detail: any) => detail.msg).join('\n');
        setModalMessage('خطا در اعتبارسنجی');
        setModalDetails(errorMessages);
        setShowErrorModal(true);
      } else if (error.response?.data?.error) {
        setModalMessage('خطا در ایجاد محصول');
        setModalDetails(error.response.data.error);
        setShowErrorModal(true);
      } else {
        setModalMessage('خطا در ایجاد محصول');
        setModalDetails('خطای غیرمنتظره رخ داده است');
        setShowErrorModal(true);
      }
    } finally {
      setLoading(false);
    }
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 1:
        return (
          <div className="space-y-6">
            <SearchableDropdown
              type="cutTypes"
              label="نوع برش"
              placeholder="جستجو در نوع برش..."
              error={errors.cutType}
              selectedItem={wizardData.cutType}
              filteredData={getFilteredData('cutTypes', searchTerms.cutTypes)}
              searchTerm={searchTerms.cutTypes}
              onSearchChange={updateSearchTerm}
              onSelect={selectMasterDataItem}
            />
          </div>
        );

      case 2:
        return (
          <div className="space-y-6">
            <SearchableDropdown
              type="stoneMaterials"
              label="جنس سنگ"
              placeholder="جستجو در جنس سنگ..."
              error={errors.stoneMaterial}
              selectedItem={wizardData.stoneMaterial}
              filteredData={getFilteredData('stoneMaterials', searchTerms.stoneMaterials)}
              searchTerm={searchTerms.stoneMaterials}
              onSearchChange={updateSearchTerm}
              onSelect={selectMasterDataItem}
            />
          </div>
        );

      case 3:
        return (
          <div className="space-y-6">
            <SearchableDropdown
              type="cutWidths"
              label="عرض برش"
              placeholder="جستجو در عرض برش..."
              error={errors.cutWidth}
              selectedItem={wizardData.cutWidth}
              filteredData={getFilteredData('cutWidths', searchTerms.cutWidths)}
              searchTerm={searchTerms.cutWidths}
              onSearchChange={updateSearchTerm}
              onSelect={selectMasterDataItem}
            />
          </div>
        );

      case 4:
        return (
          <div className="space-y-6">
            <SearchableDropdown
              type="thicknesses"
              label="ضخامت"
              placeholder="جستجو در ضخامت..."
              error={errors.thickness}
              selectedItem={wizardData.thickness}
              filteredData={getFilteredData('thicknesses', searchTerms.thicknesses)}
              searchTerm={searchTerms.thicknesses}
              onSearchChange={updateSearchTerm}
              onSelect={selectMasterDataItem}
            />
          </div>
        );

      case 5:
        return (
          <div className="space-y-6">
            <SearchableDropdown
              type="mines"
              label="معدن یا اسم سنگ"
              placeholder="جستجو در معدن یا اسم سنگ..."
              error={errors.mine}
              selectedItem={wizardData.mine}
              filteredData={getFilteredData('mines', searchTerms.mines)}
              searchTerm={searchTerms.mines}
              onSearchChange={updateSearchTerm}
              onSelect={selectMasterDataItem}
            />
          </div>
        );

      case 6:
        return (
          <div className="space-y-6">
            <SearchableDropdown
              type="finishTypes"
              label="نوع پرداخت"
              placeholder="جستجو در نوع پرداخت..."
              error={errors.finishType}
              selectedItem={wizardData.finishType}
              filteredData={getFilteredData('finishTypes', searchTerms.finishTypes)}
              searchTerm={searchTerms.finishTypes}
              onSearchChange={updateSearchTerm}
              onSelect={selectMasterDataItem}
            />
          </div>
        );

      case 7:
        return (
          <div className="space-y-6">
            <SearchableDropdown
              type="colors"
              label="خصوصیات یا رنگ"
              placeholder="جستجو در خصوصیات یا رنگ..."
              error={errors.color}
              selectedItem={wizardData.color}
              filteredData={getFilteredData('colors', searchTerms.colors)}
              searchTerm={searchTerms.colors}
              onSearchChange={updateSearchTerm}
              onSelect={selectMasterDataItem}
            />

            <div>
              <label className="mb-2 block text-sm font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-muted)]">
                طول مادر (متر)
              </label>
              <ErpInput
                value={wizardData.motherLengthValue}
                onChange={(event) => updateWizardData('motherLengthValue', event.target.value)}
                inputMode="decimal"
                className="h-10 w-full rounded-lg border border-[var(--sds-border-default)] bg-transparent px-3 text-sm outline-none focus:border-[var(--sds-border-strong)] dark:border-[var(--sds-border-strong)]"
              />
              {errors.motherLengthValue && (
                <p className="mt-1 text-sm text-[var(--sds-danger)]">{errors.motherLengthValue}</p>
              )}
            </div>

            {/* Final Code Preview */}
            <div className="bg-[var(--sds-accent-surface)] dark:bg-[var(--sds-accent-surface)] p-4 rounded-lg border border-[var(--sds-border-strong)] dark:border-[var(--sds-border-strong)]">
              <label className="block text-sm font-medium text-[var(--sds-accent)] dark:text-[var(--sds-accent)] mb-2">
                کد نهایی محصول:
              </label>
              <div className="font-mono text-lg text-[var(--sds-accent)] dark:text-[var(--sds-accent)] bg-[var(--sds-surface-raised)] dark:bg-[var(--sds-surface-raised)] p-3 rounded border">
                {generateFinalCode()}
              </div>
            </div>

            <div className="p-4 bg-[var(--sds-surface-raised)] dark:bg-[var(--sds-surface-raised)] rounded-lg border border-[var(--sds-border-default)] dark:border-[var(--sds-border-strong)]">
              <label className="block text-sm font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)] mb-3">
                قراردادهای موجود
              </label>
              <p className="text-sm text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)] mb-4">
                مشخص کنید این محصول در کدام فرایندهای ایجاد قرارداد نمایش داده شود.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {CONTRACT_VISIBILITY_OPTIONS.map(option => {
                  const checked = wizardData.contractVisibility[option.id];
                  return (
                    <label
                      key={option.id}
                      className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                        checked
                          ? 'border-[var(--sds-border-strong)] bg-[var(--sds-accent-surface)] dark:bg-[var(--sds-accent-surface)]'
                          : 'border-[var(--sds-border-default)] dark:border-[var(--sds-border-strong)] hover:border-[var(--sds-border-strong)]'
                      }`}
                    >
                      <ErpInput
                        type="checkbox"
                        className="mt-1 h-4 w-4 text-[var(--sds-accent)] rounded border-[var(--sds-border-default)] focus:ring-[var(--sds-focus-ring)]"
                        checked={checked}
                        onChange={() => toggleContractVisibility(option.id)}
                      />
                      <div>
                        <p className="font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">{option.label}</p>
                        <p className="text-xs text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">{option.description}</p>
                      </div>
                    </label>
                  );
                })}
              </div>
              {errors.contractVisibility && (
                <p className="text-[var(--sds-danger)] text-sm mt-2">{errors.contractVisibility}</p>
              )}
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <main className="sds-workspace min-h-screen">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">
                ایجاد محصول سنگ
              </h1>
              <p className="text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)] mt-2">
                مشخصات و ساختار محصول را تکمیل کنید.
              </p>
            </div>
            <div className="flex items-center gap-3">
              {/* Cancel button - return to contract wizard */}
              {(() => {
                const urlParams = new URLSearchParams(window.location.search);
                const returnTo = urlParams.get('returnTo');
                const step = urlParams.get('step');

                if (returnTo === 'contract' && step) {
                  return (
                    <ErpPressable type="submit"
                      onClick={() => {
                        // Restore contract wizard state from localStorage
                        const savedState = localStorage.getItem('contractWizardState');
                        if (savedState) {
                          const { currentStep, wizardData } = JSON.parse(savedState);
                          // Navigate back to contract wizard with restored state
                          router.push(`/dashboard/sales/contracts/create?returnTo=contract&step=${currentStep}`);
                        } else {
                          // Fallback to contract creation
                          router.push('/dashboard/sales/contracts/create');
                        }
                      }}
                      className="flex items-center gap-2 px-4 py-2 text-[var(--sds-danger)] dark:text-[var(--sds-danger)] hover:text-[var(--sds-danger)] dark:hover:text-[var(--sds-danger)] transition-colors bg-[var(--sds-danger-surface)] dark:bg-[var(--sds-danger-surface)] rounded-lg border border-[var(--sds-danger-border)] dark:border-[var(--sds-danger-border)]"
                    >
                      <FaTimes className="text-lg" />
                      لغو و بازگشت به قرارداد
                    </ErpPressable>
                  );
                }
                return null;
              })()}

              <ErpPressable type="submit"
                onClick={() => router.push('/dashboard/sales/products')}
                className="flex items-center gap-2 px-4 py-2 text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)] hover:text-[var(--sds-text-primary)] dark:hover:text-[var(--sds-text-primary)] transition-colors"
              >
                <FaTimes className="text-lg" />
                لغو
              </ErpPressable>
            </div>
          </div>
        </div>

        {/* Progress Steps */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            {WIZARD_STEPS.map((step, index) => {
              const isActive = currentStep === step.id;
              const isCompleted = currentStep > step.id;
              const Icon = step.icon;

              return (
                <div key={step.id} className="flex flex-col items-center">
                  <div className={`
                    w-12 h-12 rounded-full flex items-center justify-center mb-2 transition-all duration-200
                    ${isActive
                      ? 'bg-[var(--sds-accent)] text-[var(--sds-text-inverse)] shadow-lg'
                      : isCompleted
                        ? 'bg-[var(--sds-success)] text-[var(--sds-text-inverse)]'
                        : 'bg-[var(--sds-surface-subtle)] dark:bg-[var(--sds-surface-raised)] text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]'
                    }
                  `}>
                    {isCompleted ? <FaCheck className="text-lg" /> : <Icon className="text-lg" />}
                  </div>
                  <div className="text-center">
                    <p className={`text-sm font-medium ${isActive ? 'text-[var(--sds-accent)] dark:text-[var(--sds-accent)]' : 'text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]'}`}>
                      {step.title}
                    </p>
                    <p className="text-xs text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)] mt-1">
                      مرحله {step.id}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Step Content */}
        <div className="bg-[var(--sds-surface-raised)] dark:bg-[var(--sds-surface-raised)] backdrop-blur-sm rounded-2xl p-8 border border-[var(--sds-border-default)] dark:border-[var(--sds-border-strong)]">
          <div className="text-center mb-8">
            <div className="flex items-center justify-center gap-3 mb-4">
              {React.createElement(WIZARD_STEPS[currentStep - 1].icon, { className: "text-2xl text-[var(--sds-accent)]" })}
              <h2 className="text-2xl font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">
                {WIZARD_STEPS[currentStep - 1].title}
              </h2>
            </div>
            <p className="text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">
              {WIZARD_STEPS[currentStep - 1].description}
            </p>
          </div>

          {renderStepContent()}
        </div>

        {/* Navigation */}
        <div className="mt-8">
          <WizardNavigation
            currentStep={currentStep}
            totalSteps={WIZARD_STEPS.length}
            onPrevious={goToPreviousStep}
            onNext={goToNextStep}
            onSubmit={handleCreateProduct}
            loading={loading}
            canGoNext={true}
            canGoPrevious={currentStep > 1}
            labels={{
              previous: 'مرحله قبل',
              next: 'مرحله بعد',
              submit: 'ایجاد محصول',
              submitting: 'در حال ایجاد...'
            }}
          />
        </div>
      </div>

      {/* Success Modal */}
      <SuccessModal
        isOpen={showSuccessModal}
        onClose={() => setShowSuccessModal(false)}
        title="محصول ایجاد شد"
        message={modalMessage}
        buttonText="باشه"
        autoClose={true}
        autoCloseDelay={2000}
      />

      {/* Error Modal */}
      <ErrorModal
        isOpen={showErrorModal}
        onClose={() => setShowErrorModal(false)}
        title="خطا در ایجاد محصول"
        message={modalMessage}
        details={modalDetails}
        buttonText="باشه"
      />
    </main>
  );
}
