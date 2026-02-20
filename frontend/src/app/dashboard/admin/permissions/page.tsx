'use client';

import React, { useState, useEffect } from 'react';
import { FaUsers, FaCog, FaPlus, FaEdit, FaTrash, FaEye, FaCheck, FaTimes, FaLock } from 'react-icons/fa';
import { usersAPI, permissionsAPI, authAPI, workspacePermissionsAPI } from '@/lib/api';
import EnhancedDropdown, { DropdownOption } from '@/components/EnhancedDropdown';
import { useRouter } from 'next/navigation';

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

const PERSIAN_ACTION_MAP: Record<string, string> = {
  view: 'مشاهده',
  create: 'ا�Rجاد',
  edit: 'Ùˆیرایش',
  delete: 'حذف',
  approve: 'تایید',
  reject: 'رد',
  sign: 'ا�&ضا',
  print: '� اپ',
  import: 'ÙˆØ±Ùˆد',
  export: 'Ø®Ø±Ùˆجی',
  update: 'Ø¨Ù‡â€ŒØ±Ùˆزرسانی',
  toggle: 'تغییر Ùˆضعیت',
  start: 'Ø´Ø±Ùˆع',
  end: 'پایان',
  assign: 'تخص�Rص',
  verify: 'تایید',
  validate: 'اعتبارسنجی',
  send: 'ارسا�',
  stats: 'آ�&ار'
};

const PERSIAN_TOKEN_MAP: Record<string, string> = {
  core: 'هسته',
  dashboard: 'Ø¯Ø§Ø´Ø¨Ùˆرد',
  profile: 'Ù¾Ø±Ùˆفایل',
  departments: 'بخش‌ها',
  posts: 'پست‌ها',
  orders: 'سفارش‌ها',
  order: 'سفارش',
  status: 'Ùˆضعیت',
  customers: 'مشتریان',
  customer: 'مشتری',
  project: 'Ù¾Ø±ÙˆÚ˜ه',
  addresses: 'آدرس‌ها',
  address: 'آدرس',
  phone: 'تلفن',
  numbers: 'شماره‌ها',
  contacts: 'مخاطبین',
  leads: 'سرنخ‌ها',
  communications: 'ارتباطات',
  contracts: 'قراردادها',
  contract: '�رارداد',
  items: 'اقلام',
  deliveries: 'ØªØ­Ùˆیل‌ها',
  payments: 'پرداخت‌ها',
  verification: 'تایید',
  number: 'شماره',
  templates: 'قالب‌ها',
  generate: 'ØªÙˆلید',
  products: 'Ù…Ø­ØµÙˆلات',
  product: 'Ù…Ø­ØµÙˆل',
  attributes: 'ÙˆÛŒÚ˜گی‌ها',
  legacy: 'قدیمی',
  sales: 'ÙØ±Ùˆش',
  crm: 'CRM',
  inventory: 'ا� بار',
  hr: 'منابع انسانی',
  security: 'امنیت',
  accounting: 'حسابدار�R',
  cut: 'برش',
  cutting: 'برش',
  types: 'Ø§Ù†Ùˆاع',
  type: 'Ù†Ùˆع',
  stone: 'س� گ',
  materials: 'Ù…Ùˆاد',
  widths: 'عرض‌ها',
  thicknesses: 'ضخامت‌ها',
  mines: 'معادن',
  finish: 'پرداخت',
  finishings: 'پرداخت‌ها',
  colors: 'رنگ‌ها',
  services: 'خد�&ات',
  service: 'خد�&ت',
  sub: 'ز�Rر',
  stair: 'پله',
  standard: 'استا� دارد',
  lengths: 'Ø·Ùˆل‌ها',
  layer: 'لایه',
  layers: 'لایه‌ها',
  shifts: 'شیفت‌ها',
  attendance: 'Ø­Ø¶Ùˆر و غیاب',
  checkin: 'ÙˆØ±Ùˆد',
  checkout: 'Ø®Ø±Ùˆج',
  exception: 'استث� اء',
  exceptions: 'استثناءها',
  daily: 'Ø±Ùˆزانه',
  personnel: 'پرسنل',
  missions: 'Ù…Ø§Ù…Ùˆریت‌ها',
  signature: 'ا�&ضا',
  time: 'زمان',
  templates_view: 'مشاهده قالب‌ها',
  templates_create: 'ایجاد قالب‌ها',
  templates_edit: 'Ùˆیرایش قالب‌ها',
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
  'sales': 'ÙØ±Ùˆش',
  'inventory': 'ا� بار',
  'hr': 'منابع انسانی',
  'security': 'امنیت',
  'accounting': 'حسابدار�R'
};

const PERMISSION_LEVELS = {
  'view': 'مشاهده',
  'edit': 'Ùˆیرایش',
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

  useEffect(() => {
    checkUserAccess();
  }, []);

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
        fetchUsers();
        fetchRolePermissions();
        fetchFeatureDefinitions();
      } else {
        router.push('/login');
      }
    } catch (error) {
      console.error('Error checking user access:', error);
      router.push('/login');
    }
  };

  const fetchUsers = async () => {
    try {
      setLoading(true);
      
      // Fetch users
      const usersResponse = await usersAPI.getUsers(1, 100); // Get up to 100 users
      if (usersResponse.data.success) {
        setUsers(usersResponse.data.data);
        setFilteredUsers(usersResponse.data.data);
      }
      
    } catch (error) {
      console.error('Error fetching users:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchRolePermissions = async () => {
    try {
      const [roleWorkspaceResponse, roleFeatureResponse] = await Promise.all([
        workspacePermissionsAPI.getRolePermissions(),
        permissionsAPI.getRoleFeaturePermissions()
      ]);

      if (roleWorkspaceResponse.data.success) {
        setRoleWorkspacePermissions(roleWorkspaceResponse.data.data);
      }

      if (roleFeatureResponse.data.success) {
        setRoleFeaturePermissions(roleFeatureResponse.data.data);
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
    setSelectedUser(user);
    setFormData({ ...formData, userId: user.id });
    fetchUserPermissions(user.id);
  };

  const handleCreatePermission = async () => {
    try {
      if (!selectedUser || !formData.workspace || !formData.feature) {
        alert('لطفاً تمام فیلدهای Ø¶Ø±Ùˆری را پر کنید');
        return;
      }

      if (currentUser?.role === 'MANAGER' && selectedUser.role === 'ADMIN') {
        alert('مدیر ÙØ±Ùˆش Ù†Ù…ÛŒâ€ŒØªÙˆاند دسترسی مدیر سیستم را تغییر دهد');
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

      const response = await permissionsAPI.createFeaturePermission(permissionData);
      
      if (response.data.success) {
        setShowAddPermissionModal(false);
        setFormData({ userId: '', workspace: '', feature: '', permissionLevel: 'view', expiresAt: '' });
        setEditingPermission(null);
        setShowAddPermissionModal(false);
        // Refresh the user's permissions
        if (selectedUser) {
          fetchUserPermissions(selectedUser.id);
        }
      } else {
        alert('خطا در ایجاد Ù…Ø¬Ùˆز: ' + response.data.error);
      }
    } catch (error: any) {
      console.error('Error creating permission:', error);
      alert('خطا در ایجاد مجوز: ' + (error.response?.data?.error || error.message));
    }
  };

  // Handle bulk permission creation
  const handleBulkCreatePermissions = async () => {
    try {
      if (!selectedUser || !formData.workspace) {
        alert('لطفاً کاربر و فضای کاری را انتخاب کنید');
        return;
      }

      if (currentUser?.role === 'MANAGER' && selectedUser.role === 'ADMIN') {
        alert('مدیر ÙØ±Ùˆش Ù†Ù…ÛŒâ€ŒØªÙˆاند دسترسی مدیر سیستم را تغییر دهد');
        return;
      }

      const selectedFeaturesList = Object.entries(selectedFeatures);
      if (selectedFeaturesList.length === 0) {
        alert('لطفاً حداقل ÛŒÚ© ویژگی را انتخاب کنید');
        return;
      }

      let successCount = 0;
      let errorCount = 0;
      const errors: string[] = [];

      for (const [featureKey, permissionLevel] of selectedFeaturesList) {
        try {
          const permissionData: any = {
            userId: selectedUser.id,
            workspace: formData.workspace,
            feature: featureKey,
            permissionLevel: normalizePermissionLevelForFeature(featureKey, permissionLevel)
          };

          // Only include expiresAt if it has a valid value
          if (formData.expiresAt && formData.expiresAt.trim() !== '') {
            permissionData.expiresAt = formData.expiresAt;
          }

          console.log('Creating permission:', permissionData);
          const response = await permissionsAPI.createFeaturePermission(permissionData);
          if (response.data.success) {
            successCount++;
          } else {
            errorCount++;
            errors.push(`${featureKey}: ${response.data.error}`);
          }
        } catch (error: any) {
          errorCount++;
          console.error('Error creating permission for', featureKey, ':', error);
          errors.push(`${featureKey}: ${error.response?.data?.error || error.message}`);
        }
      }

      if (successCount > 0) {
        alert(`${successCount} مجوز با موفقیت ایجاد شد${errorCount > 0 ? ` و ${errorCount} مجوز با خطا مواجه شد` : ''}`);
        
        // Clear selections and refresh
        clearAllSelections();
        if (selectedUser) {
          fetchUserPermissions(selectedUser.id);
        }
      } else {
        alert('خطا در ایجاد Ù…Ø¬Ùˆزها\n' + errors.join('\n'));
      }
    } catch (error: any) {
      console.error('Error creating bulk permissions:', error);
      alert('خطا در ایجاد مجوزها: ' + (error.response?.data?.error || error.message));
    }
  };

  const handleEditPermission = (permission: FeaturePermission) => {
    setEditingPermission(permission);
    setFormData({
      userId: permission.userId,
      workspace: permission.workspace,
      feature: permission.feature,
      permissionLevel: permission.permissionLevel,
      expiresAt: permission.expiresAt || ''
    });
    setShowAddPermissionModal(true);
  };

  const handleDeletePermission = async (id: string) => {
    if (!confirm('آیا از حذف این Ù…Ø¬Ùˆز اطمینان دارید؟')) return;
    
    try {
      if (currentUser?.role === 'MANAGER' && selectedUser?.role === 'ADMIN') {
        alert('مدیر ÙØ±Ùˆش Ù†Ù…ÛŒâ€ŒØªÙˆاند دسترسی مدیر سیستم را تغییر دهد');
        return;
      }

      const response = await permissionsAPI.deleteFeaturePermission(id);
      
      if (response.data.success) {
        // Refresh the user's permissions
        if (selectedUser) {
          fetchUserPermissions(selectedUser.id);
        }
      } else {
        alert('خطا در حذف Ù…Ø¬Ùˆز: ' + response.data.error);
      }
    } catch (error: any) {
      console.error('Error deleting permission:', error);
      alert('خطا در حذف مجوز: ' + (error.response?.data?.error || error.message));
    }
  };

  // Handle workspace permission creation
  const handleCreateWorkspacePermission = async () => {
    try {
      if (!selectedUser || !formData.workspace || !formData.permissionLevel) {
        alert('لطفاً تمام فیلدهای Ø¶Ø±Ùˆری را پر کنید');
        return;
      }

      if (currentUser?.role === 'MANAGER' && selectedUser.role === 'ADMIN') {
        alert('مدیر ÙØ±Ùˆش Ù†Ù…ÛŒâ€ŒØªÙˆاند دسترسی مدیر سیستم را تغییر دهد');
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
        alert('Ù…Ø¬Ùˆز فضای کاری با Ù…Ùˆفقیت ایجاد شد');
      } else {
        alert('خطا در ایجاد Ù…Ø¬Ùˆز فضای کاری: ' + response.data.error);
      }
    } catch (error: any) {
      console.error('Error creating workspace permission:', error);
      alert('خطا در ایجاد مجوز فضای کاری: ' + (error.response?.data?.error || error.message));
    }
  };

  // Handle workspace permission deletion
  const handleDeleteWorkspacePermission = async (id: string) => {
    if (!confirm('آیا از حذف این Ù…Ø¬Ùˆز فضای کاری اطمینان دارید؟')) return;
    
    try {
      if (currentUser?.role === 'MANAGER' && selectedUser?.role === 'ADMIN') {
        alert('مدیر ÙØ±Ùˆش Ù†Ù…ÛŒâ€ŒØªÙˆاند دسترسی مدیر سیستم را تغییر دهد');
        return;
      }

      const response = await workspacePermissionsAPI.deleteUserPermission(id);
      
      if (response.data.success) {
        // Refresh the user's permissions
        if (selectedUser) {
          fetchUserPermissions(selectedUser.id);
        }
        alert('Ù…Ø¬Ùˆز فضای کاری با Ù…Ùˆفقیت حذف شد');
      } else {
        alert('خطا در حذف Ù…Ø¬Ùˆز فضای کاری: ' + response.data.error);
      }
    } catch (error: any) {
      console.error('Error deleting workspace permission:', error);
      alert('خطا در حذف مجوز فضای کاری: ' + (error.response?.data?.error || error.message));
    }
  };

  const handleSaveRoleWorkspacePermission = async () => {
    try {
      if (!roleWorkspaceForm.role || !roleWorkspaceForm.workspace) {
        alert('لطفاً نقش و فضای کاری را انتخاب کنید');
        return;
      }

      if (currentUser?.role === 'MANAGER' && roleWorkspaceForm.role === 'ADMIN') {
        alert('مدیر ÙØ±Ùˆش Ù†Ù…ÛŒâ€ŒØªÙˆاند دسترسی نقش مدیر را تغییر دهد');
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
    } catch (error: any) {
      console.error('Error saving role workspace permission:', error);
      alert(error.response?.data?.error || 'خطا در ذخیره مجوز نقش');
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
      alert('مدیر ÙØ±Ùˆش Ù†Ù…ÛŒâ€ŒØªÙˆاند Ù…Ø¬Ùˆز نقش مدیر را حذف کند');
      return;
    }

    if (!confirm('آیا از حذف این Ù…Ø¬Ùˆز نقش مطمئن هستید؟')) return;

    try {
      await workspacePermissionsAPI.deleteRolePermission(permission.id);
      fetchRolePermissions();
    } catch (error: any) {
      console.error('Error deleting role workspace permission:', error);
      alert(error.response?.data?.error || 'خطا در حذف مجوز نقش');
    }
  };

  const handleSaveRoleFeaturePermission = async () => {
    try {
      if (!roleFeatureForm.role || !roleFeatureForm.workspace || !roleFeatureForm.feature) {
        alert('لطفاً نقش، فضای کاری و ویژگی را انتخاب کنید');
        return;
      }

      if (currentUser?.role === 'MANAGER' && roleFeatureForm.role === 'ADMIN') {
        alert('مدیر ÙØ±Ùˆش Ù†Ù…ÛŒâ€ŒØªÙˆاند دسترسی نقش مدیر را تغییر دهد');
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
    } catch (error: any) {
      console.error('Error saving role feature permission:', error);
      alert(error.response?.data?.error || 'خطا در ذخیره مجوز ویژگی نقش');
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
      alert('مدیر ÙØ±Ùˆش Ù†Ù…ÛŒâ€ŒØªÙˆاند Ù…Ø¬Ùˆز نقش مدیر را حذف کند');
      return;
    }

    if (!confirm('آیا از حذف این Ù…Ø¬Ùˆز نقش مطمئن هستید؟')) return;

    try {
      await permissionsAPI.deleteRoleFeaturePermission(permission.id);
      fetchRolePermissions();
    } catch (error: any) {
      console.error('Error deleting role feature permission:', error);
      alert(error.response?.data?.error || 'خطا در حذف مجوز ویژگی نقش');
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
    setSelectedFeatures(prev => ({
      ...prev,
      [featureKey]: permissionLevel
    }));
  };

  // Handle bulk feature selection
  const handleBulkFeatureSelection = (permissionLevel: string) => {
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

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="glass-liquid-card p-8 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-400 mx-auto mb-4"></div>
            <p className="text-gray-300">در حال بارگذاری...</p>
          </div>
        </div>
      </div>
    );
  }

  // Check if user is not admin or manager
  if (currentUser && !['ADMIN', 'MANAGER'].includes(currentUser.role)) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="glass-liquid-card p-8 text-center">
            <FaLock className="h-16 w-16 text-red-400 mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-white mb-4">دسترسی Ù…Ø­Ø¯Ùˆد</h1>
            <p className="text-gray-300 mb-6">
              شما دسترسی لازم برای مشاهده این صفحه را ندارید. این صفحه فقط برای مدیران سیستم قابل دسترسی است.
            </p>
            <button
              onClick={() => router.push('/dashboard')}
              className="glass-liquid-card px-6 py-3 hover:bg-teal-500/20 transition-all duration-300"
            >
              بازگشت به Ø¯Ø§Ø´Ø¨Ùˆرد
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="glass-liquid-card p-6 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-white mb-2">مدیریت Ù…Ø¬Ùˆزهای کاربران</h1>
              <p className="text-gray-300">جستجو و انتخاب کاربر برای مدیریت Ù…Ø¬Ùˆزهای دسترسی</p>
            </div>
          </div>
        </div>

        {/* User Search Section */}
        <div className="glass-liquid-card p-6 mb-6">
          <h2 className="text-xl font-semibold text-white mb-4">جستجوی کاربر</h2>
          
          {/* Search Input */}
          <div className="relative mb-4">
            <input
              type="text"
              placeholder="جستجو بر اساس نام، ایمیل یا نام کاربری..."
              value={searchQuery}
              onChange={(e) => handleUserSearch(e.target.value)}
              className="w-full p-4 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:border-teal-500 focus:outline-none pr-12"
            />
            <FaUsers className="absolute right-4 top-1/2 transform -translate-y-1/2 text-gray-400" />
          </div>

          {/* User List */}
          {filteredUsers.length > 0 && (
            <div className="max-h-60 overflow-y-auto space-y-2">
              {filteredUsers.map((user) => (
                <div
                  key={user.id}
                  onClick={() => handleUserSelect(user)}
                  className={`p-4 rounded-lg cursor-pointer transition-all duration-300 ${
                    selectedUser?.id === user.id
                      ? 'bg-teal-500/20 border border-teal-500/30'
                      : 'bg-gray-800 hover:bg-gray-700 border border-gray-600'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-white font-medium">
                        {user.firstName} {user.lastName}
                      </h3>
                      <p className="text-gray-400 text-sm">{user.email}</p>
                      <p className="text-gray-500 text-xs">@{user.username} ⬢ {user.role}</p>
                    </div>
                    {selectedUser?.id === user.id && (
                      <div className="text-teal-400">
                        <FaCheck className="h-5 w-5" />
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {filteredUsers.length === 0 && searchQuery && (
            <div className="text-center py-8">
              <FaUsers className="h-12 w-12 text-gray-600 mx-auto mb-4" />
              <p className="text-gray-400">هیچ کاربری یافت نشد</p>
            </div>
          )}
        </div>

        {/* User Permissions Section */}
        {selectedUser && (
          <div className="glass-liquid-card p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-xl font-semibold text-white mb-2">
                  Ù…Ø¬Ùˆزهای {selectedUser.firstName} {selectedUser.lastName}
                </h2>
                <p className="text-gray-400">{selectedUser.email} ⬢ {selectedUser.role}</p>
              </div>
              <button
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
                className="glass-liquid-card px-4 py-2 hover:bg-teal-500/20 transition-all duration-300 flex items-center"
              >
                <FaPlus className="ml-2" />
                Ø§ÙØ²Ùˆدن Ù…Ø¬Ùˆز جدید
              </button>
            </div>

            {/* Workspace Permissions */}
            <div className="mb-8">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-medium text-white">Ù…Ø¬Ùˆزهای فضای کاری</h3>
                <button
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
                  className="glass-liquid-card px-4 py-2 hover:bg-teal-500/20 transition-all duration-300 flex items-center text-sm"
                >
                  <FaPlus className="ml-2" />
                  Ø§ÙØ²Ùˆدن Ù…Ø¬Ùˆز فضای کاری
                </button>
              </div>
              {userWorkspacePermissions.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {userWorkspacePermissions.map((permission) => (
                    <div key={permission.id} className="bg-gray-800 p-4 rounded-lg border border-gray-600">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-white font-medium">
                          {getWorkspaceDisplayName(permission.workspace)}
                        </h4>
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-1 rounded-full text-xs ${
                            permission.permissionLevel === 'admin' ? 'bg-red-500/20 text-red-400' :
                            permission.permissionLevel === 'edit' ? 'bg-yellow-500/20 text-yellow-400' :
                            'bg-green-500/20 text-green-400'
                          }`}>
                            {getPermissionDisplayName(permission.permissionLevel)}
                          </span>
                          <button
                            onClick={() => handleDeleteWorkspacePermission(permission.id)}
                            className="p-1 text-red-400 hover:bg-red-500/20 rounded transition-all duration-300"
                            title="حذف Ù…Ø¬Ùˆز فضای کاری"
                          >
                            <FaTrash className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                      <p className="text-gray-400 text-sm">
                        دسترسی کامل به فضای کاری {getWorkspaceDisplayName(permission.workspace)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
              {userWorkspacePermissions.length === 0 && (
                <div className="text-center py-8">
                  <FaCog className="h-12 w-12 text-gray-600 mx-auto mb-3" />
                  <p className="text-gray-400">هیچ Ù…Ø¬Ùˆز فضای کاری تعریف نشده است</p>
                </div>
              )}
            </div>

            {/* Feature Permissions */}
            <div>
              <h3 className="text-lg font-medium text-white mb-4">Ù…Ø¬Ùˆزهای جزئی</h3>
              
              {userPermissions.length === 0 ? (
                <div className="text-center py-12">
                  <FaCog className="h-16 w-16 text-gray-600 mx-auto mb-4" />
                  <p className="text-gray-400 text-lg">هیچ Ù…Ø¬Ùˆز جزئی تعریف نشده است</p>
                  <button
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
                    className="mt-4 glass-liquid-card px-6 py-3 hover:bg-teal-500/20 transition-all duration-300"
                  >
                    <FaPlus className="inline-block ml-2" />
                    Ø§ÙØ²Ùˆدن Ù…Ø¬Ùˆز جدید
                  </button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-700">
                        <th className="text-right py-3 px-4 text-gray-300">فضای کاری</th>
                        <th className="text-right py-3 px-4 text-gray-300">ویژگی</th>
                        <th className="text-right py-3 px-4 text-gray-300">سطح دسترس�R</th>
                        <th className="text-right py-3 px-4 text-gray-300">Ùˆضعیت</th>
                        <th className="text-right py-3 px-4 text-gray-300">عملیات</th>
                      </tr>
                    </thead>
                    <tbody>
                      {userPermissions.map((permission) => (
                        <tr key={permission.id} className="border-b border-gray-800 hover:bg-gray-800/50">
                          <td className="py-3 px-4 text-gray-300">
                            {getWorkspaceDisplayName(permission.workspace)}
                          </td>
                          <td className="py-3 px-4 text-gray-300">
                            {getFeatureDisplayName(permission.feature)}
                          </td>
                          <td className="py-3 px-4">
                            <span className={`px-3 py-1 rounded-full text-sm ${
                              permission.permissionLevel === 'admin' ? 'bg-red-500/20 text-red-400' :
                              permission.permissionLevel === 'edit' ? 'bg-yellow-500/20 text-yellow-400' :
                              'bg-green-500/20 text-green-400'
                            }`}>
                              {getPermissionDisplayName(permission.permissionLevel)}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            {permission.isActive ? (
                              <span className="flex items-center text-green-400">
                                <FaCheck className="ml-1" />
                                فعا�
                              </span>
                            ) : (
                              <span className="flex items-center text-red-400">
                                <FaTimes className="ml-1" />
                                غیرفعال
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex space-x-2 space-x-reverse">
                              <button
                                onClick={() => handleEditPermission(permission)}
                                className="p-2 text-blue-400 hover:bg-blue-500/20 rounded-lg transition-all duration-300"
                              >
                                <FaEdit />
                              </button>
                              <button
                                onClick={() => handleDeletePermission(permission.id)}
                                className="p-2 text-red-400 hover:bg-red-500/20 rounded-lg transition-all duration-300"
                              >
                                <FaTrash />
                              </button>
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
        {!selectedUser && (
          <div className="glass-liquid-card p-12 text-center">
            <FaUsers className="h-20 w-20 text-gray-600 mx-auto mb-6" />
            <h2 className="text-2xl font-semibold text-white mb-4">کاربری انتخاب نشده</h2>
            <p className="text-gray-400 text-lg mb-6">
              برای مشاهده و مدیریت Ù…Ø¬Ùˆزها، ابتدا ÛŒÚ© کاربر را از لیست بالا انتخاب کنید
            </p>
          </div>
        )}

        {/* Role Permissions */}
        <div className="glass-liquid-card p-6 mt-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-white">مدیریت Ù…Ø¬Ùˆزهای نقش</h2>
            {currentUser?.role === 'MANAGER' && (
              <span className="text-xs text-gray-400">مدیر ÙØ±Ùˆش به نقش مدیر دسترسی ندارد</span>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Role Workspace Permissions */}
            <div className="glass-liquid-card p-4">
              <h3 className="text-lg font-semibold text-white mb-3">Ù…Ø¬Ùˆزهای فضای کاری بر اساس نقش</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-gray-300 mb-1 text-sm">نقش</label>
                  <select
                    value={roleWorkspaceForm.role}
                    onChange={(e) => setRoleWorkspaceForm({ ...roleWorkspaceForm, role: e.target.value })}
                    className="w-full p-2 bg-gray-800 border border-gray-600 rounded text-white text-sm"
                  >
                    <option value="">انتخاب نقش</option>
                    {ROLE_OPTIONS.map(role => (
                      <option
                        key={role}
                        value={role}
                        disabled={currentUser?.role === 'MANAGER' && role === 'ADMIN'}
                      >
                        {role}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-gray-300 mb-1 text-sm">فضای کاری</label>
                  <select
                    value={roleWorkspaceForm.workspace}
                    onChange={(e) => setRoleWorkspaceForm({ ...roleWorkspaceForm, workspace: e.target.value })}
                    className="w-full p-2 bg-gray-800 border border-gray-600 rounded text-white text-sm"
                  >
                    <option value="">انتخاب فضای کاری</option>
                    {Object.entries(WORKSPACES).map(([key, value]) => (
                      <option key={key} value={key}>{value}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-gray-300 mb-1 text-sm">سطح دسترس�R</label>
                  <select
                    value={roleWorkspaceForm.permissionLevel}
                    onChange={(e) => setRoleWorkspaceForm({ ...roleWorkspaceForm, permissionLevel: e.target.value })}
                    className="w-full p-2 bg-gray-800 border border-gray-600 rounded text-white text-sm"
                  >
                    <option value="view">مشاهده</option>
                    <option value="edit">Ùˆیرایش</option>
                    <option value="admin">مدیریت</option>
                  </select>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={handleSaveRoleWorkspacePermission}
                    className="flex-1 glass-liquid-card p-2 hover:bg-teal-500/20 transition-all duration-300 text-center text-sm"
                  >
                    {roleWorkspaceForm.id ? 'به‌روزرسانی' : 'ایجاد'}
                  </button>
                  <button
                    onClick={() => setRoleWorkspaceForm({ id: '', role: '', workspace: '', permissionLevel: 'view', isActive: true })}
                    className="flex-1 glass-liquid-card p-2 hover:bg-gray-700/50 transition-all duration-300 text-center text-sm"
                  >
                    پاک کرد� 
                  </button>
                </div>
              </div>

              <div className="mt-4 space-y-2 max-h-48 overflow-y-auto">
                {roleWorkspacePermissions.length === 0 && (
                  <p className="text-xs text-gray-400">هیچ Ù…Ø¬Ùˆزی ثبت نشده است.</p>
                )}
                {roleWorkspacePermissions.map((permission: any) => (
                  <div key={permission.id} className="flex items-center justify-between bg-gray-800/50 p-2 rounded">
                    <div className="text-xs text-gray-300">
                      {permission.role} / {permission.workspace} / {permission.permissionLevel}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleEditRoleWorkspacePermission(permission)}
                        disabled={currentUser?.role === 'MANAGER' && permission.role === 'ADMIN'}
                        className="text-xs text-teal-300 disabled:opacity-50"
                      >
                        Ùˆیرایش
                      </button>
                      <button
                        onClick={() => handleDeleteRoleWorkspacePermission(permission)}
                        disabled={currentUser?.role === 'MANAGER' && permission.role === 'ADMIN'}
                        className="text-xs text-red-300 disabled:opacity-50"
                      >
                        حذف
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Role Feature Permissions */}
            <div className="glass-liquid-card p-4">
              <h3 className="text-lg font-semibold text-white mb-3">Ù…Ø¬Ùˆزهای ویژگی بر اساس نقش</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-gray-300 mb-1 text-sm">نقش</label>
                  <select
                    value={roleFeatureForm.role}
                    onChange={(e) => setRoleFeatureForm({ ...roleFeatureForm, role: e.target.value })}
                    className="w-full p-2 bg-gray-800 border border-gray-600 rounded text-white text-sm"
                  >
                    <option value="">انتخاب نقش</option>
                    {ROLE_OPTIONS.map(role => (
                      <option
                        key={role}
                        value={role}
                        disabled={currentUser?.role === 'MANAGER' && role === 'ADMIN'}
                      >
                        {role}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-gray-300 mb-1 text-sm">فضای کاری</label>
                  <select
                    value={roleFeatureForm.workspace}
                    onChange={(e) => setRoleFeatureForm({ ...roleFeatureForm, workspace: e.target.value, feature: '' })}
                    className="w-full p-2 bg-gray-800 border border-gray-600 rounded text-white text-sm"
                  >
                    <option value="">انتخاب فضای کاری</option>
                    {Object.entries(WORKSPACES).map(([key, value]) => (
                      <option key={key} value={key}>{value}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-gray-300 mb-1 text-sm">ویژگی</label>
                  <select
                    value={roleFeatureForm.feature}
                    onChange={(e) => setRoleFeatureForm({ ...roleFeatureForm, feature: e.target.value })}
                    className="w-full p-2 bg-gray-800 border border-gray-600 rounded text-white text-sm"
                  >
                    <option value="">انتخاب ویژگی</option>
                    {getRoleFilteredFeatures().map(([key, value]) => (
                      <option key={key} value={key}>{value}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-gray-300 mb-1 text-sm">سطح دسترس�R</label>
                  <select
                    value={roleFeatureForm.permissionLevel}
                    onChange={(e) => setRoleFeatureForm({ ...roleFeatureForm, permissionLevel: e.target.value })}
                    className="w-full p-2 bg-gray-800 border border-gray-600 rounded text-white text-sm"
                  >
                    <option value="view">مشاهده</option>
                    <option value="edit">Ùˆیرایش</option>
                    <option value="admin">مدیریت</option>
                  </select>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={handleSaveRoleFeaturePermission}
                    className="flex-1 glass-liquid-card p-2 hover:bg-teal-500/20 transition-all duration-300 text-center text-sm"
                  >
                    {roleFeatureForm.id ? 'به‌روزرسانی' : 'ایجاد'}
                  </button>
                  <button
                    onClick={() => setRoleFeatureForm({ id: '', role: '', workspace: '', feature: '', permissionLevel: 'view', isActive: true })}
                    className="flex-1 glass-liquid-card p-2 hover:bg-gray-700/50 transition-all duration-300 text-center text-sm"
                  >
                    پاک کرد� 
                  </button>
                </div>
              </div>

              <div className="mt-4 space-y-2 max-h-48 overflow-y-auto">
                {roleFeaturePermissions.length === 0 && (
                  <p className="text-xs text-gray-400">هیچ Ù…Ø¬Ùˆزی ثبت نشده است.</p>
                )}
                {roleFeaturePermissions.map((permission) => (
                  <div key={permission.id} className="flex items-center justify-between bg-gray-800/50 p-2 rounded">
                    <div className="text-xs text-gray-300">
                      {permission.role} / {getWorkspaceDisplayName(permission.workspace)} / {getFeatureDisplayName(permission.feature)} / {getPermissionDisplayName(permission.permissionLevel)}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleEditRoleFeaturePermission(permission)}
                        disabled={currentUser?.role === 'MANAGER' && permission.role === 'ADMIN'}
                        className="text-xs text-teal-300 disabled:opacity-50"
                      >
                        Ùˆیرایش
                      </button>
                      <button
                        onClick={() => handleDeleteRoleFeaturePermission(permission)}
                        disabled={currentUser?.role === 'MANAGER' && permission.role === 'ADMIN'}
                        className="text-xs text-red-300 disabled:opacity-50"
                      >
                        حذف
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Create/Edit Modal */}
        {showAddPermissionModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="glass-liquid-card p-4 w-full max-w-6xl mx-auto max-h-[90vh] overflow-y-auto">
              <h3 className="text-lg font-semibold text-white mb-3">
                {editingPermission ? 'ویرایش مجوز' : 'ایجاد مجوز جدید'}
              </h3>
              
              <div className="space-y-3">
                {!editingPermission && (
                  <div>
                    <label className="block text-gray-300 mb-2">کاربر</label>
                    <div className="p-3 bg-gray-800 border border-gray-600 rounded-lg text-white">
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
                  />
                </div>

                {/* Feature Selection Table */}
                {formData.workspace && (
                  <div>
                    <div className="flex justify-between items-center mb-3">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 bg-gradient-to-br from-teal-500 to-blue-500 rounded-lg flex items-center justify-center">
                          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </div>
                        <div>
                          <h3 className="text-base font-semibold text-gray-200">
                            انتخاب ÙˆÛŒÚ˜گی‌ها برای {getWorkspaceDisplayName(formData.workspace)}
                          </h3>
                          <p className="text-xs text-gray-400">
                            {getFilteredFeatures().length} ویژگی Ù…ÙˆØ¬Ùˆد است
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <button
                          onClick={() => handleBulkFeatureSelection('view')}
                          className="flex items-center gap-1 px-2 py-1 bg-blue-500/20 text-blue-300 border border-blue-500/30 rounded text-xs hover:bg-blue-500/30 transition-all duration-200"
                        >
                          <div className="w-1.5 h-1.5 bg-blue-400 rounded-full"></div>
                          همه (مشاهده)
                        </button>
                        <button
                          onClick={() => handleBulkFeatureSelection('edit')}
                          className="flex items-center gap-1 px-2 py-1 bg-green-500/20 text-green-300 border border-green-500/30 rounded text-xs hover:bg-green-500/30 transition-all duration-200"
                        >
                          <div className="w-1.5 h-1.5 bg-green-400 rounded-full"></div>
                          همه (Ùˆیرایش)
                        </button>
                        <button
                          onClick={clearAllSelections}
                          className="flex items-center gap-1 px-2 py-1 bg-red-500/20 text-red-300 border border-red-500/30 rounded text-xs hover:bg-red-500/30 transition-all duration-200"
                        >
                          <div className="w-1.5 h-1.5 bg-red-400 rounded-full"></div>
                          پاک کرد� 
                        </button>
                      </div>
                    </div>

                    <div className="max-h-60 overflow-y-auto border border-gray-600 rounded-lg bg-gray-900/50 backdrop-blur-sm">
                      <table className="w-full">
                        <thead className="bg-gradient-to-r from-gray-800 to-gray-700 sticky top-0 z-10">
                          <tr>
                            <th className="p-2 text-right text-gray-200 font-semibold border-b border-gray-600 text-sm">
                              <div className="flex items-center gap-1">
                                <span>ویژگی</span>
                                <div className="w-1.5 h-1.5 bg-teal-400 rounded-full"></div>
                              </div>
                            </th>
                            <th className="p-2 text-center text-gray-200 font-semibold border-b border-gray-600 text-sm">
                              <div className="flex items-center justify-center gap-1">
                                <span>Ùˆضعیت فعلی</span>
                                <div className="w-1.5 h-1.5 bg-blue-400 rounded-full"></div>
                              </div>
                            </th>
                            <th className="p-2 text-center text-gray-200 font-semibold border-b border-gray-600 text-sm">
                              <div className="flex items-center justify-center gap-1">
                                <span>ا� تخاب</span>
                                <div className="w-1.5 h-1.5 bg-green-400 rounded-full"></div>
                              </div>
                            </th>
                            <th className="p-2 text-center text-gray-200 font-semibold border-b border-gray-600 text-sm">
                              <div className="flex items-center justify-center gap-1">
                                <span>سطح دسترس�R</span>
                                <div className="w-1.5 h-1.5 bg-purple-400 rounded-full"></div>
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
                                  border-b border-gray-700/50 transition-all duration-200
                                  ${index % 2 === 0 ? 'bg-gray-800/30' : 'bg-gray-800/20'}
                                  hover:bg-gradient-to-r hover:from-teal-500/10 hover:to-blue-500/10
                                  ${isSelected ? 'ring-1 ring-teal-500/50 bg-teal-500/5' : ''}
                                `}
                              >
                                <td className="p-2 text-gray-200 font-medium">
                                  <div className="flex items-center gap-2">
                                    <div className={`w-2 h-2 rounded-full ${
                                      isSelected ? 'bg-teal-400' : 'bg-gray-600'
                                    } transition-colors duration-200`}></div>
                                    <span className="text-xs">{value}</span>
                                  </div>
                                </td>
                                <td className="p-2 text-center">
                                  {currentPermission ? (
                                    <span className={`
                                      inline-flex items-center px-2 py-1 rounded-full text-xs font-medium
                                      ${currentPermission.permissionLevel === 'admin' ? 'bg-red-500/20 text-red-300 border border-red-500/30' :
                                        currentPermission.permissionLevel === 'edit' ? 'bg-green-500/20 text-green-300 border border-green-500/30' :
                                        'bg-blue-500/20 text-blue-300 border border-blue-500/30'}
                                    `}>
                                      <div className={`w-1.5 h-1.5 rounded-full mr-1 ${
                                        currentPermission.permissionLevel === 'admin' ? 'bg-red-400' :
                                        currentPermission.permissionLevel === 'edit' ? 'bg-green-400' :
                                        'bg-blue-400'
                                      }`}></div>
                                      {currentPermission.permissionLevel === 'admin' ? 'مدیر' :
                                       currentPermission.permissionLevel === 'edit' ? 'ویرایش' : 'مشاهده'}
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-600/20 text-gray-400 border border-gray-600/30">
                                      <div className="w-1.5 h-1.5 rounded-full mr-1 bg-gray-500"></div>
                                      Ø¨Ø¯Ùˆن دسترسی
                                    </span>
                                  )}
                                </td>
                                <td className="p-2 text-center">
                                  <div className="flex items-center justify-center">
                                    <label className="relative inline-flex items-center cursor-pointer">
                                      <input
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
                                          ? 'bg-teal-500 border-teal-500 shadow-md shadow-teal-500/25' 
                                          : 'bg-gray-700 border-gray-600 hover:border-teal-400'
                                        }
                                      `}>
                                        {isSelected && (
                                          <div className="absolute inset-0 flex items-center justify-center">
                                            <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
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
                                    <select
                                      value={selectedFeatures[key] || 'view'}
                                      onChange={(e) => handleFeatureSelection(key, e.target.value)}
                                      className={`
                                        px-2 py-1 bg-gray-800 border rounded text-white text-xs
                                        focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500/20
                                        transition-all duration-200 hover:bg-gray-700
                                        ${selectedFeatures[key] === 'admin' ? 'border-red-500/50 bg-red-500/5' :
                                          selectedFeatures[key] === 'edit' ? 'border-green-500/50 bg-green-500/5' :
                                          'border-blue-500/50 bg-blue-500/5'}
                                      `}
                                    >
                                      <option value="view">مشاهده</option>
                                      <option value="edit">Ùˆیرایش</option>
                                      <option value="admin">مدیر</option>
                                    </select>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {Object.keys(selectedFeatures).length > 0 && (
                      <div className="mt-3 p-3 bg-gradient-to-r from-teal-500/10 to-blue-500/10 border border-teal-500/20 rounded-lg backdrop-blur-sm">
                        <div className="flex justify-between items-center">
                          <div className="flex items-center gap-2">
                            <div className="w-5 h-5 bg-teal-500 rounded-full flex items-center justify-center">
                              <span className="text-white text-xs font-bold">
                                {Object.keys(selectedFeatures).length}
                              </span>
                            </div>
                            <div>
                              <span className="text-gray-200 font-medium text-sm">
                                {Object.keys(selectedFeatures).length} ویژگی انتخاب شده
                              </span>
                              <p className="text-xs text-gray-400">
                                آماده برای ایجاد Ù…Ø¬Ùˆز
                              </p>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <select
                              value={bulkPermissionLevel}
                              onChange={(e) => setBulkPermissionLevel(e.target.value)}
                              className="px-3 py-1 bg-gray-800/50 border border-gray-600 rounded text-white text-xs focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500/20 transition-all duration-200"
                            >
                              <option value="view">مشاهده</option>
                              <option value="edit">Ùˆیرایش</option>
                              <option value="admin">مدیر</option>
                            </select>
                            <button
                              onClick={() => {
                                const newSelection: {[key: string]: string} = {};
                                Object.keys(selectedFeatures).forEach(key => {
                                  newSelection[key] = normalizePermissionLevelForFeature(key, bulkPermissionLevel);
                                });
                                setSelectedFeatures(newSelection);
                              }}
                              className="flex items-center gap-1 px-3 py-1 bg-teal-500/20 text-teal-300 border border-teal-500/30 rounded text-xs hover:bg-teal-500/30 transition-all duration-200"
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                              </svg>
                              اعمال به همه
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}


                <div>
                  <label className="block text-gray-300 mb-1 text-sm">تاریخ انقضا (اختیاری)</label>
                  <input
                    type="datetime-local"
                    value={formData.expiresAt}
                    onChange={(e) => setFormData({ ...formData, expiresAt: e.target.value })}
                    className="w-full p-2 bg-gray-800 border border-gray-600 rounded text-white text-sm focus:border-teal-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex space-x-3 space-x-reverse mt-4">
                {Object.keys(selectedFeatures).length > 0 ? (
                  <button
                    onClick={handleBulkCreatePermissions}
                    className="flex-1 glass-liquid-card p-2 hover:bg-teal-500/20 transition-all duration-300 text-center text-sm"
                  >
                    ایجاد {Object.keys(selectedFeatures).length} Ù…Ø¬Ùˆز
                  </button>
                ) : (
                  <button
                    onClick={handleCreatePermission}
                    className="flex-1 glass-liquid-card p-2 hover:bg-teal-500/20 transition-all duration-300 text-center text-sm"
                    disabled={!formData.feature}
                  >
                    {editingPermission ? 'ویرایش' : 'ایجاد'}
                  </button>
                )}
                <button
                  onClick={() => {
                    setShowAddPermissionModal(false);
                    setEditingPermission(null);
                    setFormData({ userId: '', workspace: '', feature: '', permissionLevel: 'view', expiresAt: '' });
                    clearAllSelections();
                  }}
                  className="flex-1 glass-liquid-card p-2 hover:bg-gray-700/50 transition-all duration-300 text-center text-sm"
                >
                  ا� صراف
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Workspace Permission Modal */}
        {showWorkspacePermissionModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="glass-liquid-card p-6 w-full max-w-md mx-auto">
              <h3 className="text-lg font-semibold text-white mb-4">
                ایجاد Ù…Ø¬Ùˆز فضای کاری
              </h3>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-gray-300 mb-2">کاربر</label>
                  <div className="p-3 bg-gray-800 border border-gray-600 rounded-lg text-white">
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
                    label="سطح دسترس�R"
                    value={formData.permissionLevel}
                    onChange={(value) => setFormData({ ...formData, permissionLevel: value })}
                    placeholder="انتخاب سطح دسترسی"
                    options={[
                      { value: 'view', label: 'مشاهده' },
                      { value: 'edit', label: 'Ùˆیرایش' },
                      { value: 'admin', label: 'مدیریت' }
                    ]}
                    searchable={false}
                    clearable={false}
                  />
                </div>

                <div>
                  <label className="block text-gray-300 mb-2">تاریخ انقضا (اختیاری)</label>
                  <input
                    type="datetime-local"
                    value={formData.expiresAt}
                    onChange={(e) => setFormData({ ...formData, expiresAt: e.target.value })}
                    className="w-full p-3 bg-gray-800 border border-gray-600 rounded-lg text-white focus:border-teal-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex space-x-4 space-x-reverse mt-6">
                <button
                  onClick={handleCreateWorkspacePermission}
                  className="flex-1 glass-liquid-card p-3 hover:bg-teal-500/20 transition-all duration-300 text-center"
                >
                  ایجاد Ù…Ø¬Ùˆز فضای کاری
                </button>
                <button
                  onClick={() => {
                    setShowWorkspacePermissionModal(false);
                    setFormData({ userId: '', workspace: '', feature: '', permissionLevel: 'view', expiresAt: '' });
                  }}
                  className="flex-1 glass-liquid-card p-3 hover:bg-gray-700/50 transition-all duration-300 text-center"
                >
                  ا� صراف
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
