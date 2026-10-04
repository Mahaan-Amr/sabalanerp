'use client';
import { DirectCustomerTransfer } from '@/features/partner-sales/customers/DirectCustomerTransfer';
import { ErpBadge, ErpButton, ErpCard, ErpCheckbox, ErpField as CustomerWorkflowField, ErpFieldView, ErpInlineState, ErpInput, ErpLoading, ErpPressable, ErpSegmentedControl, ErpSection, ErpSheet, ErpTextarea, useErpPresentationScope } from '@/components/erp';
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
import CustomerCreditPanel from '@/features/crm/CustomerCreditPanel';
import { crmAPI, dashboardAPI } from '@/lib/api';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import PersianCalendar from '@/lib/persian-calendar';
import { formatPrice } from '@/lib/numberFormat';
import { getCrmPermissions } from '@/lib/permissions';
import { PROJECT_TYPE_OPTIONS } from '@/lib/projectTypes';
import EnhancedDropdown from '@/components/EnhancedDropdown';
import { CustomerWorkflowPage, CustomerWorkflowSection } from '@/features/crm/customer-workflow/CustomerWorkflowUi';
import { CustomerRemovalConfirmation } from '@/features/crm/customer-workflow/CustomerRemovalConfirmation';
import { writeContractReturnSelection } from '@/features/contract-creation/utils/contractReturnSelection';

interface CrmCustomer {
  partnerOwnerProfileId?: string | null;
  managementReadOnly?: boolean;
  canManageCustomerCard?: boolean;
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
  const [cardActionPending, setCardActionPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'projects' | 'contacts' | 'leads' | 'contracts'>('overview');
  const [showAddProjectModal, setShowAddProjectModal] = useState(false);
  const presentationScope = useErpPresentationScope();
  const DetailFrame = presentationScope === 'workspace' ? 'div' : ErpCard;
  const DetailSection = presentationScope === 'workspace' ? ErpSection : 'div';
  const [removal, setRemoval] = useState<{ kind: 'project' | 'contact'; id: string } | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removalError, setRemovalError] = useState<string | null>(null);
  const [projectSaving, setProjectSaving] = useState(false);
  const [contactSaving, setContactSaving] = useState(false);
  const [contactSubmitError, setContactSubmitError] = useState<string | null>(null);
  const [projectSubmitError, setProjectSubmitError] = useState<string | null>(null);
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
    if (!customer || cardActionPending) return;

    setCardActionPending(true); setError(null);
    try {
      const response = await crmAPI.toggleBlacklist(customer.id);
      if (response.data.success) {
        setCustomer(prev => prev ? { ...prev, isBlacklisted: response.data.data.isBlacklisted } : null);
      }
    } catch (error: any) {
      setError(error.response?.data?.error || 'خطا در تغییر وضعیت مشتری');
      console.error('Error toggling blacklist:', error);
    } finally { setCardActionPending(false); }
  };

  const handleToggleLock = async () => {
    if (!customer || cardActionPending) return;

    setCardActionPending(true); setError(null);
    try {
      const response = await crmAPI.toggleLock(customer.id);
      if (response.data.success) {
        setCustomer(prev => prev ? { ...prev, isLocked: response.data.data.isLocked } : null);
      }
    } catch (error: any) {
      setError(error.response?.data?.error || 'خطا در تغییر وضعیت مشتری');
      console.error('Error toggling lock:', error);
    } finally { setCardActionPending(false); }
  };

  // Project Address Handlers
  const handleAddProject = () => {
    setProjectSubmitError(null);
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
    setProjectSubmitError(null);
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

  const handleDeleteProject = async (projectId: string, confirmed = false) => {
    if (!confirmed) {
      if (presentationScope === 'workspace') {
        setRemovalError(null);
        setRemoval({ kind: 'project', id: projectId });
        return;
      }
      if (!confirm('آیا از حذف این آدرس پروژه اطمینان دارید؟')) return;
    }

    try {
      const response = await crmAPI.deleteProjectAddress(customer!.id, projectId);
      if (response.data.success) {
        await fetchCustomer(); // Refresh data
        return true;
      }
    } catch (error) {
      console.error('Error deleting project address:', error);
    }
    return false;
  };

  // Contact Handlers
  const handleAddContact = () => {
    setContactSubmitError(null);
    setEditingContact(null);
    setShowAddContactModal(true);
  };

  const handleEditContact = (contact: any) => {
    setContactSubmitError(null);
    setEditingContact(contact);
    setShowAddContactModal(true);
  };

  const handleDeleteContact = async (contactId: string, confirmed = false) => {
    if (!customer) return;
    if (!confirmed) {
      if (presentationScope === 'workspace') {
        setRemovalError(null);
        setRemoval({ kind: 'contact', id: contactId });
        return;
      }
      if (!confirm('آیا از حذف این مخاطب اطمینان دارید؟')) return;
    }

    try {
      const response = await crmAPI.deleteContact(customer.id, contactId);
      if (response.data.success) {
        await fetchCustomer(); // Refresh data
        return true;
      }
    } catch (error) {
      console.error('Error deleting contact:', error);
    }
    return false;
  };

  // Form Submission Handlers
  const handleSubmitProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customer || projectSaving) return;
    setProjectSaving(true);
    setProjectSubmitError(null);

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

          // Check if we should return to contract wizard
          const urlParams = new URLSearchParams(window.location.search);
          const returnTo = urlParams.get('returnTo');
          const step = urlParams.get('step');

          if (returnTo === 'contract' && step) {
            const selectionSaved = writeContractReturnSelection({
              currentStep: Number(step),
              customerId: customer.id,
              projectId: response.data.data.id
            });
            if (!selectionSaved) {
              setProjectSubmitError('پروژه ایجاد شد، اما فضای ذخیرهٔ مرورگر پر است؛ بازگشت خودکار برای جلوگیری از انتخاب پروژه اشتباه متوقف شد.');
              return;
            }
            setProjectSubmitError(null);
            setShowAddProjectModal(false);
            // Redirect back to contract wizard
            router.push(`/dashboard/sales/contracts/create?returnTo=contract&step=${step}`);
          } else {
            setProjectSubmitError(null);
            setShowAddProjectModal(false);
          }
        }
      }
    } catch (error) {
      console.error('Error saving project address:', error);
      setProjectSubmitError('ذخیره آدرس پروژه ناموفق بود؛ دوباره تلاش کنید.');
    } finally {
      setProjectSaving(false);
    }
  };

  const handleSubmitContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customer || contactSaving) return;
    setContactSaving(true);
    setContactSubmitError(null);

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
      setContactSubmitError('ذخیره مخاطب ناموفق بود؛ دوباره تلاش کنید.');
    } finally {
      setContactSaving(false);
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

  if (loading) return <ErpLoading />;

  if (error || !customer) {
    return (
      <CustomerWorkflowPage title="جزئیات مشتری" backHref="/dashboard/crm/customers">
        <ErpInlineState kind="error" title={error || 'مشتری یافت نشد'} action={{ label: 'بازگشت به لیست', href: '/dashboard/crm/customers' }} />
      </CustomerWorkflowPage>
    );
  }

  if (customer.managementReadOnly) return <CustomerWorkflowPage title={`${customer.firstName} ${customer.lastName}`} backHref="/dashboard/crm/customers"
    feedback={error ? { kind: 'error', title: error } : undefined}
    actions={customer.canManageCustomerCard ? [{ label: 'ویرایش', icon: FaEdit, href: `/dashboard/crm/customers/${customer.id}/edit` }] : []}>
    <DirectCustomerTransfer customerId={customer.id} onTransferred={() => void fetchCustomer()} />
    {customer.canManageCustomerCard && <CustomerWorkflowSection title="مدیریت مشتری"><ErpPressable disabled={cardActionPending} onClick={handleToggleBlacklist}>{customer.isBlacklisted ? 'حذف از بلک‌لیست' : 'افزودن به بلک‌لیست'}</ErpPressable><ErpPressable disabled={cardActionPending} onClick={handleToggleLock}>{customer.isLocked ? 'باز کردن قفل' : 'قفل کردن'}</ErpPressable></CustomerWorkflowSection>}
    {!customer.partnerOwnerProfileId && <CustomerCreditPanel customerId={customer.id} onChanged={() => void fetchCustomer()} />}
    <CustomerWorkflowSection title="اطلاعات مشتری">
      <ErpInlineState kind="permission" title={customer.canManageCustomerCard ? "مدیریت کارت مشتری همکار" : "نمایش مدیریتی مشتری — دسترسی مشاهده اطلاعات"} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ErpFieldView label="مسئول فروش" value={getOwnerLabel(customer.ownerUser)} />
        <ErpFieldView label="شرکت" value={customer.companyName || '—'} />
        <ErpFieldView label="کد ملی" value={customer.nationalCode || '—'} />
        <ErpFieldView label="نشانی منزل" value={customer.homeAddress || '—'} />
        <ErpFieldView label="نشانی کار" value={customer.workAddress || '—'} />
        {customer.phoneNumbers.map(phone => <ErpFieldView key={phone.id} label="تلفن" value={phone.number} />)}
        {customer.contacts?.map(contact => <ErpFieldView key={contact.id} label={`${contact.firstName} ${contact.lastName}`} value={[contact.phone, contact.email].filter(Boolean).join(' • ') || '—'} />)}
      </div>
    </CustomerWorkflowSection>
    <CustomerWorkflowSection title="پروژه‌های مشتری">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{customer.projectAddresses.map(project =>
        <ErpFieldView key={project.id} label={project.projectName || 'نشانی پروژه'} value={[project.address, project.city].filter(Boolean).join(' • ')} />)}</div>
    </CustomerWorkflowSection>
  </CustomerWorkflowPage>;

  return (
    <CustomerWorkflowPage
      title={`${customer.firstName} ${customer.lastName}`}
      description={<>{customer.companyName && `${customer.companyName} • `}{getCustomerTypeLabel(customer.customerType)}</>}
      backHref="/dashboard/crm/customers"
      actions={hasPermission('crm' as any, 'edit' as any) ? [{ label: 'ویرایش', icon: FaEdit, href: `/dashboard/crm/customers/${customer.id}/edit` }] : []}
    >
      <DirectCustomerTransfer customerId={customer.id} onTransferred={() => void fetchCustomer()} />
      <div className="flex flex-wrap items-center gap-3">
          {/* Cancel button - return to contract wizard */}
          {(() => {
            const urlParams = new URLSearchParams(window.location.search);
            const returnTo = urlParams.get('returnTo');
            const step = urlParams.get('step');
            const action = urlParams.get('action');

            if (returnTo === 'contract' && step && action === 'addProject') {
              return (
                <ErpPressable type="button"
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
                  tone="danger"
                  variant="outline"
                  className="px-6 py-3"
                >
                  <FaTimes className="inline-block ml-2" />
                  لغو و بازگشت به قرارداد
                </ErpPressable>
              );
            }
            return null;
          })()}

      </div>

      {/* Status Indicators */}
      <div className="flex flex-wrap items-center gap-3 sm:gap-4">
        <ErpBadge tone={customer.status === 'Active' ? 'success' : customer.status === 'Inactive' ? 'neutral' : customer.status === 'Lead' ? 'warning' : 'info'}>{getStatusLabel(customer.status)}</ErpBadge>

        {customer.isBlacklisted && (
          <ErpBadge tone="danger">
            <FaBan className="h-4 w-4" />
            لیست سیاه
          </ErpBadge>
        )}

        {customer.isLocked && (
          <ErpBadge tone="warning">
            <FaLock className="h-4 w-4" />
            قفل شده
          </ErpBadge>
        )}
      </div>

      {/* Tabs */}
      <DetailFrame>
        {presentationScope !== 'workspace' && <ErpSegmentedControl
          value={activeTab}
          onChange={setActiveTab}
          options={[
            { value: 'overview', label: 'نمای کلی', icon: FaUser },
            { value: 'projects', label: 'پروژه‌ها', icon: FaMapMarkerAlt },
            { value: 'contacts', label: 'مخاطبین', icon: FaPhone },
            { value: 'leads', label: 'سرنخ‌ها', icon: FaHistory },
            { value: 'contracts', label: 'قراردادها', icon: FaFileContract },
          ]}
        />}

        <div className={presentationScope === 'workspace' ? "p-4 sm:p-6 space-y-6" : "p-4 sm:p-6"}>
          {(presentationScope === 'workspace' || activeTab === 'overview') && (
            <DetailSection className="space-y-6">
              <CustomerCreditPanel customerId={customer.id} onChanged={() => void fetchCustomer()} />
              {/* Basic Information */}
              <div>
                <h3 className="text-lg font-semibold text-[var(--sds-text-primary)] mb-4">اطلاعات پایه</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  <ErpFieldView label="نام و نام خانوادگی" value={<>{customer.firstName} {customer.lastName}</>} />
                  <ErpFieldView label="نام شرکت" value={<>{customer.companyName || 'تعریف نشده'}</>} />
                  <ErpFieldView label="نوع مشتری" value={<>{getCustomerTypeLabel(customer.customerType)}</>} />
                  <ErpFieldView label="صنعت" value={<>{customer.industry || 'تعریف نشده'}</>} />
                  <ErpFieldView label="وضعیت" value={<ErpBadge tone={customer.status === 'Active' ? 'success' : customer.status === 'Lead' ? 'warning' : customer.status === 'Prospect' ? 'info' : 'neutral'}>{getStatusLabel(customer.status)}</ErpBadge>} />
                  {crmPermissions.canAssignCustomerOwner ? (
                      <EnhancedDropdown
                        label="مسئول فروش"
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
                    ) : <ErpFieldView label="مسئول فروش" value={getOwnerLabel(customer.ownerUser)} />}
                </div>
              </div>

              {/* Contact Information */}
              <CustomerWorkflowSection title="اطلاعات تماس" collapsible legacyPlain>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  <ErpFieldView label="کد ملی" value={<>{customer.nationalCode || 'تعریف نشده'}</>} />
                  <ErpFieldView label="آدرس منزل" value={<>{customer.homeAddress || 'تعریف نشده'}</>} />
                  <ErpFieldView label="شماره منزل" value={<>{customer.homeNumber || 'تعریف نشده'}</>} />
                  <ErpFieldView label="آدرس محل کار" value={<>{customer.workAddress || 'تعریف نشده'}</>} />
                  <ErpFieldView label="شماره محل کار" value={<>{customer.workNumber || 'تعریف نشده'}</>} />
                </div>
              </CustomerWorkflowSection>

              {/* Project Management */}
              <CustomerWorkflowSection title="مدیریت پروژه" collapsible legacyPlain>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <ErpFieldView label="نام مدیر پروژه" value={<>{customer.projectManagerName || 'تعریف نشده'}</>} />
                  <ErpFieldView label="شماره تماس مدیر پروژه" value={<>{customer.projectManagerNumber || 'تعریف نشده'}</>} />
                </div>
              </CustomerWorkflowSection>

              {/* Brand Information */}
              <CustomerWorkflowSection title="اطلاعات برند" collapsible legacyPlain>

                <div className="grid grid-cols-1 gap-6">
                  <ErpFieldView label="نام برند" value={<>{customer.brandName || 'تعریف نشده'}</>} />
                  {customer.brandNameDescription && (
                    <ErpFieldView label="توضیحات برند" value={<>{customer.brandNameDescription}</>} />
                  )}
                </div>
              </CustomerWorkflowSection>

              {/* Phone Numbers */}
              {customer.phoneNumbers && customer.phoneNumbers.length > 0 && (
                <div>
                  <h3 className="text-lg font-semibold text-[var(--sds-text-primary)] mb-4">شماره‌های تماس</h3>
                  <div className="space-y-3">
                    {customer.phoneNumbers.map((phone) => (
                      <ErpCard key={phone.id} className="flex items-center justify-between p-3">
                        <div className="flex items-center gap-3">
                          <FaPhone className="h-4 w-4 text-[var(--sds-text-muted)]" />
                          <span className="text-[var(--sds-text-primary)]">{phone.number}</span>
                          <span className="text-[var(--sds-text-muted)] text-sm">({phone.type})</span>
                        </div>
                        {phone.isPrimary && (
                          <ErpBadge tone="info">اصلی</ErpBadge>
                        )}
                      </ErpCard>
                    ))}
                  </div>
                </div>
              )}

              {/* System Information */}
              <CustomerWorkflowSection title="اطلاعات سیستم" collapsible legacyPlain>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <ErpFieldView label="تاریخ ایجاد" value={<>{formatDate(customer.createdAt)}</>} />
                  <ErpFieldView label="آخرین بروزرسانی" value={<>{formatDate(customer.updatedAt)}</>} />
                </div>
              </CustomerWorkflowSection>
            </DetailSection>
          )}

          {(presentationScope === 'workspace' || activeTab === 'projects') && (
            <DetailSection className="space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-[var(--sds-text-primary)]">آدرس‌های پروژه</h3>
                {hasPermission('crm' as any, 'edit' as any) && (
                  <ErpPressable type="button"
                    onClick={handleAddProject}
                    tone="primary"
                    variant="solid"
                    className="inline-flex items-center gap-2 px-4 py-2"
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
                    <ErpCard key={address.id} className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <FaMapMarkerAlt className="h-5 w-5 text-[var(--sds-info)]" />
                            <h4 className="text-[var(--sds-text-primary)] font-medium">
                              {address.projectName || 'پروژه بدون نام'}
                            </h4>
                            {address.projectType && (
                              <ErpBadge tone="neutral">{address.projectType}</ErpBadge>
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
                              <ErpPressable type="button"
                                onClick={() => handleEditProject(address)}
                                aria-label="ویرایش آدرس پروژه"
                                variant="ghost"
                                className="p-2"
                              >
                                <FaEdit className="h-4 w-4" />
                              </ErpPressable>
                              <ErpPressable type="button"
                                onClick={() => handleDeleteProject(address.id)}
                                aria-label="حذف آدرس پروژه"
                                tone="danger"
                                variant="ghost"
                                className="p-2"
                              >
                                <FaTrash className="h-4 w-4" />
                              </ErpPressable>
                            </>
                          )}
                        </div>
                      </div>
                    </ErpCard>
                  ))}
                </div>
              )}
            </DetailSection>
          )}

          {(presentationScope === 'workspace' || activeTab === 'contacts') && (
            <DetailSection className="space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-[var(--sds-text-primary)]">مخاطبین</h3>
                {hasPermission('crm' as any, 'edit' as any) && (
                  <ErpPressable type="button"
                    onClick={handleAddContact}
                    tone="primary"
                    variant="solid"
                    className="inline-flex items-center gap-2 px-4 py-2"
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
                    <ErpCard key={contact.id} className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <FaUser className="h-5 w-5 text-[var(--sds-success)]" />
                            <h4 className="text-[var(--sds-text-primary)] font-medium">
                              {contact.firstName} {contact.lastName}
                            </h4>
                            {contact.isPrimary && (
                              <ErpBadge tone="info">اصلی</ErpBadge>
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
                              <ErpPressable type="button"
                                onClick={() => handleEditContact(contact)}
                                aria-label="ویرایش مخاطب"
                                variant="ghost"
                                className="p-2"
                              >
                                <FaEdit className="h-4 w-4" />
                              </ErpPressable>
                              <ErpPressable type="button"
                                onClick={() => handleDeleteContact(contact.id)}
                                aria-label="حذف مخاطب"
                                tone="danger"
                                variant="ghost"
                                className="p-2"
                              >
                                <FaTrash className="h-4 w-4" />
                              </ErpPressable>
                            </>
                          )}
                        </div>
                      </div>
                    </ErpCard>
                  ))}
                </div>
              )}
            </DetailSection>
          )}

          {(presentationScope === 'workspace' || activeTab === 'leads') && (
            <DetailSection className="space-y-6">
              <h3 className="text-lg font-semibold text-[var(--sds-text-primary)]">سرنخ‌ها</h3>

              {(!customer.leads || customer.leads.length === 0) ? (
                <div className="text-center py-8">
                  <FaHistory className="mx-auto text-4xl text-[var(--sds-text-muted)] mb-4" />
                  <p className="text-[var(--sds-text-muted)]">هنوز سرنخی ثبت نشده است</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {customer.leads.map((lead) => (
                    <ErpCard key={lead.id} className="p-4">
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
                        <ErpBadge tone={lead.status === 'Active' ? 'success' : lead.status === 'Lead' ? 'warning' : 'neutral'}>{getStatusLabel(lead.status)}</ErpBadge>
                      </div>
                    </ErpCard>
                  ))}
                </div>
              )}
            </DetailSection>
          )}

          {(presentationScope === 'workspace' || activeTab === 'contracts') && (
            <DetailSection className="space-y-6">
              <h3 className="text-lg font-semibold text-[var(--sds-text-primary)]">قراردادها</h3>

              {(!customer.salesContracts || customer.salesContracts.length === 0) ? (
                <div className="text-center py-8">
                  <FaFileContract className="mx-auto text-4xl text-[var(--sds-text-muted)] mb-4" />
                  <p className="text-[var(--sds-text-muted)]">هنوز قراردادی ثبت نشده است</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {customer.salesContracts.map((contract) => (
                    <ErpCard key={contract.id} className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <h4 className="text-[var(--sds-text-primary)] font-medium mb-1">قرارداد شماره {contract.contractNumber}</h4>
                          <div className="flex items-center gap-4 text-[var(--sds-text-muted)] text-sm">
                            <span>مبلغ: {formatAmount(contract.totalAmount)}</span>
                            <span>تاریخ: {formatDate(contract.createdAt)}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <ErpButton label="مشاهده" icon={FaEye} href={`/dashboard/sales/contracts/${contract.id}`} variant="solid" />
                          <ErpBadge tone={contract.status === 'Active' ? 'success' : contract.status === 'Lead' ? 'warning' : 'neutral'}>{getStatusLabel(contract.status)}</ErpBadge>
                        </div>
                      </div>
                    </ErpCard>
                  ))}
                </div>
              )}
            </DetailSection>
          )}
        </div>
      </DetailFrame>

      {/* Admin Actions */}
      {hasPermission('crm' as any, 'admin' as any) && (
        <CustomerWorkflowSection title="عملیات مدیریتی" collapsible>
          <div className="flex items-center gap-4">
            <ErpPressable type="button"
              onClick={handleToggleBlacklist}
              tone={customer.isBlacklisted ? 'success' : 'danger'}
              variant="solid"
            >
              {customer.isBlacklisted ? <FaCheckCircle className="h-4 w-4" /> : <FaBan className="h-4 w-4" />}
              {customer.isBlacklisted ? 'حذف از لیست سیاه' : 'افزودن به لیست سیاه'}
            </ErpPressable>

            <ErpPressable type="button"
              onClick={handleToggleLock}
              tone={customer.isLocked ? 'success' : 'warning'}
              variant="solid"
            >
              {customer.isLocked ? <FaCheckCircle className="h-4 w-4" /> : <FaLock className="h-4 w-4" />}
              {customer.isLocked ? 'باز کردن قفل' : 'قفل کردن'}
            </ErpPressable>
          </div>
        </CustomerWorkflowSection>
      )}

      {/* Add/Edit Project Address Modal */}
      <ErpSheet
        open={showAddProjectModal}
        pending={projectSaving}
        onClose={() => setShowAddProjectModal(false)}
        title={editingProject ? 'ویرایش آدرس پروژه' : 'افزودن آدرس پروژه'}
        presentation="modal"
      >
            <form onSubmit={handleSubmitProject} className="space-y-4">
              {projectSubmitError && <ErpInlineState kind="error" title={projectSubmitError} />}
              <CustomerWorkflowField label="نام پروژه" required>
                <ErpInput
                  type="text"
                  value={projectFormData.projectName}
                  onChange={(e) => setProjectFormData(prev => ({ ...prev, projectName: e.target.value }))}
                  placeholder="نام پروژه"
                  required
                />
              </CustomerWorkflowField>

              <CustomerWorkflowField label="آدرس" required>
                <ErpTextarea
                  value={projectFormData.address}
                  onChange={(e) => setProjectFormData(prev => ({ ...prev, address: e.target.value }))}
                  placeholder="آدرس پروژه"
                  rows={3}
                  required
                />
              </CustomerWorkflowField>

              <div className="grid grid-cols-1 gap-4">
                <CustomerWorkflowField label="شهر">
                  <ErpInput
                    type="text"
                    value={projectFormData.city}
                    onChange={(e) => setProjectFormData(prev => ({ ...prev, city: e.target.value }))}
                    placeholder="شهر"
                  />
                </CustomerWorkflowField>
              </div>

              <div>
                <EnhancedDropdown
                  label="نوع پروژه"
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
                  <CustomerWorkflowField label="نام مدیر پروژه">
                    <ErpInput
                      type="text"
                      value={projectFormData.projectManagerName}
                      onChange={(e) => setProjectFormData(prev => ({ ...prev, projectManagerName: e.target.value }))}
                      placeholder="نام مدیر پروژه"
                    />
                  </CustomerWorkflowField>

                  <CustomerWorkflowField label="شماره مدیر پروژه">
                    <ErpInput
                      type="text"
                      value={projectFormData.projectManagerNumber}
                      onChange={(e) => setProjectFormData(prev => ({ ...prev, projectManagerNumber: e.target.value }))}
                      placeholder="شماره تماس مدیر پروژه"
                    />
                  </CustomerWorkflowField>
                </div>
              </div>

              <div className="border-t border-[var(--sds-border-default)] pt-4">
                <h4 className="text-lg font-medium text-[var(--sds-text-primary)] mb-4 flex items-center gap-2">
                  <FaUser className="text-[var(--sds-info)]" />
                  اطلاعات بازاریاب
                </h4>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <CustomerWorkflowField label="نام بازاریاب">
                    <ErpInput
                      type="text"
                      value={projectFormData.marketerFirstName}
                      onChange={(e) => setProjectFormData(prev => ({ ...prev, marketerFirstName: e.target.value }))}
                      placeholder="نام بازاریاب"
                    />
                  </CustomerWorkflowField>

                  <CustomerWorkflowField label="نام خانوادگی بازاریاب">
                    <ErpInput
                      type="text"
                      value={projectFormData.marketerLastName}
                      onChange={(e) => setProjectFormData(prev => ({ ...prev, marketerLastName: e.target.value }))}
                      placeholder="نام خانوادگی بازاریاب"
                    />
                  </CustomerWorkflowField>

                  <CustomerWorkflowField label="شماره تماس بازاریاب" className="md:col-span-2">
                    <ErpInput
                      type="text"
                      value={projectFormData.marketerPhoneNumber}
                      onChange={(e) => setProjectFormData(prev => ({ ...prev, marketerPhoneNumber: e.target.value }))}
                      placeholder="شماره تماس بازاریاب"
                    />
                  </CustomerWorkflowField>
                </div>
              </div>

              <div className="flex items-center gap-4 pt-4">
                <ErpPressable
                  type="submit"
                  disabled={projectSaving}
                  tone="primary"
                  variant="solid"
                  className="inline-flex items-center gap-2 px-6 py-3"
                >
                  <FaSave className="h-4 w-4" />
                  {projectSaving ? 'در حال ذخیره…' : editingProject ? 'بروزرسانی' : 'افزودن'}
                </ErpPressable>
                <ErpPressable
                  type="button"
                  disabled={projectSaving}
                  onClick={() => setShowAddProjectModal(false)}
                  variant="ghost"
                  className="px-6 py-3"
                >
                  انصراف
                </ErpPressable>
              </div>
            </form>
      </ErpSheet>

      {/* Add/Edit Contact Modal */}
      <ErpSheet
        open={showAddContactModal}
        pending={contactSaving}
        onClose={() => setShowAddContactModal(false)}
        title={editingContact ? 'ویرایش مخاطب' : 'افزودن مخاطب'}
        presentation="modal"
      >
            <form onSubmit={handleSubmitContact} className="space-y-4">
              {contactSubmitError && <ErpInlineState kind="error" title={contactSubmitError} />}
              <div className="grid grid-cols-2 gap-4">
                <CustomerWorkflowField label="نام" required>
                  <ErpInput
                    type="text"
                    value={contactFormData.firstName}
                    onChange={(e) => setContactFormData(prev => ({ ...prev, firstName: e.target.value }))}
                    placeholder="نام"
                    required
                  />
                </CustomerWorkflowField>
                <CustomerWorkflowField label="نام خانوادگی" required>
                  <ErpInput
                    type="text"
                    value={contactFormData.lastName}
                    onChange={(e) => setContactFormData(prev => ({ ...prev, lastName: e.target.value }))}
                    placeholder="نام خانوادگی"
                    required
                  />
                </CustomerWorkflowField>
              </div>

              <CustomerWorkflowField label="سمت">
                <ErpInput
                  type="text"
                  value={contactFormData.position}
                  onChange={(e) => setContactFormData(prev => ({ ...prev, position: e.target.value }))}
                  placeholder="سمت"
                />
              </CustomerWorkflowField>

              <CustomerWorkflowField label="ایمیل">
                <ErpInput
                  type="email"
                  value={contactFormData.email}
                  onChange={(e) => setContactFormData(prev => ({ ...prev, email: e.target.value }))}
                  placeholder="ایمیل"
                />
              </CustomerWorkflowField>

              <CustomerWorkflowField label="شماره تماس">
                <ErpInput
                  type="tel"
                  value={contactFormData.phone}
                  onChange={(e) => setContactFormData(prev => ({ ...prev, phone: e.target.value }))}
                  placeholder="شماره تماس"
                />
              </CustomerWorkflowField>

              <ErpCheckbox
                  checked={contactFormData.isPrimary}
                  onChange={(e) => setContactFormData(prev => ({ ...prev, isPrimary: e.target.checked }))}
                  label="مخاطب اصلی"
                />

              <div className="flex items-center gap-4 pt-4">
                <ErpPressable
                  type="submit"
                  disabled={contactSaving}
                  tone="primary"
                  variant="solid"
                  className="inline-flex items-center gap-2 px-6 py-3"
                >
                  <FaSave className="h-4 w-4" />
                  {contactSaving ? 'در حال ذخیره…' : editingContact ? 'بروزرسانی' : 'افزودن'}
                </ErpPressable>
                <ErpPressable
                  type="button"
                  disabled={contactSaving}
                  onClick={() => setShowAddContactModal(false)}
                  variant="ghost"
                  className="px-6 py-3"
                >
                  انصراف
                </ErpPressable>
              </div>
            </form>
      </ErpSheet>
      <CustomerRemovalConfirmation open={Boolean(removal)} title={removal?.kind === 'project' ? 'حذف آدرس پروژه' : 'حذف مخاطب'}
        description={removal?.kind === 'project' ? 'آیا از حذف این آدرس پروژه اطمینان دارید؟' : 'آیا از حذف این مخاطب اطمینان دارید؟'}
        pending={removing} error={removalError} onClose={() => setRemoval(null)}
        onConfirm={async () => {
          if (!removal || removing) return;
          setRemoving(true);
          setRemovalError(null);
          try {
            const removed = removal.kind === 'project'
              ? await handleDeleteProject(removal.id, true)
              : await handleDeleteContact(removal.id, true);
            if (removed) setRemoval(null);
            else setRemovalError('حذف ناموفق بود؛ دوباره تلاش کنید.');
          } finally { setRemoving(false); }
        }} />
    </CustomerWorkflowPage>
  );
}
