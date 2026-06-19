import { useCallback, useMemo } from 'react';
import { PRODUCT_TYPES } from '../constants/contract.constants';
import type {
  ContractProduct,
  ContractServiceRow,
  ContractServiceRowSourceType,
  ContractUsageType,
  ContractWizardData,
  CuttingType,
  Product,
  RemainingStone,
  StoneFinishing,
  SubService
} from '../types/contract.types';
import { productSupportsContractType } from '../utils/productUtils';

type ProductCartType = Extract<ContractUsageType, 'longitudinal' | 'stair' | 'slab'>;

export interface ContractProductDraft {
  mode: 'idle' | 'catalog-product' | 'remaining-stone' | 'editing-cart-item';
  product: Product | null;
  cartIndex: number | null;
  source?: {
    remainingStone: RemainingStone;
    sourceProduct: ContractProduct;
  } | null;
}

export interface ProductCatalogTypeOption {
  id: ProductCartType;
  name: string;
  nameEn: string;
  count: number;
}

export interface ProductCatalogController {
  query: string;
  setQuery: (term: string) => void;
  allProducts: Product[];
  products: Product[];
  activeType: ProductCartType | null;
  typeOptions: ProductCatalogTypeOption[];
  selectedTypeCount: number;
  hasSearch: boolean;
  selectType: (type: ProductCartType | null) => void;
  selectProduct: (product: Product) => void;
  createProduct: () => void;
}

export interface ProductCartController {
  items: ContractProduct[];
  serviceRows: ContractServiceRow[];
  hasItems: boolean;
  hasServiceRows: boolean;
  summary: {
    totalPrice: number;
    totalSquareMeters: number;
    totalQuantity: number;
  };
  editItem: (index: number) => void;
  removeItem: (index: number) => void;
  updateServiceRow: (rowId: string, updates: Partial<Pick<ContractServiceRow, 'quantity' | 'unitPrice' | 'description'>>) => void;
  removeServiceRow: (rowId: string) => void;
  useRemainingStone?: (remainingStone: RemainingStone, sourceProduct: ContractProduct) => void;
}

export interface ServiceCatalogController {
  sourceType: ContractServiceRowSourceType;
  setSourceType: (sourceType: ContractServiceRowSourceType) => void;
  query: string;
  setQuery: (term: string) => void;
  rows: Array<SubService | CuttingType | StoneFinishing>;
  counts: Record<ContractServiceRowSourceType, number>;
  addRow: (sourceType: ContractServiceRowSourceType, item: SubService | CuttingType | StoneFinishing) => void;
}

export interface ContractProductCartController {
  catalog: ProductCatalogController;
  services: ServiceCatalogController;
  cart: ProductCartController;
  draft: ContractProductDraft;
}

interface UseContractProductCartControllerOptions {
  wizardData: ContractWizardData;
  updateWizardData: (updates: Partial<ContractWizardData>) => void;
  products: Product[];
  subServices: SubService[];
  cuttingTypes: CuttingType[];
  stoneFinishings: StoneFinishing[];
  filteredProducts: Product[];
  productSearchTerm: string;
  setProductSearchTerm: (term: string) => void;
  serviceSearchTerm: string;
  setServiceSearchTerm: (term: string) => void;
  serviceSourceType: ContractServiceRowSourceType;
  setServiceSourceType: (sourceType: ContractServiceRowSourceType) => void;
  productsSummary: ProductCartController['summary'];
  selectProduct: (product: Product) => void;
  editProduct: (index: number) => void;
  removeProduct: (index: number) => void;
  addServiceRow: (sourceType: ContractServiceRowSourceType, item: SubService | CuttingType | StoneFinishing) => void;
  updateServiceRow: ProductCartController['updateServiceRow'];
  removeServiceRow: (rowId: string) => void;
  useRemainingStone?: (remainingStone: RemainingStone, sourceProduct: ContractProduct) => void;
  createProduct: () => void;
}

const CATALOG_PRODUCT_TYPES = PRODUCT_TYPES.filter((type): type is typeof PRODUCT_TYPES[number] & { id: ProductCartType } =>
  type.id === 'longitudinal' || type.id === 'stair' || type.id === 'slab'
);

export const useContractProductCartController = ({
  wizardData,
  updateWizardData,
  products,
  subServices,
  cuttingTypes,
  stoneFinishings,
  filteredProducts,
  productSearchTerm,
  setProductSearchTerm,
  serviceSearchTerm,
  setServiceSearchTerm,
  serviceSourceType,
  setServiceSourceType,
  productsSummary,
  selectProduct,
  editProduct,
  removeProduct,
  addServiceRow,
  updateServiceRow,
  removeServiceRow,
  useRemainingStone,
  createProduct
}: UseContractProductCartControllerOptions): ContractProductCartController => {
  const activeType = wizardData.selectedProductTypeForAddition;

  const typeOptions = useMemo<ProductCatalogTypeOption[]>(() => (
    CATALOG_PRODUCT_TYPES.map((type) => ({
      id: type.id,
      name: type.name,
      nameEn: type.nameEn,
      count: products.filter((product) => productSupportsContractType(product, type.id)).length
    }))
  ), [products]);

  const selectType = useCallback((type: ProductCartType | null) => {
    updateWizardData({ selectedProductTypeForAddition: type });
  }, [updateWizardData]);

  const draft = useMemo<ContractProductDraft>(() => ({
    mode: 'idle',
    product: null,
    cartIndex: null,
    source: null
  }), []);

  const serviceCounts = useMemo(() => ({
    tool: subServices.length,
    cutting: cuttingTypes.length,
    finishing: stoneFinishings.length
  }), [cuttingTypes.length, stoneFinishings.length, subServices.length]);

  const serviceRows = useMemo(() => {
    const query = serviceSearchTerm.trim().toLowerCase();
    const sourceRows =
      serviceSourceType === 'tool'
        ? subServices
        : serviceSourceType === 'cutting'
          ? cuttingTypes
          : stoneFinishings;

    if (!query) return sourceRows;
    return sourceRows.filter((row) => {
      const searchable = [
        row.namePersian,
        row.name,
        'code' in row ? row.code : '',
        row.description || ''
      ].join(' ').toLowerCase();
      return searchable.includes(query);
    });
  }, [cuttingTypes, serviceSearchTerm, serviceSourceType, stoneFinishings, subServices]);

  return {
    catalog: {
      query: productSearchTerm,
      setQuery: setProductSearchTerm,
      allProducts: products,
      products: filteredProducts,
      activeType,
      typeOptions,
      selectedTypeCount: activeType
        ? typeOptions.find((type) => type.id === activeType)?.count ?? 0
        : products.length,
      hasSearch: productSearchTerm.trim().length > 0,
      selectType,
      selectProduct,
      createProduct
    },
    services: {
      sourceType: serviceSourceType,
      setSourceType: setServiceSourceType,
      query: serviceSearchTerm,
      setQuery: setServiceSearchTerm,
      rows: serviceRows,
      counts: serviceCounts,
      addRow: addServiceRow
    },
    cart: {
      items: wizardData.products,
      serviceRows: wizardData.serviceRows || [],
      hasItems: wizardData.products.length > 0 || (wizardData.serviceRows || []).length > 0,
      hasServiceRows: (wizardData.serviceRows || []).length > 0,
      summary: productsSummary,
      editItem: editProduct,
      removeItem: removeProduct,
      updateServiceRow,
      removeServiceRow,
      useRemainingStone
    },
    draft
  };
};
