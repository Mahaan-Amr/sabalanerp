'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { 
  FaArrowRight, 
  FaArrowLeft, 
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
  { id: 'volumetric', label: 'حجمی', description: 'نمایش در قراردادهای حجمی' }
];

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
  contractVisibility: {
    longitudinal: true,
    stair: true,
    slab: true,
    volumetric: true
  }
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
        [mapping.itemField]: item
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
    ].filter(Boolean).join('-');
  };

  const handleCreateProduct = async () => {
    if (!validateCurrentStep()) return;

    try {
      setLoading(true);
      
      const finalCode = generateFinalCode();
      
      const productData = {
        code: finalCode,
        name: `${wizardData.cutType?.namePersian} - ${wizardData.stoneMaterial?.namePersian}`,
        namePersian: `${wizardData.cutType?.namePersian} - ${wizardData.stoneMaterial?.namePersian}`,
        cuttingDimensionCode: wizardData.cutType?.code || '',
        cuttingDimensionName: wizardData.cutType?.name || '',
        cuttingDimensionNamePersian: wizardData.cutType?.namePersian || '',
        stoneTypeCode: wizardData.cutType?.code || '',
        stoneTypeName: wizardData.cutType?.name || '',
        stoneTypeNamePersian: wizardData.cutType?.namePersian || '',
        widthCode: wizardData.cutWidth?.code || '',
        widthValue: wizardData.cutWidth?.value || 0,
        widthName: `${wizardData.cutWidth?.value || 0} ${wizardData.cutWidth?.unit || 'cm'}`,
        thicknessCode: wizardData.thickness?.code || '',
        thicknessValue: wizardData.thickness?.value || 0,
        thicknessName: `${wizardData.thickness?.value || 0} ${wizardData.thickness?.unit || 'cm'}`,
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

  // Reusable SearchableDropdown component
  const SearchableDropdown = ({ 
    type, 
    label, 
    placeholder, 
    errorKey, 
    selectedItem 
  }: {
    type: keyof typeof masterData;
    label: string;
    placeholder: string;
    errorKey: string;
    selectedItem: MasterDataItem | null;
  }) => {
    const filteredData = getFilteredData(type, searchTerms[type]);
    
    return (
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
            {label} *
          </label>
          
          {/* Search Input */}
          <div className="relative mb-4">
            <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
              <FaSearch className="h-5 w-5 text-gray-400" />
            </div>
            <input
              type="text"
              placeholder={placeholder}
              value={searchTerms[type]}
              onChange={(e) => updateSearchTerm(type, e.target.value)}
              className="w-full pr-10 pl-4 py-3 border border-slate-200 dark:border-slate-600 rounded-lg bg-white/50 dark:bg-slate-700/50 text-slate-800 dark:text-slate-200 placeholder-slate-500 dark:placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
            />
          </div>
          
          {/* Options List */}
          <div className="max-h-60 overflow-y-auto border border-slate-200 dark:border-slate-600 rounded-lg bg-white/50 dark:bg-slate-700/50">
            {filteredData.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-slate-500 dark:text-slate-400">
                  {searchTerms[type] ? 'هیچ آیتمی با این جستجو یافت نشد' : 'هیچ آیتمی موجود نیست'}
                </p>
              </div>
            ) : (
              filteredData.map((item) => (
                <div
                  key={item.id}
                  onClick={() => selectMasterDataItem(type, item)}
                  className={`p-4 border-b border-slate-200 dark:border-slate-600 cursor-pointer transition-all ${
                    selectedItem?.id === item.id
                      ? 'bg-teal-50 dark:bg-teal-900/20 border-teal-200 dark:border-teal-800'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-700/50'
                  }`}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="font-medium text-slate-800 dark:text-slate-200">
                        {item.namePersian}
                      </h4>
                      <p className="text-sm text-slate-600 dark:text-slate-300">
                        کد: {item.code}
                        {item.value && item.unit && ` • ${item.value} ${item.unit}`}
                      </p>
                      {item.description && (
                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                          {item.description}
                        </p>
                      )}
                    </div>
                    {selectedItem?.id === item.id && (
                      <FaCheck className="text-teal-500" />
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
          
          {errors[errorKey] && <p className="text-red-500 text-sm mt-1">{errors[errorKey]}</p>}
        </div>
        
        {selectedItem && (
          <div className="p-4 bg-teal-50 dark:bg-teal-900/20 rounded-lg border border-teal-200 dark:border-teal-800">
            <h4 className="font-medium text-teal-800 dark:text-teal-200 mb-2">انتخاب شده:</h4>
            <p className="text-teal-700 dark:text-teal-300">
              <strong>{selectedItem.namePersian}</strong> ({selectedItem.code})
              {selectedItem.value && selectedItem.unit && ` - ${selectedItem.value} ${selectedItem.unit}`}
            </p>
            {selectedItem.description && (
              <p className="text-sm text-teal-600 dark:text-teal-400 mt-1">
                {selectedItem.description}
              </p>
            )}
          </div>
        )}
      </div>
    );
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
              errorKey="cutType"
              selectedItem={wizardData.cutType}
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
              errorKey="stoneMaterial"
              selectedItem={wizardData.stoneMaterial}
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
              errorKey="cutWidth"
              selectedItem={wizardData.cutWidth}
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
              errorKey="thickness"
              selectedItem={wizardData.thickness}
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
              errorKey="mine"
              selectedItem={wizardData.mine}
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
              errorKey="finishType"
              selectedItem={wizardData.finishType}
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
              errorKey="color"
              selectedItem={wizardData.color}
            />
            
            {/* Final Code Preview */}
            <div className="bg-teal-50 dark:bg-teal-900/20 p-4 rounded-lg border border-teal-200 dark:border-teal-800">
              <label className="block text-sm font-medium text-teal-800 dark:text-teal-200 mb-2">
                کد نهایی محصول:
              </label>
              <div className="font-mono text-lg text-teal-900 dark:text-teal-100 bg-white dark:bg-slate-800 p-3 rounded border">
                {generateFinalCode()}
              </div>
            </div>

            <div className="p-4 bg-white/80 dark:bg-slate-800/80 rounded-lg border border-slate-200 dark:border-slate-700">
              <label className="block text-sm font-medium text-slate-800 dark:text-slate-200 mb-3">
                قراردادهای موجود
              </label>
              <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
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
                          ? 'border-teal-400 bg-teal-50 dark:bg-teal-900/20'
                          : 'border-slate-200 dark:border-slate-700 hover:border-teal-200'
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 text-teal-600 rounded border-slate-300 focus:ring-teal-500"
                        checked={checked}
                        onChange={() => toggleContractVisibility(option.id)}
                      />
                      <div>
                        <p className="font-medium text-slate-800 dark:text-slate-200">{option.label}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{option.description}</p>
                      </div>
                    </label>
                  );
                })}
              </div>
              {errors.contractVisibility && (
                <p className="text-red-500 text-sm mt-2">{errors.contractVisibility}</p>
              )}
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-slate-800 dark:text-slate-200">
                ایجاد محصول سنگ
              </h1>
              <p className="text-slate-600 dark:text-slate-400 mt-2">
                ایجاد محصول جدید با استفاده از جادوگر 7 مرحله‌ای
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
                    <button
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
                      className="flex items-center gap-2 px-4 py-2 text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-200 transition-colors bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800"
                    >
                      <FaTimes className="text-lg" />
                      لغو و بازگشت به قرارداد
                    </button>
                  );
                }
                return null;
              })()}
              
              <button
                onClick={() => router.push('/dashboard/sales/products')}
                className="flex items-center gap-2 px-4 py-2 text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
              >
                <FaTimes className="text-lg" />
                لغو
              </button>
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
                      ? 'bg-teal-500 text-white shadow-lg' 
                      : isCompleted 
                        ? 'bg-green-500 text-white' 
                        : 'bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
                    }
                  `}>
                    {isCompleted ? <FaCheck className="text-lg" /> : <Icon className="text-lg" />}
                  </div>
                  <div className="text-center">
                    <p className={`text-sm font-medium ${isActive ? 'text-teal-600 dark:text-teal-400' : 'text-slate-600 dark:text-slate-400'}`}>
                      {step.title}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-500 mt-1">
                      مرحله {step.id}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Step Content */}
        <div className="bg-white/70 dark:bg-slate-800/70 backdrop-blur-sm rounded-2xl p-8 border border-white/20 dark:border-slate-700/50">
          <div className="text-center mb-8">
            <div className="flex items-center justify-center gap-3 mb-4">
              {React.createElement(WIZARD_STEPS[currentStep - 1].icon, { className: "text-2xl text-teal-500" })}
              <h2 className="text-2xl font-semibold text-slate-800 dark:text-slate-200">
                {WIZARD_STEPS[currentStep - 1].title}
              </h2>
            </div>
            <p className="text-slate-600 dark:text-slate-400">
              {WIZARD_STEPS[currentStep - 1].description}
            </p>
          </div>

          {renderStepContent()}
        </div>

        {/* Navigation */}
        <div className="flex justify-between items-center mt-8">
          <button
            onClick={goToPreviousStep}
            disabled={currentStep === 1}
            className="flex items-center gap-2 px-6 py-3 bg-slate-500 text-white rounded-lg hover:bg-slate-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <FaArrowLeft />
            مرحله قبل
          </button>

          <div className="text-center">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              مرحله {currentStep} از {WIZARD_STEPS.length}
            </p>
          </div>

          {currentStep < WIZARD_STEPS.length ? (
            <button
              onClick={goToNextStep}
              className="flex items-center gap-2 px-6 py-3 bg-teal-500 text-white rounded-lg hover:bg-teal-600 transition-colors"
            >
              مرحله بعد
              <FaArrowRight />
            </button>
          ) : (
            <button
              onClick={handleCreateProduct}
              disabled={loading}
              className="flex items-center gap-2 px-6 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'در حال ایجاد...' : 'ایجاد محصول'}
              <FaCheck />
            </button>
          )}
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
    </div>
  );
}