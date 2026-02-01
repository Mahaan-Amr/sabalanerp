'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { 
  FaUsers, 
  FaUser, 
  FaBullhorn, 
  FaHandshake, 
  FaChartLine, 
  FaPlus,
  FaPhone,
  FaEnvelope,
  FaBuilding,
  FaMapMarkerAlt,
  FaCalendarAlt,
  FaExclamationTriangle
} from 'react-icons/fa';
import { crmAPI, dashboardAPI } from '@/lib/api';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { getCrmPermissions, User as PermissionUser } from '@/lib/permissions';
import PersianCalendar from '@/lib/persian-calendar';

interface CrmStats {
  customers: {
    total: number;
    active: number;
    inactive: number;
  };
  contacts: {
    total: number;
    primary: number;
  };
  leads: {
    total: number;
    new: number;
    qualified: number;
    converted: number;
  };
  communications: {
    total: number;
    thisMonth: number;
  };
  recentCustomers: any[];
  recentLeads: any[];
}

const leadStatusColors = {
  NEW: 'text-blue-500 bg-blue-500/20',
  CONTACTED: 'text-yellow-500 bg-yellow-500/20',
  QUALIFIED: 'text-green-500 bg-green-500/20',
  PROPOSAL: 'text-purple-500 bg-purple-500/20',
  NEGOTIATION: 'text-orange-500 bg-orange-500/20',
  CONVERTED: 'text-teal-500 bg-teal-500/20',
  LOST: 'text-red-500 bg-red-500/20'
};

const leadStatusLabels = {
  NEW: 'جدید',
  CONTACTED: 'تماس گرفته شده',
  QUALIFIED: 'صلاحیت‌دار',
  PROPOSAL: 'پیشنهاد',
  NEGOTIATION: 'مذاکره',
  CONVERTED: 'تبدیل شده',
  LOST: 'از دست رفته'
};

interface User extends PermissionUser {}

export default function CrmWorkspacePage() {
  const [stats, setStats] = useState<CrmStats | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [crmPermissions, setCrmPermissions] = useState({
    canViewCustomers: false,
    canCreateCustomers: false,
    canEditCustomers: false,
    canDeleteCustomers: false,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { hasPermission } = useWorkspace();

  useEffect(() => {
    fetchCrmData();
    loadCurrentUser();
  }, []);

  const loadCurrentUser = async () => {
    try {
      const response = await dashboardAPI.getProfile();
      if (response.data.success) {
        const user = response.data.data;
        setCurrentUser(user);
        setCrmPermissions(getCrmPermissions(user));
      }
    } catch (error) {
      console.error('Error loading user profile:', error);
    }
  };

  const fetchCrmData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // For now, we'll use mock data
      // Later this will be replaced with crmAPI.getCrmStats()
      const mockStats: CrmStats = {
        customers: {
          total: 45,
          active: 38,
          inactive: 7
        },
        contacts: {
          total: 120,
          primary: 45
        },
        leads: {
          total: 23,
          new: 8,
          qualified: 12,
          converted: 3
        },
        communications: {
          total: 156,
          thisMonth: 23
        },
        recentCustomers: [
          {
            id: '1',
            companyName: 'شرکت ساختمانی آسمان',
            customerType: 'BUSINESS',
            status: 'ACTIVE',
            primaryContact: {
              firstName: 'احمد',
              lastName: 'محمدی',
              email: 'ahmad@aseman.com',
              phone: '09123456789'
            },
            createdAt: new Date().toISOString()
          },
          {
            id: '2',
            companyName: 'مجتمع مسکونی پارس',
            customerType: 'BUSINESS',
            status: 'ACTIVE',
            primaryContact: {
              firstName: 'فاطمه',
              lastName: 'احمدی',
              email: 'fateme@pars.com',
              phone: '09187654321'
            },
            createdAt: new Date(Date.now() - 86400000).toISOString()
          }
        ],
        recentLeads: [
          {
            id: '1',
            companyName: 'شرکت تجاری نوین',
            contactName: 'علی رضایی',
            email: 'ali@novin.com',
            phone: '09111111111',
            status: 'NEW',
            expectedValue: 50000000,
            probability: 25,
            createdAt: new Date().toISOString()
          },
          {
            id: '2',
            companyName: 'مجتمع اداری تهران',
            contactName: 'مریم کریمی',
            email: 'maryam@tehran.com',
            phone: '09222222222',
            status: 'QUALIFIED',
            expectedValue: 75000000,
            probability: 60,
            createdAt: new Date(Date.now() - 172800000).toISOString()
          }
        ]
      };
      
      setStats(mockStats);
    } catch (error: any) {
      console.error('Error fetching CRM data:', error);
      setError('خطا در دریافت اطلاعات CRM');
    } finally {
      setLoading(false);
    }
  };

  const formatAmount = (amount: number) => {
    return `${amount.toLocaleString('fa-IR')} ریال`;
  };

  const formatDate = (dateString: string) => {
    return PersianCalendar.formatForDisplay(dateString);
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
        <FaExclamationTriangle className="mx-auto text-4xl text-red-400 mb-4" />
        <h2 className="text-xl font-semibold text-white mb-2">خطا در دریافت اطلاعات</h2>
        <p className="text-gray-400 mb-4">{error}</p>
        <button 
          onClick={fetchCrmData}
          className="glass-liquid-btn-primary px-6 py-2"
        >
          تلاش مجدد
        </button>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="glass-liquid-card p-6 text-center">
        <FaUsers className="mx-auto text-4xl text-gray-400 mb-4" />
        <h2 className="text-xl font-semibold text-white mb-2">اطلاعاتی یافت نشد</h2>
        <p className="text-gray-400">هنوز داده‌ای برای نمایش وجود ندارد</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">فضای کاری CRM</h1>
          <p className="text-gray-300">مدیریت مشتریان، مخاطبین و فرصت‌های فروش</p>
        </div>
        {crmPermissions.canCreateCustomers && (
          <Link 
            href="/dashboard/crm/customers/create" 
            className="glass-liquid-btn-primary inline-flex items-center gap-2 px-6 py-3"
          >
            <FaPlus className="text-lg" />
            مشتری جدید
          </Link>
        )}
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="glass-liquid-card p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">کل مشتریان</p>
              <p className="text-2xl font-bold text-white">{stats.customers.total}</p>
              <p className="text-gray-500 text-xs">{stats.customers.active} فعال</p>
            </div>
            <div className="glass-liquid-card p-3">
              <FaUsers className="h-6 w-6 text-blue-400" />
            </div>
          </div>
        </div>

        <div className="glass-liquid-card p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">مخاطبین</p>
              <p className="text-2xl font-bold text-white">{stats.contacts.total}</p>
              <p className="text-gray-500 text-xs">{stats.contacts.primary} اصلی</p>
            </div>
            <div className="glass-liquid-card p-3">
              <FaUser className="h-6 w-6 text-green-400" />
            </div>
          </div>
        </div>

        <div className="glass-liquid-card p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">سرنخ‌ها</p>
              <p className="text-2xl font-bold text-white">{stats.leads.total}</p>
              <p className="text-gray-500 text-xs">{stats.leads.qualified} صلاحیت‌دار</p>
            </div>
            <div className="glass-liquid-card p-3">
              <FaBullhorn className="h-6 w-6 text-yellow-400" />
            </div>
          </div>
        </div>

        <div className="glass-liquid-card p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">ارتباطات</p>
              <p className="text-2xl font-bold text-white">{stats.communications.total}</p>
              <p className="text-gray-500 text-xs">{stats.communications.thisMonth} این ماه</p>
            </div>
            <div className="glass-liquid-card p-3">
              <FaHandshake className="h-6 w-6 text-purple-400" />
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="glass-liquid-card p-6">
        <h2 className="text-xl font-semibold text-white mb-4">عملیات سریع</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Link 
            href="/dashboard/crm/customers" 
            className="glass-liquid-btn-primary p-4 flex items-center gap-3 hover:bg-blue-600/20 transition-all duration-200"
          >
            <FaUsers className="h-5 w-5" />
            <span>مشتریان</span>
          </Link>
          
          <Link 
            href="/dashboard/crm/contacts" 
            className="glass-liquid-btn p-4 flex items-center gap-3 hover:bg-white/10 transition-all duration-200"
          >
            <FaUser className="h-5 w-5" />
            <span>مخاطبین</span>
          </Link>
          
          <Link 
            href="/dashboard/crm/leads" 
            className="glass-liquid-btn p-4 flex items-center gap-3 hover:bg-white/10 transition-all duration-200"
          >
            <FaBullhorn className="h-5 w-5" />
            <span>سرنخ‌ها</span>
          </Link>
          
          <Link 
            href="/dashboard/crm/reports" 
            className="glass-liquid-btn p-4 flex items-center gap-3 hover:bg-white/10 transition-all duration-200"
          >
            <FaChartLine className="h-5 w-5" />
            <span>گزارشات</span>
          </Link>
        </div>
      </div>

      {/* Recent Customers and Leads */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Customers */}
        <div className="glass-liquid-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-white">مشتریان اخیر</h2>
            <Link 
              href="/dashboard/crm/customers" 
              className="text-blue-400 hover:text-blue-300 text-sm"
            >
              مشاهده همه
            </Link>
          </div>
          
          <div className="space-y-4">
            {stats.recentCustomers.map((customer) => (
              <div key={customer.id} className="flex items-center justify-between p-4 bg-white/5 rounded-lg hover:bg-white/10 transition-all duration-200">
                <div className="flex items-center gap-4">
                  <div className="glass-liquid-card p-3">
                    <FaBuilding className="h-5 w-5 text-blue-400" />
                  </div>
                  <div>
                    <h3 className="text-white font-medium">{customer.companyName}</h3>
                    <p className="text-gray-400 text-sm">
                      {customer.primaryContact.firstName} {customer.primaryContact.lastName}
                    </p>
                    <div className="flex items-center gap-4 text-gray-500 text-xs">
                      <span className="flex items-center gap-1">
                        <FaEnvelope className="h-3 w-3" />
                        {customer.primaryContact.email}
                      </span>
                      <span className="flex items-center gap-1">
                        <FaPhone className="h-3 w-3" />
                        {customer.primaryContact.phone}
                      </span>
                    </div>
                    <p className="text-gray-500 text-xs">{formatDate(customer.createdAt)}</p>
                  </div>
                </div>
                
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                  customer.status === 'ACTIVE' ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400'
                }`}>
                  {customer.status === 'ACTIVE' ? 'فعال' : 'غیرفعال'}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Leads */}
        <div className="glass-liquid-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-white">سرنخ‌های اخیر</h2>
            <Link 
              href="/dashboard/crm/leads" 
              className="text-yellow-400 hover:text-yellow-300 text-sm"
            >
              مشاهده همه
            </Link>
          </div>
          
          <div className="space-y-4">
            {stats.recentLeads.map((lead) => (
              <div key={lead.id} className="flex items-center justify-between p-4 bg-white/5 rounded-lg hover:bg-white/10 transition-all duration-200">
                <div className="flex items-center gap-4">
                  <div className="glass-liquid-card p-3">
                    <FaBullhorn className="h-5 w-5 text-yellow-400" />
                  </div>
                  <div>
                    <h3 className="text-white font-medium">{lead.companyName}</h3>
                    <p className="text-gray-400 text-sm">{lead.contactName}</p>
                    <div className="flex items-center gap-4 text-gray-500 text-xs">
                      <span className="flex items-center gap-1">
                        <FaEnvelope className="h-3 w-3" />
                        {lead.email}
                      </span>
                      <span className="flex items-center gap-1">
                        <FaPhone className="h-3 w-3" />
                        {lead.phone}
                      </span>
                    </div>
                    <p className="text-gray-500 text-xs">{formatDate(lead.createdAt)}</p>
                  </div>
                </div>
                
                <div className="text-left">
                  <p className="text-white font-semibold">{formatAmount(lead.expectedValue)}</p>
                  <p className="text-gray-400 text-sm">{lead.probability}% احتمال</p>
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${leadStatusColors[lead.status as keyof typeof leadStatusColors]}`}>
                    {leadStatusLabels[lead.status as keyof typeof leadStatusLabels]}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Lead Conversion Funnel */}
      <div className="glass-liquid-card p-6">
        <h2 className="text-xl font-semibold text-white mb-4">قیف تبدیل سرنخ‌ها</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center">
            <div className="glass-liquid-card p-4 mb-2">
              <FaBullhorn className="h-8 w-8 text-blue-400 mx-auto mb-2" />
              <p className="text-2xl font-bold text-white">{stats.leads.new}</p>
              <p className="text-gray-400 text-sm">جدید</p>
            </div>
          </div>
          <div className="text-center">
            <div className="glass-liquid-card p-4 mb-2">
              <FaHandshake className="h-8 w-8 text-yellow-400 mx-auto mb-2" />
              <p className="text-2xl font-bold text-white">{stats.leads.qualified}</p>
              <p className="text-gray-400 text-sm">صلاحیت‌دار</p>
            </div>
          </div>
          <div className="text-center">
            <div className="glass-liquid-card p-4 mb-2">
              <FaUsers className="h-8 w-8 text-green-400 mx-auto mb-2" />
              <p className="text-2xl font-bold text-white">{stats.leads.converted}</p>
              <p className="text-gray-400 text-sm">تبدیل شده</p>
            </div>
          </div>
          <div className="text-center">
            <div className="glass-liquid-card p-4 mb-2">
              <FaChartLine className="h-8 w-8 text-teal-400 mx-auto mb-2" />
              <p className="text-2xl font-bold text-white">
                {stats.leads.total > 0 ? Math.round((stats.leads.converted / stats.leads.total) * 100) : 0}%
              </p>
              <p className="text-gray-400 text-sm">نرخ تبدیل</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
