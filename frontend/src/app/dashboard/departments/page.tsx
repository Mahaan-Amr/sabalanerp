'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { 
  FaBuilding, 
  FaPlus, 
  FaEdit, 
  FaTrash, 
  FaEye, 
  FaUsers,
  FaSearch,
  FaFilter,
  FaDownload,
  FaCheck,
  FaTimes
} from 'react-icons/fa';
import { departmentsAPI } from '@/lib/api';

interface Department {
  id: string;
  name: string;
  namePersian: string;
  description: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: {
    users: number;
  };
}

export default function DepartmentsManagementPage() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [departmentToDelete, setDepartmentToDelete] = useState<Department | null>(null);

  useEffect(() => {
    fetchDepartments();
  }, []);

  const fetchDepartments = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await departmentsAPI.getDepartments();
      if (response.data.success) {
        setDepartments(response.data.data);
      }
    } catch (error: any) {
      console.error('Error fetching departments:', error);
      setError(error.response?.data?.error || '?? ? ??? ? ??');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteDepartment = async (department: Department) => {
    setDepartmentToDelete(department);
    setShowDeleteModal(true);
  };

  const confirmDeleteDepartment = async () => {
    if (!departmentToDelete) return;
    
    try {
      await departmentsAPI.deleteDepartment(departmentToDelete.id);
      alert('?? ? ??? ?? ?');
      fetchDepartments();
    } catch (error: any) {
      console.error('Error deleting department:', error);
      alert(error.response?.data?.error || '?? ? ?? ??');
    } finally {
      setShowDeleteModal(false);
      setDepartmentToDelete(null);
    }
  };

  const filteredDepartments = departments.filter(department => {
    const matchesSearch = 
      department.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      department.namePersian.includes(searchTerm) ||
      department.description.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesStatus = !selectedStatus || 
      (selectedStatus === 'active' && department.isActive) ||
      (selectedStatus === 'inactive' && !department.isActive);
    
    return matchesSearch && matchesStatus;
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
          <h2 className="text-xl font-bold text-primary mb-2">?? ? ??</h2>
          <p className="text-secondary mb-4">{error}</p>
          <button 
            onClick={fetchDepartments}
            className="glass-liquid-btn-primary px-6 py-2"
          >
            ?? ??
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
            <FaBuilding className="h-8 w-8 text-teal-500" />
            <div>
              <h1 className="text-2xl font-bold text-primary">??? ???</h1>
              <p className="text-secondary">??? ??? ? ?? ??</p>
            </div>
          </div>
          <div className="flex items-center space-x-4 space-x-reverse">
            <Link
              href="/dashboard/departments/create"
              className="glass-liquid-btn-primary px-6 py-2 flex items-center space-x-2 space-x-reverse"
            >
              <FaPlus />
              <span>?? ??</span>
            </Link>
            <Link
              href="/dashboard/users"
              className="glass-liquid-btn px-6 py-2 flex items-center space-x-2 space-x-reverse"
            >
              <FaUsers />
              <span>??? ??</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="glass-liquid-card p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-secondary">? ???</p>
              <p className="text-2xl font-bold text-primary">{departments.length}</p>
            </div>
            <FaBuilding className="h-8 w-8 text-blue-500" />
          </div>
        </div>
        
        <div className="glass-liquid-card p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-secondary">?? ??</p>
              <p className="text-2xl font-bold text-primary">
                {departments.filter(d => d.isActive).length}
              </p>
            </div>
            <FaCheck className="h-8 w-8 text-green-500" />
          </div>
        </div>
        
        <div className="glass-liquid-card p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-secondary">?? ??</p>
              <p className="text-2xl font-bold text-primary">
                {departments.filter(d => !d.isActive).length}
              </p>
            </div>
            <FaTimes className="h-8 w-8 text-red-500" />
          </div>
        </div>
        
        <div className="glass-liquid-card p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-secondary">? ??</p>
              <p className="text-2xl font-bold text-primary">
                {departments.reduce((sum, d) => sum + (d._count?.users || 0), 0)}
              </p>
            </div>
            <FaUsers className="h-8 w-8 text-purple-500" />
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="glass-liquid-card p-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm text-secondary mb-2">???</label>
            <div className="relative">
              <FaSearch className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="??? ? ?? ? ??..."
                className="glass-liquid-input w-full pr-10"
              />
            </div>
          </div>
          
          <div>
            <label className="block text-sm text-secondary mb-2">???</label>
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="glass-liquid-input w-full"
            >
              <option value="">?? ??</option>
              <option value="active">??</option>
              <option value="inactive">??</option>
            </select>
          </div>
          
          <div className="flex items-end">
            <button
              onClick={() => {
                setSearchTerm('');
                setSelectedStatus('');
              }}
              className="glass-liquid-btn w-full px-4 py-2 flex items-center justify-center space-x-2 space-x-reverse"
            >
              <FaFilter />
              <span>?? ?? ??</span>
            </button>
          </div>
        </div>
      </div>

      {/* Departments Table */}
      <div className="glass-liquid-card p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-primary">?? ???</h2>
          <div className="flex items-center space-x-2 space-x-reverse">
            <button className="glass-liquid-btn p-2" title="???">
              <FaDownload />
            </button>
          </div>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="text-right py-3 px-4 text-secondary">?? ??</th>
                <th className="text-right py-3 px-4 text-secondary">?? ???</th>
                <th className="text-right py-3 px-4 text-secondary">??</th>
                <th className="text-right py-3 px-4 text-secondary">??? ??</th>
                <th className="text-right py-3 px-4 text-secondary">???</th>
                <th className="text-right py-3 px-4 text-secondary">??? ???</th>
                <th className="text-right py-3 px-4 text-secondary">???</th>
              </tr>
            </thead>
            <tbody>
              {filteredDepartments.map((department) => (
                <tr key={department.id} className="border-b border-gray-800 hover:bg-white/5">
                  <td className="py-3 px-4">
                    <div className="font-medium text-primary">
                      {department.name}
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <div className="font-medium text-primary">
                      {department.namePersian}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-secondary">
                    <div className="max-w-xs truncate">
                      {department.description}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-secondary">
                    <div className="flex items-center space-x-2 space-x-reverse">
                      <FaUsers className="h-4 w-4" />
                      <span>{department._count?.users || 0}</span>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      department.isActive 
                        ? 'text-green-500 bg-green-500/20' 
                        : 'text-red-500 bg-red-500/20'
                    }`}>
                      {department.isActive ? '??' : '??'}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-secondary text-sm">
                    {new Date(department.createdAt).toLocaleDateString('fa-IR')}
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex space-x-2 space-x-reverse">
                      <Link
                        href={`/dashboard/departments/${department.id}`}
                        className="glass-liquid-btn p-2"
                        title="??? ???"
                      >
                        <FaEye />
                      </Link>
                      <Link
                        href={`/dashboard/departments/${department.id}/edit`}
                        className="glass-liquid-btn p-2"
                        title="???"
                      >
                        <FaEdit />
                      </Link>
                      <button
                        onClick={() => handleDeleteDepartment(department)}
                        className="glass-liquid-btn p-2 text-red-400"
                        title="??"
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
        
        {filteredDepartments.length === 0 && (
          <div className="text-center py-8">
            <p className="text-secondary">?? ?? ?? ??</p>
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteModal && departmentToDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="glass-liquid-card p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-primary">??? ??</h2>
              <button
                onClick={() => setShowDeleteModal(false)}
                className="glass-liquid-btn p-2"
              >
                <FaTimes />
              </button>
            </div>
            <p className="text-secondary mb-6">
              ?? ??? ??? ? ??? ??{' '}
              <span className="font-medium text-primary">
                {departmentToDelete.namePersian}
              </span>{' '}
              ? ?? ??? ?? ?? ?? ??? ??.
            </p>
            {departmentToDelete._count?.users && departmentToDelete._count.users > 0 && (
              <div className="bg-yellow-500/20 border border-yellow-500/30 rounded-lg p-4 mb-6">
                <p className="text-yellow-400 text-sm">
                  ? ?? ?? ??? {departmentToDelete._count.users} ??? ??. 
                  ?? ? ?? ?? ? ? ?? ??? ??? ??.
                </p>
              </div>
            )}
            <div className="flex space-x-4 space-x-reverse">
              <button
                onClick={confirmDeleteDepartment}
                disabled={!!(departmentToDelete._count?.users && departmentToDelete._count.users > 0)}
                className="glass-liquid-btn-primary px-6 py-2 flex-1 disabled:opacity-50"
              >
                ??
              </button>
              <button
                onClick={() => setShowDeleteModal(false)}
                className="glass-liquid-btn px-6 py-2 flex-1"
              >
                ??
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

