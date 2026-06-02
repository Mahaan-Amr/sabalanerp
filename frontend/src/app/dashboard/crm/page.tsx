'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  FaBuilding,
  FaBullhorn,
  FaChartLine,
  FaEnvelope,
  FaExclamationTriangle,
  FaHandshake,
  FaPhone,
  FaPlus,
  FaUser,
  FaUsers,
} from 'react-icons/fa';
import { ErpActionGrid, ErpBadge, ErpEmptyState, ErpFieldView, ErpLoading, ErpPage, ErpSection, ErpTwoColumn, type ErpMetric, type ErpTone } from '@/components/erp';
import { dashboardAPI } from '@/lib/api';
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

const leadStatusLabels = {
  NEW: 'جدید',
  CONTACTED: 'تماس گرفته شد',
  QUALIFIED: 'واجد شرایط',
  PROPOSAL: 'پیشنهاد',
  NEGOTIATION: 'مذاکره',
  CONVERTED: 'تبدیل شده',
  LOST: 'از دست رفته',
};

const leadStatusTone: Record<string, ErpTone> = {
  NEW: 'info',
  CONTACTED: 'warning',
  QUALIFIED: 'success',
  PROPOSAL: 'purple',
  NEGOTIATION: 'warning',
  CONVERTED: 'primary',
  LOST: 'danger',
};

interface User extends PermissionUser {}

export default function CrmWorkspacePage() {
  const [stats, setStats] = useState<CrmStats | null>(null);
  const [crmPermissions, setCrmPermissions] = useState({
    canViewCustomers: false,
    canCreateCustomers: false,
    canEditCustomers: false,
    canDeleteCustomers: false,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCrmData();
    loadCurrentUser();
  }, []);

  const loadCurrentUser = async () => {
    try {
      const response = await dashboardAPI.getProfile();
      if (response.data.success) {
        const user: User = response.data.data;
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

      const mockStats: CrmStats = {
        customers: {
          total: 45,
          active: 38,
          inactive: 7,
        },
        contacts: {
          total: 120,
          primary: 45,
        },
        leads: {
          total: 23,
          new: 8,
          qualified: 12,
          converted: 3,
        },
        communications: {
          total: 156,
          thisMonth: 23,
        },
        recentCustomers: [
          {
            id: '1',
            companyName: 'شرکت آسمان سازه',
            customerType: 'BUSINESS',
            status: 'ACTIVE',
            primaryContact: {
              firstName: 'احمد',
              lastName: 'محمدی',
              email: 'ahmad@aseman.com',
              phone: '09123456789',
            },
            createdAt: new Date().toISOString(),
          },
          {
            id: '2',
            companyName: 'شرکت پارس سنگ',
            customerType: 'BUSINESS',
            status: 'ACTIVE',
            primaryContact: {
              firstName: 'فاطمه',
              lastName: 'کریمی',
              email: 'fateme@pars.com',
              phone: '09187654321',
            },
            createdAt: new Date(Date.now() - 86400000).toISOString(),
          },
        ],
        recentLeads: [
          {
            id: '1',
            companyName: 'شرکت نوین سنگ',
            contactName: 'علی رضایی',
            email: 'ali@novin.com',
            phone: '09111111111',
            status: 'NEW',
            expectedValue: 50000000,
            probability: 25,
            createdAt: new Date().toISOString(),
          },
          {
            id: '2',
            companyName: 'شرکت تهران سنگ',
            contactName: 'مریم حسینی',
            email: 'maryam@tehran.com',
            phone: '09222222222',
            status: 'QUALIFIED',
            expectedValue: 75000000,
            probability: 60,
            createdAt: new Date(Date.now() - 172800000).toISOString(),
          },
        ],
      };

      setStats(mockStats);
    } catch (error: any) {
      console.error('Error fetching CRM data:', error);
      setError('خطا در بارگذاری اطلاعات CRM');
    } finally {
      setLoading(false);
    }
  };

  const formatAmount = (amount: number) => `${amount.toLocaleString('fa-IR')} تومان`;
  const formatDate = (dateString: string) => PersianCalendar.formatForDisplay(dateString);

  if (loading) {
    return <ErpLoading />;
  }

  if (error) {
    return (
      <ErpEmptyState
        icon={FaExclamationTriangle}
        title="خطا در بارگذاری داده‌ها"
        description={error}
        action={{ label: 'تلاش دوباره', onClick: fetchCrmData, variant: 'solid', tone: 'primary' }}
      />
    );
  }

  if (!stats) {
    return <ErpEmptyState icon={FaUsers} title="داده‌ای موجود نیست" description="اطلاعات CRM برای نمایش موجود نیست." />;
  }

  const metrics: ErpMetric[] = [
    { label: 'کل مشتریان', value: stats.customers.total.toLocaleString('fa-IR'), hint: `${stats.customers.active.toLocaleString('fa-IR')} فعال`, icon: FaUsers, tone: 'info' },
    { label: 'مخاطبین', value: stats.contacts.total.toLocaleString('fa-IR'), hint: `${stats.contacts.primary.toLocaleString('fa-IR')} مخاطب اصلی`, icon: FaUser, tone: 'success' },
    { label: 'سرنخ‌ها', value: stats.leads.total.toLocaleString('fa-IR'), hint: `${stats.leads.qualified.toLocaleString('fa-IR')} واجد شرایط`, icon: FaBullhorn, tone: 'warning' },
    { label: 'ارتباطات', value: stats.communications.total.toLocaleString('fa-IR'), hint: `${stats.communications.thisMonth.toLocaleString('fa-IR')} مورد این ماه`, icon: FaHandshake, tone: 'purple' },
  ];

  return (
    <ErpPage
      eyebrow="CRM"
      title="مدیریت ارتباط با مشتری"
      description="نمای عملیاتی مشتریان، مخاطبین، سرنخ‌ها و ارتباطات تجاری."
      metrics={metrics}
      actions={crmPermissions.canCreateCustomers ? [{ label: 'مشتری جدید', href: '/dashboard/crm/customers/create', icon: FaPlus, tone: 'primary', variant: 'solid' }] : []}
    >
      <ErpSection title="اقدامات سریع" description="دسترسی به بخش‌های اصلی CRM با همان الگوی ERP جدید.">
        <ErpActionGrid
          columns={4}
          items={[
            { title: 'مشتریان', description: 'فهرست مشتریان و وضعیت همکاری', href: '/dashboard/crm/customers', icon: FaUsers, tone: 'primary' },
            { title: 'مخاطبین', description: 'افراد کلیدی و راه‌های تماس', href: '/dashboard/crm/contacts', icon: FaUser, tone: 'success' },
            { title: 'سرنخ‌ها', description: 'پیگیری فرصت‌های فروش', href: '/dashboard/crm/leads', icon: FaBullhorn, tone: 'warning' },
            { title: 'گزارش‌ها', description: 'تحلیل عملکرد CRM', href: '/dashboard/crm/reports', icon: FaChartLine, tone: 'info' },
          ]}
        />
      </ErpSection>

      <ErpTwoColumn
        main={
          <>
            <ErpSection
              title="مشتریان اخیر"
              description="آخرین مشتریان اضافه‌شده یا فعال‌شده."
              actions={[{ label: 'مشاهده همه', href: '/dashboard/crm/customers', variant: 'outline', tone: 'neutral' }]}
            >
              <div className="space-y-3">
                {stats.recentCustomers.map((customer) => (
                  <Link
                    key={customer.id}
                    href={`/dashboard/crm/customers/${customer.id}`}
                    className="block rounded-lg border border-slate-200 bg-slate-50 p-4 transition hover:border-[#074747]/40 hover:bg-white dark:border-slate-800 dark:bg-slate-800/50 dark:hover:border-teal-700 dark:hover:bg-slate-800"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex min-w-0 items-start gap-3">
                        <span className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200">
                          <FaBuilding className="h-4 w-4" />
                        </span>
                        <div className="min-w-0">
                          <h3 className="truncate text-sm font-semibold text-slate-900 dark:text-white">{customer.companyName}</h3>
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            {customer.primaryContact.firstName} {customer.primaryContact.lastName}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                            <span className="inline-flex items-center gap-1"><FaEnvelope className="h-3 w-3" />{customer.primaryContact.email}</span>
                            <span className="inline-flex items-center gap-1"><FaPhone className="h-3 w-3" />{customer.primaryContact.phone}</span>
                          </div>
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{formatDate(customer.createdAt)}</p>
                        </div>
                      </div>
                      <ErpBadge tone={customer.status === 'ACTIVE' ? 'success' : 'neutral'}>
                        {customer.status === 'ACTIVE' ? 'فعال' : 'غیرفعال'}
                      </ErpBadge>
                    </div>
                  </Link>
                ))}
              </div>
            </ErpSection>

            <ErpSection
              title="سرنخ‌های اخیر"
              description="فرصت‌های تازه و واجد شرایط برای پیگیری فروش."
              actions={[{ label: 'مشاهده همه', href: '/dashboard/crm/leads', variant: 'outline', tone: 'neutral' }]}
            >
              <div className="space-y-3">
                {stats.recentLeads.map((lead) => (
                  <div key={lead.id} className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-800/50">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex min-w-0 items-start gap-3">
                        <span className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200">
                          <FaBullhorn className="h-4 w-4" />
                        </span>
                        <div className="min-w-0">
                          <h3 className="truncate text-sm font-semibold text-slate-900 dark:text-white">{lead.companyName}</h3>
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{lead.contactName}</p>
                          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                            <span className="inline-flex items-center gap-1"><FaEnvelope className="h-3 w-3" />{lead.email}</span>
                            <span className="inline-flex items-center gap-1"><FaPhone className="h-3 w-3" />{lead.phone}</span>
                          </div>
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{formatDate(lead.createdAt)}</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 sm:justify-end sm:text-left">
                        <div>
                          <p className="text-sm font-semibold text-slate-900 dark:text-white">{formatAmount(lead.expectedValue)}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">{lead.probability.toLocaleString('fa-IR')}٪ احتمال</p>
                        </div>
                        <ErpBadge tone={leadStatusTone[lead.status] || 'neutral'}>
                          {leadStatusLabels[lead.status as keyof typeof leadStatusLabels] || lead.status}
                        </ErpBadge>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </ErpSection>
          </>
        }
        aside={
          <ErpSection title="قیف تبدیل سرنخ" description="نمای خلاصه تبدیل سرنخ‌ها به مشتری.">
            <div className="grid grid-cols-1 gap-3">
              <ErpFieldView label="جدید" value={stats.leads.new.toLocaleString('fa-IR')} tone="info" />
              <ErpFieldView label="واجد شرایط" value={stats.leads.qualified.toLocaleString('fa-IR')} tone="warning" />
              <ErpFieldView label="تبدیل شده" value={stats.leads.converted.toLocaleString('fa-IR')} tone="success" />
              <ErpFieldView
                label="نرخ تبدیل"
                value={`${(stats.leads.total > 0 ? Math.round((stats.leads.converted / stats.leads.total) * 100) : 0).toLocaleString('fa-IR')}٪`}
                tone="primary"
              />
            </div>
          </ErpSection>
        }
      />
    </ErpPage>
  );
}
