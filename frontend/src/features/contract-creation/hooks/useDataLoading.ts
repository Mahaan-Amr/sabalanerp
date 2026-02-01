// useDataLoading Hook
// Manages data fetching for contract creation wizard

import { useState, useCallback, useEffect, useRef } from 'react';
import type { CrmCustomer, Product, SubService, StoneFinishing } from '../types/contract.types';
import { crmAPI, salesAPI, servicesAPI, dashboardAPI } from '@/lib/api';

interface UseDataLoadingOptions {
  autoLoad?: boolean;
  onError?: (error: string) => void;
  onDataLoaded?: () => void;
}

interface CuttingType {
  code: string;
  pricePerMeter: number | null;
}

interface Department {
  id: string;
  name: string;
  [key: string]: any;
}

interface UserProfile {
  departmentId: string;
  firstName: string;
  lastName: string;
  [key: string]: any;
}

export const useDataLoading = (options: UseDataLoadingOptions = {}) => {
  const { autoLoad = true, onError, onDataLoaded } = options;

  // Use refs to store callbacks to avoid dependency issues
  const onErrorRef = useRef(onError);
  const onDataLoadedRef = useRef(onDataLoaded);
  
  // Update refs when callbacks change
  useEffect(() => {
    onErrorRef.current = onError;
    onDataLoadedRef.current = onDataLoaded;
  }, [onError, onDataLoaded]);

  // Data state
  const [customers, setCustomers] = useState<CrmCustomer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [cuttingTypes, setCuttingTypes] = useState<CuttingType[]>([]);
  const [subServices, setSubServices] = useState<SubService[]>([]);
  const [stoneFinishings, setStoneFinishings] = useState<StoneFinishing[]>([]);
  
  // User state
  const [userDepartment, setUserDepartment] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<{ firstName: string; lastName: string } | null>(null);
  
  // Loading state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Track if initial load has been done to prevent duplicate calls
  const hasLoadedRef = useRef(false);

  // Load customers
  const loadCustomers = useCallback(async () => {
    try {
      const response = await crmAPI.getCustomers();
      if (response.data.success) {
        setCustomers(response.data.data);
        return response.data.data;
      }
      return [];
    } catch (err: any) {
      const errorMsg = err.response?.data?.error || 'خطا در بارگذاری مشتریان';
      setError(errorMsg);
      if (onErrorRef.current) onErrorRef.current(errorMsg);
      return [];
    }
  }, []);

  // Load products
  const loadProducts = useCallback(async (limit: number = 1000) => {
    try {
      const response = await salesAPI.getProducts({ limit });
      if (response.data.success) {
        setProducts(response.data.data);
        return response.data.data;
      }
      return [];
    } catch (err: any) {
      const errorMsg = err.response?.data?.error || 'خطا در بارگذاری محصولات';
      setError(errorMsg);
      if (onErrorRef.current) onErrorRef.current(errorMsg);
      return [];
    }
  }, []);

  // Load departments
  const loadDepartments = useCallback(async () => {
    try {
      const response = await salesAPI.getDepartments();
      if (response.data.success) {
        setDepartments(response.data.data);
        return response.data.data;
      }
      return [];
    } catch (err: any) {
      const errorMsg = err.response?.data?.error || 'خطا در بارگذاری دپارتمان‌ها';
      setError(errorMsg);
      if (onErrorRef.current) onErrorRef.current(errorMsg);
      return [];
    }
  }, []);

  // Load cutting types
  const loadCuttingTypes = useCallback(async () => {
    try {
      const response = await servicesAPI.getCuttingTypes({ isActive: true });
      if (response.data.success) {
        setCuttingTypes(response.data.data);
        return response.data.data;
      }
      return [];
    } catch (err: any) {
      const errorMsg = err.response?.data?.error || 'خطا در بارگذاری انواع برش';
      setError(errorMsg);
      if (onErrorRef.current) onErrorRef.current(errorMsg);
      return [];
    }
  }, []);

  // Load sub-services
  const loadSubServices = useCallback(async (limit: number = 1000) => {
    try {
      const response = await servicesAPI.getSubServices({ isActive: true, limit });
      if (response.data.success) {
        setSubServices(response.data.data);
        return response.data.data;
      }
      return [];
    } catch (err: any) {
      const errorMsg = err.response?.data?.error || 'خطا در بارگذاری ابزارها';
      setError(errorMsg);
      if (onErrorRef.current) onErrorRef.current(errorMsg);
      return [];
    }
  }, []);

  // Load stone finishings
  const loadStoneFinishings = useCallback(async (limit: number = 1000) => {
    try {
      const response = await servicesAPI.getStoneFinishings({ isActive: true, limit });
      if (response.data.success) {
        setStoneFinishings(response.data.data);
        return response.data.data;
      }
      return [];
    } catch (err: any) {
      const errorMsg = err.response?.data?.error || 'خطا در بارگذاری پرداخت‌ها';
      setError(errorMsg);
      if (onErrorRef.current) onErrorRef.current(errorMsg);
      return [];
    }
  }, []);

  // Load user profile
  const loadUserProfile = useCallback(async () => {
    try {
      const response = await dashboardAPI.getProfile();
      if (response.data.success) {
        const userData: UserProfile = response.data.data;
        setUserDepartment(userData.departmentId);
        setCurrentUser({
          firstName: userData.firstName || '',
          lastName: userData.lastName || ''
        });
        return userData;
      }
      return null;
    } catch (err: any) {
      const errorMsg = err.response?.data?.error || 'خطا در بارگذاری پروفایل کاربر';
      setError(errorMsg);
      if (onErrorRef.current) onErrorRef.current(errorMsg);
      return null;
    }
  }, []);

  // Load all initial data
  const loadInitialData = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      // Load user profile first
      await loadUserProfile();
      
      // Load all data in parallel
      await Promise.all([
        loadCustomers(),
        loadProducts(1000),
        loadDepartments(),
        loadCuttingTypes(),
        loadSubServices(1000),
        loadStoneFinishings(1000)
      ]);
      
      if (onDataLoadedRef.current) {
        onDataLoadedRef.current();
      }
    } catch (err: any) {
      const errorMsg = err.response?.data?.error || 'خطا در بارگذاری اطلاعات اولیه';
      setError(errorMsg);
      if (onErrorRef.current) onErrorRef.current(errorMsg);
    } finally {
      setLoading(false);
    }
  }, [loadUserProfile, loadCustomers, loadProducts, loadDepartments, loadCuttingTypes, loadSubServices, loadStoneFinishings]);

  // Auto-load on mount if enabled - only run once
  useEffect(() => {
    if (autoLoad && !hasLoadedRef.current) {
      hasLoadedRef.current = true;
      loadInitialData();
    }
  }, [autoLoad, loadInitialData]);

  // Get cutting type price per meter
  const getCuttingTypePricePerMeter = useCallback((code: string): number | null => {
    const cuttingType = cuttingTypes.find(ct => ct.code === code);
    return cuttingType?.pricePerMeter ?? null;
  }, [cuttingTypes]);

  return {
    // Data
    customers,
    products,
    departments,
    cuttingTypes,
    subServices,
    stoneFinishings,
    userDepartment,
    currentUser,
    
    // Loading state
    loading,
    error,
    
    // Setters
    setCustomers,
    setProducts,
    setDepartments,
    setCuttingTypes,
    setSubServices,
    setStoneFinishings,
    setUserDepartment,
    setCurrentUser,
    
    // Loaders
    loadCustomers,
    loadProducts,
    loadDepartments,
    loadCuttingTypes,
    loadSubServices,
    loadStoneFinishings,
    loadUserProfile,
    loadInitialData,
    
    // Helpers
    getCuttingTypePricePerMeter
  };
};

