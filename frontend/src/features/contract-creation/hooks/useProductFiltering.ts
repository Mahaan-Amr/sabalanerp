// useProductFiltering Hook
// Provides filtered lists for customers and products based on search terms

import { useMemo } from 'react';
import type { CrmCustomer, Product, ContractUsageType } from '../types/contract.types';
import { productSupportsContractType } from '../utils/productUtils';
import { normalizeDigits } from '@/lib/numberFormat';

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
    selectedProductTypeForAddition
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

  // Filter products based on search term and selected product type
  const filteredProducts = useMemo(() => {
    // Require search term to show products - no preview of latest products
    if (!productSearchTerm.trim()) {
      return [];
    }

    const selectedType = selectedProductTypeForAddition;
    const eligibleProducts = selectedType
      ? products.filter(product => productSupportsContractType(product, selectedType))
      : products;

    const searchLower = normalizeSearchText(productSearchTerm).trim();
    const searchTerms = searchLower.split(/\s+/).filter(term => term.length > 0);

    return eligibleProducts.filter(product => {
      // Create a comprehensive search string that includes all searchable fields
      const searchableFields = [
        product.code,
        product.namePersian,
        product.name,
        product.cuttingDimensionNamePersian,
        product.stoneTypeNamePersian,
        product.widthName,
        product.thicknessName,
        product.mineNamePersian,
        product.finishNamePersian,
        product.colorNamePersian,
        product.qualityNamePersian,
        product.description,
        product.currency,
        // Include numeric values as strings for searching
        product.widthValue?.toString(),
        product.thicknessValue?.toString(),
        product.basePrice?.toString(),
        // Include dimension combinations
        `${product.widthValue}×${product.thicknessValue}`,
        `عرض ${product.widthValue}×ضخامت ${product.thicknessValue}`,
        // Include full product name generation
        `${product.stoneTypeNamePersian} ${product.cuttingDimensionNamePersian} عرض ${product.widthValue}×ضخامت ${product.thicknessValue}cm ${product.mineNamePersian} ${product.finishNamePersian} ${product.colorNamePersian} ${product.qualityNamePersian}`
      ].filter(Boolean);

      // Create a single searchable text
      const searchableText = normalizeSearchText(searchableFields.join(' '));

      // If only one search term, use simple includes
      if (searchTerms.length === 1) {
        return searchableText.includes(searchTerms[0]);
      }

      // If multiple search terms, all must be found (AND logic)
      return searchTerms.every(term => searchableText.includes(term));
    }).sort(compareProductsByWidthAsc);
  }, [products, productSearchTerm, selectedProductTypeForAddition]);

  // Helper function to filter stair products
  const filterStairProducts = (searchTerm: string): Product[] => {
    const stairEligibleProducts = products.filter(product => productSupportsContractType(product, 'stair'));
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
