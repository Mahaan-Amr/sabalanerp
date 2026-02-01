// Contract Creation Types
// All TypeScript interfaces and types for contract creation feature

export interface CrmCustomer {
  id: string;
  firstName: string;
  lastName: string;
  companyName?: string;
  customerType: string;
  status: string;
  projectAddresses: ProjectAddress[];
  phoneNumbers: PhoneNumber[];
  nationalCode?: string;
  homeAddress?: string;
  homeNumber?: string;
  workAddress?: string;
  workNumber?: string;
  projectManagerName?: string;
  projectManagerNumber?: string;
  brandName?: string;
  brandNameDescription?: string;
  isBlacklisted: boolean;
  isLocked: boolean;
}

export interface ProjectAddress {
  id: string;
  address: string;
  city: string;
  postalCode?: string;
  projectName?: string;
  projectType?: string;
  projectManagerName?: string;
  projectManagerNumber?: string;
  isActive: boolean;
}

export interface PhoneNumber {
  id: string;
  number: string;
  type: 'mobile' | 'home' | 'work' | 'other';
  isPrimary: boolean;
  isActive: boolean;
}

export interface Product {
  id: string;
  code: string;
  name: string;
  namePersian: string;
  fullName?: string;
  basePrice?: number;
  currency: string;
  isAvailable: boolean;
  leadTime?: number;
  description?: string;
  // Product attributes
  cuttingDimensionNamePersian: string;
  stoneTypeNamePersian: string;
  widthValue: number;
  thicknessValue: number;
  widthName: string;
  thicknessName: string;
  mineNamePersian: string;
  finishNamePersian: string;
  colorNamePersian: string;
  qualityNamePersian: string;
  availableInLongitudinalContracts?: boolean;
  availableInStairContracts?: boolean;
  availableInSlabContracts?: boolean;
  availableInVolumetricContracts?: boolean;
}

export interface StoneCut {
  id: string;
  originalWidth: number; // عرض اصلی سنگ
  cutWidth: number; // عرض برش خورده
  remainingWidth: number; // عرض باقی‌مانده
  length: number; // طول برش
  cuttingCost: number; // هزینه برش
  cuttingCostPerMeter: number; // هزینه برش به ازای هر متر
  orientation?: 'longitudinal' | 'cross';
}

export interface RemainingStone {
  id: string;
  width: number; // عرض باقی‌مانده (in cm)
  length: number; // طول باقی‌مانده (in meters)
  squareMeters: number; // متر مربع باقی‌مانده
  isAvailable: boolean; // آیا قابل استفاده است
  sourceCutId: string; // شناسه برش اصلی
  position?: { // موقعیت در سنگ اصلی (برای نمایش در canvas) - فقط برای پارتیشن‌ها
    startWidth: number; // شروع عرض (in cm)
    startLength: number; // شروع طول (in meters)
  };
  // Cutting cost fields for partitions (when created from remaining stone)
  cuttingCost?: number; // هزینه برش برای این پارتیشن
  cuttingCostPerMeter?: number; // هزینه برش به ازای هر متر
  cutType?: 'longitudinal' | 'cross' | null; // نوع برش
  quantity?: number; // تعداد (برای محاسبه هزینه برش)
}

export interface SlabStandardDimensionEntry {
  id: string; // Unique ID for this entry
  standardLengthCm: number; // طول استاندارد (in cm)
  standardWidthCm: number; // عرض استاندارد (in cm)
  quantity: number; // تعداد این ابعاد استاندارد
}

export interface StonePartition {
  id: string;
  width: number; // عرض پارتیشن (in cm)
  length: number; // طول پارتیشن (in meters)
  squareMeters: number; // متر مربع (محاسبه شده)
  position?: { // موقعیت در سنگ اصلی (برای نمایش در canvas)
    startWidth: number; // شروع عرض (in cm)
    startLength: number; // شروع طول (in meters)
  };
  validationError?: string; // خطای اعتبارسنجی برای این پارتیشن خاص
}

export interface SubService {
  id: string;
  code: string;
  name?: string;
  namePersian: string;
  description?: string;
  pricePerMeter: number; // هزینه هر متر ابزار (تومان)
  calculationBase: 'length' | 'squareMeters'; // بر اساس طول یا متر مربع
  isActive: boolean;
}

export interface StoneFinishing {
  id: string;
  name?: string;
  namePersian: string;
  description?: string;
  pricePerSquareMeter: number;
  isActive: boolean;
}

export interface AppliedSubService {
  id: string; // Unique ID for this applied service
  subServiceId: string; // Reference to SubService
  subService: SubService; // Full SubService object
  meter: number; // مقدار استفاده شده (طول یا متر مربع)
  cost: number; // هزینه محاسبه شده
  calculationBase: 'length' | 'squareMeters'; // مبنای محاسبه
}

export interface CuttingBreakdownEntry {
  type: 'longitudinal' | 'cross';
  meters: number;
  rate: number;
  cost: number;
}

export interface ServiceEntry {
  key: string;
  type: 'tool' | 'layer' | 'cut' | 'finishing';
  productName: string;
  description: string;
  amountLabel: string;
  cost: number;
  meta?: {
    rateLabel?: string;
  };
}

// Stair Part interface for individual parts of a stair system
export interface StairPart {
  // Part identification
  partType: 'tread' | 'riser' | 'landing'; // کف پله, خیز پله, پاگرد
  isSelected: boolean; // Whether this part is included in the stair system
  
  // Product selection
  productId: string | null;
  product: Product | null;
  
  // Part-specific dimensions
  // For Tread (کف پله):
  treadWidth?: number; // طول پله (width of staircase) - in cm or m
  treadDepth?: number; // عرض پله (depth of step) - in cm
  // For Riser (خیز پله):
  riserHeight?: number; // ارتفاع قائمه - in cm
  // For Landing (پاگرد):
  landingWidth?: number; // عرض پاگرد - in cm
  landingDepth?: number; // عمق پاگرد - in cm
  numberOfLandings?: number; // تعداد پاگرد
  
  // Quantity and pricing
  quantity: number; // تعداد
  squareMeters: number; // متر مربع
  pricePerSquareMeter: number; // فی هر متر مربع
  totalPrice: number; // قیمت کل
  
  // Nosing (only for tread)
  nosingType?: string;
  nosingOverhang?: number; // mm
  nosingCuttingCost?: number;
  nosingCuttingCostPerMeter?: number;
  
  // Mandatory pricing
  isMandatory: boolean;
  mandatoryPercentage: number;
  originalTotalPrice: number;
  
  // Other fields
  description: string;
  currency: string;
  lengthUnit?: 'cm' | 'm'; // For tread width
}

// Stair Part interface for individual parts of a stair system (old flow)
export interface StairPart {
  // Part identification
  partType: 'tread' | 'riser' | 'landing'; // کف پله, خیز پله, پاگرد
  isSelected: boolean; // Whether this part is included in the stair system
  
  // Product selection
  productId: string | null;
  product: Product | null;
  
  // Part-specific dimensions
  // For Tread (کف پله):
  treadWidth?: number; // طول پله (width of staircase) - in cm or m
  treadDepth?: number; // عرض پله (depth of step) - in cm
  // For Riser (خیز پله):
  riserHeight?: number; // ارتفاع قائمه - in cm
  // For Landing (پاگرد):
  landingWidth?: number; // عرض پاگرد - in cm
  landingDepth?: number; // عمق پاگرد - in cm
  numberOfLandings?: number; // تعداد پاگرد
  
  // Quantity and pricing
  quantity: number; // تعداد
  squareMeters: number; // متر مربع
  pricePerSquareMeter: number; // فی هر متر مربع
  totalPrice: number; // قیمت کل
  
  // Nosing (only for tread)
  nosingType?: string;
  nosingOverhang?: number; // mm
  nosingCuttingCost?: number;
  nosingCuttingCostPerMeter?: number;
  
  // Mandatory pricing
  isMandatory: boolean;
  mandatoryPercentage: number;
  originalTotalPrice: number;
  
  // Other fields
  description: string;
  currency: string;
  lengthUnit?: 'cm' | 'm'; // For tread width
}

// Stair System configuration (old flow)
export interface StairSystemConfig {
  // Common configuration
  numberOfSteps: number; // تعداد پله
  quantityType: 'steps' | 'staircases'; // نوع تعداد
  numberOfStaircases?: number; // if quantityType === 'staircases'
  
  // Default product (used when user first selects a product)
  defaultProduct: Product | null;
  
  // Three parts
  tread: StairPart;      // کف پله
  riser: StairPart;      // خیز پله
  landing: StairPart;    // پاگرد
}

export interface ContractProduct {
  productId: string;
  product: Product;
  // Product type
  productType: 'longitudinal' | 'stair' | 'slab'; // نوع محصول
  // Stair system linking (only for stair parts)
  stairSystemId?: string; // ID to link multiple items belonging to same stair system
  stairPartType?: 'tread' | 'riser' | 'landing'; // نوع بخش پله
  // Stone-specific fields (shared)
  stoneCode: string; // کد سنگ
  stoneName: string; // نام یا نوع سنگ
  diameterOrWidth: number; // قطر یا عرض (constant for تایل and طولی)
  length: number; // طول
  width: number; // عرض
  quantity: number; // تعداد
  squareMeters: number; // متر مربع
  pricePerSquareMeter: number; // فی هر متر مربع
  unitPrice?: number; // قیمت واحد (used in some calculations)
  totalPrice: number; // قیمت کل
  description: string; // توضیحات
  currency: string;
  // Unit information for proper display
  lengthUnit: 'cm' | 'm'; // واحد طول
  widthUnit: 'cm' | 'm'; // واحد عرض
  standardLengthValue?: number | null;
  standardLengthUnit?: 'cm' | 'm';
  actualLengthMeters?: number | null;
  layerTypeId?: string | null;
  layerTypeName?: string | null;
  layerTypePrice?: number | null;
  layerUseDifferentStone?: boolean;
  layerStoneProductId?: string | null;
  layerStoneName?: string | null;
  layerStonePricePerSquareMeter?: number | null;
  layerStoneBasePricePerSquareMeter?: number | null;
  layerUseMandatory?: boolean;
  layerMandatoryPercentage?: number | null;
  // Mandatory pricing fields
  isMandatory: boolean; // حکمی
  mandatoryPercentage: number; // درصد حکمی (default 20%)
  originalTotalPrice: number; // قیمت اصلی قبل از حکمی
  // Stone cutting fields
  isCut: boolean; // آیا سنگ برش خورده است
  cutType: 'longitudinal' | 'cross' | null; // نوع برش
  originalWidth: number; // عرض اصلی سنگ قبل از برش
  originalLength: number; // طول اصلی سنگ قبل از استفاده (in meters) - برای محاسبه باقی‌مانده
  cuttingCost: number; // هزینه برش
  cuttingCostPerMeter: number; // هزینه برش به ازای هر متر
  cutDescription: string; // توضیحات برش
  remainingStones: RemainingStone[]; // سنگ‌های باقی‌مانده
  cutDetails: StoneCut[]; // جزئیات برش‌ها
  // Legacy single standard dimension fields (kept for backward compatibility)
  slabStandardLengthCm?: number | null;
  slabStandardWidthCm?: number | null;
  // New multiple standard dimensions support
  slabStandardDimensions?: SlabStandardDimensionEntry[]; // Array of standard dimension entries
  slabCuttingMode?: 'perSquareMeter' | 'lineBased';
  slabCuttingPricePerSquareMeter?: number | null;
  slabLineCuttingStrategy?: 'length' | 'width';
  slabLineCuttingLongitudinalMeters?: number | null;
  slabLineCuttingCrossMeters?: number | null;
  // برش قائم (vertical/perpendicular edge cuts) for slab stones
  slabVerticalCutSides?: {
    top: boolean;    // بالا
    bottom: boolean; // پایین
    left: boolean;  // چپ
    right: boolean; // راست
  };
  slabVerticalCutCost?: number; // هزینه برش قائم
  slabVerticalCutCostPerMeter?: number; // هزینه برش قائم به ازای هر متر
  // Remaining stone usage tracking
  usedRemainingStones: RemainingStone[]; // سنگ‌های باقی‌مانده استفاده شده
  totalUsedRemainingWidth: number; // مجموع عرض باقی‌مانده استفاده شده
  totalUsedRemainingLength: number; // مجموع طول باقی‌مانده استفاده شده (in meters)
  // Parent-child relationship (explicit reference instead of stoneCode parsing)
  parentProductIndex?: number; // Index of parent product in wizardData.products array (for remaining stone relationships)
  // SubService tracking
  appliedSubServices: AppliedSubService[]; // ابزارهای اعمال شده
  totalSubServiceCost: number; // مجموع هزینه ابزارها
  usedLengthForSubServices: number; // طول استفاده شده برای ابزارهای مبتنی بر طول (in meters)
  usedSquareMetersForSubServices: number; // متر مربع استفاده شده برای ابزارهای مبتنی بر متر مربع
  cuttingBreakdown?: CuttingBreakdownEntry[];
  // Stair-specific fields (for backward compatibility and display)
  treadWidth?: number;
  treadDepth?: number;
  riserHeight?: number;
  numberOfSteps?: number;
  quantityType?: 'steps' | 'staircases';
  nosingType?: string;
  nosingOverhang?: number;
  nosingCuttingCost?: number;
  nosingCuttingCostPerMeter?: number;
  landingWidth?: number;
  landingDepth?: number;
  numberOfLandings?: number;
  // Metadata for stair stepper V2 and other extensions
  meta?: any;
  // Stone finishing
  finishingId?: string | null;
  finishingName?: string | null;
  finishingPricePerSquareMeter?: number | null;
  finishingCost?: number | null;
  finishingSquareMeters?: number | null;
  // CAD Design (for visual design storage)
  cadDesign?: any; // Stores the CAD design data for future reference
}

export interface DeliveryProductItem {
  productIndex: number; // Index in wizardData.products array
  productId: string;
  quantity: number; // Quantity for this specific delivery
}

export interface DeliverySchedule {
  deliveryDate: string;
  projectManagerName: string; // نام مدیر پروژه
  receiverName: string; // نام تحویل‌گیرنده
  deliveryAddress?: string; // آدرس تحویل
  driver?: string; // راننده
  vehicle?: string; // وسیله نقلیه
  products: DeliveryProductItem[]; // Products with quantities for this delivery
  notes?: string;
}

export interface PaymentEntry {
  id: string; // Unique ID for this payment entry
  method: 'CASH' | 'CHECK'; // Payment method types
  amount: number; // Amount for this specific payment
  status: 'PAID' | 'WILL_BE_PAID'; // پرداخت شده | پرداخت خواهد شد
  paymentDate: string; // Persian date - paid date if PAID, due date if WILL_BE_PAID
  description?: string; // Optional description
  nationalCode?: string; // Optional national code for CHECK payments
  checkNumber?: string; // Required check number for CHECK payments
  cashType?: string; // Required cash type for CASH payments (e.g., فوری, عادی, پیش‌پرداخت, پس‌پرداخت)
}

export interface PaymentMethod {
  payments: PaymentEntry[]; // Array of payment entries (compound payments)
  currency: string; // Default: 'تومان'
  totalContractAmount: number; // Sum of all products (for validation)
}

// Keep PaymentInstallment for backward compatibility if needed elsewhere
export interface PaymentInstallment {
  installmentNumber: number;
  amount: number;
  dueDate: string;
  notes?: string;
}

export interface ContractWizardData {
  // Step 1: Contract Date
  contractDate: string;
  contractNumber: string;
  
  // Step 2: Customer
  customerId: string;
  customer: CrmCustomer | null;
  
  // Step 3: Project
  projectId: string;
  project: ProjectAddress | null;
  
  // Step 4: Product Type Selection (NEW)
  selectedProductTypeForAddition: 'longitudinal' | 'stair' | 'slab' | null; // Temporary selection for adding products
  
  // Step 5: Products (was Step 4)
  products: ContractProduct[];
  
  // Step 6: Delivery (was Step 5)
  deliveries: DeliverySchedule[];
  
  // Step 7: Payment (was Step 6)
  payment: PaymentMethod;
  
  // Step 8: Signature (Digital Signature with SMS Verification)
  signature: {
    phoneNumber: string | null;
    verificationCode: string;
    codeSent: boolean;
    codeVerified: boolean;
    contractId: string | null; // Store contract ID after creation
  } | null;
}

export type ContractUsageType = 'longitudinal' | 'stair' | 'slab' | 'volumetric';

export type ContractVisibilityField =
  | 'availableInLongitudinalContracts'
  | 'availableInStairContracts'
  | 'availableInSlabContracts'
  | 'availableInVolumetricContracts';

export interface SlabLineCutPlan {
  axisUsingStandard: 'length' | 'width';
  longitudinalMeters: number;
  crossMeters: number;
}

export interface WidthSlice {
  startWidth: number; // Where this slice starts (in cm)
  width: number; // Width of this slice (in cm)
  remainingLength: number; // Remaining length in this slice (in meters)
  startLength: number; // Where current cutting position starts in this slice (in meters)
}

export interface PartitionPositioningResult {
  positionedPartitions: StonePartition[];
  remainingWidthSlices: WidthSlice[]; // Remaining areas after all partitions are placed
}

export interface PartitionValidationResult {
  isValid: boolean;
  error?: string; // General error message
  partitionErrors: Map<string, string>; // Partition ID -> error message
  validatedPartitions: StonePartition[]; // Partitions with validation errors attached
}

// Stair System V2 Types
export type StairStepperPart = 'tread' | 'riser' | 'landing';
export type UnitType = 'cm' | 'm';

export interface ToolSelectionV2 {
  toolId: string;
  name: string;
  pricePerMeter: number;
  // edges for tread/riser
  front?: boolean;
  left?: boolean;
  right?: boolean;
  // landing-specific
  back?: boolean;
  perimeter?: boolean;
  computedMeters?: number;
  totalPrice?: number;
}

export interface StairPartDraftV2 {
  stoneId?: string | null;
  stoneLabel?: string;
  stoneProduct?: Product | null; // Full product object for ContractProduct
  pricePerSquareMeter?: number | null;
  useMandatory?: boolean;
  mandatoryPercentage?: number | null;
  thicknessCm?: number | null;
  lengthValue?: number | null;
  lengthUnit?: UnitType; // cm or m
  widthCm?: number | null;
  quantity?: number | null;
  squareMeters?: number | null;
  tools?: ToolSelectionV2[];
  totalPrice?: number | null;
  // Layer fields (لایه‌ها)
  numberOfLayersPerStair?: number | null; // تعداد لایه برای هر پله (e.g., 2 for double)
  layerWidthCm?: number | null; // عرض لایه (cm) - width of the layer strip
  layerTypeId?: string | null;
  layerTypeName?: string | null;
  layerTypePrice?: number | null;
  // Layer edges - which sides of the stair need layers
  layerEdges?: {
    front?: boolean; // لایه برای لبه جلو
    left?: boolean; // لایه برای لبه چپ
    right?: boolean; // لایه برای لبه راست
    back?: boolean; // لایه برای لبه عقب (only for landing)
    perimeter?: boolean; // لایه برای محیط کامل (only for landing)
  };
  layerUseDifferentStone?: boolean;
  layerStoneProductId?: string | null;
  layerStoneProduct?: Product | null;
  layerStoneLabel?: string | null;
  layerPricePerSquareMeter?: number | null;
  layerUseMandatory?: boolean;
  layerMandatoryPercentage?: number | null;
  standardLengthValue?: number | null;
  standardLengthUnit?: UnitType;
  // Finishing fields
  finishingEnabled?: boolean;
  finishingId?: string | null;
  finishingLabel?: string | null;
  finishingPricePerSquareMeter?: number | null;
}

export interface StairDraftFieldErrors {
  thickness?: string;
  length?: string;
  width?: string;
  pricePerSquareMeter?: string;
  quantity?: string;
  layerType?: string;
  layerStone?: string;
  layerStonePrice?: string;
  layerMandatoryPercentage?: string;
  mandatoryPercentage?: string;
}

export interface LayerTypeOption {
  id: string;
  name: string;
  description?: string;
  pricePerLayer: number;
  isActive?: boolean;
}

export type LayerEdgeDemand = {
  edge: 'front' | 'back' | 'left' | 'right' | 'perimeter';
  layersNeeded: number;
  lengthM: number;
};

