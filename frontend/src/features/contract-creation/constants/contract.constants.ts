// Contract Creation Constants
// All constants used in contract creation feature

import {
  FaCalendarAlt,
  FaUser,
  FaBuilding,
  FaLayerGroup,
  FaWarehouse,
  FaTruck,
  FaCreditCard,
  FaSignature,
  FaRuler,
  FaSquare,
  FaThLarge,
  FaCubes
} from 'react-icons/fa';

// Nosing types for stair products
export const NOSING_TYPES = [
  {
    id: 'bullnose',
    name: 'پیشانی گرد (Bullnose)',
    nameEn: 'Bullnose',
    description: 'پیشانی گرد و نرم',
    cuttingCostPerMeter: 15000, // Mock price - will come from services
    available: true
  },
  {
    id: 'square',
    name: 'مربعی (Square)',
    nameEn: 'Square',
    description: 'پیشانی مربعی و تیز',
    cuttingCostPerMeter: 12000, // Mock price
    available: true
  },
  {
    id: 'rounded',
    name: 'گرد (Rounded)',
    nameEn: 'Rounded',
    description: 'پیشانی گرد با شعاع کوچک',
    cuttingCostPerMeter: 14000, // Mock price
    available: true
  },
  {
    id: 'none',
    name: 'بدون پیشانی',
    nameEn: 'No Nosing',
    description: 'بدون پیشانی',
    cuttingCostPerMeter: 0,
    available: true
  }
] as const;

// Product type definitions
export const PRODUCT_TYPES = [
  {
    id: 'longitudinal',
    name: 'سنگ طولی',
    nameEn: 'Longitudinal Stone',
    icon: FaRuler,
    description: 'سنگ‌های طولی با برش طولی',
    available: true
  },
  {
    id: 'stair',
    name: 'سنگ پله',
    nameEn: 'Stair Stone',
    icon: FaSquare,
    description: 'سنگ‌های مخصوص پله',
    available: true
  },
  {
    id: 'slab',
    name: 'سنگ اسلب',
    nameEn: 'Slab Stone',
    icon: FaThLarge,
    description: 'سنگ‌های اسلب با برش دو بعدی (طول و عرض)',
    available: true
  },
  {
    id: 'volumetric',
    name: 'سنگ حجمی',
    nameEn: 'Volumetric Stone',
    icon: FaCubes,
    description: 'به‌زودی: مدیریت سفارش سنگ‌های حجمی',
    available: false
  }
] as const;

// Contract visibility field mapping
export const CONTRACT_VISIBILITY_FIELD_MAP: Record<'longitudinal' | 'stair' | 'slab' | 'volumetric', 'availableInLongitudinalContracts' | 'availableInStairContracts' | 'availableInSlabContracts' | 'availableInVolumetricContracts'> = {
  longitudinal: 'availableInLongitudinalContracts',
  stair: 'availableInStairContracts',
  slab: 'availableInSlabContracts',
  volumetric: 'availableInVolumetricContracts'
};

// Wizard step definitions
export const WIZARD_STEPS = [
  {
    id: 1,
    title: 'تاریخ قرارداد',
    titleEn: 'Contract Date',
    icon: FaCalendarAlt,
    description: 'انتخاب تاریخ قرارداد'
  },
  {
    id: 2,
    title: 'انتخاب مشتری',
    titleEn: 'Customer Selection',
    icon: FaUser,
    description: 'انتخاب مشتری از سیستم CRM'
  },
  {
    id: 3,
    title: 'مدیریت پروژه',
    titleEn: 'Project Management',
    icon: FaBuilding,
    description: 'انتخاب یا ایجاد پروژه'
  },
  {
    id: 4,
    title: 'انتخاب نوع محصول',
    titleEn: 'Product Type Selection',
    icon: FaLayerGroup,
    description: 'نوع محصول را انتخاب کنید'
  },
  {
    id: 5,
    title: 'انتخاب محصولات',
    titleEn: 'Product Selection',
    icon: FaWarehouse,
    description: 'انتخاب محصولات از کاتالوگ'
  },
  {
    id: 6,
    title: 'برنامه تحویل',
    titleEn: 'Delivery Schedule',
    icon: FaTruck,
    description: 'تعیین تاریخ و آدرس تحویل'
  },
  {
    id: 7,
    title: 'روش پرداخت',
    titleEn: 'Payment Method',
    icon: FaCreditCard,
    description: 'انتخاب روش پرداخت'
  },
  {
    id: 8,
    title: 'امضای دیجیتال',
    titleEn: 'Digital Signature',
    icon: FaSignature,
    description: 'تایید نهایی قرارداد'
  }
];

