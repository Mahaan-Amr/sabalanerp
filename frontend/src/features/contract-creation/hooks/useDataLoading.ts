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
  permissions?: {
    features?: Array<{ feature: string; permissionLevel: string; workspace: string }>;
    workspaces?: Array<{ workspace: string; permissionLevel: string }>;
  };
  [key: string]: any;
}

interface DataCapabilities {
  canLoadCustomers: boolean;
  canLoadCuttingTypes: boolean;
  canLoadSubServices: boolean;
  canLoadStoneFinishings: boolean;
}

type StoneFinishingLoadState = 'idle' | 'available' | 'empty' | 'forbidden' | 'error';

type PermissionLevel = 'view' | 'edit' | 'admin';

const permissionLevels: PermissionLevel[] = ['view', 'edit', 'admin'];

export const useDataLoading = (options: UseDataLoadingOptions = {}) => {
  const { autoLoad = true, onError, onDataLoaded } = options;

  const onErrorRef = useRef(onError);
  const onDataLoadedRef = useRef(onDataLoaded);

  useEffect(() => {
    onErrorRef.current = onError;
    onDataLoadedRef.current = onDataLoaded;
  }, [onError, onDataLoaded]);

  const [customers, setCustomers] = useState<CrmCustomer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [cuttingTypes, setCuttingTypes] = useState<CuttingType[]>([]);
  const [subServices, setSubServices] = useState<SubService[]>([]);
  const [stoneFinishings, setStoneFinishings] = useState<StoneFinishing[]>([]);
  const [stoneFinishingLoadState, setStoneFinishingLoadState] = useState<StoneFinishingLoadState>('idle');

  const [userDepartment, setUserDepartment] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<{ firstName: string; lastName: string; role?: string } | null>(null);
  const [grantedFeatures, setGrantedFeatures] = useState<string[]>([]);
  const [grantedWorkspaces, setGrantedWorkspaces] = useState<Array<{ workspace: string; permissionLevel: string }>>([]);
  const [capabilities, setCapabilities] = useState<DataCapabilities>({
    canLoadCustomers: false,
    canLoadCuttingTypes: false,
    canLoadSubServices: false,
    canLoadStoneFinishings: false
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasLoadedRef = useRef(false);

  const isForbiddenError = (err: any) => err?.response?.status === 403;

  const hasAnyFeature = useCallback((features: string[], candidates: string[]) => {
    const granted = new Set(features);
    return candidates.some((feature) => granted.has(feature));
  }, []);

  const hasWorkspaceAccess = useCallback(
    (
      workspaces: Array<{ workspace: string; permissionLevel: string }>,
      candidates: string[],
      requiredPermission: PermissionLevel
    ) => {
      const requiredLevel = permissionLevels.indexOf(requiredPermission);
      return workspaces.some((item) => {
        if (!candidates.includes(item.workspace)) return false;
        const grantedLevel = permissionLevels.indexOf(item.permissionLevel as PermissionLevel);
        return grantedLevel >= requiredLevel;
      });
    },
    []
  );

  const buildCapabilities = useCallback(
    (
      features: string[],
      workspaces: Array<{ workspace: string; permissionLevel: string }>
    ): DataCapabilities => ({
      // Read access must come from explicit view permission (or workspace view+), not create-only.
      canLoadCustomers:
        hasAnyFeature(features, ['crm_customers_view', 'sales_customers_view']) ||
        hasWorkspaceAccess(workspaces, ['crm', 'sales'], 'view'),
      canLoadCuttingTypes: hasAnyFeature(features, [
        'inventory_cutting_types_view',
        'inventory_cutting_types_edit',
        'inventory_cutting_types_create',
        'sales_contracts_view',
        'sales_contracts_create'
      ]) || hasWorkspaceAccess(workspaces, ['inventory', 'sales'], 'view'),
      canLoadSubServices: hasAnyFeature(features, [
        'inventory_sub_services_view',
        'inventory_sub_services_edit',
        'inventory_sub_services_create'
      ]) || hasWorkspaceAccess(workspaces, ['inventory'], 'view'),
      canLoadStoneFinishings: hasAnyFeature(features, [
        'inventory_stone_finishings_view',
        'inventory_stone_finishings_edit',
        'inventory_stone_finishings_create',
        'sales_contracts_view',
        'sales_contracts_create'
      ]) || hasWorkspaceAccess(workspaces, ['inventory', 'sales'], 'view')
    }),
    [hasAnyFeature, hasWorkspaceAccess]
  );

  const loadCustomers = useCallback(async () => {
    try {
      const response = await crmAPI.getCustomers({ limit: 1000 });
      if (response.data.success) {
        const data = response.data.data || [];
        setCustomers(data);
        return data;
      }
      return [];
    } catch (err: any) {
      if (isForbiddenError(err)) {
        const message = '??? ??? ?? CRM ?? ?? ?? ?? ???.';
        setError(message);
        if (onErrorRef.current) onErrorRef.current(message);
        setCustomers([]);
        return [];
      }
      const errorMsg = err.response?.data?.error || 'Error loading customers';
      setError(errorMsg);
      if (onErrorRef.current) onErrorRef.current(errorMsg);
      return [];
    }
  }, []);

  const loadProducts = useCallback(async (limit: number = 1000) => {
    try {
      const response = await salesAPI.getProducts({ limit });
      if (response.data.success) {
        setProducts(response.data.data);
        return response.data.data;
      }
      return [];
    } catch (err: any) {
      const errorMsg = err.response?.data?.error || 'Error loading products';
      setError(errorMsg);
      if (onErrorRef.current) onErrorRef.current(errorMsg);
      return [];
    }
  }, []);

  const loadDepartments = useCallback(async () => {
    try {
      const response = await salesAPI.getDepartments();
      if (response.data.success) {
        setDepartments(response.data.data);
        return response.data.data;
      }
      return [];
    } catch (err: any) {
      const errorMsg = err.response?.data?.error || 'Error loading departments';
      setError(errorMsg);
      if (onErrorRef.current) onErrorRef.current(errorMsg);
      return [];
    }
  }, []);

  const loadCuttingTypes = useCallback(async () => {
    try {
      const response = await servicesAPI.getCuttingTypes({ isActive: true });
      if (response.data.success) {
        setCuttingTypes(response.data.data);
        return response.data.data;
      }
      return [];
    } catch (err: any) {
      if (isForbiddenError(err)) {
        setCuttingTypes([]);
        return [];
      }
      const errorMsg = err.response?.data?.error || 'Error loading cutting types';
      setError(errorMsg);
      if (onErrorRef.current) onErrorRef.current(errorMsg);
      return [];
    }
  }, []);

  const loadSubServices = useCallback(async (limit: number = 1000) => {
    try {
      const response = await servicesAPI.getSubServices({ isActive: true, limit });
      if (response.data.success) {
        setSubServices(response.data.data);
        return response.data.data;
      }
      return [];
    } catch (err: any) {
      if (isForbiddenError(err)) {
        setSubServices([]);
        return [];
      }
      const errorMsg = err.response?.data?.error || 'Error loading tools';
      setError(errorMsg);
      if (onErrorRef.current) onErrorRef.current(errorMsg);
      return [];
    }
  }, []);

  const loadStoneFinishings = useCallback(async (limit: number = 1000) => {
    try {
      const response = await servicesAPI.getStoneFinishings({ isActive: true, limit });
      if (response.data.success) {
        const data = response.data.data || [];
        setStoneFinishings(data);
        setStoneFinishingLoadState(data.length > 0 ? 'available' : 'empty');
        return data;
      }
      setStoneFinishings([]);
      setStoneFinishingLoadState('empty');
      return [];
    } catch (err: any) {
      if (isForbiddenError(err)) {
        setStoneFinishings([]);
        setStoneFinishingLoadState('forbidden');
        return [];
      }
      const errorMsg = err.response?.data?.error || 'Error loading stone finishings';
      setError(errorMsg);
      setStoneFinishings([]);
      setStoneFinishingLoadState('error');
      if (onErrorRef.current) onErrorRef.current(errorMsg);
      return [];
    }
  }, []);

  const loadUserProfile = useCallback(async () => {
    try {
      const response = await dashboardAPI.getProfile();
      if (response.data.success) {
        const userData: UserProfile = response.data.data;
        const features = (userData.permissions?.features || []).map((item) => item.feature);
        const workspaces = userData.permissions?.workspaces || [];
        const nextCapabilities = buildCapabilities(features, workspaces);

        setGrantedFeatures(features);
        setGrantedWorkspaces(workspaces);
        setCapabilities(nextCapabilities);
        setUserDepartment(userData.departmentId);
        setCurrentUser({
          firstName: userData.firstName || '',
          lastName: userData.lastName || '',
          role: userData.role
        });
        return userData;
      }
      return null;
    } catch (err: any) {
      const errorMsg = err.response?.data?.error || 'Error loading user profile';
      setError(errorMsg);
      if (onErrorRef.current) onErrorRef.current(errorMsg);
      return null;
    }
  }, [buildCapabilities]);

  const loadInitialData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const profile = await loadUserProfile();
      const features = (profile?.permissions?.features || []).map((item: any) => item.feature);
      const workspaces = profile?.permissions?.workspaces || [];
      const nextCapabilities = buildCapabilities(features, workspaces);
      setCapabilities(nextCapabilities);

      const tasks: Promise<any>[] = [loadProducts(1000), loadDepartments()];
      if (nextCapabilities.canLoadCustomers) {
        tasks.push(loadCustomers());
      } else {
        const message = '?? ??? ?? CRM ?? ??? ??? ?? ?? ???.';
        setCustomers([]);
        setError(message);
        if (onErrorRef.current) onErrorRef.current(message);
      }
      if (nextCapabilities.canLoadCuttingTypes) tasks.push(loadCuttingTypes());
      if (nextCapabilities.canLoadSubServices) tasks.push(loadSubServices(1000));
      if (nextCapabilities.canLoadStoneFinishings) {
        tasks.push(loadStoneFinishings(1000));
      } else {
        setStoneFinishings([]);
        setStoneFinishingLoadState('forbidden');
      }

      await Promise.all(tasks);

      if (onDataLoadedRef.current) {
        onDataLoadedRef.current();
      }
    } catch (err: any) {
      const errorMsg = err.response?.data?.error || 'Error loading initial data';
      setError(errorMsg);
      if (onErrorRef.current) onErrorRef.current(errorMsg);
    } finally {
      setLoading(false);
    }
  }, [buildCapabilities, loadUserProfile, loadProducts, loadDepartments, loadCustomers, loadCuttingTypes, loadSubServices, loadStoneFinishings]);

  useEffect(() => {
    if (autoLoad && !hasLoadedRef.current) {
      hasLoadedRef.current = true;
      loadInitialData();
    }
  }, [autoLoad, loadInitialData]);

  const getCuttingTypePricePerMeter = useCallback(
    (code: string): number | null => {
      const cuttingType = cuttingTypes.find((ct) => ct.code === code);
      return cuttingType?.pricePerMeter ?? null;
    },
    [cuttingTypes]
  );

  return {
    customers,
    products,
    departments,
    cuttingTypes,
    subServices,
    stoneFinishings,
    stoneFinishingLoadState,
    userDepartment,
    currentUser,
    grantedFeatures,
    grantedWorkspaces,
    capabilities,

    loading,
    error,

    setCustomers,
    setProducts,
    setDepartments,
    setCuttingTypes,
    setSubServices,
    setStoneFinishings,
    setUserDepartment,
    setCurrentUser,

    loadCustomers,
    loadProducts,
    loadDepartments,
    loadCuttingTypes,
    loadSubServices,
    loadStoneFinishings,
    loadUserProfile,
    loadInitialData,

    getCuttingTypePricePerMeter
  };
};

