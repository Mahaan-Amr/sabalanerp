// Contract Creation Constants
// All constants used in contract creation feature

import {
  FaCalendarAlt,
  FaUser,
  FaBuilding,
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
    name: 'لب گرد (Bullnose)',
    nameEn: 'Bullnose',
    description: 'لب‌پرداخت گرد پله',
    cuttingCostPerMeter: 15000, // Mock price - will come from services
    available: true
  },
  {
    id: 'square',
    name: 'لب صاف (Square)',
    nameEn: 'Square',
    description: 'لب‌پرداخت صاف پله',
    cuttingCostPerMeter: 12000, // Mock price
    available: true
  },
  {
    id: 'rounded',
    name: 'نیم‌گرد (Rounded)',
    nameEn: 'Rounded',
    description: 'لب‌پرداخت نیم‌گرد پله',
    cuttingCostPerMeter: 14000, // Mock price
    available: true
  },
  {
    id: 'none',
    name: 'بدون لب‌پرداخت',
    nameEn: 'No Nosing',
    description: 'بدون لب‌پرداخت',
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
    description: 'سنگ طولی با برش مستقیم',
    available: true
  },
  {
    id: 'stair',
    name: 'سنگ پله',
    nameEn: 'Stair Stone',
    icon: FaSquare,
    description: 'سنگ مخصوص پله',
    available: true
  },
  {
    id: 'slab',
    name: 'سنگ اسلب',
    nameEn: 'Slab Stone',
    icon: FaThLarge,
    description: 'سنگ اسلب با برش دو بعدی (طول و عرض)',
    available: true
  },
  {
    id: 'prepared',
    name: 'کیوبیک و قطعات آماده',
    nameEn: 'Cubic and Ready Pieces',
    icon: FaCubes,
    description: 'کیوبیک و قطعات آماده با واحد متر مربع، تن یا تعداد',
    available: true
  }
] as const;

// Contract visibility field mapping
export const CONTRACT_VISIBILITY_FIELD_MAP: Record<'longitudinal' | 'stair' | 'slab' | 'prepared' | 'volumetric', 'availableInLongitudinalContracts' | 'availableInStairContracts' | 'availableInSlabContracts' | 'availableInVolumetricContracts'> = {
  longitudinal: 'availableInLongitudinalContracts',
  stair: 'availableInStairContracts',
  slab: 'availableInSlabContracts',
  prepared: 'availableInVolumetricContracts',
  volumetric: 'availableInVolumetricContracts'
};

// Wizard step definitions
export const WIZARD_STEPS = [
  {
    id: 1,
    title: 'تاریخ قرارداد',
    titleEn: 'Contract Date',
    icon: FaCalendarAlt,
    description: 'تاریخ قرارداد را تعیین کنید'
  },
  {
    id: 2,
    title: 'انتخاب مشتری',
    titleEn: 'Customer Selection',
    icon: FaUser,
    description: 'مشتری را از CRM انتخاب کنید'
  },
  {
    id: 3,
    title: 'مدیریت پروژه',
    titleEn: 'Project Management',
    icon: FaBuilding,
    description: 'پروژه را انتخاب یا ایجاد کنید'
  },
  {
    id: 4,
    title: 'انتخاب محصولات',
    titleEn: 'Product Selection',
    icon: FaWarehouse,
    description: 'محصولات را به قرارداد اضافه کنید'
  },
  {
    id: 5,
    title: 'برنامه تحویل',
    titleEn: 'Delivery Schedule',
    icon: FaTruck,
    description: 'زمان‌بندی تحویل را ثبت کنید'
  },
  {
    id: 6,
    title: 'روش پرداخت',
    titleEn: 'Payment Method',
    icon: FaCreditCard,
    description: 'اقلام پرداخت را تعریف کنید'
  },
  {
    id: 7,
    title: 'تایید دیجیتال',
    titleEn: 'Digital Confirmation',
    icon: FaSignature,
    description: 'تایید نهایی قرارداد'
  }
];


