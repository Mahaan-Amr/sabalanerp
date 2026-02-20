'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { 
  FaEdit, 
  FaTrash, 
  FaPhone, 
  FaEnvelope, 
  FaMapMarkerAlt, 
  FaBuilding, 
  FaUser, 
  FaExclamationTriangle,
  FaLock,
  FaBan,
  FaCheckCircle,
  FaTimesCircle,
  FaPlus,
  FaHistory,
  FaFileContract,
  FaTimes,
  FaSave,
  FaEye
} from 'react-icons/fa';
import { crmAPI } from '@/lib/api';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import PersianCalendar from '@/lib/persian-calendar';

interface CrmCustomer {
  id: string;
  firstName: string;
  lastName: string;
  companyName?: string;
  customerType: string;
  industry?: string;
  status: string;
  nationalCode?: string;
  homeAddress?: string;
  homeNumber?: string;
  workAddress?: string;
  workNumber?: string;
  projectManagerName?: string;
  projectManagerNumber?: string;
  brandName?: string;
  brandNameDescription?: string;
  isBlacklisted: boolean;
  isLocked: boolean;
  primaryContact?: {
    id: string;
    firstName: string;
    lastName: string;
    email?: string;
    phone?: string;
    position?: string;
  };
  contacts: Array<{
    id: string;
    firstName: string;
    lastName: string;
    email?: string;
    phone?: string;
    position?: string;
    isPrimary: boolean;
  }>;
  projectAddresses: Array<{
    id: string;
    address: string;
    city: string;
    postalCode?: string;
    projectName?: string;
    projectType?: string;
    projectManagerName?: string;
    projectManagerNumber?: string;
    isActive: boolean;
  }>;
  phoneNumbers: Array<{
    id: string;
    number: string;
    type: string;
    isPrimary: boolean;
    isActive: boolean;
  }>;
  leads: Array<{
    id: string;
    companyName: string;
    contactName: string;
    status: string;
    expectedValue?: number;
    probability: number;
    createdAt: string;
  }>;
  salesContracts: Array<{
    id: string;
    contractNumber: string;
    status: string;
    totalAmount: number | null;
    createdAt: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

export default function CustomerDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { hasPermission } = useWorkspace();
  const [customer, setCustomer] = useState<CrmCustomer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'projects' | 'contacts' | 'leads' | 'contracts'>('overview');
  const [showAddProjectModal, setShowAddProjectModal] = useState(false);
  const [showAddContactModal, setShowAddContactModal] = useState(false);
  const [editingProject, setEditingProject] = useState<any>(null);
  const [editingContact, setEditingContact] = useState<any>(null);
  const [projectFormData, setProjectFormData] = useState({
    address: '',
    city: '',
    postalCode: '',
    projectName: '',
    projectType: '',
    projectManagerName: '',
    projectManagerNumber: ''
  });
  const [contactFormData, setContactFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    position: '',
    isPrimary: false
  });
  const addProjectModalOpenedRef = useRef(false);

  useEffect(() => {
    if (params.id) {
      fetchCustomer();
    }
  }, [params.id]);

  const fetchCustomer = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await crmAPI.getCustomer(params.id as string);
      
      if (response.data.success) {
        setCustomer(response.data.data);
      } else {
        setError('خطا در دریافت اطلاعات مشتری');
      }
    } catch (error: any) {
      console.error('Error fetching customer:', error);
      setError('خطا در دریافت اطلاعات مشتری');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleBlacklist = async () => {
    if (!customer) return;
    
    try {
      const response = await crmAPI.toggleBlacklist(customer.id);
      if (response.data.success) {
        setCustomer(prev => prev ? { ...prev, isBlacklisted: !prev.isBlacklisted } : null);
      }
    } catch (error) {
      console.error('Error toggling blacklist:', error);
    }
  };

  const handleToggleLock = async () => {
    if (!customer) return;
    
    try {
      const response = await crmAPI.toggleLock(customer.id);
      if (response.data.success) {
        setCustomer(prev => prev ? { ...prev, isLocked: !prev.isLocked } : null);
      }
    } catch (error) {
      console.error('Error toggling lock:', error);
    }
  };

  // Project Address Handlers
  const handleAddProject = () => {
    setEditingProject(null);
    setProjectFormData({
      address: '',
      city: '',
      postalCode: '',
      projectName: '',
      projectType: '',
      projectManagerName: '',
      projectManagerNumber: ''
    });
    setShowAddProjectModal(true);
  };

  // When returning from contract wizard to add a project, open the add-project modal immediately (once)
  useEffect(() => {
    if (!customer || addProjectModalOpenedRef.current) return;
    const urlParams = new URLSearchParams(window.location.search);
    const returnTo = urlParams.get('returnTo');
    const step = urlParams.get('step');
    const action = urlParams.get('action');
    if (returnTo === 'contract' && step && action === 'addProject') {
      addProjectModalOpenedRef.current = true;
      setActiveTab('projects');
      setEditingProject(null);
      setProjectFormData({
        address: '',
        city: '',
        postalCode: '',
        projectName: '',
        projectType: '',
        projectManagerName: '',
        projectManagerNumber: ''
      });
      setShowAddProjectModal(true);
    }
  }, [customer?.id]);

  const handleEditProject = (project: any) => {
    setEditingProject(project);
    setProjectFormData({
      address: project.address || '',
      city: project.city || '',
      postalCode: project.postalCode || '',
      projectName: project.projectName || '',
      projectType: project.projectType || '',
      projectManagerName: project.projectManagerName || '',
      projectManagerNumber: project.projectManagerNumber || ''
    });
    setShowAddProjectModal(true);
  };

  const handleDeleteProject = async (projectId: string) => {
    if (!confirm('آیا از حذف این آدرس پروژه اطمینان دارید؟')) return;
    
    try {
      const response = await crmAPI.deleteProjectAddress(customer!.id, projectId);
      if (response.data.success) {
        await fetchCustomer(); // Refresh data
      }
    } catch (error) {
      console.error('Error deleting project address:', error);
    }
  };

  // Contact Handlers
  const handleAddContact = () => {
    setEditingContact(null);
    setShowAddContactModal(true);
  };

  const handleEditContact = (contact: any) => {
    setEditingContact(contact);
    setShowAddContactModal(true);
  };

  const handleDeleteContact = async (contactId: string) => {
    if (!confirm('آیا از حذف این مخاطب اطمینان دارید؟')) return;
    
    try {
      const response = await crmAPI.deleteContact(contactId);
      if (response.data.success) {
        await fetchCustomer(); // Refresh data
      }
    } catch (error) {
      console.error('Error deleting contact:', error);
    }
  };

  // Form Submission Handlers
  const handleSubmitProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customer) return;

    try {
      if (editingProject) {
        // Update existing project
        const response = await crmAPI.updateProjectAddress(customer.id, editingProject.id, projectFormData);
        if (response.data.success) {
          await fetchCustomer();
          setShowAddProjectModal(false);
        }
      } else {
        // Create new project
        const response = await crmAPI.addProjectAddress(customer.id, projectFormData);
        if (response.data.success) {
          await fetchCustomer();
          setShowAddProjectModal(false);
          
          // Check if we should return to contract wizard
          const urlParams = new URLSearchParams(window.location.search);
          const returnTo = urlParams.get('returnTo');
          const step = urlParams.get('step');
          
          if (returnTo === 'contract' && step) {
            // Redirect back to contract wizard
            router.push(`/dashboard/sales/contracts/create?returnTo=contract&step=${step}`);
          }
        }
      }
    } catch (error) {
      console.error('Error saving project address:', error);
    }
  };

  const handleSubmitContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customer) return;

    try {
      if (editingContact) {
        // Update existing contact
        const response = await crmAPI.updateContact(editingContact.id, contactFormData);
        if (response.data.success) {
          await fetchCustomer();
          setShowAddContactModal(false);
        }
      } else {
        // Create new contact
        const response = await crmAPI.createContact({ ...contactFormData, customerId: customer.id });
        if (response.data.success) {
          await fetchCustomer();
          setShowAddContactModal(false);
        }
      }
    } catch (error) {
      console.error('Error saving contact:', error);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Active': return 'bg-green-500/20 text-green-400';
      case 'Inactive': return 'bg-gray-500/20 text-gray-400';
      case 'Prospect': return 'bg-blue-500/20 text-blue-400';
      case 'Lead': return 'bg-yellow-500/20 text-yellow-400';
      default: return 'bg-gray-500/20 text-gray-400';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'Active': return 'فعال';
      case 'Inactive': return 'غیرفعال';
      case 'Prospect': return 'پتانسیل';
      case 'Lead': return 'سرنخ';
      default: return status;
    }
  };

  const getCustomerTypeLabel = (type: string) => {
    switch (type) {
      case 'Individual': return 'شخصی';
      case 'Company': return 'شرکتی';
      case 'Government': return 'دولتی';
      default: return type;
    }
  };


  const formatAmount = (amount: number | null | undefined) => {
    if (amount === null || amount === undefined) {
      return 'تعریف نشده';
    }
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

  if (error || !customer) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="glass-liquid-card p-6 text-center">
          <FaExclamationTriangle className="mx-auto text-4xl text-red-400 mb-4" />
          <h2 className="text-xl font-semibold text-white mb-2">خطا در دریافت اطلاعات</h2>
          <p className="text-gray-400 mb-4">{error || 'مشتری یافت نشد'}</p>
          <Link 
            href="/dashboard/crm/customers" 
            className="glass-liquid-btn-primary px-6 py-2"
          >
            بازگشت به لیست
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">
            {customer.firstName} {customer.lastName}
          </h1>
          <p className="text-gray-300">
            {customer.companyName && `${customer.companyName} • `}
            {getCustomerTypeLabel(customer.customerType)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Cancel button - return to contract wizard */}
          {(() => {
            const urlParams = new URLSearchParams(window.location.search);
            const returnTo = urlParams.get('returnTo');
            const step = urlParams.get('step');
            const action = urlParams.get('action');
            
            if (returnTo === 'contract' && step && action === 'addProject') {
              return (
                <button
                  onClick={() => {
                    // Restore contract wizard state from localStorage
                    const savedState = localStorage.getItem('contractWizardState');
                    if (savedState) {
                      const { currentStep, wizardData } = JSON.parse(savedState);
                      // Navigate back to contract wizard with restored state
                      router.push(`/dashboard/sales/contracts/create?returnTo=contract&step=${currentStep}`);
                    } else {
                      // Fallback to contract creation
                      router.push('/dashboard/sales/contracts/create');
                    }
                  }}
                  className="glass-liquid-btn px-6 py-3 bg-red-500/20 hover:bg-red-500/30 border-red-500/50 text-red-300 hover:text-red-200"
                >
                  <FaTimes className="inline-block ml-2" />
                  لغو و بازگشت به قرارداد
                </button>
              );
            }
            return null;
          })()}
          
          {hasPermission('crm' as any, 'edit' as any) && (
            <Link
              href={`/dashboard/crm/customers/${customer.id}/edit`}
              className="glass-liquid-btn-primary inline-flex items-center gap-2 px-6 py-3"
            >
              <FaEdit className="text-lg" />
              ویرایش
            </Link>
          )}
          <Link 
            href="/dashboard/crm/customers" 
            className="glass-liquid-btn px-6 py-3"
          >
            بازگشت به لیست
          </Link>
        </div>
      </div>

      {/* Status Indicators */}
      <div className="flex items-center gap-4">
        <span className={`px-4 py-2 rounded-full text-sm font-medium ${getStatusColor(customer.status)}`}>
          {getStatusLabel(customer.status)}
        </span>
        
        {customer.isBlacklisted && (
          <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium bg-red-500/20 text-red-400">
            <FaBan className="h-4 w-4" />
            لیست سیاه
          </span>
        )}
        
        {customer.isLocked && (
          <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium bg-orange-500/20 text-orange-400">
            <FaLock className="h-4 w-4" />
            قفل شده
          </span>
        )}
      </div>

      {/* Tabs */}
      <div className="glass-liquid-card">
        <div className="border-b border-white/10">
          <nav className="flex space-x-8 px-6">
            {[
              { key: 'overview', label: 'نمای کلی', icon: FaUser },
              { key: 'projects', label: 'پروژه‌ها', icon: FaMapMarkerAlt },
              { key: 'contacts', label: 'مخاطبین', icon: FaPhone },
              { key: 'leads', label: 'سرنخ‌ها', icon: FaHistory },
              { key: 'contracts', label: 'قراردادها', icon: FaFileContract }
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key as any)}
                className={`flex items-center gap-2 py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === tab.key
                    ? 'border-teal-500 text-teal-400'
                    : 'border-transparent text-gray-400 hover:text-white hover:border-gray-300'
                }`}
              >
                <tab.icon className="h-4 w-4" />
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="p-6">
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* Basic Information */}
              <div>
                <h3 className="text-lg font-semibold text-white mb-4">اطلاعات پایه</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-1">نام و نام خانوادگی</label>
                    <p className="text-white">{customer.firstName} {customer.lastName}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-1">نام شرکت</label>
                    <p className="text-white">{customer.companyName || 'تعریف نشده'}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-1">نوع مشتری</label>
                    <p className="text-white">{getCustomerTypeLabel(customer.customerType)}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-1">صنعت</label>
                    <p className="text-white">{customer.industry || 'تعریف نشده'}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-1">وضعیت</label>
                    <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(customer.status)}`}>
                      {getStatusLabel(customer.status)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Contact Information */}
              <div>
                <h3 className="text-lg font-semibold text-white mb-4">اطلاعات تماس</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-1">کد ملی</label>
                    <p className="text-white">{customer.nationalCode || 'تعریف نشده'}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-1">آدرس منزل</label>
                    <p className="text-white">{customer.homeAddress || 'تعریف نشده'}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-1">شماره منزل</label>
                    <p className="text-white">{customer.homeNumber || 'تعریف نشده'}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-1">آدرس محل کار</label>
                    <p className="text-white">{customer.workAddress || 'تعریف نشده'}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-1">شماره محل کار</label>
                    <p className="text-white">{customer.workNumber || 'تعریف نشده'}</p>
                  </div>
                </div>
              </div>

              {/* Project Management */}
              <div>
                <h3 className="text-lg font-semibold text-white mb-4">مدیریت پروژه</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-1">نام مدیر پروژه</label>
                    <p className="text-white">{customer.projectManagerName || 'تعریف نشده'}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-1">شماره تماس مدیر پروژه</label>
                    <p className="text-white">{customer.projectManagerNumber || 'تعریف نشده'}</p>
                  </div>
                </div>
              </div>

              {/* Brand Information */}
              <div>
                <h3 className="text-lg font-semibold text-white mb-4">اطلاعات برند</h3>
                <div className="grid grid-cols-1 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-1">نام برند</label>
                    <p className="text-white">{customer.brandName || 'تعریف نشده'}</p>
                  </div>
                  {customer.brandNameDescription && (
                    <div>
                      <label className="block text-sm font-medium text-gray-400 mb-1">توضیحات برند</label>
                      <p className="text-white">{customer.brandNameDescription}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Phone Numbers */}
              {customer.phoneNumbers && customer.phoneNumbers.length > 0 && (
                <div>
                  <h3 className="text-lg font-semibold text-white mb-4">شماره‌های تماس</h3>
                  <div className="space-y-3">
                    {customer.phoneNumbers.map((phone) => (
                      <div key={phone.id} className="flex items-center justify-between p-3 bg-white/5 rounded-lg">
                        <div className="flex items-center gap-3">
                          <FaPhone className="h-4 w-4 text-gray-400" />
                          <span className="text-white">{phone.number}</span>
                          <span className="text-gray-400 text-sm">({phone.type})</span>
                        </div>
                        {phone.isPrimary && (
                          <span className="px-2 py-1 rounded-full text-xs font-medium bg-teal-500/20 text-teal-400">
                            اصلی
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* System Information */}
              <div>
                <h3 className="text-lg font-semibold text-white mb-4">اطلاعات سیستم</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-1">تاریخ ایجاد</label>
                    <p className="text-white">{formatDate(customer.createdAt)}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-1">آخرین بروزرسانی</label>
                    <p className="text-white">{formatDate(customer.updatedAt)}</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'projects' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white">آدرس‌های پروژه</h3>
                {hasPermission('crm' as any, 'edit' as any) && (
                  <button 
                    onClick={handleAddProject}
                    className="glass-liquid-btn-primary inline-flex items-center gap-2 px-4 py-2"
                  >
                    <FaPlus className="h-4 w-4" />
                    افزودن آدرس
                  </button>
                )}
              </div>

              {(!customer.projectAddresses || customer.projectAddresses.length === 0) ? (
                <div className="text-center py-8">
                  <FaMapMarkerAlt className="mx-auto text-4xl text-gray-400 mb-4" />
                  <p className="text-gray-400">هنوز آدرس پروژه‌ای ثبت نشده است</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {customer.projectAddresses.map((address) => (
                    <div key={address.id} className="glass-liquid-card p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <FaMapMarkerAlt className="h-5 w-5 text-blue-400" />
                            <h4 className="text-white font-medium">
                              {address.projectName || 'پروژه بدون نام'}
                            </h4>
                            {address.projectType && (
                              <span className="px-2 py-1 rounded-full text-xs font-medium bg-gray-500/20 text-gray-400">
                                {address.projectType}
                              </span>
                            )}
                          </div>
                          <p className="text-gray-300 mb-1">{address.address}</p>
                          <p className="text-gray-400 text-sm">{address.city}</p>
                          {address.postalCode && (
                            <p className="text-gray-400 text-sm">کد پستی: {address.postalCode}</p>
                          )}
                          
                          {/* Project Manager Information */}
                          {(address.projectManagerName || address.projectManagerNumber) && (
                            <div className="mt-3 pt-3 border-t border-white/10">
                              <div className="flex items-center gap-4 text-sm">
                                {address.projectManagerName && (
                                  <div className="flex items-center gap-2">
                                    <FaUser className="h-4 w-4 text-teal-400" />
                                    <span className="text-gray-300">مدیر پروژه:</span>
                                    <span className="text-white font-medium">{address.projectManagerName}</span>
                                  </div>
                                )}
                                {address.projectManagerNumber && (
                                  <div className="flex items-center gap-2">
                                    <FaPhone className="h-4 w-4 text-green-400" />
                                    <span className="text-gray-300">شماره:</span>
                                    <span className="text-white font-medium">{address.projectManagerNumber}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {hasPermission('crm' as any, 'edit' as any) && (
                            <>
                              <button 
                                onClick={() => handleEditProject(address)}
                                className="glass-liquid-btn p-2 hover:bg-white/10"
                              >
                                <FaEdit className="h-4 w-4" />
                              </button>
                              <button 
                                onClick={() => handleDeleteProject(address.id)}
                                className="glass-liquid-btn p-2 hover:bg-white/10 text-red-400"
                              >
                                <FaTrash className="h-4 w-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'contacts' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white">مخاطبین</h3>
                {hasPermission('crm' as any, 'edit' as any) && (
                  <button 
                    onClick={handleAddContact}
                    className="glass-liquid-btn-primary inline-flex items-center gap-2 px-4 py-2"
                  >
                    <FaPlus className="h-4 w-4" />
                    افزودن مخاطب
                  </button>
                )}
              </div>

              {(!customer.contacts || customer.contacts.length === 0) ? (
                <div className="text-center py-8">
                  <FaUser className="mx-auto text-4xl text-gray-400 mb-4" />
                  <p className="text-gray-400">هنوز مخاطبی ثبت نشده است</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {customer.contacts.map((contact) => (
                    <div key={contact.id} className="glass-liquid-card p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <FaUser className="h-5 w-5 text-green-400" />
                            <h4 className="text-white font-medium">
                              {contact.firstName} {contact.lastName}
                            </h4>
                            {contact.isPrimary && (
                              <span className="px-2 py-1 rounded-full text-xs font-medium bg-teal-500/20 text-teal-400">
                                اصلی
                              </span>
                            )}
                          </div>
                          {contact.position && (
                            <p className="text-gray-300 mb-1">{contact.position}</p>
                          )}
                          <div className="flex items-center gap-4 text-gray-400 text-sm">
                            {contact.email && (
                              <span className="flex items-center gap-1">
                                <FaEnvelope className="h-3 w-3" />
                                {contact.email}
                              </span>
                            )}
                            {contact.phone && (
                              <span className="flex items-center gap-1">
                                <FaPhone className="h-3 w-3" />
                                {contact.phone}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {hasPermission('crm' as any, 'edit' as any) && (
                            <>
                              <button 
                                onClick={() => handleEditContact(contact)}
                                className="glass-liquid-btn p-2 hover:bg-white/10"
                              >
                                <FaEdit className="h-4 w-4" />
                              </button>
                              <button 
                                onClick={() => handleDeleteContact(contact.id)}
                                className="glass-liquid-btn p-2 hover:bg-white/10 text-red-400"
                              >
                                <FaTrash className="h-4 w-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'leads' && (
            <div className="space-y-6">
              <h3 className="text-lg font-semibold text-white">سرنخ‌ها</h3>

              {(!customer.leads || customer.leads.length === 0) ? (
                <div className="text-center py-8">
                  <FaHistory className="mx-auto text-4xl text-gray-400 mb-4" />
                  <p className="text-gray-400">هنوز سرنخی ثبت نشده است</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {customer.leads.map((lead) => (
                    <div key={lead.id} className="glass-liquid-card p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <h4 className="text-white font-medium mb-1">{lead.companyName}</h4>
                          <p className="text-gray-300 mb-2">{lead.contactName}</p>
                          <div className="flex items-center gap-4 text-gray-400 text-sm">
                            <span>ارزش مورد انتظار: {lead.expectedValue ? formatAmount(lead.expectedValue) : 'تعریف نشده'}</span>
                            <span>احتمال: {lead.probability}%</span>
                            <span>تاریخ: {formatDate(lead.createdAt)}</span>
                          </div>
                        </div>
                        <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(lead.status)}`}>
                          {getStatusLabel(lead.status)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'contracts' && (
            <div className="space-y-6">
              <h3 className="text-lg font-semibold text-white">قراردادها</h3>

              {(!customer.salesContracts || customer.salesContracts.length === 0) ? (
                <div className="text-center py-8">
                  <FaFileContract className="mx-auto text-4xl text-gray-400 mb-4" />
                  <p className="text-gray-400">هنوز قراردادی ثبت نشده است</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {customer.salesContracts.map((contract) => (
                    <div key={contract.id} className="glass-liquid-card p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <h4 className="text-white font-medium mb-1">قرارداد شماره {contract.contractNumber}</h4>
                          <div className="flex items-center gap-4 text-gray-400 text-sm">
                            <span>مبلغ: {formatAmount(contract.totalAmount)}</span>
                            <span>تاریخ: {formatDate(contract.createdAt)}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <Link
                            href={`/dashboard/sales/contracts/${contract.id}`}
                            className="glass-liquid-btn-primary inline-flex items-center gap-2 px-3 py-2 text-sm"
                          >
                            <FaEye className="h-4 w-4" />
                            مشاهده
                          </Link>
                          <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(contract.status)}`}>
                            {getStatusLabel(contract.status)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Admin Actions */}
      {hasPermission('crm' as any, 'admin' as any) && (
        <div className="glass-liquid-card p-6">
          <h3 className="text-lg font-semibold text-white mb-4">عملیات مدیریتی</h3>
          <div className="flex items-center gap-4">
            <button
              onClick={handleToggleBlacklist}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg transition-all duration-200 ${
                customer.isBlacklisted 
                  ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30' 
                  : 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
              }`}
            >
              {customer.isBlacklisted ? <FaCheckCircle className="h-4 w-4" /> : <FaBan className="h-4 w-4" />}
              {customer.isBlacklisted ? 'حذف از لیست سیاه' : 'افزودن به لیست سیاه'}
            </button>

            <button
              onClick={handleToggleLock}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg transition-all duration-200 ${
                customer.isLocked 
                  ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30' 
                  : 'bg-orange-500/20 text-orange-400 hover:bg-orange-500/30'
              }`}
            >
              {customer.isLocked ? <FaCheckCircle className="h-4 w-4" /> : <FaLock className="h-4 w-4" />}
              {customer.isLocked ? 'باز کردن قفل' : 'قفل کردن'}
            </button>
          </div>
        </div>
      )}

      {/* Add/Edit Project Address Modal */}
      {showAddProjectModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="glass-liquid-card p-6 w-full max-w-md mx-4">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-white">
                {editingProject ? 'ویرایش آدرس پروژه' : 'افزودن آدرس پروژه'}
              </h3>
              <button
                onClick={() => setShowAddProjectModal(false)}
                className="glass-liquid-btn p-2 hover:bg-white/10"
              >
                <FaTimes className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitProject} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">نام پروژه</label>
                <input
                  type="text"
                  value={projectFormData.projectName}
                  onChange={(e) => setProjectFormData(prev => ({ ...prev, projectName: e.target.value }))}
                  className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500"
                  placeholder="نام پروژه"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">آدرس</label>
                <textarea
                  value={projectFormData.address}
                  onChange={(e) => setProjectFormData(prev => ({ ...prev, address: e.target.value }))}
                  className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500"
                  placeholder="آدرس پروژه"
                  rows={3}
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">شهر</label>
                  <input
                    type="text"
                    value={projectFormData.city}
                    onChange={(e) => setProjectFormData(prev => ({ ...prev, city: e.target.value }))}
                    className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500"
                    placeholder="شهر"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">کد پستی</label>
                  <input
                    type="text"
                    value={projectFormData.postalCode}
                    onChange={(e) => setProjectFormData(prev => ({ ...prev, postalCode: e.target.value }))}
                    className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500"
                    placeholder="کد پستی"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">نوع پروژه</label>
                <select
                  value={projectFormData.projectType}
                  onChange={(e) => setProjectFormData(prev => ({ ...prev, projectType: e.target.value }))}
                  className="w-full px-4 py-3 min-h-[48px] bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500 cursor-pointer"
                >
                  <option value="" className="bg-gray-800 text-white">انتخاب نوع پروژه</option>
                  <option value="مسکونی" className="bg-gray-800 text-white">مسکونی</option>
                  <option value="تجاری" className="bg-gray-800 text-white">تجاری</option>
                  <option value="پزشکی" className="bg-gray-800 text-white">پزشکی</option>
                  <option value="اداری" className="bg-gray-800 text-white">اداری</option>
                  <option value="صنعتی" className="bg-gray-800 text-white">صنعتی</option>
                  <option value="آموزشی" className="bg-gray-800 text-white">آموزشی</option>
                  <option value="تفریحی" className="bg-gray-800 text-white">تفریحی</option>
                  <option value="سایر" className="bg-gray-800 text-white">سایر</option>
                </select>
              </div>

              {/* Project Manager Information */}
              <div className="border-t border-white/20 pt-4">
                <h4 className="text-lg font-medium text-white mb-4 flex items-center gap-2">
                  <FaUser className="text-teal-400" />
                  اطلاعات مدیر پروژه
                </h4>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">نام مدیر پروژه</label>
                    <input
                      type="text"
                      value={projectFormData.projectManagerName}
                      onChange={(e) => setProjectFormData(prev => ({ ...prev, projectManagerName: e.target.value }))}
                      className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500"
                      placeholder="نام مدیر پروژه"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">شماره مدیر پروژه</label>
                    <input
                      type="text"
                      value={projectFormData.projectManagerNumber}
                      onChange={(e) => setProjectFormData(prev => ({ ...prev, projectManagerNumber: e.target.value }))}
                      className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500"
                      placeholder="شماره تماس مدیر پروژه"
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-4 pt-4">
                <button
                  type="submit"
                  className="glass-liquid-btn-primary inline-flex items-center gap-2 px-6 py-3"
                >
                  <FaSave className="h-4 w-4" />
                  {editingProject ? 'بروزرسانی' : 'افزودن'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddProjectModal(false)}
                  className="glass-liquid-btn px-6 py-3"
                >
                  انصراف
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add/Edit Contact Modal */}
      {showAddContactModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="glass-liquid-card p-6 w-full max-w-md mx-4">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-white">
                {editingContact ? 'ویرایش مخاطب' : 'افزودن مخاطب'}
              </h3>
              <button
                onClick={() => setShowAddContactModal(false)}
                className="glass-liquid-btn p-2 hover:bg-white/10"
              >
                <FaTimes className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitContact} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">نام</label>
                  <input
                    type="text"
                    value={contactFormData.firstName}
                    onChange={(e) => setContactFormData(prev => ({ ...prev, firstName: e.target.value }))}
                    className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500"
                    placeholder="نام"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">نام خانوادگی</label>
                  <input
                    type="text"
                    value={contactFormData.lastName}
                    onChange={(e) => setContactFormData(prev => ({ ...prev, lastName: e.target.value }))}
                    className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500"
                    placeholder="نام خانوادگی"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">سمت</label>
                <input
                  type="text"
                  value={contactFormData.position}
                  onChange={(e) => setContactFormData(prev => ({ ...prev, position: e.target.value }))}
                  className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500"
                  placeholder="سمت"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">ایمیل</label>
                <input
                  type="email"
                  value={contactFormData.email}
                  onChange={(e) => setContactFormData(prev => ({ ...prev, email: e.target.value }))}
                  className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500"
                  placeholder="ایمیل"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">شماره تماس</label>
                <input
                  type="tel"
                  value={contactFormData.phone}
                  onChange={(e) => setContactFormData(prev => ({ ...prev, phone: e.target.value }))}
                  className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500"
                  placeholder="شماره تماس"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isPrimary"
                  checked={contactFormData.isPrimary}
                  onChange={(e) => setContactFormData(prev => ({ ...prev, isPrimary: e.target.checked }))}
                  className="w-4 h-4 text-teal-600 bg-white/10 border-white/20 rounded focus:ring-teal-500"
                />
                <label htmlFor="isPrimary" className="text-sm text-gray-300">
                  مخاطب اصلی
                </label>
              </div>

              <div className="flex items-center gap-4 pt-4">
                <button
                  type="submit"
                  className="glass-liquid-btn-primary inline-flex items-center gap-2 px-6 py-3"
                >
                  <FaSave className="h-4 w-4" />
                  {editingContact ? 'بروزرسانی' : 'افزودن'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddContactModal(false)}
                  className="glass-liquid-btn px-6 py-3"
                >
                  انصراف
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
