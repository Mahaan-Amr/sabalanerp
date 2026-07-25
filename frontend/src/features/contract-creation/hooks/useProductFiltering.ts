// useProductFiltering Hook
// Provides filtered lists for customers and products based on search terms

import { useMemo } from 'react';
import type { CrmCustomer, Product, ContractUsageType } from '../types/contract.types';
import { productSupportsContractRoute } from '../utils/productUtils';
import { normalizeDigits } from '@/lib/numberFormat';
import {
  rankContractCatalogProducts,
  type SellerProductHistory
} from '../components/steps/catalogProductRanking';

const CUSTOMER_PREVIEW_COUNT = 3;

interface UseProductFilteringOptions {
  customers: CrmCustomer[];
  products: Product[];
  customerSearchTerm: string;
  productSearchTerm: string;
  treadProductSearchTerm: string;
  riserProductSearchTerm: string;
  landingProductSearchTerm: string;
  selectedProductTypeForAddition: ContractUsageType | null;
  sellerProductHistory?: SellerProductHistory;
}

interface UseProductFilteringReturn {
  filteredCustomers: CrmCustomer[];
  filteredProducts: Product[];
  filteredTreadProducts: Product[];
  filteredRiserProducts: Product[];
  filteredLandingProducts: Product[];
}

const normalizeSearchText = (value: unknown): string =>
  normalizeDigits(String(value ?? ''))
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/\u200c/g, ' ')
    .toLowerCase();

const compareProductsByWidthAsc = (a: Product, b: Product): number => {
  const widthDiff = (Number(a.widthValue) || 0) - (Number(b.widthValue) || 0);
  if (widthDiff !== 0) return widthDiff;
  const thicknessDiff = (Number(a.thicknessValue) || 0) - (Number(b.thicknessValue) || 0);
  if (thicknessDiff !== 0) return thicknessDiff;
  return normalizeSearchText(a.namePersian || a.name || a.code).localeCompare(
    normalizeSearchText(b.namePersian || b.name || b.code),
    'fa'
  );
};

export const useProductFiltering = (options: UseProductFilteringOptions): UseProductFilteringReturn => {
  const {
    customers,
    products,
    customerSearchTerm,
    productSearchTerm,
    treadProductSearchTerm,
    riserProductSearchTerm,
    landingProductSearchTerm,
    selectedProductTypeForAddition,
    sellerProductHistory
  } = options;

  // Filter customers based on search term
  const filteredCustomers = useMemo(() => {
    if (!customerSearchTerm.trim()) {
      // Show latest customers as preview when no search term
      return customers.slice(0, CUSTOMER_PREVIEW_COUNT);
    }

    // Show full filtered list when searching
    const searchLower = customerSearchTerm.toLowerCase();
    return customers.filter(customer =>
      customer.firstName.toLowerCase().includes(searchLower) ||
      customer.lastName.toLowerCase().includes(searchLower) ||
      (customer.companyName && customer.companyName.toLowerCase().includes(searchLower)) ||
      (customer.nationalCode && customer.nationalCode.includes(searchLower)) ||
      (customer.homeNumber && customer.homeNumber.includes(searchLower)) ||
      (customer.workNumber && customer.workNumber.includes(searchLower)) ||
      (customer.phoneNumbers && customer.phoneNumbers.some(phone =>
        phone.number.includes(searchLower) ||
        phone.number.replace(/\s+/g, '').includes(searchLower.replace(/\s+/g, ''))
      ))
    );
  }, [customers, customerSearchTerm]);

  const filteredProducts = useMemo(
    () => rankContractCatalogProducts({
      products,
      query: productSearchTerm,
      activeType: selectedProductTypeForAddition,
      sellerHistory: sellerProductHistory
    }).map(item => item.product),
    [products, productSearchTerm, selectedProductTypeForAddition, sellerProductHistory]
  );

  // Helper function to filter stair products
  const filterStairProducts = (searchTerm: string): Product[] => {
    const stairEligibleProducts = Array.from(new Map(
      products
        .filter(product => productSupportsContractRoute(product, 'stair'))
        .map(product => [product.id, product] as const)
    ).values());
    if (!searchTerm.trim()) {
      return stairEligibleProducts.slice(-3);
    }
    const searchLower = normalizeSearchText(searchTerm).trim();
    const searchTerms = searchLower.split(/\s+/).filter(term => term.length > 0);
    return stairEligibleProducts.filter(product => {
      const searchableFields = [
        product.code, product.namePersian, product.name,
        product.cuttingDimensionNamePersian, product.stoneTypeNamePersian,
        product.widthName, product.thicknessName, product.mineNamePersian,
        product.finishNamePersian, product.colorNamePersian, product.qualityNamePersian,
        product.widthValue?.toString(), product.thicknessValue?.toString(),
        product.basePrice?.toString(),
        product.fullName,
        `${product.stoneTypeNamePersian} ${product.cuttingDimensionNamePersian} عرض ${product.widthValue}×ضخامت ${product.thicknessValue}cm ${product.mineNamePersian} ${product.finishNamePersian} ${product.colorNamePersian} ${product.qualityNamePersian}`
      ].filter(Boolean);
      const searchableText = normalizeSearchText(searchableFields.join(' '));
      return searchTerms.length === 1
        ? searchableText.includes(searchTerms[0])
        : searchTerms.every(term => searchableText.includes(term));
    }).sort(compareProductsByWidthAsc);
  };

  // Filtered products for each stair part (independent product selection)
  const filteredTreadProducts = useMemo(() => {
    return filterStairProducts(treadProductSearchTerm);
  }, [products, treadProductSearchTerm]);

  const filteredRiserProducts = useMemo(() => {
    return filterStairProducts(riserProductSearchTerm);
  }, [products, riserProductSearchTerm]);

  const filteredLandingProducts = useMemo(() => {
    return filterStairProducts(landingProductSearchTerm);
  }, [products, landingProductSearchTerm]);

  return {
    filteredCustomers,
    filteredProducts,
    filteredTreadProducts,
    filteredRiserProducts,
    filteredLandingProducts
  };
};
