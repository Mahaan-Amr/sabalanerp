import { useCallback, useMemo } from 'react';
import { PRODUCT_TYPES } from '../constants/contract.constants';
import type {
  ContractProduct,
  ContractUsageType,
  ContractWizardData,
  Product,
  RemainingStone
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
  hasItems: boolean;
  summary: {
    totalPrice: number;
    totalSquareMeters: number;
    totalQuantity: number;
  };
  editItem: (index: number) => void;
  removeItem: (index: number) => void;
  useRemainingStone?: (remainingStone: RemainingStone, sourceProduct: ContractProduct) => void;
}

export interface ContractProductCartController {
  catalog: ProductCatalogController;
  cart: ProductCartController;
  draft: ContractProductDraft;
}

interface UseContractProductCartControllerOptions {
  wizardData: ContractWizardData;
  updateWizardData: (updates: Partial<ContractWizardData>) => void;
  products: Product[];
  filteredProducts: Product[];
  productSearchTerm: string;
  setProductSearchTerm: (term: string) => void;
  productsSummary: ProductCartController['summary'];
  selectProduct: (product: Product) => void;
  editProduct: (index: number) => void;
  removeProduct: (index: number) => void;
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
  filteredProducts,
  productSearchTerm,
  setProductSearchTerm,
  productsSummary,
  selectProduct,
  editProduct,
  removeProduct,
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
    cart: {
      items: wizardData.products,
      hasItems: wizardData.products.length > 0,
      summary: productsSummary,
      editItem: editProduct,
      removeItem: removeProduct,
      useRemainingStone
    },
    draft
  };
};
