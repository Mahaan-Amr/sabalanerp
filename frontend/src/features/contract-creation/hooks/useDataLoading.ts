// useDataLoading Hook
// Manages data fetching for contract creation wizard

import { useState, useCallback, useEffect, useRef } from 'react';
import type { CuttingType, Product, SubService, StoneFinishing } from '../types/contract.types';
import { salesAPI, servicesAPI, dashboardAPI } from '@/lib/api';
import { getSalesOperationalErrorKind, getSalesOperationalErrorMessage } from '@/features/sales/salesOperationalError';
import { createLatestRequestTracker } from '@/features/sales/latestRequestTracker';

interface UseDataLoadingOptions {
  productStepActive: boolean;
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

export const useDataLoading = ({ productStepActive, onError, onDataLoaded }: UseDataLoadingOptions) => {

  const onErrorRef = useRef(onError);
  const onDataLoadedRef = useRef(onDataLoaded);

  useEffect(() => {
    onErrorRef.current = onError;
    onDataLoadedRef.current = onDataLoaded;
  }, [onError, onDataLoaded]);

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

  const productCatalogRequest = useRef<Promise<unknown> | null>(null);
  const productCatalogStarted = useRef(false);
  const [productCatalogReady, setProductCatalogReady] = useState(false);
  const [productCatalogError, setProductCatalogError] = useState<DataLoadError>();
  const errorSequenceRef = useRef(0);
  const activeErrorsRef = useRef(new Map<string, DataLoadError>());
  const requestTrackerRef = useRef(createLatestRequestTracker());
  const beginRequest = useCallback((source: string) => requestTrackerRef.current.begin(source), []);
  const isLatestRequest = useCallback((source: string, sequence: number) =>
    requestTrackerRef.current.isLatest(source, sequence), []);

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

  const reportResponseFailure = useCallback((source: string, response: unknown, resource: string) => {
    const failure = { response };
    reportError(source, loadErrorMessage(failure, resource), getSalesOperationalErrorKind(failure));
  }, [reportError]);

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

  const loadProducts = useCallback(async (limit: number = 1000) => {
    const requestSequence = beginRequest('products');
    try {
      const response = await salesAPI.getProducts({ limit });
      if (!isLatestRequest('products', requestSequence)) return [];
      if (response.data.success) {
        setProducts(response.data.data);
        recoverError('products');
        return response.data.data;
      }
      reportResponseFailure('products', response, 'فهرست محصولات');
      return [];
    } catch (err: any) {
      if (!isLatestRequest('products', requestSequence)) return [];
      const errorMsg = loadErrorMessage(err, 'فهرست محصولات');
      reportError('products', errorMsg, getSalesOperationalErrorKind(err));
      return [];
    }
  }, [beginRequest, isLatestRequest, recoverError, reportError, reportResponseFailure]);

  const loadDepartments = useCallback(async () => {
    const requestSequence = beginRequest('departments');
    try {
      const response = await salesAPI.getDepartments();
      if (!isLatestRequest('departments', requestSequence)) return [];
      if (response.data.success) {
        setDepartments(response.data.data);
        recoverError('departments');
        return response.data.data;
      }
      reportResponseFailure('departments', response, 'اطلاعات واحد فروش');
      return [];
    } catch (err: any) {
      if (!isLatestRequest('departments', requestSequence)) return [];
      const errorMsg = loadErrorMessage(err, 'اطلاعات واحد فروش');
      reportError('departments', errorMsg, getSalesOperationalErrorKind(err));
      return [];
    }
  }, [beginRequest, isLatestRequest, recoverError, reportError, reportResponseFailure]);

  const loadCuttingTypes = useCallback(async () => {
    const requestSequence = beginRequest('cuttingTypes');
    try {
      const response = await servicesAPI.getCuttingTypes({ isActive: true });
      if (!isLatestRequest('cuttingTypes', requestSequence)) return [];
      if (response.data.success) {
        setCuttingTypes(response.data.data);
        recoverError('cuttingTypes');
        return response.data.data;
      }
      reportResponseFailure('cuttingTypes', response, 'انواع برش');
      return [];
    } catch (err: any) {
      if (!isLatestRequest('cuttingTypes', requestSequence)) return [];
      if (isForbiddenError(err)) {
        recoverError('cuttingTypes');
        setCuttingTypes([]);
        return [];
      }
      const errorMsg = loadErrorMessage(err, 'انواع برش');
      reportError('cuttingTypes', errorMsg, getSalesOperationalErrorKind(err));
      return [];
    }
  }, [beginRequest, isLatestRequest, recoverError, reportError, reportResponseFailure]);

  const loadSubServices = useCallback(async (limit: number = 1000) => {
    const requestSequence = beginRequest('subServices');
    try {
      const response = await servicesAPI.getSubServices({ isActive: true, limit });
      if (!isLatestRequest('subServices', requestSequence)) return [];
      if (response.data.success) {
        setSubServices(response.data.data);
        recoverError('subServices');
        return response.data.data;
      }
      reportResponseFailure('subServices', response, 'فهرست ابزارها');
      return [];
    } catch (err: any) {
      if (!isLatestRequest('subServices', requestSequence)) return [];
      if (isForbiddenError(err)) {
        recoverError('subServices');
        setSubServices([]);
        return [];
      }
      const errorMsg = loadErrorMessage(err, 'فهرست ابزارها');
      reportError('subServices', errorMsg, getSalesOperationalErrorKind(err));
      return [];
    }
  }, [beginRequest, isLatestRequest, recoverError, reportError, reportResponseFailure]);

  const loadStoneFinishings = useCallback(async (limit: number = 1000) => {
    const requestSequence = beginRequest('stoneFinishings');
    try {
      const response = await servicesAPI.getStoneFinishings({ isActive: true, limit });
      if (!isLatestRequest('stoneFinishings', requestSequence)) return [];
      if (response.data.success) {
        const data = response.data.data || [];
        setStoneFinishings(data);
        setStoneFinishingLoadState(data.length > 0 ? 'available' : 'empty');
        recoverError('stoneFinishings');
        return data;
      }
      reportResponseFailure('stoneFinishings', response, 'روش‌های پرداخت سنگ');
      setStoneFinishingLoadState('error');
      return [];
    } catch (err: any) {
      if (!isLatestRequest('stoneFinishings', requestSequence)) return [];
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
  }, [beginRequest, isLatestRequest, recoverError, reportError, reportResponseFailure]);

  const loadUserProfile = useCallback(async () => {
    const requestSequence = beginRequest('userProfile');
    try {
      const response = await dashboardAPI.getProfile();
      if (!isLatestRequest('userProfile', requestSequence)) return null;
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
      reportResponseFailure('userProfile', response, 'اطلاعات کاربر');
      return null;
    } catch (err: any) {
      if (!isLatestRequest('userProfile', requestSequence)) return null;
      const errorMsg = loadErrorMessage(err, 'اطلاعات کاربر');
      reportError('userProfile', errorMsg, getSalesOperationalErrorKind(err));
      return null;
    }
  }, [beginRequest, buildCapabilities, isLatestRequest, recoverError, reportError, reportResponseFailure]);

  const loadInitialData = useCallback(async () => {
    const requestSequence = beginRequest('initial');
    setLoading(true);
    const errorSequenceAtStart = errorSequenceRef.current;

    try {
      const profile = await loadUserProfile();
      if (!isLatestRequest('initial', requestSequence)) return;
      if (!profile) return;
      await loadDepartments();
      if (!isLatestRequest('initial', requestSequence)) return;
      const recoveredInitialError = activeErrorsRef.current.has('initial');
      recoverError('initial');

      if (!recoveredInitialError && errorSequenceRef.current === errorSequenceAtStart && activeErrorsRef.current.size === 0 && onDataLoadedRef.current) {
        setError(null);
        onDataLoadedRef.current();
      }
    } catch (err: any) {
      if (!isLatestRequest('initial', requestSequence)) return;
      const errorMsg = loadErrorMessage(err, 'اطلاعات اولیه قرارداد');
      reportError('initial', errorMsg, getSalesOperationalErrorKind(err));
    } finally {
      if (isLatestRequest('initial', requestSequence)) setLoading(false);
    }
  }, [beginRequest, isLatestRequest, loadUserProfile, loadDepartments, recoverError, reportError]);

  const loadProductCatalog = useCallback(async () => {
    if (!currentUser || productCatalogRequest.current) return;
    const loads: Record<string, () => Promise<unknown>> = { products: loadProducts };
    if (capabilities.canLoadCuttingTypes) loads.cuttingTypes = loadCuttingTypes;
    if (capabilities.canLoadSubServices) loads.subServices = loadSubServices;
    if (capabilities.canLoadStoneFinishings) loads.stoneFinishings = loadStoneFinishings;
    else setStoneFinishingLoadState('forbidden');

    const sources = Object.keys(loads);
    const pending = productCatalogStarted.current ? sources.filter(source => activeErrorsRef.current.has(source)) : sources;
    productCatalogStarted.current = true;
    setProductCatalogError(undefined);
    const request = Promise.all(pending.map(source => loads[source]()));
    productCatalogRequest.current = request;
    try {
      await request;
      const failure = sources.map(source => activeErrorsRef.current.get(source)).find(Boolean);
      setProductCatalogError(failure);
      setProductCatalogReady(!failure);
    } finally {
      productCatalogRequest.current = null;
    }
  }, [currentUser, capabilities, loadProducts, loadCuttingTypes, loadSubServices, loadStoneFinishings]);

  useEffect(() => {
    if (productStepActive && !productCatalogStarted.current) void loadProductCatalog();
  }, [productStepActive, loadProductCatalog]);

  const getCuttingTypePricePerMeter = useCallback(
    (code: string): number | null => {
      const cuttingType = cuttingTypes.find((ct) => ct.code === code);
      return cuttingType?.pricePerMeter ?? null;
    },
    [cuttingTypes]
  );

  return {
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
    productCatalogReady,
    productCatalogError,
    loadProductCatalog,

    loading,
    error,

    setProducts,
    setDepartments,
    setCuttingTypes,
    setSubServices,
    setStoneFinishings,
    setUserDepartment,
    setCurrentUser,

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
