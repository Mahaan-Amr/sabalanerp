'use client';
import { ErpInput, ErpPressable, ErpSelect } from '@/components/erp';
import React, { useState, useEffect } from 'react';
import { FaUsers, FaCog, FaPlus, FaEdit, FaTrash, FaEye, FaCheck, FaTimes, FaLock } from 'react-icons/fa';
import { usersAPI, permissionsAPI, authAPI, workspacePermissionsAPI } from '@/lib/api';
import EnhancedDropdown, { DropdownOption } from '@/components/EnhancedDropdown';
import { useRouter, useSearchParams } from 'next/navigation';

interface FeaturePermission {
  id: string;
  userId: string;
  workspace: string;
  feature: string;
  permissionLevel: string;
  grantedBy?: string;
  grantedAt: string;
  expiresAt?: string;
  isActive: boolean;
  user?: {
    firstName: string;
    lastName: string;
    email: string;
  };
}

interface RoleFeaturePermission {
  id: string;
  role: string;
  workspace: string;
  feature: string;
  permissionLevel: string;
  isActive: boolean;
}

interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  username: string;
  role: string;
}

interface FeatureDefinition {
  key: string;
  label: string;
  workspace: string;
}

interface EffectiveWorkspacePermission {
  key: string;
  workspace: string;
  permissionLevel: string;
  source: 'direct' | 'role' | 'admin';
}

interface FeedbackMessage {
  type: 'success' | 'error';
  message: string;
}

const PERSIAN_ACTION_MAP: Record<string, string> = {
  view: 'مشاهده',
  create: 'ایجاد',
  edit: 'ویرایش',
  delete: 'حذف',
  approve: 'تایید',
  reject: 'رد',
  sign: 'امضا',
  print: 'چاپ',
  import: 'ورود',
  export: 'خروجی',
  update: 'به‌روزرسانی',
  toggle: 'تغییر وضعیت',
  start: 'شروع',
  end: 'پایان',
  assign: 'تخصیص',
  verify: 'تایید',
  validate: 'اعتبارسنجی',
  send: 'ارسال',
  stats: 'آمار'
};

const PERSIAN_TOKEN_MAP: Record<string, string> = {
  core: 'هسته',
  dashboard: 'داشبورد',
  profile: 'پروفایل',
  departments: 'بخش‌ها',
  posts: 'پست‌ها',
  orders: 'سفارش‌ها',
  order: 'سفارش',
  status: 'وضعیت',
  customers: 'مشتریان',
  customer: 'مشتری',
  project: 'پروژه',
  addresses: 'آدرس‌ها',
  address: 'آدرس',
  phone: 'تلفن',
  numbers: 'شماره‌ها',
  contacts: 'مخاطبین',
  leads: 'سرنخ‌ها',
  communications: 'ارتباطات',
  contracts: 'قراردادها',
  contract: 'قرارداد',
  items: 'اقلام',
  deliveries: 'تحویل‌ها',
  payments: 'پرداخت‌ها',
  verification: 'تایید',
  number: 'شماره',
  templates: 'قالب‌ها',
  generate: 'تولید',
  products: 'محصولات',
  product: 'محصول',
  attributes: 'ویژگی‌ها',
  legacy: 'قدیمی',
  sales: 'فروش',
  crm: 'CRM',
  inventory: 'انبار',
  hr: 'منابع انسانی',
  security: 'امنیت',
  support: 'پشتیبانی',
  incident: 'رخداد',
  handle: 'رسیدگی',
  accounting: 'حسابداری',
  bi: 'هوش تجاری',
  logistics: 'لجستیک',
  loading: 'بارگیری',
  loadings: 'بارگیری‌ها',
  driver: 'راننده',
  drivers: 'راننده‌ها',
  corrections: 'اصلاحات',
  correction: 'اصلاح',
  finalize: 'نهایی‌سازی',
  cancel: 'لغو',
  cut: 'برش',
  cutting: 'برش',
  types: 'انواع',
  type: 'نوع',
  stone: 'سنگ',
  materials: 'مواد',
  widths: 'عرض‌ها',
  thicknesses: 'ضخامت‌ها',
  mines: 'معادن',
  finish: 'پرداخت',
  finishings: 'پرداخت‌ها',
  colors: 'رنگ‌ها',
  services: 'خدمات',
  service: 'خدمت',
  sub: 'زیر',
  stair: 'پله',
  standard: 'استاندارد',
  lengths: 'طول‌ها',
  layer: 'لایه',
  layers: 'لایه‌ها',
  shifts: 'شیفت‌ها',
  attendance: 'حضور و غیاب',
  checkin: 'ورود',
  checkout: 'خروج',
  exception: 'استثناء',
  exceptions: 'استثناءها',
  daily: 'روزانه',
  personnel: 'پرسنل',
  missions: 'ماموریت‌ها',
  signature: 'امضا',
  time: 'زمان',
  templates_view: 'مشاهده قالب‌ها',
  templates_create: 'ایجاد قالب‌ها',
  templates_edit: 'ویرایش قالب‌ها',
  templates_delete: 'حذف قالب‌ها'
};

const hasPersianText = (value?: string) => !!value && /[\u0600-\u06FF]/.test(value);

const normalizeFeatureLabelToPersian = (featureKey: string, rawLabel?: string) => {
  if (hasPersianText(rawLabel)) return rawLabel as string;

  const tokens = featureKey.toLowerCase().split('_').filter(Boolean);
  if (tokens.length === 0) return rawLabel || featureKey;

  const lastToken = tokens[tokens.length - 1];
  const action = PERSIAN_ACTION_MAP[lastToken] || '';
  const entityTokens = action ? tokens.slice(0, -1) : tokens;

  const entity = entityTokens
    .map((token) => PERSIAN_TOKEN_MAP[token] || token)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!entity) return action || rawLabel || featureKey;
  if (!action) return entity;
  return `${action} ${entity}`;
};

const WORKSPACES = {
  'crm': 'CRM',
  'sales': 'فروش',
  'inventory': 'انبار',
  'hr': 'منابع انسانی',
  'security': 'امنیت',
  'accounting': 'حسابداری',
  'bi': 'هوش تجاری',
  'logistics': 'لجستیک'
};

const PERMISSION_LEVELS = {
  'view': 'مشاهده',
  'edit': 'ویرایش',
  'admin': 'مدیریت'
};

const ROLE_OPTIONS = ['ADMIN', 'MANAGER', 'SALES', 'MODERATOR', 'USER'];

const WRITE_ACTION_SUFFIXES = new Set([
  'create',
  'edit',
  'delete',
  'approve',
  'reject',
  'sign',
  'import',
  'export',
  'update',
  'toggle',
  'start',
  'end',
  'assign',
  'verify',
  'validate',
  'send'
]);

const getRecommendedPermissionLevelForFeature = (featureKey: string): string => {
  const action = featureKey.toLowerCase().split('_').filter(Boolean).pop() || '';
  return WRITE_ACTION_SUFFIXES.has(action) ? 'edit' : 'view';
};

const normalizePermissionLevelForFeature = (featureKey: string, permissionLevel: string): string => {
  const recommendedLevel = getRecommendedPermissionLevelForFeature(featureKey);
  if (permissionLevel === 'view' && recommendedLevel === 'edit') {
    return 'edit';
  }
  return permissionLevel;
};

export default function PermissionsManagementPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedUserId = searchParams.get('userId');
  const requestedSection = searchParams.get('section');
  const [users, setUsers] = useState<User[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<User[]>([]);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [userPermissions, setUserPermissions] = useState<FeaturePermission[]>([]);
  const [userWorkspacePermissions, setUserWorkspacePermissions] = useState<any[]>([]);
  const [roleWorkspacePermissions, setRoleWorkspacePermissions] = useState<any[]>([]);
  const [roleFeaturePermissions, setRoleFeaturePermissions] = useState<RoleFeaturePermission[]>([]);
  const [featureDefinitions, setFeatureDefinitions] = useState<FeatureDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddPermissionModal, setShowAddPermissionModal] = useState(false);
  const [showWorkspacePermissionModal, setShowWorkspacePermissionModal] = useState(false);
  const [editingPermission, setEditingPermission] = useState<FeaturePermission | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [showAdvancedFeaturePermissions, setShowAdvancedFeaturePermissions] = useState(false);
  const [activePermissionTab, setActivePermissionTab] = useState<'users' | 'roles'>('users');
  const [feedback, setFeedback] = useState<FeedbackMessage | null>(null);

  // Form state for creating/editing permissions
  const [formData, setFormData] = useState({
    userId: '',
    workspace: '',
    feature: '',
    permissionLevel: 'view',
    expiresAt: ''
  });

  const [roleWorkspaceForm, setRoleWorkspaceForm] = useState({
    id: '',
    role: '',
    workspace: '',
    permissionLevel: 'view',
    isActive: true
  });

  const [roleFeatureForm, setRoleFeatureForm] = useState({
    id: '',
    role: '',
    workspace: '',
    feature: '',
    permissionLevel: 'view',
    isActive: true
  });

  // State for table-based feature selection
  const [selectedFeatures, setSelectedFeatures] = useState<{[key: string]: string}>({});
  const [bulkPermissionLevel, setBulkPermissionLevel] = useState('view');

  const isAdminUser = (user?: User | null) => user?.role === 'ADMIN';
  const canManageRoleDefaults = currentUser?.role === 'ADMIN';
  const canGrantAdminPermissions = currentUser?.role !== 'MANAGER';
  const workspacePermissionLevelOptions = Object.entries(PERMISSION_LEVELS)
    .filter(([level]) => canGrantAdminPermissions || level !== 'admin')
    .map(([value, label]) => ({ value, label }));
  const featureExceptionPermissionLevelOptions = Object.entries(PERMISSION_LEVELS)
    .filter(([level]) => level !== 'admin')
    .map(([value, label]) => ({ value, label }));
  const canManageDirectPermission = (permission: { permissionLevel?: string }) =>
    currentUser?.role !== 'MANAGER' || permission.permissionLevel !== 'admin';
  const showFeedback = (message: string, type: FeedbackMessage['type'] = 'error') => {
    setFeedback({ message, type });
  };

  useEffect(() => {
    checkUserAccess();
  }, []);

  useEffect(() => {
    if (!requestedUserId || users.length === 0 || selectedUser) return;
    const targetUser = users.find((user) => user.id === requestedUserId);
    if (targetUser) {
      handleUserSelect(targetUser);
      if (requestedSection === 'exceptions') {
        setShowAdvancedFeaturePermissions(true);
      }
    }
  }, [requestedUserId, requestedSection, users, selectedUser]);

  useEffect(() => {
    if (activePermissionTab === 'roles' && !canManageRoleDefaults) {
      setActivePermissionTab('users');
    }
  }, [activePermissionTab, canManageRoleDefaults]);

  const checkUserAccess = async () => {
    try {
      // Get current user profile using the API client
      const profileResponse = await authAPI.getMe();

      if (profileResponse.data.success) {
        setCurrentUser(profileResponse.data.data);

        // Check if user is admin or manager
        if (!['ADMIN', 'MANAGER'].includes(profileResponse.data.data.role)) {
          router.push('/dashboard');
          return;
        }

        // If admin/manager, fetch users, role permissions, and feature definitions
        fetchUsers(profileResponse.data.data.role);
        fetchRolePermissions(profileResponse.data.data.role);
        fetchFeatureDefinitions();
      } else {
        router.push('/login');
      }
    } catch (error) {
      console.error('Error checking user access:', error);
      router.push('/login');
    }
  };

  const fetchUsers = async (activeRole?: string) => {
    try {
      setLoading(true);

      // Fetch users
      const usersResponse = await usersAPI.getUsers(1, 100); // Get up to 100 users
      if (usersResponse.data.success) {
        const userList: User[] = usersResponse.data.data || [];
        const safeUsers = activeRole === 'MANAGER'
          ? userList.filter((user) => !isAdminUser(user))
          : userList;
        setUsers(safeUsers);
        setFilteredUsers(safeUsers);
      }

    } catch (error) {
      console.error('Error fetching users:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchRolePermissions = async (activeRole?: string) => {
    try {
      const [roleWorkspaceResponse, roleFeatureResponse] = await Promise.all([
        workspacePermissionsAPI.getRolePermissions(),
        permissionsAPI.getRoleFeaturePermissions()
      ]);

      if (roleWorkspaceResponse.data.success) {
        const roleWorkspaceData = roleWorkspaceResponse.data.data || [];
        setRoleWorkspacePermissions(
          activeRole === 'MANAGER'
            ? roleWorkspaceData.filter((permission: any) => permission.role !== 'ADMIN')
            : roleWorkspaceData
        );
      }

      if (roleFeatureResponse.data.success) {
        const roleFeatureData = roleFeatureResponse.data.data || [];
        setRoleFeaturePermissions(
          activeRole === 'MANAGER'
            ? roleFeatureData.filter((permission: RoleFeaturePermission) => permission.role !== 'ADMIN')
            : roleFeatureData
        );
      }
    } catch (error) {
      console.error('Error fetching role permissions:', error);
    }
  };

  const fetchFeatureDefinitions = async () => {
    try {
      const response = await permissionsAPI.getFeatureDefinitions();
      if (response.data.success) {
        const mapped = (response.data.data || []).map((item: FeatureDefinition) => ({
          ...item,
          label: normalizeFeatureLabelToPersian(item.key, item.label)
        }));
        setFeatureDefinitions(mapped);
      }
    } catch (error) {
      console.error('Error fetching feature definitions:', error);
    }
  };

  const fetchUserPermissions = async (userId: string) => {
    try {
      // Fetch user's feature permissions
      const userPermissionsResponse = await permissionsAPI.getUserFeaturePermissions(userId);
      if (userPermissionsResponse.data.success) {
        setUserPermissions(userPermissionsResponse.data.data);
      }

      // Fetch user's features summary (includes workspace permissions)
      const userFeaturesResponse = await permissionsAPI.getUserFeaturesSummary(userId);
      if (userFeaturesResponse.data.success) {
        setUserWorkspacePermissions(userFeaturesResponse.data.data.workspacePermissions || []);
      }

    } catch (error) {
      console.error('Error fetching user permissions:', error);
    }
  };

  const handleUserSearch = (query: string) => {
    setSearchQuery(query);
    if (query.trim() === '') {
      setFilteredUsers(users);
    } else {
      const filtered = users.filter(user =>
        user.firstName.toLowerCase().includes(query.toLowerCase()) ||
        user.lastName.toLowerCase().includes(query.toLowerCase()) ||
        user.email.toLowerCase().includes(query.toLowerCase()) ||
        user.username.toLowerCase().includes(query.toLowerCase())
      );
      setFilteredUsers(filtered);
    }
  };

  const handleUserSelect = (user: User) => {
    if (currentUser?.role === 'MANAGER' && isAdminUser(user)) {
      showFeedback('مدیر فروش اجازه مدیریت دسترسی مدیر سیستم را ندارد');
      return;
    }
    setFeedback(null);
    setSelectedUser(user);
    setShowAdvancedFeaturePermissions(false);
    setFormData({ ...formData, userId: user.id });
    fetchUserPermissions(user.id);
  };

  const handleCreatePermission = async () => {
    try {
      if (!selectedUser || !formData.workspace || !formData.feature) {
        showFeedback('لطفاً تمام فیلدهای ضروری را پر کنید');
        return;
      }

      if (currentUser?.role === 'MANAGER' && selectedUser.role === 'ADMIN') {
        showFeedback('مدیر فروش نمی‌تواند دسترسی مدیر سیستم را تغییر دهد');
        return;
      }

      if (normalizePermissionLevelForFeature(formData.feature, formData.permissionLevel) === 'admin') {
        showFeedback('مجوز جزئی فقط سطح مشاهده یا ویرایش را پشتیبانی می‌کند');
        return;
      }

      const permissionData: any = {
        userId: selectedUser.id,
        workspace: formData.workspace,
        feature: formData.feature,
        permissionLevel: normalizePermissionLevelForFeature(formData.feature, formData.permissionLevel)
      };

      // Only include expiresAt if it has a valid value
      if (formData.expiresAt && formData.expiresAt.trim() !== '') {
        permissionData.expiresAt = formData.expiresAt;
      }

      const response = editingPermission
        ? await permissionsAPI.updateFeaturePermission(editingPermission.id, {
            workspace: formData.workspace,
            feature: formData.feature,
            permissionLevel: permissionData.permissionLevel,
            ...(permissionData.expiresAt ? { expiresAt: permissionData.expiresAt } : { expiresAt: null })
          })
        : await permissionsAPI.createFeaturePermission(permissionData);

      if (response.data.success) {
        setShowAddPermissionModal(false);
        setFormData({ userId: '', workspace: '', feature: '', permissionLevel: 'view', expiresAt: '' });
        setEditingPermission(null);
        clearAllSelections();
        // Refresh the user's permissions
        if (selectedUser) {
          fetchUserPermissions(selectedUser.id);
        }
        showFeedback(editingPermission ? 'مجوز با موفقیت ویرایش شد' : 'مجوز با موفقیت ایجاد شد', 'success');
      } else {
        showFeedback('خطا در ایجاد مجوز: ' + response.data.error);
      }
    } catch (error: any) {
      console.error('Error creating permission:', error);
      showFeedback('خطا در ایجاد مجوز: ' + (error.response?.data?.error || error.message));
    }
  };

  // Handle bulk permission creation
  const handleBulkCreatePermissions = async () => {
    try {
      if (!selectedUser || !formData.workspace) {
        showFeedback('لطفاً کاربر و فضای کاری را انتخاب کنید');
        return;
      }

      if (currentUser?.role === 'MANAGER' && selectedUser.role === 'ADMIN') {
        showFeedback('مدیر فروش نمی‌تواند دسترسی مدیر سیستم را تغییر دهد');
        return;
      }

      const selectedFeaturesList = Object.entries(selectedFeatures);
      if (selectedFeaturesList.length === 0) {
        showFeedback('لطفاً حداقل یک ویژگی را انتخاب کنید');
        return;
      }

      if (selectedFeaturesList.some(([, permissionLevel]) => permissionLevel === 'admin')) {
        showFeedback('مجوز جزئی فقط سطح مشاهده یا ویرایش را پشتیبانی می‌کند');
        return;
      }

      const permissions = selectedFeaturesList.map(([featureKey, permissionLevel]) => ({
        workspace: formData.workspace,
        feature: featureKey,
        permissionLevel: normalizePermissionLevelForFeature(featureKey, permissionLevel),
        ...(formData.expiresAt && formData.expiresAt.trim() !== '' ? { expiresAt: formData.expiresAt } : {})
      }));

      const response = await permissionsAPI.bulkUpsertFeaturePermissions({
        userId: selectedUser.id,
        permissions
      });

      if (response.data.success) {
        const savedCount = response.data.summary?.count || permissions.length;
        showFeedback(`${savedCount} مجوز با موفقیت ذخیره شد`, 'success');
        clearAllSelections();
        if (selectedUser) {
          fetchUserPermissions(selectedUser.id);
        }
      } else {
        showFeedback('خطا در ذخیره مجوزها: ' + response.data.error);
      }
    } catch (error: any) {
      console.error('Error saving bulk permissions:', error);
      showFeedback('خطا در ذخیره مجوزها: ' + (error.response?.data?.error || error.message));
    }
  };

  const handleEditPermission = (permission: FeaturePermission) => {
    if (currentUser?.role === 'MANAGER' && selectedUser?.role === 'ADMIN') {
      showFeedback('مدیر فروش اجازه ویرایش دسترسی مدیر سیستم را ندارد');
      return;
    }
    if (!canManageDirectPermission(permission)) {
      showFeedback('مدیر نمی‌تواند مجوز سطح مدیریت را تغییر دهد');
      return;
    }
    setEditingPermission(permission);
    clearAllSelections();
    setFormData({
      userId: permission.userId,
      workspace: permission.workspace,
      feature: permission.feature,
      permissionLevel: permission.permissionLevel,
      expiresAt: permission.expiresAt || ''
    });
    setShowAddPermissionModal(true);
  };

  const handleDeletePermission = async (permission: FeaturePermission) => {
    if (!canManageDirectPermission(permission)) {
      showFeedback('مدیر نمی‌تواند مجوز سطح مدیریت را حذف کند');
      return;
    }
    if (!confirm('آیا از حذف این مجوز اطمینان دارید؟')) return;

    try {
      if (currentUser?.role === 'MANAGER' && selectedUser?.role === 'ADMIN') {
        showFeedback('مدیر فروش نمی‌تواند دسترسی مدیر سیستم را تغییر دهد');
        return;
      }

      const response = await permissionsAPI.deleteFeaturePermission(permission.id);

      if (response.data.success) {
        // Refresh the user's permissions
        if (selectedUser) {
          fetchUserPermissions(selectedUser.id);
        }
        showFeedback('مجوز با موفقیت حذف شد', 'success');
      } else {
        showFeedback('خطا در حذف مجوز: ' + response.data.error);
      }
    } catch (error: any) {
      console.error('Error deleting permission:', error);
      showFeedback('خطا در حذف مجوز: ' + (error.response?.data?.error || error.message));
    }
  };

  // Handle workspace permission creation
  const handleCreateWorkspacePermission = async () => {
    try {
      if (!selectedUser || !formData.workspace || !formData.permissionLevel) {
        showFeedback('لطفاً تمام فیلدهای ضروری را پر کنید');
        return;
      }

      if (currentUser?.role === 'MANAGER' && selectedUser.role === 'ADMIN') {
        showFeedback('مدیر فروش نمی‌تواند دسترسی مدیر سیستم را تغییر دهد');
        return;
      }

      if (!canGrantAdminPermissions && formData.permissionLevel === 'admin') {
        showFeedback('مدیر نمی‌تواند سطح دسترسی مدیریت را اعطا کند');
        return;
      }

      const permissionData: any = {
        userId: selectedUser.id,
        workspace: formData.workspace,
        permissionLevel: formData.permissionLevel
      };

      // Only include expiresAt if it has a valid value
      if (formData.expiresAt && formData.expiresAt.trim() !== '') {
        permissionData.expiresAt = formData.expiresAt;
      }

      const response = await workspacePermissionsAPI.createUserPermission(permissionData);

      if (response.data.success) {
        setShowWorkspacePermissionModal(false);
        setFormData({ userId: '', workspace: '', feature: '', permissionLevel: 'view', expiresAt: '' });
        // Refresh the user's permissions
        if (selectedUser) {
          fetchUserPermissions(selectedUser.id);
        }
        showFeedback('مجوز فضای کاری با موفقیت ایجاد شد', 'success');
      } else {
        showFeedback('خطا در ایجاد مجوز فضای کاری: ' + response.data.error);
      }
    } catch (error: any) {
      console.error('Error creating workspace permission:', error);
      showFeedback('خطا در ایجاد مجوز فضای کاری: ' + (error.response?.data?.error || error.message));
    }
  };

  // Handle workspace permission deletion
  const handleDeleteWorkspacePermission = async (permission: any) => {
    if (!canManageDirectPermission(permission)) {
      showFeedback('مدیر نمی‌تواند مجوز سطح مدیریت را حذف کند');
      return;
    }
    if (!confirm('آیا از حذف این مجوز فضای کاری اطمینان دارید؟')) return;

    try {
      if (currentUser?.role === 'MANAGER' && selectedUser?.role === 'ADMIN') {
        showFeedback('مدیر فروش نمی‌تواند دسترسی مدیر سیستم را تغییر دهد');
        return;
      }

      const response = await workspacePermissionsAPI.deleteUserPermission(permission.id);

      if (response.data.success) {
        // Refresh the user's permissions
        if (selectedUser) {
          fetchUserPermissions(selectedUser.id);
        }
        showFeedback('مجوز فضای کاری با موفقیت حذف شد', 'success');
      } else {
        showFeedback('خطا در حذف مجوز فضای کاری: ' + response.data.error);
      }
    } catch (error: any) {
      console.error('Error deleting workspace permission:', error);
      showFeedback('خطا در حذف مجوز فضای کاری: ' + (error.response?.data?.error || error.message));
    }
  };

  const handleSaveRoleWorkspacePermission = async () => {
    try {
      if (!roleWorkspaceForm.role || !roleWorkspaceForm.workspace) {
        showFeedback('لطفاً نقش و فضای کاری را انتخاب کنید');
        return;
      }

      if (currentUser?.role === 'MANAGER' && roleWorkspaceForm.role === 'ADMIN') {
        showFeedback('مدیر فروش نمی‌تواند دسترسی نقش مدیر را تغییر دهد');
        return;
      }

      const payload = {
        role: roleWorkspaceForm.role,
        workspace: roleWorkspaceForm.workspace,
        permissionLevel: roleWorkspaceForm.permissionLevel
      };

      if (roleWorkspaceForm.id) {
        await workspacePermissionsAPI.updateRolePermission(roleWorkspaceForm.id, payload);
      } else {
        await workspacePermissionsAPI.createRolePermission(payload);
      }

      setRoleWorkspaceForm({ id: '', role: '', workspace: '', permissionLevel: 'view', isActive: true });
      fetchRolePermissions();
      showFeedback('مجوز نقش با موفقیت ذخیره شد', 'success');
    } catch (error: any) {
      console.error('Error saving role workspace permission:', error);
      showFeedback(error.response?.data?.error || 'خطا در ذخیره مجوز نقش');
    }
  };

  const handleEditRoleWorkspacePermission = (permission: any) => {
    setRoleWorkspaceForm({
      id: permission.id,
      role: permission.role,
      workspace: permission.workspace,
      permissionLevel: permission.permissionLevel,
      isActive: permission.isActive
    });
  };

  const handleDeleteRoleWorkspacePermission = async (permission: any) => {
    if (currentUser?.role === 'MANAGER' && permission.role === 'ADMIN') {
      showFeedback('مدیر فروش نمی‌تواند مجوز نقش مدیر را حذف کند');
      return;
    }

    if (!confirm('آیا از حذف این مجوز نقش مطمئن هستید؟')) return;

    try {
      await workspacePermissionsAPI.deleteRolePermission(permission.id);
      fetchRolePermissions();
      showFeedback('مجوز نقش با موفقیت حذف شد', 'success');
    } catch (error: any) {
      console.error('Error deleting role workspace permission:', error);
      showFeedback(error.response?.data?.error || 'خطا در حذف مجوز نقش');
    }
  };

  const handleSaveRoleFeaturePermission = async () => {
    try {
      if (!roleFeatureForm.role || !roleFeatureForm.workspace || !roleFeatureForm.feature) {
        showFeedback('لطفاً نقش، فضای کاری و ویژگی را انتخاب کنید');
        return;
      }

      if (currentUser?.role === 'MANAGER' && roleFeatureForm.role === 'ADMIN') {
        showFeedback('مدیر فروش نمی‌تواند دسترسی نقش مدیر را تغییر دهد');
        return;
      }

      const payload = {
        role: roleFeatureForm.role,
        workspace: roleFeatureForm.workspace,
        feature: roleFeatureForm.feature,
        permissionLevel: normalizePermissionLevelForFeature(roleFeatureForm.feature, roleFeatureForm.permissionLevel)
      };

      if (roleFeatureForm.id) {
        await permissionsAPI.updateRoleFeaturePermission(roleFeatureForm.id, payload);
      } else {
        await permissionsAPI.createRoleFeaturePermission(payload);
      }

      setRoleFeatureForm({ id: '', role: '', workspace: '', feature: '', permissionLevel: 'view', isActive: true });
      fetchRolePermissions();
      showFeedback('مجوز ویژگی نقش با موفقیت ذخیره شد', 'success');
    } catch (error: any) {
      console.error('Error saving role feature permission:', error);
      showFeedback(error.response?.data?.error || 'خطا در ذخیره مجوز ویژگی نقش');
    }
  };

  const handleEditRoleFeaturePermission = (permission: RoleFeaturePermission) => {
    setRoleFeatureForm({
      id: permission.id,
      role: permission.role,
      workspace: permission.workspace,
      feature: permission.feature,
      permissionLevel: permission.permissionLevel,
      isActive: permission.isActive
    });
  };

  const handleDeleteRoleFeaturePermission = async (permission: RoleFeaturePermission) => {
    if (currentUser?.role === 'MANAGER' && permission.role === 'ADMIN') {
      showFeedback('مدیر فروش نمی‌تواند مجوز نقش مدیر را حذف کند');
      return;
    }

    if (!confirm('آیا از حذف این مجوز نقش مطمئن هستید؟')) return;

    try {
      await permissionsAPI.deleteRoleFeaturePermission(permission.id);
      fetchRolePermissions();
      showFeedback('مجوز ویژگی نقش با موفقیت حذف شد', 'success');
    } catch (error: any) {
      console.error('Error deleting role feature permission:', error);
      showFeedback(error.response?.data?.error || 'خطا در حذف مجوز ویژگی نقش');
    }
  };

  const getFeatureDisplayName = (feature: string) => {
    const definition = featureDefinitions.find((item) => item.key === feature);
    return normalizeFeatureLabelToPersian(feature, definition?.label);
  };

  // Filter features based on selected workspace
  const getFilteredFeatures = () => {
    const filtered = formData.workspace
      ? featureDefinitions.filter((item) => item.workspace === formData.workspace)
      : featureDefinitions;
    return filtered.map((item) => [item.key, item.label] as [string, string]);
  };

  const getRoleFilteredFeatures = () => {
    const filtered = roleFeatureForm.workspace
      ? featureDefinitions.filter((item) => item.workspace === roleFeatureForm.workspace)
      : featureDefinitions;
    return filtered.map((item) => [item.key, item.label] as [string, string]);
  };

  // Handle individual feature selection
  const handleFeatureSelection = (featureKey: string, permissionLevel: string) => {
    if (permissionLevel === 'admin') {
      showFeedback('مجوز جزئی فقط سطح مشاهده یا ویرایش را پشتیبانی می‌کند');
      return;
    }
    setSelectedFeatures(prev => ({
      ...prev,
      [featureKey]: permissionLevel
    }));
  };

  // Handle bulk feature selection
  const handleBulkFeatureSelection = (permissionLevel: string) => {
    if (permissionLevel === 'admin') {
      showFeedback('مجوز جزئی فقط سطح مشاهده یا ویرایش را پشتیبانی می‌کند');
      return;
    }
    const filteredFeatures = getFilteredFeatures();
    const newSelection: {[key: string]: string} = {};

    filteredFeatures.forEach(([key]) => {
      newSelection[key] = normalizePermissionLevelForFeature(key, permissionLevel);
    });

    setSelectedFeatures(newSelection);
  };

  // Clear all selections
  const clearAllSelections = () => {
    setSelectedFeatures({});
  };

  // Get current permission for a feature
  const getCurrentPermission = (featureKey: string) => {
    if (!selectedUser) return null;
    return userPermissions.find(p => p.feature === featureKey);
  };

  const getWorkspaceDisplayName = (workspace: string) => {
    return WORKSPACES[workspace as keyof typeof WORKSPACES] || workspace;
  };

  const getPermissionDisplayName = (level: string) => {
    return PERMISSION_LEVELS[level as keyof typeof PERMISSION_LEVELS] || level;
  };

  const getPermissionSourceLabel = (source: EffectiveWorkspacePermission['source']) => {
    switch (source) {
      case 'direct':
        return 'مستقیم';
      case 'role':
        return 'از نقش';
      case 'admin':
        return 'مدیر سیستم';
      default:
        return source;
    }
  };

  const getPermissionSourceColor = (source: EffectiveWorkspacePermission['source']) => {
    switch (source) {
      case 'direct':
        return 'bg-[var(--sds-accent-surface)] text-[var(--sds-accent)] border-[var(--sds-border-strong)]';
      case 'role':
        return 'bg-[var(--sds-info-surface)] text-[var(--sds-info)] border-[var(--sds-info-border)]';
      case 'admin':
        return 'bg-[var(--sds-danger-surface)] text-[var(--sds-danger)] border-[var(--sds-danger-border)]';
      default:
        return 'bg-[var(--sds-surface-subtle)] text-[var(--sds-text-primary)] border-[var(--sds-border-default)]';
    }
  };

  const getSelectedUserRoleWorkspaceDefaults = () => {
    if (!selectedUser) return [];
    return roleWorkspacePermissions.filter(
      (permission: any) => permission.role === selectedUser.role && permission.isActive
    );
  };

  const getEffectiveWorkspacePermissions = (): EffectiveWorkspacePermission[] => {
    if (!selectedUser) return [];

    if (selectedUser.role === 'ADMIN') {
      return Object.keys(WORKSPACES).map((workspace) => ({
        key: `admin-${workspace}`,
        workspace,
        permissionLevel: 'admin',
        source: 'admin'
      }));
    }

    const directPermissions = userWorkspacePermissions.filter((permission) => permission.isActive);
    const directWorkspaces = new Set(directPermissions.map((permission) => permission.workspace));
    const roleDefaults = getSelectedUserRoleWorkspaceDefaults();

    return [
      ...directPermissions.map((permission) => ({
        key: permission.id,
        workspace: permission.workspace,
        permissionLevel: permission.permissionLevel,
        source: 'direct' as const
      })),
      ...roleDefaults
        .filter((permission: any) => !directWorkspaces.has(permission.workspace))
        .map((permission: any) => ({
          key: permission.id,
          workspace: permission.workspace,
          permissionLevel: permission.permissionLevel,
          source: 'role' as const
        }))
    ];
  };

  if (loading) {
    return (
      <main className="sds-workspace mx-auto w-full max-w-7xl">
        <div>
          <div className="sds-workspace-surface p-8 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[var(--sds-border-strong)] mx-auto mb-4"></div>
            <p className="text-[var(--sds-text-muted)]">در حال بارگذاری...</p>
          </div>
        </div>
      </main>
    );
  }

  // Check if user is not admin or manager
  if (currentUser && !['ADMIN', 'MANAGER'].includes(currentUser.role)) {
    return (
      <main className="sds-workspace mx-auto w-full max-w-7xl">
        <div>
          <div className="sds-workspace-surface p-8 text-center">
            <FaLock className="h-16 w-16 text-[var(--sds-danger)] mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-[var(--sds-text-primary)] mb-4">دسترسی محدود</h1>
            <p className="text-[var(--sds-text-muted)] mb-6">
              شما دسترسی لازم برای مشاهده این صفحه را ندارید. این صفحه فقط برای مدیران سیستم قابل دسترسی است.
            </p>
            <ErpPressable type="submit"
              onClick={() => router.push('/dashboard')}
              className="sds-workspace-surface px-6 py-3 hover:bg-[var(--sds-accent-surface)] transition-all duration-300"
            >
              بازگشت به داشبورد
            </ErpPressable>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="sds-workspace mx-auto w-full max-w-7xl">
      <div className="space-y-6">
        {/* Header */}
        <div className="sds-workspace-surface p-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-[var(--sds-text-primary)] mb-2">مدیریت مجوزهای کاربران</h1>
              <p className="text-[var(--sds-text-muted)]">جستجو و انتخاب کاربر برای مدیریت مجوزهای دسترسی</p>
            </div>
          </div>
        </div>

        {canManageRoleDefaults && (
        <div className="sds-workspace-surface p-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <ErpPressable
              type="button"
              onClick={() => setActivePermissionTab('users')}
              className={`px-4 py-3 rounded-lg text-sm font-medium transition-all duration-200 ${
                activePermissionTab === 'users'
                  ? 'bg-[var(--sds-accent-surface)] text-[var(--sds-accent)] border border-[var(--sds-border-strong)]'
                  : 'text-[var(--sds-text-muted)] hover:bg-[var(--sds-surface-raised)] border border-transparent'
              }`}
            >
              استثناهای کاربر
            </ErpPressable>
            <ErpPressable
              type="button"
              onClick={() => setActivePermissionTab('roles')}
              className={`px-4 py-3 rounded-lg text-sm font-medium transition-all duration-200 ${
                activePermissionTab === 'roles'
                  ? 'bg-[var(--sds-accent-surface)] text-[var(--sds-accent)] border border-[var(--sds-border-strong)]'
                  : 'text-[var(--sds-text-muted)] hover:bg-[var(--sds-surface-raised)] border border-transparent'
              }`}
            >
              پیش‌فرض‌های نقش
            </ErpPressable>
          </div>
        </div>
        )}

        {feedback && (
          <div className={`rounded-lg border p-4 ${
            feedback.type === 'success'
              ? 'bg-[var(--sds-success-surface)] border-[var(--sds-success-border)] text-[var(--sds-success)]'
              : 'bg-[var(--sds-danger-surface)] border-[var(--sds-danger-border)] text-[var(--sds-danger)]'
          }`}>
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                {feedback.type === 'success' ? <FaCheck /> : <FaTimes />}
                <span>{feedback.message}</span>
              </div>
              <ErpPressable
                type="button"
                onClick={() => setFeedback(null)}
                className="text-sm opacity-80 hover:opacity-100"
              >
                بستن
              </ErpPressable>
            </div>
          </div>
        )}

        {/* User Search Section */}
        {activePermissionTab === 'users' && (
        <div className="sds-workspace-surface p-6 mb-6">
          <h2 className="text-xl font-semibold text-[var(--sds-text-primary)] mb-4">جستجوی کاربر</h2>

          {/* Search Input */}
          <div className="relative mb-4">
            <ErpInput
              type="text"
              placeholder="جستجو بر اساس نام، ایمیل یا نام کاربری..."
              value={searchQuery}
              onChange={(e) => handleUserSearch(e.target.value)}
              className="w-full p-4 bg-[var(--sds-surface-raised)] border border-[var(--sds-border-strong)] rounded-lg text-[var(--sds-text-primary)] placeholder:text-[var(--sds-text-muted)] focus:border-[var(--sds-border-strong)] focus:outline-none pr-12"
            />
            <FaUsers className="absolute right-4 top-1/2 transform -translate-y-1/2 text-[var(--sds-text-muted)]" />
          </div>

          {/* User List */}
          {filteredUsers.length > 0 && (
            <div className="max-h-60 overflow-y-auto space-y-2">
              {filteredUsers.map((user) => (
                <ErpPressable
                  type="button"
                  key={user.id}
                  onClick={() => handleUserSelect(user)}
                  className={`block w-full p-4 text-right rounded-lg cursor-pointer transition-all duration-300 ${
                    selectedUser?.id === user.id
                      ? 'bg-[var(--sds-accent-surface)] border border-[var(--sds-border-strong)]'
                      : 'bg-[var(--sds-surface-raised)] hover:bg-[var(--sds-surface-raised)] border border-[var(--sds-border-strong)]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-[var(--sds-text-primary)] font-medium">
                        {user.firstName} {user.lastName}
                      </h3>
                      <p className="text-[var(--sds-text-muted)] text-sm">{user.email}</p>
                      <p className="text-[var(--sds-text-secondary)] text-xs">@{user.username} ⬢ {user.role}</p>
                    </div>
                    {selectedUser?.id === user.id && (
                      <div className="text-[var(--sds-accent)]">
                        <FaCheck className="h-5 w-5" />
                      </div>
                    )}
                  </div>
                </ErpPressable>
              ))}
            </div>
          )}

          {filteredUsers.length === 0 && searchQuery && (
            <div className="text-center py-8">
              <FaUsers className="h-12 w-12 text-[var(--sds-text-secondary)] mx-auto mb-4" />
              <p className="text-[var(--sds-text-muted)]">هیچ کاربری یافت نشد</p>
            </div>
          )}
        </div>
        )}

        {/* User Permissions Section */}
        {activePermissionTab === 'users' && selectedUser && (
          <div className="sds-workspace-surface p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-xl font-semibold text-[var(--sds-text-primary)] mb-2">
                  مجوزهای {selectedUser.firstName} {selectedUser.lastName}
                </h2>
                <p className="text-[var(--sds-text-muted)]">{selectedUser.email} ⬢ {selectedUser.role}</p>
              </div>
              <ErpPressable type="submit"
                onClick={() => {
                  setFormData({
                    userId: selectedUser.id,
                    workspace: '',
                    feature: '',
                    permissionLevel: 'view',
                    expiresAt: ''
                  });
                  setShowAddPermissionModal(true);
                }}
                className="sds-workspace-surface px-4 py-2 hover:bg-[var(--sds-accent-surface)] transition-all duration-300 flex items-center"
              >
                <FaPlus className="ml-2" />
                افزودن مجوز جدید
              </ErpPressable>
            </div>

            {/* Effective Access */}
            <div className="mb-8 bg-[var(--sds-surface-raised)] border border-[var(--sds-border-strong)] rounded-lg p-4">
              <div className="flex items-center justify-between gap-4 mb-4">
                <div>
                  <h3 className="text-lg font-medium text-[var(--sds-text-primary)]">دسترسی موثر کاربر</h3>
                  <p className="text-sm text-[var(--sds-text-muted)] mt-1">
                    نتیجه نهایی بر اساس مجوزهای مستقیم و پیش‌فرض‌های نقش
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="px-2 py-1 rounded-full border bg-[var(--sds-accent-surface)] text-[var(--sds-accent)] border-[var(--sds-border-strong)]">
                    مستقیم: {userWorkspacePermissions.filter((permission) => permission.isActive).length}
                  </span>
                  <span className="px-2 py-1 rounded-full border bg-[var(--sds-info-surface)] text-[var(--sds-info)] border-[var(--sds-info-border)]">
                    از نقش: {getSelectedUserRoleWorkspaceDefaults().length}
                  </span>
                </div>
              </div>

              {getEffectiveWorkspacePermissions().length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {getEffectiveWorkspacePermissions().map((permission) => (
                    <span
                      key={permission.key}
                      className={`px-3 py-2 rounded-lg border text-sm ${getPermissionSourceColor(permission.source)}`}
                      title={`منبع دسترسی: ${getPermissionSourceLabel(permission.source)}`}
                    >
                      {getWorkspaceDisplayName(permission.workspace)} ({getPermissionDisplayName(permission.permissionLevel)} - {getPermissionSourceLabel(permission.source)})
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-[var(--sds-text-muted)]">هیچ دسترسی موثری برای این کاربر تعریف نشده است.</p>
              )}
            </div>

            {/* Workspace Permissions */}
            <div className="mb-8">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-medium text-[var(--sds-text-primary)]">دسترسی‌های مستقیم فضای کاری</h3>
                <ErpPressable type="submit"
                  onClick={() => {
                    setFormData({
                      userId: selectedUser.id,
                      workspace: '',
                      feature: '',
                      permissionLevel: 'view',
                      expiresAt: ''
                    });
                    setShowWorkspacePermissionModal(true);
                  }}
                  className="sds-workspace-surface px-4 py-2 hover:bg-[var(--sds-accent-surface)] transition-all duration-300 flex items-center text-sm"
                >
                  <FaPlus className="ml-2" />
                  افزودن مجوز فضای کاری
                </ErpPressable>
              </div>
              {userWorkspacePermissions.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {userWorkspacePermissions.map((permission) => (
                    <div key={permission.id} className="bg-[var(--sds-surface-raised)] p-4 rounded-lg border border-[var(--sds-border-strong)]">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-[var(--sds-text-primary)] font-medium">
                          {getWorkspaceDisplayName(permission.workspace)}
                        </h4>
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-1 rounded-full text-xs ${
                            permission.permissionLevel === 'admin' ? 'bg-[var(--sds-danger-surface)] text-[var(--sds-danger)]' :
                            permission.permissionLevel === 'edit' ? 'bg-[var(--sds-warning-surface)] text-[var(--sds-warning)]' :
                            'bg-[var(--sds-success-surface)] text-[var(--sds-success)]'
                          }`}>
                            {getPermissionDisplayName(permission.permissionLevel)}
                          </span>
                          <ErpPressable type="submit"
                            onClick={() => handleDeleteWorkspacePermission(permission)}
                            disabled={!canManageDirectPermission(permission)}
                            className="p-1 text-[var(--sds-danger)] hover:bg-[var(--sds-danger-surface)] rounded transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed"
                            title={canManageDirectPermission(permission) ? 'حذف مجوز فضای کاری' : 'فقط مدیر سیستم می‌تواند مجوز مدیریت را حذف کند'}
                          >
                            <FaTrash className="w-3 h-3" />
                          </ErpPressable>
                        </div>
                      </div>
                      <p className="text-[var(--sds-text-muted)] text-sm">
                        دسترسی کامل به فضای کاری {getWorkspaceDisplayName(permission.workspace)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
              {userWorkspacePermissions.length === 0 && (
                <div className="text-center py-8">
                  <FaCog className="h-12 w-12 text-[var(--sds-text-secondary)] mx-auto mb-3" />
                  <p className="text-[var(--sds-text-muted)]">هیچ مجوز فضای کاری تعریف نشده است</p>
                </div>
              )}
            </div>

            {/* Feature Permissions */}
            <div>
              <div className="flex items-center justify-between gap-4 mb-4">
                <div>
                  <h3 className="text-lg font-medium text-[var(--sds-text-primary)]">مجوزهای جزئی مستقیم</h3>
                  <p className="text-sm text-[var(--sds-text-muted)] mt-1">
                    بخش پیشرفته برای استثناهای ریزتر از سطح فضای کاری
                  </p>
                </div>
                <ErpPressable
                  type="button"
                  onClick={() => setShowAdvancedFeaturePermissions((value) => !value)}
                  className="sds-workspace-surface px-4 py-2 hover:bg-[var(--sds-accent-surface)] transition-all duration-300 text-sm"
                >
                  {showAdvancedFeaturePermissions ? 'بستن تنظیمات پیشرفته' : `نمایش تنظیمات پیشرفته (${userPermissions.length})`}
                </ErpPressable>
              </div>

              {!showAdvancedFeaturePermissions ? (
                <div className="bg-[var(--sds-surface-raised)] border border-[var(--sds-border-strong)] rounded-lg p-4">
                  <p className="text-[var(--sds-text-muted)] text-sm">
                    مجوزهای جزئی برای استثناهای خاص نگه داشته شده‌اند. برای بیشتر کاربران، دسترسی فضای کاری کافی است.
                  </p>
                </div>
              ) : userPermissions.length === 0 ? (
                <div className="text-center py-12">
                  <FaCog className="h-16 w-16 text-[var(--sds-text-secondary)] mx-auto mb-4" />
                  <p className="text-[var(--sds-text-muted)] text-lg">هیچ مجوز جزئی تعریف نشده است</p>
                  <ErpPressable type="submit"
                    onClick={() => {
                      setFormData({
                        userId: selectedUser.id,
                        workspace: '',
                        feature: '',
                        permissionLevel: 'view',
                        expiresAt: ''
                      });
                      setShowAddPermissionModal(true);
                    }}
                    className="mt-4 sds-workspace-surface px-6 py-3 hover:bg-[var(--sds-accent-surface)] transition-all duration-300"
                  >
                    <FaPlus className="inline-block ml-2" />
                    افزودن مجوز جدید
                  </ErpPressable>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-[var(--sds-border-strong)]">
                        <th className="text-right py-3 px-4 text-[var(--sds-text-muted)]">فضای کاری</th>
                        <th className="text-right py-3 px-4 text-[var(--sds-text-muted)]">ویژگی</th>
                        <th className="text-right py-3 px-4 text-[var(--sds-text-muted)]">سطح دسترسی</th>
                        <th className="text-right py-3 px-4 text-[var(--sds-text-muted)]">وضعیت</th>
                        <th className="text-right py-3 px-4 text-[var(--sds-text-muted)]">عملیات</th>
                      </tr>
                    </thead>
                    <tbody>
                      {userPermissions.map((permission) => (
                        <tr key={permission.id} className="border-b border-[var(--sds-border-strong)] hover:bg-[var(--sds-surface-raised)]">
                          <td className="py-3 px-4 text-[var(--sds-text-muted)]">
                            {getWorkspaceDisplayName(permission.workspace)}
                          </td>
                          <td className="py-3 px-4 text-[var(--sds-text-muted)]">
                            {getFeatureDisplayName(permission.feature)}
                          </td>
                          <td className="py-3 px-4">
                            <span className={`px-3 py-1 rounded-full text-sm ${
                              permission.permissionLevel === 'admin' ? 'bg-[var(--sds-danger-surface)] text-[var(--sds-danger)]' :
                              permission.permissionLevel === 'edit' ? 'bg-[var(--sds-warning-surface)] text-[var(--sds-warning)]' :
                              'bg-[var(--sds-success-surface)] text-[var(--sds-success)]'
                            }`}>
                              {getPermissionDisplayName(permission.permissionLevel)}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            {permission.isActive ? (
                              <span className="flex items-center text-[var(--sds-success)]">
                                <FaCheck className="ml-1" />
                                فعال
                              </span>
                            ) : (
                              <span className="flex items-center text-[var(--sds-danger)]">
                                <FaTimes className="ml-1" />
                                غیرفعال
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex space-x-2 space-x-reverse">
                              <ErpPressable type="submit"
                                onClick={() => handleEditPermission(permission)}
                                disabled={!canManageDirectPermission(permission)}
                                className="p-2 text-[var(--sds-info)] hover:bg-[var(--sds-info-surface)] rounded-lg transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed"
                                title={canManageDirectPermission(permission) ? 'ویرایش' : 'فقط مدیر سیستم می‌تواند مجوز مدیریت را تغییر دهد'}
                              >
                                <FaEdit />
                              </ErpPressable>
                              <ErpPressable type="submit"
                                onClick={() => handleDeletePermission(permission)}
                                disabled={!canManageDirectPermission(permission)}
                                className="p-2 text-[var(--sds-danger)] hover:bg-[var(--sds-danger-surface)] rounded-lg transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed"
                                title={canManageDirectPermission(permission) ? 'حذف' : 'فقط مدیر سیستم می‌تواند مجوز مدیریت را حذف کند'}
                              >
                                <FaTrash />
                              </ErpPressable>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* No User Selected State */}
        {activePermissionTab === 'users' && !selectedUser && (
          <div className="sds-workspace-surface p-12 text-center">
            <FaUsers className="h-20 w-20 text-[var(--sds-text-secondary)] mx-auto mb-6" />
            <h2 className="text-2xl font-semibold text-[var(--sds-text-primary)] mb-4">کاربری انتخاب نشده</h2>
            <p className="text-[var(--sds-text-muted)] text-lg mb-6">
              برای مشاهده و مدیریت مجوزها ابتدا یک کاربر را از لیست بالا انتخاب کنید
            </p>
          </div>
        )}

        {/* Role Permissions */}
        {activePermissionTab === 'roles' && canManageRoleDefaults && (
        <div className="sds-workspace-surface p-6 mt-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-[var(--sds-text-primary)]">مدیریت مجوزهای نقش</h2>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Role Workspace Permissions */}
            <div className="sds-workspace-surface p-4">
              <h3 className="text-lg font-semibold text-[var(--sds-text-primary)] mb-3">مجوزهای فضای کاری بر اساس نقش</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-[var(--sds-text-muted)] mb-1 text-sm">نقش</label>
                  <ErpSelect
                    value={roleWorkspaceForm.role}
                    onChange={(e) => setRoleWorkspaceForm({ ...roleWorkspaceForm, role: e.target.value })}
                    className="w-full p-2 bg-[var(--sds-surface-raised)] border border-[var(--sds-border-strong)] rounded text-[var(--sds-text-primary)] text-sm"
                  >
                    <option value="">انتخاب نقش</option>
                    {ROLE_OPTIONS.map(role => (
                      <option
                        key={role}
                        value={role}
                      >
                        {role}
                      </option>
                    ))}
                  </ErpSelect>
                </div>

                <div>
                  <label className="block text-[var(--sds-text-muted)] mb-1 text-sm">فضای کاری</label>
                  <ErpSelect
                    value={roleWorkspaceForm.workspace}
                    onChange={(e) => setRoleWorkspaceForm({ ...roleWorkspaceForm, workspace: e.target.value })}
                    className="w-full p-2 bg-[var(--sds-surface-raised)] border border-[var(--sds-border-strong)] rounded text-[var(--sds-text-primary)] text-sm"
                  >
                    <option value="">انتخاب فضای کاری</option>
                    {Object.entries(WORKSPACES).map(([key, value]) => (
                      <option key={key} value={key}>{value}</option>
                    ))}
                  </ErpSelect>
                </div>

                <div>
                  <label className="block text-[var(--sds-text-muted)] mb-1 text-sm">سطح دسترسی</label>
                  <ErpSelect
                    value={roleWorkspaceForm.permissionLevel}
                    onChange={(e) => setRoleWorkspaceForm({ ...roleWorkspaceForm, permissionLevel: e.target.value })}
                    className="w-full p-2 bg-[var(--sds-surface-raised)] border border-[var(--sds-border-strong)] rounded text-[var(--sds-text-primary)] text-sm"
                  >
                    <option value="view">مشاهده</option>
                    <option value="edit">ویرایش</option>
                    <option value="admin">مدیریت</option>
                  </ErpSelect>
                </div>

                <div className="flex gap-2">
                  <ErpPressable type="submit"
                    onClick={handleSaveRoleWorkspacePermission}
                    className="flex-1 sds-workspace-surface p-2 hover:bg-[var(--sds-accent-surface)] transition-all duration-300 text-center text-sm"
                  >
                    {roleWorkspaceForm.id ? 'به‌روزرسانی' : 'ایجاد'}
                  </ErpPressable>
                  <ErpPressable type="submit"
                    onClick={() => setRoleWorkspaceForm({ id: '', role: '', workspace: '', permissionLevel: 'view', isActive: true })}
                    className="flex-1 sds-workspace-surface p-2 hover:bg-[var(--sds-surface-raised)] transition-all duration-300 text-center text-sm"
                  >
                    پاک کردن
                  </ErpPressable>
                </div>
              </div>

              <div className="mt-4 space-y-2 max-h-48 overflow-y-auto">
                {roleWorkspacePermissions.length === 0 && (
                  <p className="text-xs text-[var(--sds-text-muted)]">هیچ مجوزی ثبت نشده است.</p>
                )}
                {roleWorkspacePermissions.map((permission: any) => (
                  <div key={permission.id} className="flex items-center justify-between bg-[var(--sds-surface-raised)] p-2 rounded">
                    <div className="text-xs text-[var(--sds-text-muted)]">
                      {permission.role} / {permission.workspace} / {permission.permissionLevel}
                    </div>
                    <div className="flex gap-2">
                      <ErpPressable type="submit"
                        onClick={() => handleEditRoleWorkspacePermission(permission)}
                        className="text-xs text-[var(--sds-accent)] disabled:opacity-50"
                      >
                        ویرایش
                      </ErpPressable>
                      <ErpPressable type="submit"
                        onClick={() => handleDeleteRoleWorkspacePermission(permission)}
                        className="text-xs text-[var(--sds-danger)] disabled:opacity-50"
                      >
                        حذف
                      </ErpPressable>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Role Feature Permissions */}
            <div className="sds-workspace-surface p-4">
              <h3 className="text-lg font-semibold text-[var(--sds-text-primary)] mb-3">مجوزهای ویژگی بر اساس نقش</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-[var(--sds-text-muted)] mb-1 text-sm">نقش</label>
                  <ErpSelect
                    value={roleFeatureForm.role}
                    onChange={(e) => setRoleFeatureForm({ ...roleFeatureForm, role: e.target.value })}
                    className="w-full p-2 bg-[var(--sds-surface-raised)] border border-[var(--sds-border-strong)] rounded text-[var(--sds-text-primary)] text-sm"
                  >
                    <option value="">انتخاب نقش</option>
                    {ROLE_OPTIONS.map(role => (
                      <option
                        key={role}
                        value={role}
                      >
                        {role}
                      </option>
                    ))}
                  </ErpSelect>
                </div>

                <div>
                  <label className="block text-[var(--sds-text-muted)] mb-1 text-sm">فضای کاری</label>
                  <ErpSelect
                    value={roleFeatureForm.workspace}
                    onChange={(e) => setRoleFeatureForm({ ...roleFeatureForm, workspace: e.target.value, feature: '' })}
                    className="w-full p-2 bg-[var(--sds-surface-raised)] border border-[var(--sds-border-strong)] rounded text-[var(--sds-text-primary)] text-sm"
                  >
                    <option value="">انتخاب فضای کاری</option>
                    {Object.entries(WORKSPACES).map(([key, value]) => (
                      <option key={key} value={key}>{value}</option>
                    ))}
                  </ErpSelect>
                </div>

                <div>
                  <label className="block text-[var(--sds-text-muted)] mb-1 text-sm">ویژگی</label>
                  <ErpSelect
                    value={roleFeatureForm.feature}
                    onChange={(e) => setRoleFeatureForm({ ...roleFeatureForm, feature: e.target.value })}
                    className="w-full p-2 bg-[var(--sds-surface-raised)] border border-[var(--sds-border-strong)] rounded text-[var(--sds-text-primary)] text-sm"
                  >
                    <option value="">انتخاب ویژگی</option>
                    {getRoleFilteredFeatures().map(([key, value]) => (
                      <option key={key} value={key}>{value}</option>
                    ))}
                  </ErpSelect>
                </div>

                <div>
                  <label className="block text-[var(--sds-text-muted)] mb-1 text-sm">سطح دسترسی</label>
                  <ErpSelect
                    value={roleFeatureForm.permissionLevel}
                    onChange={(e) => setRoleFeatureForm({ ...roleFeatureForm, permissionLevel: e.target.value })}
                    className="w-full p-2 bg-[var(--sds-surface-raised)] border border-[var(--sds-border-strong)] rounded text-[var(--sds-text-primary)] text-sm"
                  >
                    <option value="view">مشاهده</option>
                    <option value="edit">ویرایش</option>
                    <option value="admin">مدیریت</option>
                  </ErpSelect>
                </div>

                <div className="flex gap-2">
                  <ErpPressable type="submit"
                    onClick={handleSaveRoleFeaturePermission}
                    className="flex-1 sds-workspace-surface p-2 hover:bg-[var(--sds-accent-surface)] transition-all duration-300 text-center text-sm"
                  >
                    {roleFeatureForm.id ? 'به‌روزرسانی' : 'ایجاد'}
                  </ErpPressable>
                  <ErpPressable type="submit"
                    onClick={() => setRoleFeatureForm({ id: '', role: '', workspace: '', feature: '', permissionLevel: 'view', isActive: true })}
                    className="flex-1 sds-workspace-surface p-2 hover:bg-[var(--sds-surface-raised)] transition-all duration-300 text-center text-sm"
                  >
                    پاک کردن
                  </ErpPressable>
                </div>
              </div>

              <div className="mt-4 space-y-2 max-h-48 overflow-y-auto">
                {roleFeaturePermissions.length === 0 && (
                  <p className="text-xs text-[var(--sds-text-muted)]">هیچ مجوزی ثبت نشده است.</p>
                )}
                {roleFeaturePermissions.map((permission) => (
                  <div key={permission.id} className="flex items-center justify-between bg-[var(--sds-surface-raised)] p-2 rounded">
                    <div className="text-xs text-[var(--sds-text-muted)]">
                      {permission.role} / {getWorkspaceDisplayName(permission.workspace)} / {getFeatureDisplayName(permission.feature)} / {getPermissionDisplayName(permission.permissionLevel)}
                    </div>
                    <div className="flex gap-2">
                      <ErpPressable type="submit"
                        onClick={() => handleEditRoleFeaturePermission(permission)}
                        className="text-xs text-[var(--sds-accent)] disabled:opacity-50"
                      >
                        ویرایش
                      </ErpPressable>
                      <ErpPressable type="submit"
                        onClick={() => handleDeleteRoleFeaturePermission(permission)}
                        className="text-xs text-[var(--sds-danger)] disabled:opacity-50"
                      >
                        حذف
                      </ErpPressable>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        )}

        {/* Create/Edit Modal */}
        {showAddPermissionModal && (
          <div className="fixed inset-0 bg-[var(--sds-surface-overlay)] flex items-center justify-center z-50 p-4">
            <div className="sds-workspace-surface p-4 w-full max-w-6xl mx-auto max-h-[90vh] overflow-y-auto">
              <h3 className="text-lg font-semibold text-[var(--sds-text-primary)] mb-3">
                {editingPermission ? 'ویرایش مجوز' : 'ایجاد مجوز جدید'}
              </h3>

              <div className="space-y-3">
                {!editingPermission && (
                  <div>
                    <label className="block text-[var(--sds-text-muted)] mb-2">کاربر</label>
                    <div className="p-3 bg-[var(--sds-surface-raised)] border border-[var(--sds-border-strong)] rounded-lg text-[var(--sds-text-primary)]">
                      {selectedUser ? `${selectedUser.firstName} ${selectedUser.lastName} (${selectedUser.email})` : 'هیچ کاربری انتخاب نشده'}
                    </div>
                  </div>
                )}

                <div>
                  <EnhancedDropdown
                    label="فضای کاری"
                    value={formData.workspace}
                    onChange={(value) => setFormData({ ...formData, workspace: value, feature: '' })}
                    placeholder="انتخاب فضای کاری"
                    options={Object.entries(WORKSPACES).map(([key, value]) => ({
                      value: key,
                      label: value
                    }))}
                    searchable={true}
                    clearable={true}
                    disabled={!!editingPermission}
                  />
                </div>

                {/* Feature Selection Table */}
                {formData.workspace && !editingPermission && (
                  <div>
                    <div className="flex justify-between items-center mb-3">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 bg-gradient-to-br from-[var(--sds-accent)] to-[var(--sds-info)] rounded-lg flex items-center justify-center">
                          <svg className="w-4 h-4 text-[var(--sds-text-primary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </div>
                        <div>
                          <h3 className="text-base font-semibold text-[var(--sds-text-primary)]">
                            انتخاب ویژگی‌ها برای {getWorkspaceDisplayName(formData.workspace)}
                          </h3>
                          <p className="text-xs text-[var(--sds-text-muted)]">
                            {getFilteredFeatures().length} ویژگی موجود است
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <ErpPressable type="submit"
                          onClick={() => handleBulkFeatureSelection('view')}
                          className="flex items-center gap-1 px-2 py-1 bg-[var(--sds-info-surface)] text-[var(--sds-info)] border border-[var(--sds-info-border)] rounded text-xs hover:bg-[var(--sds-info-surface)] transition-all duration-200"
                        >
                          <div className="w-1.5 h-1.5 bg-[var(--sds-info-surface)] rounded-full"></div>
                          همه (مشاهده)
                        </ErpPressable>
                        <ErpPressable type="submit"
                          onClick={() => handleBulkFeatureSelection('edit')}
                          className="flex items-center gap-1 px-2 py-1 bg-[var(--sds-success-surface)] text-[var(--sds-success)] border border-[var(--sds-success-border)] rounded text-xs hover:bg-[var(--sds-success-surface)] transition-all duration-200"
                        >
                          <div className="w-1.5 h-1.5 bg-[var(--sds-success-surface)] rounded-full"></div>
                          همه (ویرایش)
                        </ErpPressable>
                        <ErpPressable type="submit"
                          onClick={clearAllSelections}
                          className="flex items-center gap-1 px-2 py-1 bg-[var(--sds-danger-surface)] text-[var(--sds-danger)] border border-[var(--sds-danger-border)] rounded text-xs hover:bg-[var(--sds-danger-surface)] transition-all duration-200"
                        >
                          <div className="w-1.5 h-1.5 bg-[var(--sds-danger-surface)] rounded-full"></div>
                          پاک کردن
                        </ErpPressable>
                      </div>
                    </div>

                    <div className="max-h-60 overflow-y-auto border border-[var(--sds-border-strong)] rounded-lg bg-[var(--sds-surface-raised)] backdrop-blur-sm">
                      <table className="w-full">
                        <thead className="bg-gradient-to-r from-[var(--sds-surface-raised)] to-[var(--sds-surface-raised)] sticky top-0 z-10">
                          <tr>
                            <th className="p-2 text-right text-[var(--sds-text-primary)] font-semibold border-b border-[var(--sds-border-strong)] text-sm">
                              <div className="flex items-center gap-1">
                                <span>ویژگی</span>
                                <div className="w-1.5 h-1.5 bg-[var(--sds-accent-surface)] rounded-full"></div>
                              </div>
                            </th>
                            <th className="p-2 text-center text-[var(--sds-text-primary)] font-semibold border-b border-[var(--sds-border-strong)] text-sm">
                              <div className="flex items-center justify-center gap-1">
                                <span>وضعیت فعلی</span>
                                <div className="w-1.5 h-1.5 bg-[var(--sds-info-surface)] rounded-full"></div>
                              </div>
                            </th>
                            <th className="p-2 text-center text-[var(--sds-text-primary)] font-semibold border-b border-[var(--sds-border-strong)] text-sm">
                              <div className="flex items-center justify-center gap-1">
                                <span>انتخاب</span>
                                <div className="w-1.5 h-1.5 bg-[var(--sds-success-surface)] rounded-full"></div>
                              </div>
                            </th>
                            <th className="p-2 text-center text-[var(--sds-text-primary)] font-semibold border-b border-[var(--sds-border-strong)] text-sm">
                              <div className="flex items-center justify-center gap-1">
                                <span>سطح دسترسی</span>
                                <div className="w-1.5 h-1.5 bg-[var(--sds-info-surface)] rounded-full"></div>
                              </div>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {getFilteredFeatures().map(([key, value], index) => {
                            const currentPermission = getCurrentPermission(key);
                            const isSelected = selectedFeatures[key];

                            return (
                              <tr
                                key={key}
                                className={`
                                  border-b border-[var(--sds-border-strong)] transition-all duration-200
                                  ${index % 2 === 0 ? 'bg-[var(--sds-surface-raised)]' : 'bg-[var(--sds-surface-raised)]'}
                                  hover:bg-gradient-to-r hover:from-[var(--sds-accent-surface)] hover:to-[var(--sds-info-surface)]
                                  ${isSelected ? 'ring-1 ring-[var(--sds-focus-ring)] bg-[var(--sds-accent-surface)]' : ''}
                                `}
                              >
                                <td className="p-2 text-[var(--sds-text-primary)] font-medium">
                                  <div className="flex items-center gap-2">
                                    <div className={`w-2 h-2 rounded-full ${
                                      isSelected ? 'bg-[var(--sds-accent-surface)]' : 'bg-[var(--sds-surface-subtle)]'
                                    } transition-colors duration-200`}></div>
                                    <span className="text-xs">{value}</span>
                                  </div>
                                </td>
                                <td className="p-2 text-center">
                                  {currentPermission ? (
                                    <span className={`
                                      inline-flex items-center px-2 py-1 rounded-full text-xs font-medium
                                      ${currentPermission.permissionLevel === 'admin' ? 'bg-[var(--sds-danger-surface)] text-[var(--sds-danger)] border border-[var(--sds-danger-border)]' :
                                        currentPermission.permissionLevel === 'edit' ? 'bg-[var(--sds-success-surface)] text-[var(--sds-success)] border border-[var(--sds-success-border)]' :
                                        'bg-[var(--sds-info-surface)] text-[var(--sds-info)] border border-[var(--sds-info-border)]'}
                                    `}>
                                      <div className={`w-1.5 h-1.5 rounded-full mr-1 ${
                                        currentPermission.permissionLevel === 'admin' ? 'bg-[var(--sds-danger-surface)]' :
                                        currentPermission.permissionLevel === 'edit' ? 'bg-[var(--sds-success-surface)]' :
                                        'bg-[var(--sds-info-surface)]'
                                      }`}></div>
                                      {currentPermission.permissionLevel === 'admin' ? 'مدیر' :
                                       currentPermission.permissionLevel === 'edit' ? 'ویرایش' : 'مشاهده'}
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-[var(--sds-surface-subtle)] text-[var(--sds-text-muted)] border border-[var(--sds-border-strong)]">
                                      <div className="w-1.5 h-1.5 rounded-full mr-1 bg-[var(--sds-surface-subtle)]"></div>
                                      بدون دسترسی
                                    </span>
                                  )}
                                </td>
                                <td className="p-2 text-center">
                                  <div className="flex items-center justify-center">
                                    <label className="relative inline-flex items-center cursor-pointer">
                                      <ErpInput
                                        type="checkbox"
                                        checked={!!isSelected}
                                        onChange={(e) => {
                                          if (e.target.checked) {
                                            const initialPermissionLevel = normalizePermissionLevelForFeature(key, bulkPermissionLevel);
                                            handleFeatureSelection(key, initialPermissionLevel);
                                          } else {
                                            const newSelection = { ...selectedFeatures };
                                            delete newSelection[key];
                                            setSelectedFeatures(newSelection);
                                          }
                                        }}
                                        className="sr-only"
                                      />
                                      <div className={`
                                        relative w-5 h-5 rounded border-2 transition-all duration-200
                                        ${isSelected
                                          ? 'bg-[var(--sds-accent)] border-[var(--sds-border-strong)] shadow-md shadow-[var(--sds-shadow-card)]'
                                          : 'bg-[var(--sds-surface-raised)] border-[var(--sds-border-strong)] hover:border-[var(--sds-border-strong)]'
                                        }
                                      `}>
                                        {isSelected && (
                                          <div className="absolute inset-0 flex items-center justify-center">
                                            <svg className="w-3 h-3 text-[var(--sds-text-primary)]" fill="currentColor" viewBox="0 0 20 20">
                                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                            </svg>
                                          </div>
                                        )}
                                      </div>
                                    </label>
                                  </div>
                                </td>
                                <td className="p-2 text-center">
                                  {isSelected && (
                                    <ErpSelect
                                      value={selectedFeatures[key] || 'view'}
                                      onChange={(e) => handleFeatureSelection(key, e.target.value)}
                                      className={`
                                        px-2 py-1 bg-[var(--sds-surface-raised)] border rounded text-[var(--sds-text-primary)] text-xs
                                        focus:border-[var(--sds-border-strong)] focus:outline-none focus:ring-1 focus:ring-[var(--sds-focus-ring)]
                                        transition-all duration-200 hover:bg-[var(--sds-surface-raised)]
                                        ${selectedFeatures[key] === 'admin' ? 'border-[var(--sds-danger-border)] bg-[var(--sds-danger-surface)]' :
                                          selectedFeatures[key] === 'edit' ? 'border-[var(--sds-success-border)] bg-[var(--sds-success-surface)]' :
                                          'border-[var(--sds-info-border)] bg-[var(--sds-info-surface)]'}
                                      `}
                                    >
                                      {featureExceptionPermissionLevelOptions.map((option) => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                      ))}
                                    </ErpSelect>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {Object.keys(selectedFeatures).length > 0 && (
                      <div className="mt-3 p-3 bg-gradient-to-r from-[var(--sds-accent-surface)] to-[var(--sds-info-surface)] border border-[var(--sds-border-strong)] rounded-lg backdrop-blur-sm">
                        <div className="flex justify-between items-center">
                          <div className="flex items-center gap-2">
                            <div className="w-5 h-5 bg-[var(--sds-accent)] rounded-full flex items-center justify-center">
                              <span className="text-[var(--sds-text-primary)] text-xs font-bold">
                                {Object.keys(selectedFeatures).length}
                              </span>
                            </div>
                            <div>
                              <span className="text-[var(--sds-text-primary)] font-medium text-sm">
                                {Object.keys(selectedFeatures).length} ویژگی انتخاب شده
                              </span>
                              <p className="text-xs text-[var(--sds-text-muted)]">
                                آماده برای ایجاد مجوز
                              </p>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <ErpSelect
                              value={bulkPermissionLevel}
                              onChange={(e) => setBulkPermissionLevel(e.target.value)}
                              className="px-3 py-1 bg-[var(--sds-surface-raised)] border border-[var(--sds-border-strong)] rounded text-[var(--sds-text-primary)] text-xs focus:border-[var(--sds-border-strong)] focus:outline-none focus:ring-1 focus:ring-[var(--sds-focus-ring)] transition-all duration-200"
                            >
                              {featureExceptionPermissionLevelOptions.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                              ))}
                            </ErpSelect>
                            <ErpPressable type="submit"
                              onClick={() => {
                                if (bulkPermissionLevel === 'admin') {
                                  showFeedback('مجوز جزئی فقط سطح مشاهده یا ویرایش را پشتیبانی می‌کند');
                                  return;
                                }
                                const newSelection: {[key: string]: string} = {};
                                Object.keys(selectedFeatures).forEach(key => {
                                  newSelection[key] = normalizePermissionLevelForFeature(key, bulkPermissionLevel);
                                });
                                setSelectedFeatures(newSelection);
                              }}
                              className="flex items-center gap-1 px-3 py-1 bg-[var(--sds-accent-surface)] text-[var(--sds-accent)] border border-[var(--sds-border-strong)] rounded text-xs hover:bg-[var(--sds-accent-surface)] transition-all duration-200"
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                              </svg>
                              اعمال به همه
                            </ErpPressable>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {editingPermission && (
                  <div className="bg-[var(--sds-surface-raised)] border border-[var(--sds-border-strong)] rounded-lg p-3 text-sm text-[var(--sds-text-muted)]">
                    <p>ویژگی انتخاب‌شده: {getFeatureDisplayName(formData.feature)}</p>
                    <p className="text-xs text-[var(--sds-text-muted)] mt-1">در حالت ویرایش، نوع ویژگی و فضای کاری ثابت هستند.</p>
                  </div>
                )}


                <div>
                  <label className="block text-[var(--sds-text-muted)] mb-1 text-sm">تاریخ انقضا (اختیاری)</label>
                  <ErpInput
                    type="datetime-local"
                    value={formData.expiresAt}
                    onChange={(e) => setFormData({ ...formData, expiresAt: e.target.value })}
                    className="w-full p-2 bg-[var(--sds-surface-raised)] border border-[var(--sds-border-strong)] rounded text-[var(--sds-text-primary)] text-sm focus:border-[var(--sds-border-strong)] focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex space-x-3 space-x-reverse mt-4">
                {Object.keys(selectedFeatures).length > 0 ? (
                  <ErpPressable type="submit"
                    onClick={handleBulkCreatePermissions}
                    className="flex-1 sds-workspace-surface p-2 hover:bg-[var(--sds-accent-surface)] transition-all duration-300 text-center text-sm"
                  >
                    ایجاد {Object.keys(selectedFeatures).length} مجوز
                  </ErpPressable>
                ) : (
                  <ErpPressable type="submit"
                    onClick={handleCreatePermission}
                    className="flex-1 sds-workspace-surface p-2 hover:bg-[var(--sds-accent-surface)] transition-all duration-300 text-center text-sm"
                    disabled={!formData.feature || (currentUser?.role === 'MANAGER' && selectedUser?.role === 'ADMIN')}
                  >
                    {editingPermission ? 'ویرایش' : 'ایجاد'}
                  </ErpPressable>
                )}
                <ErpPressable type="submit"
                  onClick={() => {
                    setShowAddPermissionModal(false);
                    setEditingPermission(null);
                    setFormData({ userId: '', workspace: '', feature: '', permissionLevel: 'view', expiresAt: '' });
                    clearAllSelections();
                  }}
                  className="flex-1 sds-workspace-surface p-2 hover:bg-[var(--sds-surface-raised)] transition-all duration-300 text-center text-sm"
                >
                  انصراف
                </ErpPressable>
              </div>
            </div>
          </div>
        )}

        {/* Workspace Permission Modal */}
        {showWorkspacePermissionModal && (
          <div className="fixed inset-0 bg-[var(--sds-surface-overlay)] flex items-center justify-center z-50 p-4">
            <div className="sds-workspace-surface p-6 w-full max-w-md mx-auto">
              <h3 className="text-lg font-semibold text-[var(--sds-text-primary)] mb-4">
                ایجاد مجوز فضای کاری
              </h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-[var(--sds-text-muted)] mb-2">کاربر</label>
                  <div className="p-3 bg-[var(--sds-surface-raised)] border border-[var(--sds-border-strong)] rounded-lg text-[var(--sds-text-primary)]">
                    {selectedUser ? `${selectedUser.firstName} ${selectedUser.lastName} (${selectedUser.email})` : 'هیچ کاربری انتخاب نشده'}
                  </div>
                </div>

                <div>
                  <EnhancedDropdown
                    label="فضای کاری"
                    value={formData.workspace}
                    onChange={(value) => setFormData({ ...formData, workspace: value })}
                    placeholder="انتخاب فضای کاری"
                    options={Object.entries(WORKSPACES).map(([key, value]) => ({
                      value: key,
                      label: value
                    }))}
                    searchable={true}
                    clearable={true}
                  />
                </div>

                <div>
                  <EnhancedDropdown
                    label="سطح دسترسی"
                    value={formData.permissionLevel}
                    onChange={(value) => setFormData({ ...formData, permissionLevel: value })}
                    placeholder="انتخاب سطح دسترسی"
                    options={workspacePermissionLevelOptions}
                    searchable={false}
                    clearable={false}
                  />
                </div>

                <div>
                  <label className="block text-[var(--sds-text-muted)] mb-2">تاریخ انقضا (اختیاری)</label>
                  <ErpInput
                    type="datetime-local"
                    value={formData.expiresAt}
                    onChange={(e) => setFormData({ ...formData, expiresAt: e.target.value })}
                    className="w-full p-3 bg-[var(--sds-surface-raised)] border border-[var(--sds-border-strong)] rounded-lg text-[var(--sds-text-primary)] focus:border-[var(--sds-border-strong)] focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex space-x-4 space-x-reverse mt-6">
                <ErpPressable type="submit"
                  onClick={handleCreateWorkspacePermission}
                  className="flex-1 sds-workspace-surface p-3 hover:bg-[var(--sds-accent-surface)] transition-all duration-300 text-center"
                >
                  ایجاد مجوز فضای کاری
                </ErpPressable>
                <ErpPressable type="submit"
                  onClick={() => {
                    setShowWorkspacePermissionModal(false);
                    setFormData({ userId: '', workspace: '', feature: '', permissionLevel: 'view', expiresAt: '' });
                  }}
                  className="flex-1 sds-workspace-surface p-3 hover:bg-[var(--sds-surface-raised)] transition-all duration-300 text-center"
                >
                  انصراف
                </ErpPressable>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
