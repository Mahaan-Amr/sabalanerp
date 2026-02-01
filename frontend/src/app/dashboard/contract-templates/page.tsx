'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { 
  FaPlus, 
  FaEdit, 
  FaEye, 
  FaTrash, 
  FaFileContract, 
  FaSearch,
  FaFilter,
  FaArrowRight,
  FaCopy,
  FaDownload
} from 'react-icons/fa';
import { contractTemplatesAPI } from '@/lib/api';

interface ContractTemplate {
  id: string;
  name: string;
  namePersian: string;
  description: string | null;
  category: string | null;
  isActive: boolean;
  createdAt: string;
  createdByUser: {
    id: string;
    firstName: string;
    lastName: string;
    username: string;
  };
  _count: {
    contracts: number;
  };
}

export default function ContractTemplatesPage() {
  const [templates, setTemplates] = useState<ContractTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => {
    fetchTemplates();
  }, [categoryFilter, statusFilter]);

  const fetchTemplates = async () => {
    try {
      setLoading(true);
      setError(null);

      const params: any = {};
      if (categoryFilter) params.category = categoryFilter;
      if (statusFilter !== 'all') params.isActive = statusFilter === 'active';

      const response = await contractTemplatesAPI.getAll(params);
      
      if (response.data.success) {
        setTemplates(response.data.data);
      } else {
        setError('خطا در دریافت قالب‌های قرارداد');
      }
    } catch (error: any) {
      console.error('Error fetching templates:', error);
      setError(error.response?.data?.error || 'خطا در ارتباط با سرور');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (templateId: string) => {
    if (!confirm('آیا مطمئن هستید که می‌خواهید این قالب را حذف کنید؟')) {
      return;
    }

    try {
      await contractTemplatesAPI.delete(templateId);
      setTemplates(templates.filter(t => t.id !== templateId));
    } catch (error: any) {
      console.error('Error deleting template:', error);
      alert('خطا در حذف قالب: ' + (error.response?.data?.error || 'خطای سرور'));
    }
  };

  const filteredTemplates = templates.filter(template => {
    const matchesSearch = template.namePersian.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         template.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         (template.description && template.description.toLowerCase().includes(searchTerm.toLowerCase()));
    
    return matchesSearch;
  });

  const getCategoryLabel = (category: string | null) => {
    switch (category) {
      case 'sales': return 'فروش';
      case 'service': return 'خدمات';
      case 'maintenance': return 'نگهداری';
      default: return 'عمومی';
    }
  };

  const getCategoryColor = (category: string | null) => {
    switch (category) {
      case 'sales': return 'bg-teal-500/20 text-teal-400';
      case 'service': return 'bg-gold-500/20 text-gold-400';
      case 'maintenance': return 'bg-silver-500/20 text-silver-400';
      default: return 'bg-gray-500/20 text-gray-400';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-500"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass-liquid-card p-6 text-center">
        <FaFileContract className="mx-auto text-4xl text-red-400 mb-4" />
        <h2 className="text-xl font-semibold text-white mb-2">خطا در دریافت اطلاعات</h2>
        <p className="text-gray-400 mb-4">{error}</p>
        <button 
          onClick={fetchTemplates}
          className="glass-liquid-btn-primary px-6 py-2"
        >
          تلاش مجدد
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">مدیریت قالب‌های قرارداد</h1>
          <p className="text-gray-300 mt-1">ایجاد و مدیریت قالب‌های قرارداد</p>
        </div>
        <Link 
          href="/dashboard/contract-templates/create"
          className="glass-liquid-btn-primary px-6 py-3 flex items-center gap-2"
        >
          <FaPlus className="h-5 w-5" />
          <span>ایجاد قالب جدید</span>
        </Link>
      </div>

      {/* Filters */}
      <div className="glass-liquid-card p-6">
        <div className="flex flex-col md:flex-row gap-4">
          {/* Search */}
          <div className="flex-1">
            <div className="relative">
              <FaSearch className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
              <input
                type="text"
                placeholder="جستجو در قالب‌ها..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="glass-liquid-input w-full pr-10"
              />
            </div>
          </div>

          {/* Category Filter */}
          <div className="md:w-48">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="glass-liquid-input w-full"
            >
              <option value="">همه دسته‌بندی‌ها</option>
              <option value="sales">فروش</option>
              <option value="service">خدمات</option>
              <option value="maintenance">نگهداری</option>
            </select>
          </div>

          {/* Status Filter */}
          <div className="md:w-48">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="glass-liquid-input w-full"
            >
              <option value="all">همه وضعیت‌ها</option>
              <option value="active">فعال</option>
              <option value="inactive">غیرفعال</option>
            </select>
          </div>
        </div>
      </div>

      {/* Templates Grid */}
      {filteredTemplates.length === 0 ? (
        <div className="glass-liquid-card p-12 text-center">
          <FaFileContract className="mx-auto text-6xl text-gray-400 mb-6" />
          <h2 className="text-2xl font-semibold text-white mb-4">
            {searchTerm ? 'قالبی یافت نشد' : 'هنوز قالبی ایجاد نشده است'}
          </h2>
          <p className="text-gray-400 mb-6">
            {searchTerm 
              ? 'لطفاً عبارت جستجوی خود را تغییر دهید'
              : 'برای شروع، اولین قالب قرارداد خود را ایجاد کنید'
            }
          </p>
          {!searchTerm && (
            <Link 
              href="/dashboard/contract-templates/create"
              className="glass-liquid-btn-primary px-8 py-3 inline-flex items-center gap-2"
            >
              <FaPlus className="h-5 w-5" />
              <span>ایجاد اولین قالب</span>
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredTemplates.map((template) => (
            <div key={template.id} className="glass-liquid-card p-6 hover:bg-white/5 transition-all duration-200">
              {/* Template Header */}
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-white mb-1">
                    {template.namePersian}
                  </h3>
                  <p className="text-sm text-gray-400 mb-2">
                    {template.name}
                  </p>
                  {template.description && (
                    <p className="text-sm text-gray-500 line-clamp-2">
                      {template.description}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${getCategoryColor(template.category)}`}>
                    {getCategoryLabel(template.category)}
                  </span>
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                    template.isActive 
                      ? 'bg-green-500/20 text-green-400' 
                      : 'bg-red-500/20 text-red-400'
                  }`}>
                    {template.isActive ? 'فعال' : 'غیرفعال'}
                  </span>
                </div>
              </div>

              {/* Template Stats */}
              <div className="flex items-center justify-between mb-4 text-sm text-gray-400">
                <div className="flex items-center gap-1">
                  <FaFileContract className="h-4 w-4" />
                  <span>{template._count.contracts} قرارداد</span>
                </div>
                <div>
                  توسط {template.createdByUser.firstName} {template.createdByUser.lastName}
                </div>
              </div>

              {/* Template Actions */}
              <div className="flex items-center gap-2">
                <Link 
                  href={`/dashboard/contract-templates/${template.id}`}
                  className="flex-1 glass-liquid-btn p-2 text-center flex items-center justify-center gap-2 hover:bg-white/10 transition-all duration-200"
                >
                  <FaEye className="h-4 w-4" />
                  <span>مشاهده</span>
                </Link>
                
                <Link 
                  href={`/dashboard/contract-templates/${template.id}/edit`}
                  className="flex-1 glass-liquid-btn p-2 text-center flex items-center justify-center gap-2 hover:bg-white/10 transition-all duration-200"
                >
                  <FaEdit className="h-4 w-4" />
                  <span>ویرایش</span>
                </Link>

                <Link 
                  href={`/dashboard/contracts/create?template=${template.id}`}
                  className="flex-1 glass-liquid-btn-primary p-2 text-center flex items-center justify-center gap-2 hover:bg-teal-600/20 transition-all duration-200"
                >
                  <FaCopy className="h-4 w-4" />
                  <span>استفاده</span>
                </Link>

                <button
                  onClick={() => handleDelete(template.id)}
                  className="glass-liquid-btn p-2 text-red-400 hover:bg-red-500/20 transition-all duration-200"
                  title="حذف قالب"
                >
                  <FaTrash className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Quick Actions */}
      <div className="glass-liquid-card p-6">
        <h2 className="text-xl font-semibold text-white mb-4">عملیات سریع</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Link 
            href="/dashboard/contract-templates/create" 
            className="glass-liquid-btn-primary p-4 flex items-center gap-3 hover:bg-teal-600/20 transition-all duration-200"
          >
            <FaPlus className="h-5 w-5" />
            <span>ایجاد قالب جدید</span>
          </Link>
          
          <Link 
            href="/dashboard/contracts/create" 
            className="glass-liquid-btn p-4 flex items-center gap-3 hover:bg-white/10 transition-all duration-200"
          >
            <FaFileContract className="h-5 w-5" />
            <span>ایجاد قرارداد جدید</span>
          </Link>
          
          <Link 
            href="/dashboard/contracts" 
            className="glass-liquid-btn p-4 flex items-center gap-3 hover:bg-white/10 transition-all duration-200"
          >
            <FaArrowRight className="h-5 w-5" />
            <span>مشاهده قراردادها</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
