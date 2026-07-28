'use client';
import { ErpInput, ErpPressable, ErpTextarea } from '@/components/erp';
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
import { crmAPI, dashboardAPI } from '@/lib/api';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import PersianCalendar from '@/lib/persian-calendar';
import { formatPrice } from '@/lib/numberFormat';
import { getCrmPermissions } from '@/lib/permissions';
import { PROJECT_TYPE_OPTIONS } from '@/lib/projectTypes';
import EnhancedDropdown from '@/components/EnhancedDropdown';

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
    city: string | null;
    postalCode?: string;
    projectName?: string;
    projectType?: string;
    projectManagerName?: string;
    projectManagerNumber?: string;
    marketerFirstName?: string;
    marketerLastName?: string;
    marketerPhoneNumber?: string;
    isActive: boolean;
  }>;
  phoneNumbers: Array<{
    id: string;
    number: string;
    type: string;
    isPrimary: boolean;
    isActive: boolean;
  }>;
  ownerUserId?: string | null;
  ownerUser?: {
    id: string;
    firstName?: string | null;
    lastName?: string | null;
    username?: string | null;
  } | null;
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

interface OwnerOption {
  id: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  role?: string;
}

export default function CustomerDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { hasPermission } = useWorkspace();
  const [customer, setCustomer] = useState<CrmCustomer | null>(null);
  const [ownerOptions, setOwnerOptions] = useState<OwnerOption[]>([]);
  const [ownerSaving, setOwnerSaving] = useState(false);
  const [crmPermissions, setCrmPermissions] = useState({
    canViewCustomers: false,
    canCreateCustomers: false,
    canEditCustomers: false,
    canDeleteCustomers: false,
    canAssignCustomerOwner: false,
  });
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
    projectManagerNumber: '',
    marketerFirstName: '',
    marketerLastName: '',
    marketerPhoneNumber: ''
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
      loadCurrentUser();
    }
  }, [params.id]);

  useEffect(() => {
    if (crmPermissions.canAssignCustomerOwner) {
      loadOwnerOptions();
    }
  }, [crmPermissions.canAssignCustomerOwner]);

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

  const loadCurrentUser = async () => {
    try {
      const response = await dashboardAPI.getProfile();
      if (response.data.success) {
        const user = response.data.data;
        setCrmPermissions(getCrmPermissions(user));
      }
    } catch (error) {
      console.error('Error loading user profile:', error);
    }
  };

  const loadOwnerOptions = async () => {
    try {
      const response = await crmAPI.getCustomerOwners();
      if (response.data.success) {
        setOwnerOptions(response.data.data || []);
      }
    } catch (error) {
      console.error('Error loading owner options:', error);
    }
  };

  const getOwnerLabel = (owner?: CrmCustomer['ownerUser'] | null) => {
    const ownerName = [owner?.firstName, owner?.lastName].filter(Boolean).join(' ').trim();
    return ownerName || owner?.username || 'بدون مسئول فروش';
  };

  const handleOwnerChange = async (ownerUserId: string) => {
    if (!customer) return;

    setOwnerSaving(true);
    try {
      const response = await crmAPI.assignCustomerOwner(customer.id, ownerUserId || null);
      if (response.data.success) {
        setCustomer(response.data.data);
      }
    } catch (error) {
      console.error('Error assigning customer owner:', error);
    } finally {
      setOwnerSaving(false);
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
      projectManagerNumber: '',
      marketerFirstName: '',
      marketerLastName: '',
      marketerPhoneNumber: ''
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
        projectManagerNumber: '',
        marketerFirstName: '',
        marketerLastName: '',
        marketerPhoneNumber: ''
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
      projectManagerNumber: project.projectManagerNumber || '',
      marketerFirstName: project.marketerFirstName || '',
      marketerLastName: project.marketerLastName || '',
      marketerPhoneNumber: project.marketerPhoneNumber || ''
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
    if (!customer) return;
    if (!confirm('آیا از حذف این مخاطب اطمینان دارید؟')) return;

    try {
      const response = await crmAPI.deleteContact(customer.id, contactId);
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

    const projectPayload = {
      ...projectFormData,
      address: projectFormData.address.trim(),
      city: projectFormData.city.trim() || null
    };

    try {
      if (editingProject) {
        // Update existing project
        const response = await crmAPI.updateProjectAddress(customer.id, editingProject.id, projectPayload);
        if (response.data.success) {
          await fetchCustomer();
          setShowAddProjectModal(false);
        }
      } else {
        // Create new project
        const response = await crmAPI.addProjectAddress(customer.id, projectPayload);
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
        const response = await crmAPI.updateContact(customer.id, editingContact.id, contactFormData);
        if (response.data.success) {
          await fetchCustomer();
          setShowAddContactModal(false);
        }
      } else {
        // Create new contact
        const response = await crmAPI.createContact(customer.id, contactFormData);
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
      case 'Active': return 'bg-[var(--sds-success-surface)] text-[var(--sds-success)]';
      case 'Inactive': return 'bg-[var(--sds-surface-subtle)] text-[var(--sds-text-muted)]';
      case 'Prospect': return 'bg-[var(--sds-info-surface)] text-[var(--sds-info)]';
      case 'Lead': return 'bg-[var(--sds-warning-surface)] text-[var(--sds-warning)]';
      default: return 'bg-[var(--sds-surface-subtle)] text-[var(--sds-text-muted)]';
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
      case 'Collaborative': return 'همکاری';
      default: return type;
    }
  };


  const formatAmount = (amount: number | string | null | undefined) => {
    if (amount === null || amount === undefined) {
      return 'تعریف نشده';
    }
    return formatPrice(amount, 'ریال');
  };

  const formatDate = (dateString: string) => {
    return PersianCalendar.formatForDisplay(dateString);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[var(--sds-border-strong)]"></div>
      </div>
    );
  }

  if (error || !customer) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="sds-workspace-surface p-6 text-center">
          <FaExclamationTriangle className="mx-auto text-4xl text-[var(--sds-danger)] mb-4" />
          <h2 className="text-xl font-semibold text-[var(--sds-text-primary)] mb-2">خطا در دریافت اطلاعات</h2>
          <p className="text-[var(--sds-text-muted)] mb-4">{error || 'مشتری یافت نشد'}</p>
          <Link
            href="/dashboard/crm/customers"
            className="sds-action sds-tone-primary sds-action-solid px-6 py-2"
          >
            بازگشت به لیست
          </Link>
        </div>
      </div>
    );
  }

  return (
    <main className="sds-workspace space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="break-words text-2xl font-bold text-[var(--sds-text-primary)] sm:text-3xl">
            {customer.firstName} {customer.lastName}
          </h1>
          <p className="text-[var(--sds-text-muted)]">
            {customer.companyName && `${customer.companyName} • `}
            {getCustomerTypeLabel(customer.customerType)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* Cancel button - return to contract wizard */}
          {(() => {
            const urlParams = new URLSearchParams(window.location.search);
            const returnTo = urlParams.get('returnTo');
            const step = urlParams.get('step');
            const action = urlParams.get('action');

            if (returnTo === 'contract' && step && action === 'addProject') {
              return (
                <ErpPressable type="submit"
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
                  className="sds-action border-[var(--sds-danger-border)] bg-[var(--sds-danger)] px-6 py-3 text-[var(--sds-text-inverse)] hover:bg-[var(--sds-danger)]"
                >
                  <FaTimes className="inline-block ml-2" />
                  لغو و بازگشت به قرارداد
                </ErpPressable>
              );
            }
            return null;
          })()}

          {hasPermission('crm' as any, 'edit' as any) && (
            <Link
              href={`/dashboard/crm/customers/${customer.id}/edit`}
              className="sds-action sds-tone-primary sds-action-solid inline-flex items-center gap-2 px-6 py-3"
            >
              <FaEdit className="text-lg" />
              ویرایش
            </Link>
          )}
          <Link
            href="/dashboard/crm/customers"
            className="sds-action px-6 py-3"
          >
            بازگشت به لیست
          </Link>
        </div>
      </div>

      {/* Status Indicators */}
      <div className="flex flex-wrap items-center gap-3 sm:gap-4">
        <span className={`px-4 py-2 rounded-full text-sm font-medium ${getStatusColor(customer.status)}`}>
          {getStatusLabel(customer.status)}
        </span>

        {customer.isBlacklisted && (
          <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium bg-[var(--sds-danger-surface)] text-[var(--sds-danger)]">
            <FaBan className="h-4 w-4" />
            لیست سیاه
          </span>
        )}

        {customer.isLocked && (
          <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium bg-[var(--sds-warning-surface)] text-[var(--sds-warning)]">
            <FaLock className="h-4 w-4" />
            قفل شده
          </span>
        )}
      </div>

      {/* Tabs */}
      <div className="sds-workspace-surface">
        <div className="border-b border-[var(--sds-border-default)]">
          <nav className="flex gap-6 overflow-x-auto px-4 sm:px-6">
            {[
              { key: 'overview', label: 'نمای کلی', icon: FaUser },
              { key: 'projects', label: 'پروژه‌ها', icon: FaMapMarkerAlt },
              { key: 'contacts', label: 'مخاطبین', icon: FaPhone },
              { key: 'leads', label: 'سرنخ‌ها', icon: FaHistory },
              { key: 'contracts', label: 'قراردادها', icon: FaFileContract }
            ].map((tab) => (
              <ErpPressable type="submit"
                key={tab.key}
                onClick={() => setActiveTab(tab.key as any)}
                className={`flex items-center gap-2 py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === tab.key
                    ? 'border-[var(--sds-border-strong)] text-[var(--sds-accent)]'
                    : 'border-transparent text-[var(--sds-text-muted)] hover:text-[var(--sds-text-primary)] hover:border-[var(--sds-border-default)]'
                }`}
              >
                <tab.icon className="h-4 w-4" />
                {tab.label}
              </ErpPressable>
            ))}
          </nav>
        </div>

        <div className="p-4 sm:p-6">
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* Basic Information */}
              <div>
                <h3 className="text-lg font-semibold text-[var(--sds-text-primary)] mb-4">اطلاعات پایه</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-[var(--sds-text-muted)] mb-1">نام و نام خانوادگی</label>
                    <p className="text-[var(--sds-text-primary)]">{customer.firstName} {customer.lastName}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--sds-text-muted)] mb-1">نام شرکت</label>
                    <p className="text-[var(--sds-text-primary)]">{customer.companyName || 'تعریف نشده'}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--sds-text-muted)] mb-1">نوع مشتری</label>
                    <p className="text-[var(--sds-text-primary)]">{getCustomerTypeLabel(customer.customerType)}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--sds-text-muted)] mb-1">صنعت</label>
                    <p className="text-[var(--sds-text-primary)]">{customer.industry || 'تعریف نشده'}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--sds-text-muted)] mb-1">وضعیت</label>
                    <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(customer.status)}`}>
                      {getStatusLabel(customer.status)}
                    </span>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--sds-text-muted)] mb-1">مسئول فروش</label>
                    {crmPermissions.canAssignCustomerOwner ? (
                      <EnhancedDropdown
                        value={customer.ownerUserId || ''}
                        onChange={handleOwnerChange}
                        disabled={ownerSaving}
                        placeholder="بدون مسئول فروش"
                        options={[
                          { value: '', label: 'بدون مسئول فروش' },
                          ...ownerOptions.map((owner) => ({
                            value: owner.id,
                            label: [owner.firstName, owner.lastName].filter(Boolean).join(' ').trim() || owner.username || owner.id,
                          })),
                        ]}
                        searchable
                        clearable
                        noOptionsText="فروشنده‌ای پیدا نشد"
                      />
                    ) : (
                      <p className="text-[var(--sds-text-primary)]">{getOwnerLabel(customer.ownerUser)}</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Contact Information */}
              <div>
                <h3 className="text-lg font-semibold text-[var(--sds-text-primary)] mb-4">اطلاعات تماس</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-[var(--sds-text-muted)] mb-1">کد ملی</label>
                    <p className="text-[var(--sds-text-primary)]">{customer.nationalCode || 'تعریف نشده'}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--sds-text-muted)] mb-1">آدرس منزل</label>
                    <p className="text-[var(--sds-text-primary)]">{customer.homeAddress || 'تعریف نشده'}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--sds-text-muted)] mb-1">شماره منزل</label>
                    <p className="text-[var(--sds-text-primary)]">{customer.homeNumber || 'تعریف نشده'}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--sds-text-muted)] mb-1">آدرس محل کار</label>
                    <p className="text-[var(--sds-text-primary)]">{customer.workAddress || 'تعریف نشده'}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--sds-text-muted)] mb-1">شماره محل کار</label>
                    <p className="text-[var(--sds-text-primary)]">{customer.workNumber || 'تعریف نشده'}</p>
                  </div>
                </div>
              </div>

              {/* Project Management */}
              <div>
                <h3 className="text-lg font-semibold text-[var(--sds-text-primary)] mb-4">مدیریت پروژه</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-[var(--sds-text-muted)] mb-1">نام مدیر پروژه</label>
                    <p className="text-[var(--sds-text-primary)]">{customer.projectManagerName || 'تعریف نشده'}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--sds-text-muted)] mb-1">شماره تماس مدیر پروژه</label>
                    <p className="text-[var(--sds-text-primary)]">{customer.projectManagerNumber || 'تعریف نشده'}</p>
                  </div>
                </div>
              </div>

              {/* Brand Information */}
              <div>
                <h3 className="text-lg font-semibold text-[var(--sds-text-primary)] mb-4">اطلاعات برند</h3>
                <div className="grid grid-cols-1 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-[var(--sds-text-muted)] mb-1">نام برند</label>
                    <p className="text-[var(--sds-text-primary)]">{customer.brandName || 'تعریف نشده'}</p>
                  </div>
                  {customer.brandNameDescription && (
                    <div>
                      <label className="block text-sm font-medium text-[var(--sds-text-muted)] mb-1">توضیحات برند</label>
                      <p className="text-[var(--sds-text-primary)]">{customer.brandNameDescription}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Phone Numbers */}
              {customer.phoneNumbers && customer.phoneNumbers.length > 0 && (
                <div>
                  <h3 className="text-lg font-semibold text-[var(--sds-text-primary)] mb-4">شماره‌های تماس</h3>
                  <div className="space-y-3">
                    {customer.phoneNumbers.map((phone) => (
                      <div key={phone.id} className="flex items-center justify-between p-3 bg-[var(--sds-surface-raised)] rounded-lg">
                        <div className="flex items-center gap-3">
                          <FaPhone className="h-4 w-4 text-[var(--sds-text-muted)]" />
                          <span className="text-[var(--sds-text-primary)]">{phone.number}</span>
                          <span className="text-[var(--sds-text-muted)] text-sm">({phone.type})</span>
                        </div>
                        {phone.isPrimary && (
                          <span className="px-2 py-1 rounded-full text-xs font-medium bg-[var(--sds-accent-surface)] text-[var(--sds-accent)]">
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
                <h3 className="text-lg font-semibold text-[var(--sds-text-primary)] mb-4">اطلاعات سیستم</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-[var(--sds-text-muted)] mb-1">تاریخ ایجاد</label>
                    <p className="text-[var(--sds-text-primary)]">{formatDate(customer.createdAt)}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--sds-text-muted)] mb-1">آخرین بروزرسانی</label>
                    <p className="text-[var(--sds-text-primary)]">{formatDate(customer.updatedAt)}</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'projects' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-[var(--sds-text-primary)]">آدرس‌های پروژه</h3>
                {hasPermission('crm' as any, 'edit' as any) && (
                  <ErpPressable type="submit"
                    onClick={handleAddProject}
                    className="sds-action sds-tone-primary sds-action-solid inline-flex items-center gap-2 px-4 py-2"
                  >
                    <FaPlus className="h-4 w-4" />
                    افزودن آدرس
                  </ErpPressable>
                )}
              </div>

              {(!customer.projectAddresses || customer.projectAddresses.length === 0) ? (
                <div className="text-center py-8">
                  <FaMapMarkerAlt className="mx-auto text-4xl text-[var(--sds-text-muted)] mb-4" />
                  <p className="text-[var(--sds-text-muted)]">هنوز آدرس پروژه‌ای ثبت نشده است</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {customer.projectAddresses.map((address) => (
                    <div key={address.id} className="sds-workspace-surface p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <FaMapMarkerAlt className="h-5 w-5 text-[var(--sds-info)]" />
                            <h4 className="text-[var(--sds-text-primary)] font-medium">
                              {address.projectName || 'پروژه بدون نام'}
                            </h4>
                            {address.projectType && (
                              <span className="px-2 py-1 rounded-full text-xs font-medium bg-[var(--sds-surface-subtle)] text-[var(--sds-text-muted)]">
                                {address.projectType}
                              </span>
                            )}
                          </div>
                          <p className="text-[var(--sds-text-muted)] mb-1">{address.address}</p>
                          {address.city && <p className="text-[var(--sds-text-muted)] text-sm">{address.city}</p>}
                          {address.postalCode && (
                            <p className="text-[var(--sds-text-muted)] text-sm">کد پستی: {address.postalCode}</p>
                          )}

                          {/* Project Manager Information */}
                          {(address.projectManagerName || address.projectManagerNumber) && (
                            <div className="mt-3 pt-3 border-t border-[var(--sds-border-default)]">
                              <div className="flex items-center gap-4 text-sm">
                                {address.projectManagerName && (
                                  <div className="flex items-center gap-2">
                                    <FaUser className="h-4 w-4 text-[var(--sds-accent)]" />
                                    <span className="text-[var(--sds-text-muted)]">مدیر پروژه:</span>
                                    <span className="text-[var(--sds-text-primary)] font-medium">{address.projectManagerName}</span>
                                  </div>
                                )}
                                {address.projectManagerNumber && (
                                  <div className="flex items-center gap-2">
                                    <FaPhone className="h-4 w-4 text-[var(--sds-success)]" />
                                    <span className="text-[var(--sds-text-muted)]">شماره:</span>
                                    <span className="text-[var(--sds-text-primary)] font-medium">{address.projectManagerNumber}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                          {(address.marketerFirstName || address.marketerLastName || address.marketerPhoneNumber) && (
                            <div className="mt-3 pt-3 border-t border-[var(--sds-border-default)]">
                              <div className="flex flex-wrap items-center gap-4 text-sm">
                                {(address.marketerFirstName || address.marketerLastName) && (
                                  <div className="flex items-center gap-2">
                                    <FaUser className="h-4 w-4 text-[var(--sds-info)]" />
                                    <span className="text-[var(--sds-text-muted)]">بازاریاب:</span>
                                    <span className="text-[var(--sds-text-primary)] font-medium">
                                      {[address.marketerFirstName, address.marketerLastName].filter(Boolean).join(' ')}
                                    </span>
                                  </div>
                                )}
                                {address.marketerPhoneNumber && (
                                  <div className="flex items-center gap-2">
                                    <FaPhone className="h-4 w-4 text-[var(--sds-success)]" />
                                    <span className="text-[var(--sds-text-muted)]">شماره:</span>
                                    <span className="text-[var(--sds-text-primary)] font-medium">{address.marketerPhoneNumber}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {hasPermission('crm' as any, 'edit' as any) && (
                            <>
                              <ErpPressable type="submit"
                                onClick={() => handleEditProject(address)}
                                className="sds-action p-2 hover:bg-[var(--sds-surface-raised)]"
                              >
                                <FaEdit className="h-4 w-4" />
                              </ErpPressable>
                              <ErpPressable type="submit"
                                onClick={() => handleDeleteProject(address.id)}
                                className="sds-action p-2 hover:bg-[var(--sds-surface-raised)] text-[var(--sds-danger)]"
                              >
                                <FaTrash className="h-4 w-4" />
                              </ErpPressable>
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
                <h3 className="text-lg font-semibold text-[var(--sds-text-primary)]">مخاطبین</h3>
                {hasPermission('crm' as any, 'edit' as any) && (
                  <ErpPressable type="submit"
                    onClick={handleAddContact}
                    className="sds-action sds-tone-primary sds-action-solid inline-flex items-center gap-2 px-4 py-2"
                  >
                    <FaPlus className="h-4 w-4" />
                    افزودن مخاطب
                  </ErpPressable>
                )}
              </div>

              {(!customer.contacts || customer.contacts.length === 0) ? (
                <div className="text-center py-8">
                  <FaUser className="mx-auto text-4xl text-[var(--sds-text-muted)] mb-4" />
                  <p className="text-[var(--sds-text-muted)]">هنوز مخاطبی ثبت نشده است</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {customer.contacts.map((contact) => (
                    <div key={contact.id} className="sds-workspace-surface p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <FaUser className="h-5 w-5 text-[var(--sds-success)]" />
                            <h4 className="text-[var(--sds-text-primary)] font-medium">
                              {contact.firstName} {contact.lastName}
                            </h4>
                            {contact.isPrimary && (
                              <span className="px-2 py-1 rounded-full text-xs font-medium bg-[var(--sds-accent-surface)] text-[var(--sds-accent)]">
                                اصلی
                              </span>
                            )}
                          </div>
                          {contact.position && (
                            <p className="text-[var(--sds-text-muted)] mb-1">{contact.position}</p>
                          )}
                          <div className="flex items-center gap-4 text-[var(--sds-text-muted)] text-sm">
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
                              <ErpPressable type="submit"
                                onClick={() => handleEditContact(contact)}
                                className="sds-action p-2 hover:bg-[var(--sds-surface-raised)]"
                              >
                                <FaEdit className="h-4 w-4" />
                              </ErpPressable>
                              <ErpPressable type="submit"
                                onClick={() => handleDeleteContact(contact.id)}
                                className="sds-action p-2 hover:bg-[var(--sds-surface-raised)] text-[var(--sds-danger)]"
                              >
                                <FaTrash className="h-4 w-4" />
                              </ErpPressable>
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
              <h3 className="text-lg font-semibold text-[var(--sds-text-primary)]">سرنخ‌ها</h3>

              {(!customer.leads || customer.leads.length === 0) ? (
                <div className="text-center py-8">
                  <FaHistory className="mx-auto text-4xl text-[var(--sds-text-muted)] mb-4" />
                  <p className="text-[var(--sds-text-muted)]">هنوز سرنخی ثبت نشده است</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {customer.leads.map((lead) => (
                    <div key={lead.id} className="sds-workspace-surface p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <h4 className="text-[var(--sds-text-primary)] font-medium mb-1">{lead.companyName}</h4>
                          <p className="text-[var(--sds-text-muted)] mb-2">{lead.contactName}</p>
                          <div className="flex items-center gap-4 text-[var(--sds-text-muted)] text-sm">
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
              <h3 className="text-lg font-semibold text-[var(--sds-text-primary)]">قراردادها</h3>

              {(!customer.salesContracts || customer.salesContracts.length === 0) ? (
                <div className="text-center py-8">
                  <FaFileContract className="mx-auto text-4xl text-[var(--sds-text-muted)] mb-4" />
                  <p className="text-[var(--sds-text-muted)]">هنوز قراردادی ثبت نشده است</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {customer.salesContracts.map((contract) => (
                    <div key={contract.id} className="sds-workspace-surface p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <h4 className="text-[var(--sds-text-primary)] font-medium mb-1">قرارداد شماره {contract.contractNumber}</h4>
                          <div className="flex items-center gap-4 text-[var(--sds-text-muted)] text-sm">
                            <span>مبلغ: {formatAmount(contract.totalAmount)}</span>
                            <span>تاریخ: {formatDate(contract.createdAt)}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <Link
                            href={`/dashboard/sales/contracts/${contract.id}`}
                            className="sds-action sds-tone-primary sds-action-solid inline-flex items-center gap-2 px-3 py-2 text-sm"
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
        <div className="sds-workspace-surface p-6">
          <h3 className="text-lg font-semibold text-[var(--sds-text-primary)] mb-4">عملیات مدیریتی</h3>
          <div className="flex items-center gap-4">
            <ErpPressable type="submit"
              onClick={handleToggleBlacklist}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg transition-all duration-200 ${
                customer.isBlacklisted
                  ? 'bg-[var(--sds-success)] text-[var(--sds-text-inverse)] hover:bg-[var(--sds-success)]'
                  : 'bg-[var(--sds-danger)] text-[var(--sds-text-inverse)] hover:bg-[var(--sds-danger)]'
              }`}
            >
              {customer.isBlacklisted ? <FaCheckCircle className="h-4 w-4" /> : <FaBan className="h-4 w-4" />}
              {customer.isBlacklisted ? 'حذف از لیست سیاه' : 'افزودن به لیست سیاه'}
            </ErpPressable>

            <ErpPressable type="submit"
              onClick={handleToggleLock}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg transition-all duration-200 ${
                customer.isLocked
                  ? 'bg-[var(--sds-success)] text-[var(--sds-text-inverse)] hover:bg-[var(--sds-success)]'
                  : 'bg-[var(--sds-warning)] text-[var(--sds-text-inverse)] hover:bg-[var(--sds-warning)]'
              }`}
            >
              {customer.isLocked ? <FaCheckCircle className="h-4 w-4" /> : <FaLock className="h-4 w-4" />}
              {customer.isLocked ? 'باز کردن قفل' : 'قفل کردن'}
            </ErpPressable>
          </div>
        </div>
      )}

      {/* Add/Edit Project Address Modal */}
      {showAddProjectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--sds-surface-overlay)] p-4">
          <div className="sds-workspace-surface flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden">
            <div className="flex flex-shrink-0 items-center justify-between border-b border-[var(--sds-border-default)] p-4 sm:p-6">
              <h3 className="text-lg font-semibold text-[var(--sds-text-primary)]">
                {editingProject ? 'ویرایش آدرس پروژه' : 'افزودن آدرس پروژه'}
              </h3>
              <ErpPressable type="submit"
                onClick={() => setShowAddProjectModal(false)}
                className="sds-action p-2 hover:bg-[var(--sds-surface-raised)]"
              >
                <FaTimes className="h-4 w-4" />
              </ErpPressable>
            </div>

            <form onSubmit={handleSubmitProject} className="space-y-4 overflow-y-auto p-4 sm:p-6">
              <div>
                <label className="block text-sm font-medium text-[var(--sds-text-muted)] mb-2">نام پروژه</label>
                <ErpInput
                  type="text"
                  value={projectFormData.projectName}
                  onChange={(e) => setProjectFormData(prev => ({ ...prev, projectName: e.target.value }))}
                  className="w-full px-4 py-3 bg-[var(--sds-surface-raised)] border border-[var(--sds-border-default)] rounded-lg text-[var(--sds-text-primary)] placeholder:text-[var(--sds-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--sds-focus-ring)]"
                  placeholder="نام پروژه"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--sds-text-muted)] mb-2">آدرس</label>
                <ErpTextarea
                  value={projectFormData.address}
                  onChange={(e) => setProjectFormData(prev => ({ ...prev, address: e.target.value }))}
                  className="w-full px-4 py-3 bg-[var(--sds-surface-raised)] border border-[var(--sds-border-default)] rounded-lg text-[var(--sds-text-primary)] placeholder:text-[var(--sds-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--sds-focus-ring)]"
                  placeholder="آدرس پروژه"
                  rows={3}
                  required
                />
              </div>

              <div className="grid grid-cols-1 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--sds-text-muted)] mb-2">شهر</label>
                  <ErpInput
                    type="text"
                    value={projectFormData.city}
                    onChange={(e) => setProjectFormData(prev => ({ ...prev, city: e.target.value }))}
                    className="w-full px-4 py-3 bg-[var(--sds-surface-raised)] border border-[var(--sds-border-default)] rounded-lg text-[var(--sds-text-primary)] placeholder:text-[var(--sds-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--sds-focus-ring)]"
                    placeholder="شهر"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--sds-text-muted)] mb-2">نوع پروژه</label>
                <EnhancedDropdown
                  value={projectFormData.projectType}
                  onChange={(value) => setProjectFormData(prev => ({ ...prev, projectType: value }))}
                  placeholder="انتخاب نوع پروژه"
                  options={PROJECT_TYPE_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
                  searchable
                  clearable
                  noOptionsText="نوع پروژه‌ای پیدا نشد"
                />
              </div>

              {/* Project Manager Information */}
              <div className="border-t border-[var(--sds-border-default)] pt-4">
                <h4 className="text-lg font-medium text-[var(--sds-text-primary)] mb-4 flex items-center gap-2">
                  <FaUser className="text-[var(--sds-accent)]" />
                  اطلاعات مدیر پروژه
                </h4>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-[var(--sds-text-muted)] mb-2">نام مدیر پروژه</label>
                    <ErpInput
                      type="text"
                      value={projectFormData.projectManagerName}
                      onChange={(e) => setProjectFormData(prev => ({ ...prev, projectManagerName: e.target.value }))}
                      className="w-full px-4 py-3 bg-[var(--sds-surface-raised)] border border-[var(--sds-border-default)] rounded-lg text-[var(--sds-text-primary)] placeholder:text-[var(--sds-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--sds-focus-ring)]"
                      placeholder="نام مدیر پروژه"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-[var(--sds-text-muted)] mb-2">شماره مدیر پروژه</label>
                    <ErpInput
                      type="text"
                      value={projectFormData.projectManagerNumber}
                      onChange={(e) => setProjectFormData(prev => ({ ...prev, projectManagerNumber: e.target.value }))}
                      className="w-full px-4 py-3 bg-[var(--sds-surface-raised)] border border-[var(--sds-border-default)] rounded-lg text-[var(--sds-text-primary)] placeholder:text-[var(--sds-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--sds-focus-ring)]"
                      placeholder="شماره تماس مدیر پروژه"
                    />
                  </div>
                </div>
              </div>

              <div className="border-t border-[var(--sds-border-default)] pt-4">
                <h4 className="text-lg font-medium text-[var(--sds-text-primary)] mb-4 flex items-center gap-2">
                  <FaUser className="text-[var(--sds-info)]" />
                  اطلاعات بازاریاب
                </h4>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-[var(--sds-text-muted)] mb-2">نام بازاریاب</label>
                    <ErpInput
                      type="text"
                      value={projectFormData.marketerFirstName}
                      onChange={(e) => setProjectFormData(prev => ({ ...prev, marketerFirstName: e.target.value }))}
                      className="w-full px-4 py-3 bg-[var(--sds-surface-raised)] border border-[var(--sds-border-default)] rounded-lg text-[var(--sds-text-primary)] placeholder:text-[var(--sds-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--sds-focus-ring)]"
                      placeholder="نام بازاریاب"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-[var(--sds-text-muted)] mb-2">نام خانوادگی بازاریاب</label>
                    <ErpInput
                      type="text"
                      value={projectFormData.marketerLastName}
                      onChange={(e) => setProjectFormData(prev => ({ ...prev, marketerLastName: e.target.value }))}
                      className="w-full px-4 py-3 bg-[var(--sds-surface-raised)] border border-[var(--sds-border-default)] rounded-lg text-[var(--sds-text-primary)] placeholder:text-[var(--sds-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--sds-focus-ring)]"
                      placeholder="نام خانوادگی بازاریاب"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-[var(--sds-text-muted)] mb-2">شماره تماس بازاریاب</label>
                    <ErpInput
                      type="text"
                      value={projectFormData.marketerPhoneNumber}
                      onChange={(e) => setProjectFormData(prev => ({ ...prev, marketerPhoneNumber: e.target.value }))}
                      className="w-full px-4 py-3 bg-[var(--sds-surface-raised)] border border-[var(--sds-border-default)] rounded-lg text-[var(--sds-text-primary)] placeholder:text-[var(--sds-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--sds-focus-ring)]"
                      placeholder="شماره تماس بازاریاب"
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-4 pt-4">
                <ErpPressable
                  type="submit"
                  className="sds-action sds-tone-primary sds-action-solid inline-flex items-center gap-2 px-6 py-3"
                >
                  <FaSave className="h-4 w-4" />
                  {editingProject ? 'بروزرسانی' : 'افزودن'}
                </ErpPressable>
                <ErpPressable
                  type="button"
                  onClick={() => setShowAddProjectModal(false)}
                  className="sds-action px-6 py-3"
                >
                  انصراف
                </ErpPressable>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add/Edit Contact Modal */}
      {showAddContactModal && (
        <div className="fixed inset-0 bg-[var(--sds-surface-overlay)] flex items-center justify-center z-50">
          <div className="sds-workspace-surface p-6 w-full max-w-md mx-4">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-[var(--sds-text-primary)]">
                {editingContact ? 'ویرایش مخاطب' : 'افزودن مخاطب'}
              </h3>
              <ErpPressable type="submit"
                onClick={() => setShowAddContactModal(false)}
                className="sds-action p-2 hover:bg-[var(--sds-surface-raised)]"
              >
                <FaTimes className="h-4 w-4" />
              </ErpPressable>
            </div>

            <form onSubmit={handleSubmitContact} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--sds-text-muted)] mb-2">نام</label>
                  <ErpInput
                    type="text"
                    value={contactFormData.firstName}
                    onChange={(e) => setContactFormData(prev => ({ ...prev, firstName: e.target.value }))}
                    className="w-full px-4 py-3 bg-[var(--sds-surface-raised)] border border-[var(--sds-border-default)] rounded-lg text-[var(--sds-text-primary)] placeholder:text-[var(--sds-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--sds-focus-ring)]"
                    placeholder="نام"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--sds-text-muted)] mb-2">نام خانوادگی</label>
                  <ErpInput
                    type="text"
                    value={contactFormData.lastName}
                    onChange={(e) => setContactFormData(prev => ({ ...prev, lastName: e.target.value }))}
                    className="w-full px-4 py-3 bg-[var(--sds-surface-raised)] border border-[var(--sds-border-default)] rounded-lg text-[var(--sds-text-primary)] placeholder:text-[var(--sds-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--sds-focus-ring)]"
                    placeholder="نام خانوادگی"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--sds-text-muted)] mb-2">سمت</label>
                <ErpInput
                  type="text"
                  value={contactFormData.position}
                  onChange={(e) => setContactFormData(prev => ({ ...prev, position: e.target.value }))}
                  className="w-full px-4 py-3 bg-[var(--sds-surface-raised)] border border-[var(--sds-border-default)] rounded-lg text-[var(--sds-text-primary)] placeholder:text-[var(--sds-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--sds-focus-ring)]"
                  placeholder="سمت"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--sds-text-muted)] mb-2">ایمیل</label>
                <ErpInput
                  type="email"
                  value={contactFormData.email}
                  onChange={(e) => setContactFormData(prev => ({ ...prev, email: e.target.value }))}
                  className="w-full px-4 py-3 bg-[var(--sds-surface-raised)] border border-[var(--sds-border-default)] rounded-lg text-[var(--sds-text-primary)] placeholder:text-[var(--sds-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--sds-focus-ring)]"
                  placeholder="ایمیل"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--sds-text-muted)] mb-2">شماره تماس</label>
                <ErpInput
                  type="tel"
                  value={contactFormData.phone}
                  onChange={(e) => setContactFormData(prev => ({ ...prev, phone: e.target.value }))}
                  className="w-full px-4 py-3 bg-[var(--sds-surface-raised)] border border-[var(--sds-border-default)] rounded-lg text-[var(--sds-text-primary)] placeholder:text-[var(--sds-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--sds-focus-ring)]"
                  placeholder="شماره تماس"
                />
              </div>

              <div className="flex items-center gap-2">
                <ErpInput
                  type="checkbox"
                  id="isPrimary"
                  checked={contactFormData.isPrimary}
                  onChange={(e) => setContactFormData(prev => ({ ...prev, isPrimary: e.target.checked }))}
                  className="w-4 h-4 text-[var(--sds-accent)] bg-[var(--sds-surface-raised)] border-[var(--sds-border-default)] rounded focus:ring-[var(--sds-focus-ring)]"
                />
                <label htmlFor="isPrimary" className="text-sm text-[var(--sds-text-muted)]">
                  مخاطب اصلی
                </label>
              </div>

              <div className="flex items-center gap-4 pt-4">
                <ErpPressable
                  type="submit"
                  className="sds-action sds-tone-primary sds-action-solid inline-flex items-center gap-2 px-6 py-3"
                >
                  <FaSave className="h-4 w-4" />
                  {editingContact ? 'بروزرسانی' : 'افزودن'}
                </ErpPressable>
                <ErpPressable
                  type="button"
                  onClick={() => setShowAddContactModal(false)}
                  className="sds-action px-6 py-3"
                >
                  انصراف
                </ErpPressable>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
