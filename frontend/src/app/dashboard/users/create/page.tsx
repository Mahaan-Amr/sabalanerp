'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { 
  FaUserPlus, 
  FaArrowRight, 
  FaBuilding, 
  FaShieldAlt,
  FaCheck,
  FaTimes,
  FaEye,
  FaEyeSlash
} from 'react-icons/fa';
import { authAPI, usersAPI, departmentsAPI, workspacePermissionsAPI } from '@/lib/api';

interface Department {
  id: string;
  name: string;
  namePersian: string;
  description: string;
  isActive: boolean;
}

interface WorkspacePermission {
  workspace: string;
  permissionLevel: string;
}

const WORKSPACES = {
  SALES: 'sales',
  CRM: 'crm',
  HR: 'hr',
  ACCOUNTING: 'accounting',
  INVENTORY: 'inventory',
  SECURITY: 'security'
};

const WORKSPACE_PERMISSIONS = {
  VIEW: 'view',
  EDIT: 'edit',
  ADMIN: 'admin'
};

const WORKSPACE_LABELS = {
  sales: '??',
  crm: 'CRM',
  hr: '??? ???',
  accounting: '??',
  inventory: '???',
  security: '???'
};

const PERMISSION_LABELS = {
  view: '???',
  edit: '???',
  admin: '???'
};

export default function CreateUserPage() {
  const router = useRouter();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    username: '',
    password: '',
    confirmPassword: '',
    role: 'USER',
    departmentId: '',
    isActive: true
  });

  const [workspacePermissions, setWorkspacePermissions] = useState<WorkspacePermission[]>([]);

  useEffect(() => {
    fetchDepartments();
    fetchCurrentUser();
  }, []);

  const fetchCurrentUser = async () => {
    try {
      const response = await authAPI.getMe();
      if (response.data.success) {
        setCurrentUserRole(response.data.data.role);
      }
    } catch (error) {
      console.error('Error fetching current user:', error);
    }
  };

  const fetchDepartments = async () => {
    try {
      const response = await departmentsAPI.getDepartments();
      if (response.data.success) {
        setDepartments(response.data.data);
      }
    } catch (error) {
      console.error('Error fetching departments:', error);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : value
    }));
  };

  const handleWorkspacePermissionChange = (workspace: string, permissionLevel: string) => {
    setWorkspacePermissions(prev => {
      const existing = prev.find(p => p.workspace === workspace);
      if (existing) {
        if (permissionLevel === 'none') {
          return prev.filter(p => p.workspace !== workspace);
        } else {
          return prev.map(p => 
            p.workspace === workspace 
              ? { ...p, permissionLevel }
              : p
          );
        }
      } else {
        if (permissionLevel !== 'none') {
          return [...prev, { workspace, permissionLevel }];
        }
        return prev;
      }
    });
  };

  const getCurrentPermission = (workspace: string) => {
    const permission = workspacePermissions.find(p => p.workspace === workspace);
    return permission ? permission.permissionLevel : 'none';
  };

  const validateForm = () => {
    if (!formData.firstName.trim()) {
      setError('?? ??? ??');
      return false;
    }
    if (!formData.lastName.trim()) {
      setError('?? ?? ??? ??');
      return false;
    }
    if (!formData.email.trim()) {
      setError('??? ??? ??');
      return false;
    }
    if (!formData.username.trim()) {
      setError('?? ??? ??? ??');
      return false;
    }
    if (!formData.password.trim()) {
      setError('?? ?? ??? ??');
      return false;
    }
    if (formData.password.length < 6) {
      setError('?? ?? ?? ??? 6 ?? ??');
      return false;
    }
    if (formData.password !== formData.confirmPassword) {
      setError('?? ?? ? ??? ?? ?? ??? ???');
      return false;
    }
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Create user
      const userResponse = await usersAPI.createUser({
        firstName: formData.firstName,
        lastName: formData.lastName,
        email: formData.email,
        username: formData.username,
        password: formData.password,
        role: formData.role,
        departmentId: formData.departmentId,
        isActive: formData.isActive
      });

      if (userResponse.data.success) {
        const userId = userResponse.data.data.id;

        // Update user with additional data
        if (formData.role !== 'USER' || formData.departmentId) {
          // Note: We would need to add an update user endpoint for role and department
          console.log('User created, additional updates needed:', {
            role: formData.role,
            departmentId: formData.departmentId
          });
        }

        // Grant workspace permissions
        for (const permission of workspacePermissions) {
          try {
            await workspacePermissionsAPI.createUserPermission({
              userId,
              workspace: permission.workspace,
              permissionLevel: permission.permissionLevel
            });
          } catch (permissionError) {
            console.error('Error granting workspace permission:', permissionError);
          }
        }

        alert('??? ? ??? ??? ?');
        router.push('/dashboard/users');
      }
    } catch (error: any) {
      console.error('Error creating user:', error);
      const details = error.response?.data?.details;
      const detailMessage = Array.isArray(details) && details.length > 0
        ? details[0].msg
        : null;
      setError(detailMessage || error.response?.data?.error || '?? ? ??? ???');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="glass-liquid-card p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4 space-x-reverse">
            <FaUserPlus className="h-8 w-8 text-teal-500" />
            <div>
              <h1 className="text-2xl font-bold text-primary">??? ??? ??</h1>
              <p className="text-secondary">??? ??? ?? ? ??? ?? ? ???</p>
            </div>
          </div>
          <Link
            href="/dashboard/users"
            className="glass-liquid-btn px-6 py-2 flex items-center space-x-2 space-x-reverse"
          >
            <FaArrowRight />
            <span>??? ? ??</span>
          </Link>
        </div>
      </div>

      {error && (
        <div className="glass-liquid-card p-4 bg-red-500/20 border border-red-500/30">
          <div className="flex items-center space-x-2 space-x-reverse">
            <FaTimes className="text-red-500" />
            <p className="text-red-400">{error}</p>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic Information */}
        <div className="glass-liquid-card p-6">
          <h2 className="text-xl font-bold text-primary mb-4">?? ??</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm text-secondary mb-2">?? *</label>
              <input
                type="text"
                name="firstName"
                value={formData.firstName}
                onChange={handleInputChange}
                className="glass-liquid-input w-full"
                placeholder="??"
                required
              />
            </div>
            
            <div>
              <label className="block text-sm text-secondary mb-2">?? ?? *</label>
              <input
                type="text"
                name="lastName"
                value={formData.lastName}
                onChange={handleInputChange}
                className="glass-liquid-input w-full"
                placeholder="?? ??"
                required
              />
            </div>
            
            <div>
              <label className="block text-sm text-secondary mb-2">??? *</label>
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleInputChange}
                className="glass-liquid-input w-full"
                placeholder="example@domain.com"
                required
              />
            </div>
            
            <div>
              <label className="block text-sm text-secondary mb-2">?? ??? *</label>
              <input
                type="text"
                name="username"
                value={formData.username}
                onChange={handleInputChange}
                className="glass-liquid-input w-full"
                placeholder="?? ???"
                required
              />
            </div>
            
            <div>
              <label className="block text-sm text-secondary mb-2">?? ?? *</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  value={formData.password}
                  onChange={handleInputChange}
                  className="glass-liquid-input w-full pr-10"
                  placeholder="?? ??"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400"
                >
                  {showPassword ? <FaEyeSlash /> : <FaEye />}
                </button>
              </div>
            </div>
            
            <div>
              <label className="block text-sm text-secondary mb-2">??? ?? ?? *</label>
              <div className="relative">
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  name="confirmPassword"
                  value={formData.confirmPassword}
                  onChange={handleInputChange}
                  className="glass-liquid-input w-full pr-10"
                  placeholder="??? ?? ??"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400"
                >
                  {showConfirmPassword ? <FaEyeSlash /> : <FaEye />}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Role and Department */}
        <div className="glass-liquid-card p-6">
          <h2 className="text-xl font-bold text-primary mb-4">?? ? ??</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm text-secondary mb-2">??</label>
              <select
                name="role"
                value={formData.role}
                onChange={handleInputChange}
                className="glass-liquid-input w-full"
              >
                <option value="USER">???</option>
                <option value="MODERATOR">??</option>
                <option value="SALES">??</option>
                <option value="MANAGER">?? ??</option>
                {currentUserRole !== 'MANAGER' && (
                  <option value="ADMIN">??</option>
                )}
              </select>
            </div>
            
            <div>
              <label className="block text-sm text-secondary mb-2">??</label>
              <select
                name="departmentId"
                value={formData.departmentId}
                onChange={handleInputChange}
                className="glass-liquid-input w-full"
              >
                <option value="">?? ??</option>
                {departments.map(dept => (
                  <option key={dept.id} value={dept.id}>
                    {dept.namePersian}
                  </option>
                ))}
              </select>
            </div>
          </div>
          
          <div className="mt-4">
            <label className="flex items-center space-x-2 space-x-reverse">
              <input
                type="checkbox"
                name="isActive"
                checked={formData.isActive}
                onChange={handleInputChange}
                className="rounded border-gray-600 bg-gray-700 text-teal-500 focus:ring-teal-500"
              />
              <span className="text-secondary">??? ??</span>
            </label>
          </div>
        </div>

        {/* Workspace Permissions */}
        <div className="glass-liquid-card p-6">
          <h2 className="text-xl font-bold text-primary mb-4">??? ?? ??</h2>
          <p className="text-secondary mb-6">
            ??? ??? ? ??? ?? ??? ? ??? ??
          </p>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {Object.entries(WORKSPACES).map(([key, workspace]) => (
              <div key={workspace} className="glass-liquid-card p-4">
                <h3 className="font-medium text-primary mb-3">
                  {WORKSPACE_LABELS[workspace as keyof typeof WORKSPACE_LABELS]}
                </h3>
                
                <div className="space-y-2">
                  {Object.entries(WORKSPACE_PERMISSIONS).map(([permKey, permission]) => (
                    <label key={permission} className="flex items-center space-x-2 space-x-reverse">
                      <input
                        type="radio"
                        name={`workspace_${workspace}`}
                        value={permission}
                        checked={getCurrentPermission(workspace) === permission}
                        onChange={() => handleWorkspacePermissionChange(workspace, permission)}
                        className="text-teal-500 focus:ring-teal-500"
                      />
                      <span className="text-secondary text-sm">
                        {PERMISSION_LABELS[permission as keyof typeof PERMISSION_LABELS]}
                      </span>
                    </label>
                  ))}
                  
                  <label className="flex items-center space-x-2 space-x-reverse">
                    <input
                      type="radio"
                      name={`workspace_${workspace}`}
                      value="none"
                      checked={getCurrentPermission(workspace) === 'none'}
                      onChange={() => handleWorkspacePermissionChange(workspace, 'none')}
                      className="text-gray-500 focus:ring-gray-500"
                    />
                    <span className="text-gray-500 text-sm">?? ???</span>
                  </label>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Submit Buttons */}
        <div className="glass-liquid-card p-6">
          <div className="flex items-center justify-end space-x-4 space-x-reverse">
            <Link
              href="/dashboard/users"
              className="glass-liquid-btn px-6 py-2"
            >
              ??
            </Link>
            <button
              type="submit"
              disabled={loading}
              className="glass-liquid-btn-primary px-6 py-2 flex items-center space-x-2 space-x-reverse disabled:opacity-50"
            >
              {loading ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
              ) : (
                <FaCheck />
              )}
              <span>{loading ? '? ?? ???...' : '??? ???'}</span>
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}


