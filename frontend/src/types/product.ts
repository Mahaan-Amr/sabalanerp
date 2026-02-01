export interface Product {
  id: string;
  code: string;
  name: string;
  namePersian: string;
  fullName?: string;
  
  // Product Attributes
  cuttingDimensionCode: string;
  cuttingDimensionName: string;
  cuttingDimensionNamePersian: string;
  
  stoneTypeCode: string;
  stoneTypeName: string;
  stoneTypeNamePersian: string;
  
  widthCode: string;
  widthValue: number;
  widthName: string;
  
  thicknessCode: string;
  thicknessValue: number;
  thicknessName: string;
  
  mineCode: string;
  mineName: string;
  mineNamePersian: string;
  
  finishCode: string;
  finishName: string;
  finishNamePersian: string;
  
  colorCode: string;
  colorName: string;
  colorNamePersian: string;
  
  qualityCode: string;
  qualityName: string;
  qualityNamePersian: string;
  
  // Pricing and Availability
  basePrice: number | null;
  currency: string;
  isAvailable: boolean;
  leadTime: number | null;
  
  // Additional Info
  description: string | null;
  images: string[];
  isActive: boolean;
  availableInLongitudinalContracts: boolean;
  availableInStairContracts: boolean;
  availableInSlabContracts: boolean;
  availableInVolumetricContracts: boolean;
  deletedAt: string | null;
  
  createdAt: string;
  updatedAt: string;
}

export interface ProductFilters {
  searchTerm?: string;
  stoneType?: string;
  mine?: string;
  finish?: string;
  isAvailable?: boolean;
  minPrice?: number;
  maxPrice?: number;
}

export interface ProductCreateData {
  code: string;
  name: string;
  namePersian: string;
  cuttingDimensionCode: string;
  cuttingDimensionName: string;
  cuttingDimensionNamePersian: string;
  stoneTypeCode: string;
  stoneTypeName: string;
  stoneTypeNamePersian: string;
  widthCode: string;
  widthValue: number;
  widthName: string;
  thicknessCode: string;
  thicknessValue: number;
  thicknessName: string;
  mineCode: string;
  mineName: string;
  mineNamePersian: string;
  finishCode: string;
  finishName: string;
  finishNamePersian: string;
  colorCode: string;
  colorName: string;
  colorNamePersian: string;
  qualityCode: string;
  qualityName: string;
  qualityNamePersian: string;
  basePrice?: number | null;
  currency?: string;
  isAvailable?: boolean;
  leadTime?: number | null;
  description?: string | null;
  images?: string[];
  isActive?: boolean;
  availableInLongitudinalContracts?: boolean;
  availableInStairContracts?: boolean;
  availableInSlabContracts?: boolean;
  availableInVolumetricContracts?: boolean;
}

export interface ProductUpdateData {
  basePrice?: number | null;
  currency?: string;
  isAvailable?: boolean;
  leadTime?: number | null;
  description?: string | null;
  images?: string[];
  isActive?: boolean;
  availableInLongitudinalContracts?: boolean;
  availableInStairContracts?: boolean;
  availableInSlabContracts?: boolean;
  availableInVolumetricContracts?: boolean;
}
