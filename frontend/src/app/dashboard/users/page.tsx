'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { 
  FaUsers, 
  FaPlus, 
  FaEdit, 
  FaTrash, 
  FaEye, 
  FaShieldAlt,
  FaBuilding,
  FaSearch,
  FaFilter,
  FaDownload,
  FaUserCheck,
  FaUserTimes,
  FaCog
} from 'react-icons/fa';
import { usersAPI, workspacePermissionsAPI, departmentsAPI } from '@/lib/api';

interface User {
  id: string;
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  role: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  department?: {
    id: string;
    name: string;
    namePersian: string;
  };
  profile?: {
    id: string;
    phone: string;
    address: string;
  };
}

interface WorkspacePermission {
  id: string;
  userId: string;
  workspace: string;
  permissionLevel: string;
  isActive: boolean;
  grantedAt: string;
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    username: string;
    role: string;
  };
  granter: {
    id: string;
    firstName: string;
    lastName: string;
    username: string;
  };
}

interface Department {
  id: string;
  name: string;
  namePersian: string;
  description: string;
  isActive: boolean;
}

export default function UsersManagementPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [permissions, setPermissions] = useState<WorkspacePermission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState('');
  const [selectedRole, setSelectedRole] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [userToDelete, setUserToDelete] = useState<User | null>(null);

  useEffect(() => {
    fetchData();
  }, [currentPage, searchTerm, selectedDepartment, selectedRole, selectedStatus]);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const [usersResponse, departmentsResponse, permissionsResponse] = await Promise.all([
        usersAPI.getUsers(currentPage, 10),
        departmentsAPI.getDepartments(),
        workspacePermissionsAPI.getUserPermissions()
      ]);
      
      if (usersResponse.data.success) {
        setUsers(usersResponse.data.data);
        setTotalPages(usersResponse.data.pagination.pages);
      }
      
      if (departmentsResponse.data.success) {
        setDepartments(departmentsResponse.data.data);
      }
      
      if (permissionsResponse.data.success) {
        setPermissions(permissionsResponse.data.data);
      }
    } catch (error: any) {
      console.error('Error fetching users data:', error);
      setError(error.response?.data?.error || 'خطا در ارتباط با سرور');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteUser = async (user: User) => {
    setUserToDelete(user);
    setShowDeleteModal(true);
  };

  const confirmDeleteUser = async () => {
    if (!userToDelete) return;
    
    try {
      await usersAPI.deleteUser(userToDelete.id);
      alert('کاربر با موفقیت حذف شد');
      fetchData();
    } catch (error: any) {
      console.error('Error deleting user:', error);
      alert(error.response?.data?.error || 'خطا در حذف کاربر');
    } finally {
      setShowDeleteModal(false);
      setUserToDelete(null);
    }
  };

  const getUserWorkspacePermissions = (userId: string) => {
    return permissions.filter(p => p.userId === userId && p.isActive);
  };

  const getRoleLabel = (role: string) => {
    switch (role) {
      case 'ADMIN': return 'مدیر';
      case 'USER': return 'کاربر';
      case 'MODERATOR': return 'ناظر';
      default: return role;
    }
  };

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'ADMIN': return 'text-red-500 bg-red-500/20';
      case 'USER': return 'text-blue-500 bg-blue-500/20';
      case 'MODERATOR': return 'text-yellow-500 bg-yellow-500/20';
      default: return 'text-gray-500 bg-gray-500/20';
    }
  };

  const getWorkspaceLabel = (workspace: string) => {
    switch (workspace) {
      case 'sales': return 'فروش';
      case 'crm': return 'CRM';
      case 'hr': return 'منابع انسانی';
      case 'accounting': return 'حسابداری';
      case 'inventory': return 'انبار';
      case 'security': return 'امنیت';
      default: return workspace;
    }
  };

  const getPermissionLabel = (permission: string) => {
    switch (permission) {
      case 'view': return 'مشاهده';
      case 'edit': return 'ویرایش';
      case 'admin': return 'مدیریت';
      default: return permission;
    }
  };

  const filteredUsers = users.filter(user => {
    const matchesSearch = 
      user.firstName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.lastName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.username.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesDepartment = !selectedDepartment || user.department?.id === selectedDepartment;
    const matchesRole = !selectedRole || user.role === selectedRole;
    const matchesStatus = !selectedStatus || 
      (selectedStatus === 'active' && user.isActive) ||
      (selectedStatus === 'inactive' && !user.isActive);
    
    return matchesSearch && matchesDepartment && matchesRole && matchesStatus;
  });

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-500"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center">
        <div className="glass-liquid-card p-8 text-center">
          <h2 className="text-xl font-bold text-primary mb-2">خطا در بارگذاری</h2>
          <p className="text-secondary mb-4">{error}</p>
          <button 
            onClick={fetchData}
            className="glass-liquid-btn-primary px-6 py-2"
          >
            تلاش مجدد
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="glass-liquid-card p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4 space-x-reverse">
            <FaUsers className="h-8 w-8 text-teal-500" />
            <div>
              <h1 className="text-2xl font-bold text-primary">مدیریت کاربران</h1>
              <p className="text-secondary">مدیریت کاربران، نقش‌ها و دسترسی‌های سیستم</p>
            </div>
          </div>
          <div className="flex items-center space-x-4 space-x-reverse">
            <Link
              href="/dashboard/users/create"
              className="glass-liquid-btn-primary px-6 py-2 flex items-center space-x-2 space-x-reverse"
            >
              <FaPlus />
              <span>کاربر جدید</span>
            </Link>
            <Link
              href="/dashboard/departments"
              className="glass-liquid-btn px-6 py-2 flex items-center space-x-2 space-x-reverse"
            >
              <FaBuilding />
              <span>مدیریت بخش‌ها</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="glass-liquid-card p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-secondary">کل کاربران</p>
              <p className="text-2xl font-bold text-primary">{users.length}</p>
            </div>
            <FaUsers className="h-8 w-8 text-blue-500" />
          </div>
        </div>
        
        <div className="glass-liquid-card p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-secondary">کاربران فعال</p>
              <p className="text-2xl font-bold text-primary">
                {users.filter(u => u.isActive).length}
              </p>
            </div>
            <FaUserCheck className="h-8 w-8 text-green-500" />
          </div>
        </div>
        
        <div className="glass-liquid-card p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-secondary">مدیران</p>
              <p className="text-2xl font-bold text-primary">
                {users.filter(u => u.role === 'ADMIN').length}
              </p>
            </div>
            <FaShieldAlt className="h-8 w-8 text-red-500" />
          </div>
        </div>
        
        <div className="glass-liquid-card p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-secondary">کل بخش‌ها</p>
              <p className="text-2xl font-bold text-primary">{departments.length}</p>
            </div>
            <FaBuilding className="h-8 w-8 text-purple-500" />
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="glass-liquid-card p-6">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <div>
            <label className="block text-sm text-secondary mb-2">جستجو</label>
            <div className="relative">
              <FaSearch className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="جستجو در نام، ایمیل یا نام کاربری..."
                className="glass-liquid-input w-full pr-10"
              />
            </div>
          </div>
          
          <div>
            <label className="block text-sm text-secondary mb-2">بخش</label>
            <select
              value={selectedDepartment}
              onChange={(e) => setSelectedDepartment(e.target.value)}
              className="glass-liquid-input w-full"
            >
              <option value="">همه بخش‌ها</option>
              {departments.map(dept => (
                <option key={dept.id} value={dept.id}>
                  {dept.namePersian}
                </option>
              ))}
            </select>
          </div>
          
          <div>
            <label className="block text-sm text-secondary mb-2">نقش</label>
            <select
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value)}
              className="glass-liquid-input w-full"
            >
              <option value="">همه نقش‌ها</option>
              <option value="ADMIN">مدیر</option>
              <option value="USER">کاربر</option>
              <option value="MODERATOR">ناظر</option>
            </select>
          </div>
          
          <div>
            <label className="block text-sm text-secondary mb-2">وضعیت</label>
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="glass-liquid-input w-full"
            >
              <option value="">همه وضعیت‌ها</option>
              <option value="active">فعال</option>
              <option value="inactive">غیرفعال</option>
            </select>
          </div>
          
          <div className="flex items-end">
            <button
              onClick={() => {
                setSearchTerm('');
                setSelectedDepartment('');
                setSelectedRole('');
                setSelectedStatus('');
              }}
              className="glass-liquid-btn w-full px-4 py-2 flex items-center justify-center space-x-2 space-x-reverse"
            >
              <FaFilter />
              <span>پاک کردن فیلترها</span>
            </button>
          </div>
        </div>
      </div>

      {/* Users Table */}
      <div className="glass-liquid-card p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-primary">لیست کاربران</h2>
          <div className="flex items-center space-x-2 space-x-reverse">
            <button className="glass-liquid-btn p-2" title="صادرات">
              <FaDownload />
            </button>
          </div>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="text-right py-3 px-4 text-secondary">کاربر</th>
                <th className="text-right py-3 px-4 text-secondary">نقش</th>
                <th className="text-right py-3 px-4 text-secondary">بخش</th>
                <th className="text-right py-3 px-4 text-secondary">فضاهای کاری</th>
                <th className="text-right py-3 px-4 text-secondary">وضعیت</th>
                <th className="text-right py-3 px-4 text-secondary">تاریخ ایجاد</th>
                <th className="text-right py-3 px-4 text-secondary">عملیات</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((user) => {
                const userPermissions = getUserWorkspacePermissions(user.id);
                return (
                  <tr key={user.id} className="border-b border-gray-800 hover:bg-white/5">
                    <td className="py-3 px-4">
                      <div>
                        <div className="font-medium text-primary">
                          {user.firstName} {user.lastName}
                        </div>
                        <div className="text-sm text-secondary">
                          {user.email}
                        </div>
                        <div className="text-xs text-gray-500">
                          @{user.username}
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${getRoleColor(user.role)}`}>
                        {getRoleLabel(user.role)}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-secondary">
                      {user.department ? user.department.namePersian : 'بدون بخش'}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex flex-wrap gap-1">
                        {userPermissions.length > 0 ? (
                          userPermissions.map(permission => (
                            <span
                              key={permission.id}
                              className="px-2 py-1 rounded text-xs bg-teal-500/20 text-teal-400"
                            >
                              {getWorkspaceLabel(permission.workspace)} ({getPermissionLabel(permission.permissionLevel)})
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-gray-500">بدون دسترسی</span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        user.isActive 
                          ? 'text-green-500 bg-green-500/20' 
                          : 'text-red-500 bg-red-500/20'
                      }`}>
                        {user.isActive ? 'فعال' : 'غیرفعال'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-secondary text-sm">
                      {new Date(user.createdAt).toLocaleDateString('fa-IR')}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex space-x-2 space-x-reverse">
                        <Link
                          href={`/dashboard/users/${user.id}`}
                          className="glass-liquid-btn p-2"
                          title="مشاهده جزئیات"
                        >
                          <FaEye />
                        </Link>
                        <Link
                          href={`/dashboard/users/${user.id}/edit`}
                          className="glass-liquid-btn p-2"
                          title="ویرایش"
                        >
                          <FaEdit />
                        </Link>
                        <Link
                          href={`/dashboard/users/${user.id}/permissions`}
                          className="glass-liquid-btn p-2"
                          title="مدیریت دسترسی‌ها"
                        >
                          <FaCog />
                        </Link>
                        <button
                          onClick={() => handleDeleteUser(user)}
                          className="glass-liquid-btn p-2 text-red-400"
                          title="حذف"
                        >
                          <FaTrash />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        
        {filteredUsers.length === 0 && (
          <div className="text-center py-8">
            <p className="text-secondary">هیچ کاربری یافت نشد</p>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center space-x-2 space-x-reverse mt-6">
            <button
              onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
              disabled={currentPage === 1}
              className="glass-liquid-btn px-4 py-2 disabled:opacity-50"
            >
              قبلی
            </button>
            <span className="text-secondary">
              صفحه {currentPage} از {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
              disabled={currentPage === totalPages}
              className="glass-liquid-btn px-4 py-2 disabled:opacity-50"
            >
              بعدی
            </button>
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteModal && userToDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="glass-liquid-card p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-primary">تایید حذف</h2>
              <button
                onClick={() => setShowDeleteModal(false)}
                className="glass-liquid-btn p-2"
              >
                <FaTimes />
              </button>
            </div>
            <p className="text-secondary mb-6">
              آیا مطمئن هستید که می‌خواهید کاربر{' '}
              <span className="font-medium text-primary">
                {userToDelete.firstName} {userToDelete.lastName}
              </span>{' '}
              را حذف کنید؟ این عمل قابل بازگشت نیست.
            </p>
            <div className="flex space-x-4 space-x-reverse">
              <button
                onClick={confirmDeleteUser}
                className="glass-liquid-btn-primary px-6 py-2 flex-1"
              >
                حذف
              </button>
              <button
                onClick={() => setShowDeleteModal(false)}
                className="glass-liquid-btn px-6 py-2 flex-1"
              >
                لغو
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
