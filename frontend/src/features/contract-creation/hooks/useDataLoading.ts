// useDataLoading Hook
// Manages data fetching for contract creation wizard

import { useState, useCallback, useEffect, useRef } from 'react';
import type { CrmCustomer, CuttingType, Product, SubService, StoneFinishing } from '../types/contract.types';
import { crmAPI, salesAPI, servicesAPI, dashboardAPI } from '@/lib/api';
import { getSalesOperationalErrorKind, getSalesOperationalErrorMessage } from '@/features/sales/salesOperationalError';

interface UseDataLoadingOptions {
  autoLoad?: boolean;
  onError?: (error: string, kind: 'error' | 'permission' | 'stale') => void;
  onDataLoaded?: () => void;
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
type CustomerLoadParams = { limit?: number; search?: string };
type DataLoadError = {
  message: string;
  kind: 'error' | 'permission' | 'stale';
  order: number;
};

const permissionLevels: PermissionLevel[] = ['view', 'edit', 'admin'];

const loadErrorMessage = (err: unknown, resource: string) =>
  getSalesOperationalErrorMessage(err, {
    failedAction: `دریافت ${resource}`,
    nextStep: 'اتصال را بررسی کنید و دوباره تلاش کنید.'
  });

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
  const [currentUser, setCurrentUser] = useState<{ id?: string; username?: string; firstName: string; lastName: string; role?: string } | null>(null);
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
  const errorSequenceRef = useRef(0);
  const activeErrorsRef = useRef(new Map<string, DataLoadError>());
  const customerRequestSequenceRef = useRef(0);

  const publishLatestError = useCallback(() => {
    const latest = Array.from(activeErrorsRef.current.values())
      .sort((left, right) => right.order - left.order)[0];

    if (latest) {
      setError(latest.message);
      onErrorRef.current?.(latest.message, latest.kind);
      return;
    }

    setError(null);
    onDataLoadedRef.current?.();
  }, []);

  const reportError = useCallback((source: string, message: string, kind: 'error' | 'permission' | 'stale') => {
    errorSequenceRef.current += 1;
    activeErrorsRef.current.set(source, { message, kind, order: errorSequenceRef.current });
    setError(message);
    onErrorRef.current?.(message, kind);
  }, []);

  const recoverError = useCallback((source: string) => {
    if (!activeErrorsRef.current.delete(source)) return;
    publishLatestError();
  }, [publishLatestError]);

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
        'inventory_sub_services_create',
        'sales_contracts_view',
        'sales_contracts_create',
        'sales_contracts_edit'
      ]) || hasWorkspaceAccess(workspaces, ['inventory', 'sales'], 'view'),
      canLoadStoneFinishings: hasAnyFeature(features, [
        'inventory_stone_finishings_view',
        'inventory_stone_finishings_edit',
        'inventory_stone_finishings_create',
        'sales_contracts_view',
        'sales_contracts_create',
        'sales_contracts_edit'
      ]) || hasWorkspaceAccess(workspaces, ['inventory', 'sales'], 'view')
    }),
    [hasAnyFeature, hasWorkspaceAccess]
  );

  const loadCustomers = useCallback(async (params: CustomerLoadParams = {}) => {
    const requestSequence = ++customerRequestSequenceRef.current;
    try {
      const response = await crmAPI.getCustomers({
        limit: params.limit ?? 3,
        search: params.search?.trim() || undefined
      });
      if (requestSequence !== customerRequestSequenceRef.current) return [];
      if (response.data.success) {
        const data = response.data.data || [];
        setCustomers(data);
        recoverError('customers');
        return data;
      }
      return [];
    } catch (err: any) {
      if (requestSequence !== customerRequestSequenceRef.current) return [];
      if (isForbiddenError(err)) {
        const message = 'برای دریافت مشتریان از CRM دسترسی لازم را ندارید.';
        reportError('customers', message, 'permission');
        setCustomers([]);
        return [];
      }
      const errorMsg = loadErrorMessage(err, 'فهرست مشتریان');
      reportError('customers', errorMsg, getSalesOperationalErrorKind(err));
      return [];
    }
  }, [recoverError, reportError]);

  const loadProducts = useCallback(async (limit: number = 1000) => {
    try {
      const response = await salesAPI.getProducts({ limit });
      if (response.data.success) {
        setProducts(response.data.data);
        recoverError('products');
        return response.data.data;
      }
      return [];
    } catch (err: any) {
      const errorMsg = loadErrorMessage(err, 'فهرست محصولات');
      reportError('products', errorMsg, getSalesOperationalErrorKind(err));
      return [];
    }
  }, [recoverError, reportError]);

  const loadDepartments = useCallback(async () => {
    try {
      const response = await salesAPI.getDepartments();
      if (response.data.success) {
        setDepartments(response.data.data);
        recoverError('departments');
        return response.data.data;
      }
      return [];
    } catch (err: any) {
      const errorMsg = loadErrorMessage(err, 'اطلاعات واحد فروش');
      reportError('departments', errorMsg, getSalesOperationalErrorKind(err));
      return [];
    }
  }, [recoverError, reportError]);

  const loadCuttingTypes = useCallback(async () => {
    try {
      const response = await servicesAPI.getCuttingTypes({ isActive: true });
      if (response.data.success) {
        setCuttingTypes(response.data.data);
        recoverError('cuttingTypes');
        return response.data.data;
      }
      return [];
    } catch (err: any) {
      if (isForbiddenError(err)) {
        recoverError('cuttingTypes');
        setCuttingTypes([]);
        return [];
      }
      const errorMsg = loadErrorMessage(err, 'انواع برش');
      reportError('cuttingTypes', errorMsg, getSalesOperationalErrorKind(err));
      return [];
    }
  }, [recoverError, reportError]);

  const loadSubServices = useCallback(async (limit: number = 1000) => {
    try {
      const response = await servicesAPI.getSubServices({ isActive: true, limit });
      if (response.data.success) {
        setSubServices(response.data.data);
        recoverError('subServices');
        return response.data.data;
      }
      return [];
    } catch (err: any) {
      if (isForbiddenError(err)) {
        recoverError('subServices');
        setSubServices([]);
        return [];
      }
      const errorMsg = loadErrorMessage(err, 'فهرست ابزارها');
      reportError('subServices', errorMsg, getSalesOperationalErrorKind(err));
      return [];
    }
  }, [recoverError, reportError]);

  const loadStoneFinishings = useCallback(async (limit: number = 1000) => {
    try {
      const response = await servicesAPI.getStoneFinishings({ isActive: true, limit });
      if (response.data.success) {
        const data = response.data.data || [];
        setStoneFinishings(data);
        setStoneFinishingLoadState(data.length > 0 ? 'available' : 'empty');
        recoverError('stoneFinishings');
        return data;
      }
      setStoneFinishings([]);
      setStoneFinishingLoadState('empty');
      return [];
    } catch (err: any) {
      if (isForbiddenError(err)) {
        recoverError('stoneFinishings');
        setStoneFinishings([]);
        setStoneFinishingLoadState('forbidden');
        return [];
      }
      const errorMsg = loadErrorMessage(err, 'روش‌های پرداخت سنگ');
      reportError('stoneFinishings', errorMsg, getSalesOperationalErrorKind(err));
      setStoneFinishings([]);
      setStoneFinishingLoadState('error');
      return [];
    }
  }, [recoverError, reportError]);

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
          id: userData.id,
          username: userData.username,
          firstName: userData.firstName || '',
          lastName: userData.lastName || '',
          role: userData.role
        });
        recoverError('userProfile');
        return userData;
      }
      return null;
    } catch (err: any) {
      const errorMsg = loadErrorMessage(err, 'اطلاعات کاربر');
      reportError('userProfile', errorMsg, getSalesOperationalErrorKind(err));
      return null;
    }
  }, [buildCapabilities, recoverError, reportError]);

  const loadInitialData = useCallback(async () => {
    setLoading(true);
    const errorSequenceAtStart = errorSequenceRef.current;

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
        const message = 'برای دریافت مشتریان از CRM دسترسی لازم را ندارید.';
        setCustomers([]);
        reportError('customers', message, 'permission');
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
      const recoveredInitialError = activeErrorsRef.current.has('initial');
      recoverError('initial');

      if (!recoveredInitialError && errorSequenceRef.current === errorSequenceAtStart && activeErrorsRef.current.size === 0 && onDataLoadedRef.current) {
        setError(null);
        onDataLoadedRef.current();
      }
    } catch (err: any) {
      const errorMsg = loadErrorMessage(err, 'اطلاعات اولیه قرارداد');
      reportError('initial', errorMsg, getSalesOperationalErrorKind(err));
    } finally {
      setLoading(false);
    }
  }, [buildCapabilities, loadUserProfile, loadProducts, loadDepartments, loadCustomers, loadCuttingTypes, loadSubServices, loadStoneFinishings, recoverError, reportError]);

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
