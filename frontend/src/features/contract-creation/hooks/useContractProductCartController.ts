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
import { normalizeDigits } from '@/lib/numberFormat';
import { resolveContractRowIndex } from '../components/steps/contractCartRows';

type ProductCartType = Extract<ContractUsageType, 'longitudinal' | 'stair' | 'slab' | 'prepared'>;

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
  editItem: (rowId: string) => void;
  duplicateItem: (rowId: string) => void;
  removeItem: (rowId: string) => void;
  updateItemImages: (rowId: string, images: string[]) => void;
  updateServiceRow: (rowId: string, updates: Partial<Pick<ContractServiceRow, 'quantity' | 'unitPrice' | 'description' | 'images'>>) => void;
  duplicateServiceRow: (rowId: string) => void;
  removeServiceRow: (rowId: string) => void;
  uploadImage: (file: File) => Promise<string>;
  useRemainingStone?: (remainingStone: RemainingStone, sourceProduct: ContractProduct) => void;
  resolveLegacyRemainingAddOns: (rowId: string, action: 'adopt' | 'remove') => void;
}

export interface ServiceCatalogController {
  sourceType: ContractServiceRowSourceType;
  setSourceType: (sourceType: ContractServiceRowSourceType) => void;
  query: string;
  setQuery: (term: string) => void;
  rows: Array<SubService | CuttingType | StoneFinishing>;
  counts: Record<ContractServiceRowSourceType, number>;
  hasSearch: boolean;
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
  duplicateProduct: (index: number) => void;
  removeProduct: (index: number) => void;
  updateProductImages: (index: number, images: string[]) => void;
  addServiceRow: (sourceType: ContractServiceRowSourceType, item: SubService | CuttingType | StoneFinishing) => void;
  updateServiceRow: ProductCartController['updateServiceRow'];
  duplicateServiceRow: (rowId: string) => void;
  removeServiceRow: (rowId: string) => void;
  uploadImage: (file: File) => Promise<string>;
  useRemainingStone?: (remainingStone: RemainingStone, sourceProduct: ContractProduct) => void;
  resolveLegacyRemainingAddOns: (index: number, action: 'adopt' | 'remove') => void;
  createProduct: () => void;
}

const CATALOG_PRODUCT_TYPES = PRODUCT_TYPES.filter((type): type is typeof PRODUCT_TYPES[number] & { id: ProductCartType } =>
  type.id === 'longitudinal' || type.id === 'stair' || type.id === 'slab' || type.id === 'prepared'
);

const normalizeSearchText = (value: unknown): string =>
  normalizeDigits(String(value ?? '')).toLowerCase();

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
  duplicateProduct,
  removeProduct,
  updateProductImages,
  addServiceRow,
  updateServiceRow,
  duplicateServiceRow,
  removeServiceRow,
  uploadImage,
  useRemainingStone,
  resolveLegacyRemainingAddOns,
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
    const query = normalizeSearchText(serviceSearchTerm).trim();
    const sourceRows =
      serviceSourceType === 'tool'
        ? subServices
        : serviceSourceType === 'cutting'
          ? cuttingTypes
          : stoneFinishings;

    if (!query) return [];
    return sourceRows.filter((row) => {
      const searchable = [
        row.namePersian,
        row.name,
        'code' in row ? row.code : '',
        row.description || ''
      ].join(' ');
      const normalizedSearchable = normalizeSearchText(searchable);
      return normalizedSearchable.includes(query);
    });
  }, [cuttingTypes, serviceSearchTerm, serviceSourceType, stoneFinishings, subServices]);

  const withResolvedRow = useCallback((
    rowId: string,
    action: (index: number, product: ContractProduct) => void
  ) => {
    const index = resolveContractRowIndex(wizardData.products, rowId);
    if (index < 0) return;
    const product = wizardData.products[index];
    if (!product) return;
    action(index, product);
  }, [wizardData.products]);

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
      hasSearch: serviceSearchTerm.trim().length > 0,
      addRow: addServiceRow
    },
    cart: {
      items: wizardData.products,
      serviceRows: wizardData.serviceRows || [],
      hasItems: wizardData.products.length > 0 || (wizardData.serviceRows || []).length > 0,
      hasServiceRows: (wizardData.serviceRows || []).length > 0,
      summary: productsSummary,
      editItem: (rowId) => withResolvedRow(rowId, index => editProduct(index)),
      duplicateItem: (rowId) => withResolvedRow(rowId, index => duplicateProduct(index)),
      removeItem: (rowId) => withResolvedRow(rowId, index => removeProduct(index)),
      updateItemImages: (rowId, images) => withResolvedRow(rowId, index => updateProductImages(index, images)),
      updateServiceRow,
      duplicateServiceRow,
      removeServiceRow,
      uploadImage,
      useRemainingStone,
      resolveLegacyRemainingAddOns: (rowId, action) =>
        withResolvedRow(rowId, index => resolveLegacyRemainingAddOns(index, action))
    },
    draft
  };
};
