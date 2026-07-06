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
  ownerUserId?: string | null;
  ownerUser?: {
    id: string;
    firstName?: string;
    lastName?: string;
    username?: string;
  } | null;
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
  images?: string[];
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

export type PreparedProductKind = 'cubic' | 'readyPiece';
export type PreparedProductUnit = 'squareMeter' | 'ton' | 'count';
export type ContractProductType = 'longitudinal' | 'stair' | 'slab' | 'prepared' | 'volumetric';

export interface StoneCut {
  id: string;
  type?: 'longitudinal' | 'cross' | 'vertical';
  label?: string;
  description?: string;
  meters?: number;
  rate?: number;
  cost?: number;
  sourceLengthCm?: number;
  sourceWidthCm?: number;
  sourceQuantity?: number;
  requestedLengthCm?: number;
  requestedWidthCm?: number;
  selectedSides?: string[];
  originalWidth: number; // ?? ?? ??
  cutWidth: number; // cut width
  remainingWidth: number; // remaining width
  length: number; // ?? ??
  cuttingCost: number; // cutting cost
  cuttingCostPerMeter: number; // cutting cost per meter
  orientation?: 'longitudinal' | 'cross';
}

export interface RemainingStone {
  id: string;
  width: number; // partition width in cm
  length: number; // partition length in meters
  squareMeters: number; // partition area
  isAvailable: boolean; // ?? ?? ?? ??
  sourceCutId: string; // source cut id
  position?: { // placement position on stone/canvas
    startWidth: number; // ?? ?? (in cm)
    startLength: number; // ?? ?? (in meters)
  };
  // Cutting cost fields for partitions (when created from remaining stone)
  cuttingCost?: number; // cutting cost for this partition
  cuttingCostPerMeter?: number; // cutting cost per meter
  cutType?: 'longitudinal' | 'cross' | null; // ?? ??
  quantity?: number; // quantity
  physicalPieces?: Array<{
    width: number;
    length: number;
    quantity: number;
    squareMeters: number;
  }>;
}

export interface SlabStandardDimensionEntry {
  id: string; // Unique ID for this entry
  standardLengthCm: number; // standard length in cm
  standardWidthCm: number; // standard width in cm
  quantity: number; // quantity of stones
}

export interface StonePartition {
  id: string;
  width: number; // ?? ?? (in cm)
  length: number; // ?? ?? (in meters)
  quantity: number; // partition piece count
  squareMeters: number; // area in square meters
  physicalPieces?: Array<{
    width: number;
    length: number;
    quantity: number;
    squareMeters: number;
  }>;
  position?: { // placement position on stone/canvas
    startWidth: number; // ?? ?? (in cm)
    startLength: number; // ?? ?? (in meters)
  };
  validationError?: string; // placement validation error
}

export interface SubService {
  id: string;
  code: string;
  name?: string;
  namePersian: string;
  description?: string;
  pricePerMeter: number; // price per meter
  calculationBase: 'length' | 'squareMeters'; // ? ?? ?? ? ?? ??
  images?: string[];
  isActive: boolean;
}

export interface CuttingType {
  id: string;
  code: string;
  name?: string;
  namePersian: string;
  description?: string;
  pricePerMeter: number | null;
  images?: string[];
  isActive?: boolean;
}

export interface StoneFinishing {
  id: string;
  code?: string;
  name?: string;
  namePersian: string;
  description?: string;
  pricePerSquareMeter: number;
  unitPrice?: number | null;
  calculationBase?: 'length' | 'squareMeters';
  images?: string[];
  isActive: boolean;
}

export interface AppliedSubService {
  id: string; // Unique ID for this applied service
  subServiceId: string; // Reference to SubService
  subService: SubService; // Full SubService object
  meter: number; // used length or area
  cost: number; // total service cost
  calculationBase: 'length' | 'squareMeters'; // calculation base
  edges?: {
    front?: boolean;
    left?: boolean;
    right?: boolean;
    back?: boolean;
    perimeter?: boolean;
  };
}

export interface CuttingBreakdownEntry {
  type: 'longitudinal' | 'cross';
  meters: number;
  rate: number;
  cost: number;
}

export interface SmartCutProductionPiece {
  widthCm: number;
  lengthM: number;
  quantity: number;
}

export interface SmartLongitudinalCutPlan {
  enabled: boolean;
  mode: 'optimized' | 'single-strip' | 'none';
  sourceWidthCm: number;
  requestedWidthCm: number;
  consumedWidthCm: number;
  requestedLengthM: number;
  requestedQuantity: number;
  totalRequestedLengthM: number;
  sourceBandsNeeded?: number;
  stripsPerSource: number;
  sourceLengthConsumedM: number;
  consumedAreaSqm: number;
  requestedAreaSqm: number;
  sawKerfEnabled?: boolean;
  sawKerfCm?: number | null;
  calibrationCutEnabled?: boolean;
  productionPieces: SmartCutProductionPiece[];
  remainingStones: RemainingStone[];
  cuttingBreakdown: CuttingBreakdownEntry[];
  totalCuttingCost: number;
  warnings: string[];
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

export type ContractServiceRowSourceType = 'tool' | 'cutting' | 'finishing';
export type ContractServiceRowUnit = 'meter' | 'squareMeter' | 'count';

export interface ContractServiceRow {
  id: string;
  sourceType: ContractServiceRowSourceType;
  sourceId: string;
  sourceCode?: string | null;
  title: string;
  description?: string;
  unit: ContractServiceRowUnit;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  currency: string;
  images?: string[];
}

// Stair Part interface for individual parts of a stair system
export interface StairPart {
  // Part identification
  partType: 'tread' | 'riser' | 'landing'; // stair part type
  isSelected: boolean; // Whether this part is included in the stair system
  
  // Product selection
  productId: string | null;
  product: Product | null;
  
  // Part-specific dimensions
  // For Tread (? ??):
  treadWidth?: number; // ?? ?? (width of staircase) - in cm or m
  treadDepth?: number; // ?? ?? (depth of step) - in cm
  // For Riser (?? ??):
  riserHeight?: number; // riser height in cm
  // For landing:
  landingWidth?: number; // landing width in cm
  landingDepth?: number; // landing depth in cm
  numberOfLandings?: number; // number of landings
  
  // Quantity and pricing
  quantity: number; // quantity
  squareMeters: number; // ?? ??
  pricePerSquareMeter: number; // ? ? ?? ??
  totalPrice: number; // ?? ?
  
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
  partType: 'tread' | 'riser' | 'landing'; // stair part type
  isSelected: boolean; // Whether this part is included in the stair system
  
  // Product selection
  productId: string | null;
  product: Product | null;
  
  // Part-specific dimensions
  // For Tread (? ??):
  treadWidth?: number; // ?? ?? (width of staircase) - in cm or m
  treadDepth?: number; // ?? ?? (depth of step) - in cm
  // For Riser (?? ??):
  riserHeight?: number; // riser height in cm
  // For landing:
  landingWidth?: number; // landing width in cm
  landingDepth?: number; // landing depth in cm
  numberOfLandings?: number; // number of landings
  
  // Quantity and pricing
  quantity: number; // quantity
  squareMeters: number; // ?? ??
  pricePerSquareMeter: number; // ? ? ?? ??
  totalPrice: number; // ?? ?
  
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
  numberOfSteps: number; // number of steps
  quantityType: 'steps' | 'staircases'; // quantity type
  numberOfStaircases?: number; // if quantityType === 'staircases'
  
  // Default product (used when user first selects a product)
  defaultProduct: Product | null;
  
  // Three parts
  tread: StairPart;      // ? ??
  riser: StairPart;      // ?? ??
  landing: StairPart;    // landing
}

export interface ContractProduct {
  productId: string;
  product: Product;
  // Product type
  productType: ContractProductType; // product type
  preparedKind?: PreparedProductKind | null;
  preparedUnit?: PreparedProductUnit | null;
  preparedQuantity?: number | null;
  // Stair system linking (only for stair parts)
  stairSystemId?: string; // ID to link multiple items belonging to same stair system
  stairPartType?: 'tread' | 'riser' | 'landing'; // ?? ?? ??
  // Stone-specific fields (shared)
  stoneCode: string; // ? ??
  stoneName: string; // ?? ? ?? ??
  diameterOrWidth: number; // ?? ? ?? (constant for ?? and ??)
  length: number; // ??
  width: number; // ??
  quantity: number; // quantity
  squareMeters: number; // ?? ??
  pricePerSquareMeter: number; // ? ? ?? ??
  unitPrice?: number; // ?? ?? (used in some calculations)
  totalPrice: number; // ?? ?
  description: string; // ??
  images?: string[];
  currency: string;
  sawKerfEnabled?: boolean;
  sawKerfCm?: number | null;
  calibrationCutEnabled?: boolean;
  // Unit information for proper display
  lengthUnit: 'cm' | 'm'; // ?? ??
  widthUnit: 'cm' | 'm'; // ?? ??
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
  isMandatory: boolean; // ??
  mandatoryPercentage: number; // ?? ?? (default 20%)
  originalTotalPrice: number; // ?? ?? ?? ? ??
  // Stone cutting fields
  isCut: boolean; // whether product is cut
  cutType: 'longitudinal' | 'cross' | null; // ?? ??
  originalWidth: number; // ?? ?? ?? ?? ? ??
  originalLength: number; // original length before cutting in meters
  cuttingCost: number; // cutting cost
  cuttingCostPerMeter: number; // cutting cost per meter
  cutDescription: string; // ?? ??
  remainingStones: RemainingStone[]; // remaining stones
  cutDetails: StoneCut[]; // cut details
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
  // ?? ?? (vertical/perpendicular edge cuts) for slab stones
  slabVerticalCutSides?: {
    top: boolean;    // ??
    bottom: boolean; // bottom
    left: boolean;  // ?
    right: boolean; // ??
  };
  slabVerticalCutCost?: number; // vertical slab cutting cost
  slabVerticalCutCostPerMeter?: number; // vertical slab cutting cost per meter
  // Remaining stone usage tracking
  usedRemainingStones: RemainingStone[]; // used remaining stones
  totalUsedRemainingWidth: number; // total used remaining width
  totalUsedRemainingLength: number; // total used remaining length in meters
  // Parent-child relationship (explicit reference instead of stoneCode parsing)
  parentProductIndex?: number; // Index of parent product in wizardData.products array (for remaining stone relationships)
  // SubService tracking
  appliedSubServices: AppliedSubService[]; // applied sub-services
  totalSubServiceCost: number; // total sub-service cost
  usedLengthForSubServices: number; // length used for sub-services in meters
  usedSquareMetersForSubServices: number; // square meters used for sub-services
  cuttingBreakdown?: CuttingBreakdownEntry[];
  smartCutPlan?: SmartLongitudinalCutPlan | null;
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
  finishingEnabled?: boolean;
  finishingId?: string | null;
  finishingCode?: string | null;
  finishingName?: string | null;
  finishingPricePerSquareMeter?: number | null;
  finishingUnitPrice?: number | null;
  finishingCalculationBase?: 'length' | 'squareMeters' | null;
  finishingQuantity?: number | null;
  finishingSearchTerm?: string;
  finishingCost?: number | null;
  finishingSquareMeters?: number | null;
  // CAD Design (for visual design storage)
  cadDesign?: any; // Stores the CAD design data for future reference
}

export interface DeliveryProductItem {
  rowType?: 'product' | 'service';
  productIndex?: number; // Index in wizardData.products array
  serviceRowId?: string;
  productId: string;
  quantity: number; // Quantity for this specific delivery
  unit?: 'meter' | 'squareMeter' | 'ton' | 'count';
  amount?: number;
}

export interface DeliverySchedule {
  deliveryDate: string;
  projectManagerName: string; // project manager name
  receiverName: string; // ?? ??
  deliveryAddress?: string; // delivery address
  driver?: string; // driver
  vehicle?: string; // vehicle
  products: DeliveryProductItem[]; // Products with quantities for this delivery
  notes?: string;
}

// ?? (??) | ?? (??) | ? | ??????? ?? ????? ??????
export type PaymentEntryMethod = 'CASH_CARD' | 'CASH_SHIBA' | 'CHECK' | 'CUSTOMER_BALANCE';
export type ExtraPaymentReason = 'PREVIOUS_DEBT';

export interface PaymentEntry {
  id: string; // Unique ID for this payment entry
  method: PaymentEntryMethod; // ?? (??) | ?? (??) | ?
  amount: number; // amount in currency
  status?: 'PAID' | 'WILL_BE_PAID'; // Optional, for display
  paymentDate: string; // cash: payment date; check: clearance date
  description?: string;
  nationalCode?: string;
  checkNumber?: string; // check number
  checkOwnerName?: string; // ?: ?? ?? ?
  handoverDate?: string; // check handover date - Persian date
  cashType?: string; // Legacy / API: ?? | ?? for CASH
}

export interface PaymentMethod {
  payments: PaymentEntry[]; // Array of payment entries (compound payments)
  currency: string; // default currency
  totalContractAmount: number; // Sum of all products (for validation)
  extraPaymentReason?: ExtraPaymentReason | null;
}

export interface ContractDiscountSnapshot {
  enabled: boolean;
  rangeId?: string | null;
  rangeMinAmount?: number | null;
  rangeMaxAmount?: number | null;
  maxDiscountPercent?: number | null;
  baseSubtotal: number;
  percent: number;
  amount: number;
  currency: string;
  appliedAt?: string;
}

// Keep PaymentInstallment for backward compatibility if needed elsewhere
export interface PaymentInstallment {
  installmentNumber: number;
  amount: number;
  dueDate: string;
  notes?: string;
}

export type ContractKind = 'standard' | 'collaboration';

export interface ContractWizardData {
  contractKind?: ContractKind;

  // Step 1: Contract Date
  contractDate: string;
  contractNumber: string;
  creatorSequenceNumber?: number | null;
  
  // Step 2: Customer
  customerId: string;
  customer: CrmCustomer | null;
  
  // Step 3: Project
  projectId: string;
  project: ProjectAddress | null;
  
  // Last-used product type preference for modal default (not a required wizard step)
  selectedProductTypeForAddition: Exclude<ContractProductType, 'volumetric'> | null;
  
  // Step 5: Products (was Step 4)
  products: ContractProduct[];
  serviceRows: ContractServiceRow[];
  
  // Step 6: Delivery (was Step 5)
  deliveries: DeliverySchedule[];
  
  // Step 7: Payment (was Step 6)
  payment: PaymentMethod;
  discount?: ContractDiscountSnapshot | null;
  
  // Step 8: Signature (Digital Signature with SMS Verification)
  signature: {
    phoneNumber: string | null;
    contractId: string | null;
    contractStatus?: string | null;
    confirmationSent: boolean;
    confirmationStatus: 'PENDING' | 'VERIFIED' | 'EXPIRED' | 'CANCELLED' | null;
    linkExpiresAt: string | null;
    otpExpiresAt: string | null;
    attemptsUsed: number;
    maxAttempts: number;
    resendCount: number;
    lastSentAt: string | null;
    lastOpenedAt: string | null;
  } | null;
}

export interface ContractStep8ProductDetail {
  id: string;
  code: string;
  name: string;
  productType: string;
  stairPartType: string;
  dimensions: string;
  quantity: number;
  squareMeters: number;
  unitPrice: number;
  totalPrice: number;
  description: string;
}

export interface ContractStep8ServiceDetail {
  id: string;
  productName: string;
  category: string;
  name: string;
  amountLabel: string;
  rateLabel: string;
  cost: number;
}

export interface ContractStep8DeliveryDetail {
  id: string;
  deliveryDate: string;
  deliveryAddress: string;
  projectManagerName: string;
  receiverName: string;
  notes: string;
  products: Array<{
    productName: string;
    quantity: number;
    amountLabel?: string;
  }>;
}

export interface ContractStep8PaymentDetail {
  id: string;
  methodLabel: string;
  amount: number;
  paymentDate: string;
  handoverDate: string;
  checkNumber: string;
  checkOwnerName: string;
  status: string;
  description: string;
}

export interface ContractStep8FinancialSummary {
  productsTotal: number;
  servicesTotal: number;
  cutsTotal: number;
  finishingTotal: number;
  discountAmount?: number;
  discountPercent?: number;
  discountBaseSubtotal?: number;
  grandTotal: number;
  paymentTotal: number;
  remainingAmount: number;
  currency: string;
}

export type ContractUsageType = ContractProductType;

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
  // Stair tool edges. front/back use the part length; left/right use the part width/depth.
  front?: boolean;
  left?: boolean;
  right?: boolean;
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
  // Layer fields (??)
  numberOfLayersPerStair?: number | null; // layers per stair, e.g. 2 for double
  layerWidthCm?: number | null; // ?? ?? (cm) - width of the layer strip
  layerTypeId?: string | null;
  layerTypeName?: string | null;
  layerTypePrice?: number | null;
  // Layer edges - which sides of the stair need layers
  layerEdges?: {
    front?: boolean;
    left?: boolean;
    right?: boolean;
    back?: boolean;
    perimeter?: boolean;
  };
  layerUseDifferentStone?: boolean;
  layerStoneProductId?: string | null;
  layerStoneProduct?: Product | null;
  layerStoneLabel?: string | null;
  layerPricePerSquareMeter?: number | null;
  layerUseMandatory?: boolean;
  layerMandatoryPercentage?: number | null;
  layerShortageSource?: 'fullOrigin' | 'manualWarehouse' | 'autoSuggested' | null;
  layerManualSourceWidthCm?: number | null;
  layerManualSourceLengthM?: number | null;
  layerManualSourceQuantity?: number | null;
  standardLengthValue?: number | null;
  standardLengthUnit?: UnitType;
  // Finishing fields
  finishingEnabled?: boolean;
  finishingId?: string | null;
  finishingCode?: string | null;
  finishingLabel?: string | null;
  finishingPricePerSquareMeter?: number | null;
  finishingUnitPrice?: number | null;
  finishingCalculationBase?: 'length' | 'squareMeters' | null;
  finishingQuantity?: number | null;
  finishingSearchTerm?: string;
  calibrationCutEnabled?: boolean;
  description?: string | null;
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
