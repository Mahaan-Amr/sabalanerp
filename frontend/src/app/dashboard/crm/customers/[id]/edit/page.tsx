'use client';
import { ErpInlineState, ErpInput, ErpLoading, ErpPressable, ErpTextarea } from '@/components/erp';
import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  FaArrowRight,
  FaBan,
  FaBuilding,
  FaCheckCircle,
  FaExclamationTriangle,
  FaLock,
  FaMapMarkerAlt,
  FaPlus,
  FaSave,
  FaTrash,
  FaUser
} from 'react-icons/fa';
import { crmAPI, dashboardAPI } from '@/lib/api';
import { getCrmPermissions, User as PermissionUser } from '@/lib/permissions';
import { PROJECT_TYPE_OPTIONS } from '@/lib/projectTypes';
import { CustomerWorkflowPage, CustomerWorkflowSection } from '@/features/crm/customer-workflow/CustomerWorkflowUi';
import EnhancedDropdown from '@/components/EnhancedDropdown';
import { InlineFieldError, getBackendErrorMessage, mapBackendValidationErrors } from '@/lib/formErrors';
import {
  normalizeIranianMobile,
  normalizePhoneDigits,
  validateOptionalIranianMobile,
  validateRequiredIranianMobile
} from '@/lib/phoneFormat';

type CustomerType = 'Individual' | 'Company' | 'Government' | 'Collaborative';
type CustomerStatus = 'Active' | 'Inactive' | 'Prospect' | 'Lead';
type PhoneType = 'mobile' | 'home' | 'work' | 'other';

interface EditableProject {
  id?: string;
  address: string;
  city: string;
  postalCode: string;
  projectName: string;
  projectType: string;
  projectManagerName: string;
  projectManagerNumber: string;
  marketerFirstName: string;
  marketerLastName: string;
  marketerPhoneNumber: string;
  isActive: boolean;
}

interface EditablePhone {
  id?: string;
  number: string;
  type: PhoneType;
  isPrimary: boolean;
  isActive: boolean;
}

interface EditableContact {
  id?: string;
  firstName: string;
  lastName: string;
  position: string;
  email: string;
  phone: string;
  mobile: string;
  isPrimary: boolean;
  isActive: boolean;
}

interface CustomerFormData {
  firstName: string;
  lastName: string;
  customerType: CustomerType;
  status: CustomerStatus;
  nationalCode: string;
  companyName: string;
  industry: string;
  brandName: string;
  brandNameDescription: string;
  homeAddress: string;
  homeNumber: string;
  workAddress: string;
  workNumber: string;
  projectManagerName: string;
  projectManagerNumber: string;
  referrerFirstName: string;
  referrerLastName: string;
  referrerPhoneNumber: string;
  isBlacklisted: boolean;
  isLocked: boolean;
}

const emptyProject = (): EditableProject => ({
  address: '',
  city: '',
  postalCode: '',
  projectName: '',
  projectType: '',
  projectManagerName: '',
  projectManagerNumber: '',
  marketerFirstName: '',
  marketerLastName: '',
  marketerPhoneNumber: '',
  isActive: true
});

const emptyPhone = (isPrimary = false): EditablePhone => ({
  number: '',
  type: 'mobile',
  isPrimary,
  isActive: true
});

const emptyContact = (): EditableContact => ({
  firstName: '',
  lastName: '',
  position: '',
  email: '',
  phone: '',
  mobile: '',
  isPrimary: false,
  isActive: true
});

const inputClass = 'w-full px-4 py-3 bg-[var(--sds-surface-raised)] border border-[var(--sds-border-default)] rounded-lg text-[var(--sds-text-primary)] placeholder:text-[var(--sds-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--sds-focus-ring)]';
const labelClass = 'block text-sm font-medium text-[var(--sds-text-muted)] mb-2';
const normalizePhoneTypeValue = (value: unknown): PhoneType => {
  const normalized = String(value || '').toLowerCase();
  return ['mobile', 'home', 'work', 'other'].includes(normalized) ? normalized as PhoneType : 'mobile';
};
export default function EditCustomerPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const customerId = params.id as string;

  const [currentUser, setCurrentUser] = useState<PermissionUser | null>(null);
  const [formData, setFormData] = useState<CustomerFormData>({
    firstName: '',
    lastName: '',
    customerType: 'Individual',
    status: 'Active',
    nationalCode: '',
    companyName: '',
    industry: '',
    brandName: '',
    brandNameDescription: '',
    homeAddress: '',
    homeNumber: '',
    workAddress: '',
    workNumber: '',
    projectManagerName: '',
    projectManagerNumber: '',
    referrerFirstName: '',
    referrerLastName: '',
    referrerPhoneNumber: '',
    isBlacklisted: false,
    isLocked: false
  });
  const [projects, setProjects] = useState<EditableProject[]>([]);
  const [phones, setPhones] = useState<EditablePhone[]>([]);
  const [contacts, setContacts] = useState<EditableContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const permissions = useMemo(() => getCrmPermissions(currentUser), [currentUser]);

  const returnPath = useMemo(() => {
    const returnTo = searchParams.get('returnTo');
    const step = searchParams.get('step');
    if (returnTo === 'contract' && step) {
      return `/dashboard/sales/contracts/create?returnTo=contract&step=${step}`;
    }
    return `/dashboard/crm/customers/${customerId}`;
  }, [customerId, searchParams]);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const [profileResponse, customerResponse] = await Promise.all([
          dashboardAPI.getProfile(),
          crmAPI.getCustomer(customerId)
        ]);

        if (profileResponse.data.success) {
          setCurrentUser(profileResponse.data.data);
        }

        if (!customerResponse.data.success) {
          setError('مشتری یافت نشد');
          return;
        }

        const customer = customerResponse.data.data;
        setFormData({
          firstName: customer.firstName || '',
          lastName: customer.lastName || '',
          customerType: customer.customerType || 'Individual',
          status: customer.status || 'Active',
          nationalCode: customer.nationalCode || '',
          companyName: customer.companyName || '',
          industry: customer.industry || '',
          brandName: customer.brandName || '',
          brandNameDescription: customer.brandNameDescription || '',
          homeAddress: customer.homeAddress || '',
          homeNumber: customer.homeNumber || '',
          workAddress: customer.workAddress || '',
          workNumber: customer.workNumber || '',
          projectManagerName: customer.projectManagerName || '',
          projectManagerNumber: customer.projectManagerNumber || '',
          referrerFirstName: customer.referrerFirstName || '',
          referrerLastName: customer.referrerLastName || '',
          referrerPhoneNumber: customer.referrerPhoneNumber || '',
          isBlacklisted: Boolean(customer.isBlacklisted),
          isLocked: Boolean(customer.isLocked)
        });

        setProjects((customer.projectAddresses || []).map((project: any) => ({
          id: project.id,
          address: project.address || '',
          city: project.city || '',
          postalCode: project.postalCode || '',
          projectName: project.projectName || '',
          projectType: project.projectType || '',
          projectManagerName: project.projectManagerName || '',
          projectManagerNumber: project.projectManagerNumber || '',
          marketerFirstName: project.marketerFirstName || '',
          marketerLastName: project.marketerLastName || '',
          marketerPhoneNumber: project.marketerPhoneNumber || '',
          isActive: project.isActive !== false
        })));

        setPhones((customer.phoneNumbers || []).map((phone: any) => ({
          id: phone.id,
          number: phone.number || '',
          type: normalizePhoneTypeValue(phone.type),
          isPrimary: Boolean(phone.isPrimary),
          isActive: phone.isActive !== false
        })));

        setContacts((customer.contacts || []).map((contact: any) => ({
          id: contact.id,
          firstName: contact.firstName || '',
          lastName: contact.lastName || '',
          position: contact.position || '',
          email: contact.email || '',
          phone: contact.phone || '',
          mobile: contact.mobile || '',
          isPrimary: Boolean(contact.isPrimary),
          isActive: contact.isActive !== false
        })));
      } catch (err: any) {
        console.error('Error loading customer edit data:', err);
        setError(err.response?.data?.error || 'خطا در دریافت اطلاعات مشتری');
      } finally {
        setLoading(false);
      }
    };

    if (customerId) load();
  }, [customerId]);

  const updateField = (field: keyof CustomerFormData, value: any) => {
    const nextValue =
      field === 'projectManagerNumber'
        || field === 'referrerPhoneNumber'
        ? normalizeIranianMobile(value)
        : field === 'nationalCode' || field === 'homeNumber' || field === 'workNumber'
          ? normalizePhoneDigits(value)
          : value;
    setFormData((prev) => ({ ...prev, [field]: nextValue }));
    setDirty(true);
    setErrors((prev) => ({ ...prev, [field]: '' }));
  };

  const updateProject = (index: number, field: keyof EditableProject, value: any) => {
    const nextValue = field === 'projectManagerNumber' || field === 'marketerPhoneNumber' ? normalizeIranianMobile(value) : value;
    setProjects((prev) => prev.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: nextValue } : item));
    setDirty(true);
  };

  const updatePhone = (index: number, field: keyof EditablePhone, value: any) => {
    const nextValue = field === 'number' ? normalizeIranianMobile(value) : value;
    setPhones((prev) => prev.map((item, itemIndex) => {
      if (field === 'isPrimary' && nextValue) {
        return { ...item, isPrimary: itemIndex === index };
      }
      return itemIndex === index ? { ...item, [field]: nextValue } : item;
    }));
    setDirty(true);
  };

  const updateContact = (index: number, field: keyof EditableContact, value: any) => {
    const nextValue =
      field === 'mobile'
        ? normalizeIranianMobile(value)
        : field === 'phone'
          ? normalizePhoneDigits(value)
          : value;
    setContacts((prev) => prev.map((item, itemIndex) => {
      if (field === 'isPrimary' && nextValue) {
        return { ...item, isPrimary: itemIndex === index };
      }
      return itemIndex === index ? { ...item, [field]: nextValue } : item;
    }));
    setDirty(true);
  };

  const removeProject = (index: number) => {
    const activeCount = projects.filter((project) => project.isActive).length;
    if (projects[index].isActive && activeCount === 1 && !confirm('این آخرین پروژه فعال مشتری است. حذف شود؟')) {
      return;
    }
    setProjects((prev) => prev.map((project, itemIndex) => itemIndex === index ? { ...project, isActive: false } : project));
    setDirty(true);
  };

  const removePhone = (index: number) => {
    const activeCount = phones.filter((phone) => phone.isActive).length;
    if (phones[index].isActive && activeCount <= 1) {
      setErrors((prev) => ({ ...prev, phones: 'حداقل یک شماره تماس فعال برای مشتری الزامی است' }));
      return;
    }
    setPhones((prev) => prev.map((phone, itemIndex) => itemIndex === index ? { ...phone, isActive: false, isPrimary: false } : phone));
    setDirty(true);
  };

  const removeContact = (index: number) => {
    setContacts((prev) => prev.map((contact, itemIndex) => itemIndex === index ? { ...contact, isActive: false, isPrimary: false } : contact));
    setDirty(true);
  };

  const validate = () => {
    const nextErrors: Record<string, string> = {};
    if (!formData.firstName.trim()) nextErrors.firstName = 'نام الزامی است';
    if (!formData.lastName.trim()) nextErrors.lastName = 'نام خانوادگی الزامی است';
    if (formData.nationalCode && formData.nationalCode.length !== 10) {
      nextErrors.nationalCode = 'کد ملی باید ۱۰ رقم باشد';
    }

    const activePhones = phones.filter((phone) => phone.isActive);
    if (activePhones.length === 0 || activePhones.some((phone) => !phone.number.trim())) {
      nextErrors.phones = 'حداقل یک شماره تماس معتبر برای مشتری الزامی است';
    }

    const invalidProject = projects.find((project) => project.isActive && !project.address.trim());
    if (invalidProject) {
      nextErrors.projects = 'برای پروژه‌های فعال، آدرس الزامی است';
    }

    const invalidContact = contacts.find((contact) => contact.isActive && (!contact.firstName.trim() || !contact.lastName.trim()));
    if (invalidContact) {
      nextErrors.contacts = 'برای مخاطبین فعال، نام و نام خانوادگی الزامی است';
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    const phoneErrors: Record<string, string> = {};
    const customerManagerPhoneError = validateOptionalIranianMobile(formData.projectManagerNumber);
    const referrerPhoneError = validateOptionalIranianMobile(formData.referrerPhoneNumber);
    if (customerManagerPhoneError) phoneErrors.projectManagerNumber = customerManagerPhoneError;
    if (referrerPhoneError) phoneErrors.referrerPhoneNumber = referrerPhoneError;
    if (phones.some((phone) => phone.isActive && validateRequiredIranianMobile(phone.number))) {
      phoneErrors.phones = 'شماره‌های تماس باید ۱۱ رقم و با 09 شروع شوند';
    }
    if (projects.some((project) => project.isActive && (validateOptionalIranianMobile(project.projectManagerNumber) || validateOptionalIranianMobile(project.marketerPhoneNumber)))) {
      phoneErrors.projects = 'شماره مدیر پروژه یا بازاریاب باید ۱۱ رقم و با 09 شروع شود';
    }
    if (contacts.some((contact) => contact.isActive && validateOptionalIranianMobile(contact.mobile))) {
      phoneErrors.contacts = 'شماره موبایل مخاطب باید ۱۱ رقم و با 09 شروع شود';
    }
    if (Object.keys(phoneErrors).length > 0) {
      setErrors((prev) => ({ ...prev, ...phoneErrors }));
      return;
    }

    try {
      setSaving(true);
      setError(null);
      await crmAPI.updateCustomer(customerId, {
        firstName: formData.firstName.trim(),
        lastName: formData.lastName.trim(),
        customerType: formData.customerType,
        status: formData.status,
        nationalCode: normalizePhoneDigits(formData.nationalCode) || null,
        companyName: formData.companyName.trim() || null,
        industry: formData.industry.trim() || null,
        brandName: formData.brandName.trim() || null,
        brandNameDescription: formData.brandNameDescription.trim() || null,
        homeAddress: formData.homeAddress.trim() || null,
        homeNumber: normalizePhoneDigits(formData.homeNumber) || null,
        workAddress: formData.workAddress.trim() || null,
        workNumber: normalizePhoneDigits(formData.workNumber) || null,
        projectManagerName: formData.projectManagerName.trim() || null,
        projectManagerNumber: normalizeIranianMobile(formData.projectManagerNumber) || null,
        referrerFirstName: formData.referrerFirstName.trim() || null,
        referrerLastName: formData.referrerLastName.trim() || null,
        referrerPhoneNumber: normalizeIranianMobile(formData.referrerPhoneNumber) || null,
        isBlacklisted: formData.isBlacklisted,
        isLocked: formData.isLocked
      });

      await Promise.all([
        ...projects.map((project) => {
          if (!project.isActive && project.id) return crmAPI.deleteProjectAddress(customerId, project.id);
          if (!project.isActive) return Promise.resolve();
          const payload = {
            address: project.address.trim(),
            city: project.city.trim() || null,
            postalCode: project.postalCode.trim() || null,
            projectName: project.projectName.trim() || null,
            projectType: project.projectType.trim() || null,
            projectManagerName: project.projectManagerName.trim() || null,
            projectManagerNumber: normalizeIranianMobile(project.projectManagerNumber) || null,
            marketerFirstName: project.marketerFirstName.trim() || null,
            marketerLastName: project.marketerLastName.trim() || null,
            marketerPhoneNumber: normalizeIranianMobile(project.marketerPhoneNumber) || null
          };
          return project.id
            ? crmAPI.updateProjectAddress(customerId, project.id, payload)
            : crmAPI.addProjectAddress(customerId, payload);
        }),
        ...phones.map((phone) => {
          if (!phone.isActive && phone.id) return crmAPI.deletePhoneNumber(customerId, phone.id);
          if (!phone.isActive) return Promise.resolve();
          const payload = {
            number: normalizeIranianMobile(phone.number),
            type: normalizePhoneTypeValue(phone.type),
            isPrimary: phone.isPrimary
          };
          return phone.id
            ? crmAPI.updatePhoneNumber(customerId, phone.id, payload)
            : crmAPI.addPhoneNumber(customerId, payload);
        }),
        ...contacts.map((contact) => {
          if (!contact.isActive && contact.id) return crmAPI.deleteContact(customerId, contact.id);
          if (!contact.isActive) return Promise.resolve();
          const payload = {
            firstName: contact.firstName.trim(),
            lastName: contact.lastName.trim(),
            position: contact.position.trim() || null,
            email: contact.email.trim() || null,
            phone: normalizePhoneDigits(contact.phone) || null,
            mobile: normalizeIranianMobile(contact.mobile) || null,
            isPrimary: contact.isPrimary
          };
          return contact.id
            ? crmAPI.updateContact(customerId, contact.id, payload)
            : crmAPI.createContact(customerId, payload);
        })
      ]);

      router.push(returnPath);
    } catch (err: any) {
      console.error('Error saving customer:', err);
      const errorData = err.response?.data;
      const fieldErrors = mapBackendValidationErrors(errorData, {
        number: 'phones',
        mobile: 'contacts',
        projectManagerNumber: 'projectManagerNumber'
      });
      if (Object.keys(fieldErrors).length > 0) {
        setErrors((prev) => ({ ...prev, ...fieldErrors }));
      }
      setError(getBackendErrorMessage(errorData, 'خطا در ذخیره اطلاعات مشتری'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <ErpLoading />;

  if (error && !formData.firstName) {
    return (
      <CustomerWorkflowPage title="ویرایش مشتری" backHref="/dashboard/crm/customers">
        <ErpInlineState kind="error" title={error} action={{ label: 'بازگشت به لیست', href: '/dashboard/crm/customers' }} />
      </CustomerWorkflowPage>
    );
  }

  if (!permissions.canEditCustomers) {
    return (
      <CustomerWorkflowPage title="ویرایش مشتری" backHref="/dashboard/crm/customers">
        <ErpInlineState kind="permission" title="شما دسترسی لازم برای ویرایش مشتری را ندارید" />
      </CustomerWorkflowPage>
    );
  }

  return (
    <CustomerWorkflowPage
      title="ویرایش مشتری"
      description={`${formData.firstName} ${formData.lastName}`.trim()}
      backHref={returnPath}
      actions={[{ label: saving ? 'در حال ذخیره…' : 'ذخیره تغییرات', icon: FaSave, onClick: handleSave, disabled: saving }]}
      feedback={error ? { kind: 'error', title: error } : dirty ? { kind: 'stale', title: 'تغییرات ذخیره‌نشده دارید.' } : undefined}
    >

      <CustomerWorkflowSection>
        <h2 className="text-xl font-semibold text-[var(--sds-text-primary)] mb-6 flex items-center gap-2">
          <FaUser className="text-[var(--sds-accent)]" />
          اطلاعات پایه
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label htmlFor="customer-firstName" className={labelClass}>نام *</label>
            <ErpInput id="customer-firstName" aria-invalid={Boolean(errors.firstName)} aria-describedby={errors.firstName ? 'customer-firstName-error' : undefined} className={inputClass} value={formData.firstName} onChange={(e) => updateField('firstName', e.target.value)} />
            {errors.firstName && <p id="customer-firstName-error" role="alert" className="text-[var(--sds-danger)] text-sm mt-1">{errors.firstName}</p>}
          </div>
          <div>
            <label htmlFor="customer-lastName" className={labelClass}>نام خانوادگی *</label>
            <ErpInput id="customer-lastName" aria-invalid={Boolean(errors.lastName)} aria-describedby={errors.lastName ? 'customer-lastName-error' : undefined} className={inputClass} value={formData.lastName} onChange={(e) => updateField('lastName', e.target.value)} />
            {errors.lastName && <p id="customer-lastName-error" role="alert" className="text-[var(--sds-danger)] text-sm mt-1">{errors.lastName}</p>}
          </div>
          <div>
            <label className={labelClass}>نوع مشتری</label>
            <EnhancedDropdown
              value={formData.customerType}
              onChange={(value) => updateField('customerType', value as CustomerType)}
              options={[
                { value: 'Individual', label: 'حقیقی' },
                { value: 'Company', label: 'حقوقی' },
                { value: 'Government', label: 'دولتی' },
                { value: 'Collaborative', label: 'همکاری' },
              ]}
              searchable
            />
          </div>
          <div>
            <label className={labelClass}>وضعیت</label>
            <EnhancedDropdown
              value={formData.status}
              onChange={(value) => updateField('status', value as CustomerStatus)}
              options={[
                { value: 'Active', label: 'فعال' },
                { value: 'Inactive', label: 'غیرفعال' },
                { value: 'Prospect', label: 'بالقوه' },
                { value: 'Lead', label: 'سرنخ' },
              ]}
              searchable
            />
          </div>
          <div>
            <label htmlFor="customer-nationalCode" className={labelClass}>کد ملی</label>
            <ErpInput id="customer-nationalCode" aria-invalid={Boolean(errors.nationalCode)} aria-describedby={errors.nationalCode ? 'customer-nationalCode-error' : undefined} className={inputClass} value={formData.nationalCode} maxLength={10} onChange={(e) => updateField('nationalCode', e.target.value)} />
            {errors.nationalCode && <p id="customer-nationalCode-error" role="alert" className="text-[var(--sds-danger)] text-sm mt-1">{errors.nationalCode}</p>}
          </div>
          <div>
            <label className={labelClass}>صنعت</label>
            <ErpInput className={inputClass} value={formData.industry} onChange={(e) => updateField('industry', e.target.value)} />
          </div>
        </div>
      </CustomerWorkflowSection>

      <CustomerWorkflowSection>
        <h2 className="text-xl font-semibold text-[var(--sds-text-primary)] mb-6 flex items-center gap-2">
          <FaBuilding className="text-[var(--sds-info)]" />
          اطلاعات تکمیلی
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className={labelClass}>نام شرکت / سازمان</label>
            <ErpInput className={inputClass} value={formData.companyName} onChange={(e) => updateField('companyName', e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>نام برند</label>
            <ErpInput className={inputClass} value={formData.brandName} onChange={(e) => updateField('brandName', e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <label className={labelClass}>توضیحات برند</label>
            <ErpTextarea className={inputClass} rows={3} value={formData.brandNameDescription} onChange={(e) => updateField('brandNameDescription', e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>آدرس منزل</label>
            <ErpInput className={inputClass} value={formData.homeAddress} onChange={(e) => updateField('homeAddress', e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>شماره منزل</label>
            <ErpInput className={inputClass} value={formData.homeNumber} onChange={(e) => updateField('homeNumber', e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>آدرس محل کار</label>
            <ErpInput className={inputClass} value={formData.workAddress} onChange={(e) => updateField('workAddress', e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>شماره محل کار</label>
            <ErpInput className={inputClass} value={formData.workNumber} onChange={(e) => updateField('workNumber', e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>نام مدیر پروژه</label>
            <ErpInput className={inputClass} value={formData.projectManagerName} onChange={(e) => updateField('projectManagerName', e.target.value)} />
          </div>
          <div>
            <label htmlFor="customer-projectManagerNumber" className={labelClass}>شماره تماس مدیر پروژه</label>
            <ErpInput id="customer-projectManagerNumber" aria-invalid={Boolean(errors.projectManagerNumber)} aria-describedby={errors.projectManagerNumber ? 'customer-projectManagerNumber-error' : undefined} className={inputClass} value={formData.projectManagerNumber} onChange={(e) => updateField('projectManagerNumber', e.target.value)} />
            <InlineFieldError id="customer-projectManagerNumber-error" message={errors.projectManagerNumber} />
          </div>
          <div>
            <label className={labelClass}>نام معرف</label>
            <ErpInput className={inputClass} value={formData.referrerFirstName} onChange={(e) => updateField('referrerFirstName', e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>نام خانوادگی معرف</label>
            <ErpInput className={inputClass} value={formData.referrerLastName} onChange={(e) => updateField('referrerLastName', e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <label htmlFor="customer-referrerPhoneNumber" className={labelClass}>شماره تماس معرف</label>
            <ErpInput id="customer-referrerPhoneNumber" aria-invalid={Boolean(errors.referrerPhoneNumber)} aria-describedby={errors.referrerPhoneNumber ? 'customer-referrerPhoneNumber-error' : undefined} className={inputClass} value={formData.referrerPhoneNumber} onChange={(e) => updateField('referrerPhoneNumber', e.target.value)} />
            <InlineFieldError id="customer-referrerPhoneNumber-error" message={errors.referrerPhoneNumber} />
          </div>
        </div>
      </CustomerWorkflowSection>

      <CustomerWorkflowSection>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-[var(--sds-text-primary)] flex items-center gap-2">
            <FaMapMarkerAlt className="text-[var(--sds-warning)]" />
            پروژه‌ها
          </h2>
          <ErpPressable type="button" onClick={() => setProjects((prev) => [...prev, emptyProject()])} tone="primary" variant="solid" className="inline-flex items-center gap-2 px-4 py-2">
            <FaPlus />
            افزودن پروژه
          </ErpPressable>
        </div>
        {errors.projects && <p className="text-[var(--sds-danger)] text-sm mb-4">{errors.projects}</p>}
        <div className="space-y-4">
          {projects.filter((project) => project.isActive).map((project, visibleIndex) => {
            const index = projects.findIndex((item) => item === project);
            return (
              <div key={project.id || index} className="p-4 rounded-lg bg-[var(--sds-surface-raised)] border border-[var(--sds-border-default)]">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <ErpInput className={inputClass} placeholder="نام پروژه" value={project.projectName} onChange={(e) => updateProject(index, 'projectName', e.target.value)} />
                  <ErpInput className={inputClass} placeholder="شهر" value={project.city} onChange={(e) => updateProject(index, 'city', e.target.value)} />
                  <EnhancedDropdown
                    value={project.projectType}
                    onChange={(value) => updateProject(index, 'projectType', value)}
                    placeholder="انتخاب نوع پروژه"
                    options={PROJECT_TYPE_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
                    searchable
                    clearable
                    noOptionsText="نوع پروژه‌ای پیدا نشد"
                  />
                  <ErpInput className={inputClass} placeholder="نام مدیر پروژه" value={project.projectManagerName} onChange={(e) => updateProject(index, 'projectManagerName', e.target.value)} />
                  <ErpInput className={inputClass} placeholder="شماره مدیر پروژه" value={project.projectManagerNumber} onChange={(e) => updateProject(index, 'projectManagerNumber', e.target.value)} />
                  <ErpInput className={inputClass} placeholder="نام بازاریاب" value={project.marketerFirstName} onChange={(e) => updateProject(index, 'marketerFirstName', e.target.value)} />
                  <ErpInput className={inputClass} placeholder="نام خانوادگی بازاریاب" value={project.marketerLastName} onChange={(e) => updateProject(index, 'marketerLastName', e.target.value)} />
                  <ErpInput className={inputClass} placeholder="شماره تماس بازاریاب" value={project.marketerPhoneNumber} onChange={(e) => updateProject(index, 'marketerPhoneNumber', e.target.value)} />
                  <ErpTextarea className={`${inputClass} md:col-span-2`} rows={2} placeholder="آدرس پروژه *" value={project.address} onChange={(e) => updateProject(index, 'address', e.target.value)} />
                </div>
                <ErpPressable type="button" onClick={() => removeProject(index)} tone="danger" variant="ghost" className="mt-3 inline-flex items-center gap-2">
                  <FaTrash />
                  حذف پروژه {visibleIndex + 1}
                </ErpPressable>
              </div>
            );
          })}
          {projects.filter((project) => project.isActive).length === 0 && (
            <p className="text-[var(--sds-text-muted)]">هیچ پروژه فعالی برای این مشتری ثبت نشده است.</p>
          )}
        </div>
      </CustomerWorkflowSection>

      <CustomerWorkflowSection>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-[var(--sds-text-primary)]">شماره‌های تماس</h2>
          <ErpPressable type="button" onClick={() => setPhones((prev) => [...prev, emptyPhone(prev.filter((phone) => phone.isActive).length === 0)])} tone="primary" variant="solid" className="inline-flex items-center gap-2 px-4 py-2">
            <FaPlus />
            افزودن شماره
          </ErpPressable>
        </div>
        {errors.phones && <p className="text-[var(--sds-danger)] text-sm mb-4">{errors.phones}</p>}
        <div className="space-y-4">
          {phones.filter((phone) => phone.isActive).map((phone, visibleIndex) => {
            const index = phones.findIndex((item) => item === phone);
            return (
              <div key={phone.id || index} className="grid grid-cols-1 md:grid-cols-4 gap-4 p-4 rounded-lg bg-[var(--sds-surface-raised)] border border-[var(--sds-border-default)]">
                <ErpInput className={inputClass} placeholder="شماره تماس *" value={phone.number} onChange={(e) => updatePhone(index, 'number', e.target.value)} />
                <EnhancedDropdown
                  value={phone.type}
                  onChange={(value) => updatePhone(index, 'type', value as PhoneType)}
                  options={[
                    { value: 'mobile', label: 'موبایل' },
                    { value: 'home', label: 'منزل' },
                    { value: 'work', label: 'محل کار' },
                    { value: 'other', label: 'سایر' },
                  ]}
                  searchable
                />
                <label className="flex items-center gap-2 text-[var(--sds-text-muted)]">
                  <ErpInput type="checkbox" checked={phone.isPrimary} onChange={(e) => updatePhone(index, 'isPrimary', e.target.checked)} />
                  شماره اصلی
                </label>
                <ErpPressable type="button" onClick={() => removePhone(index)} tone="danger" variant="ghost" className="inline-flex items-center gap-2">
                  <FaTrash />
                  حذف شماره {visibleIndex + 1}
                </ErpPressable>
              </div>
            );
          })}
        </div>
      </CustomerWorkflowSection>

      <CustomerWorkflowSection>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-[var(--sds-text-primary)]">مخاطبین</h2>
          <ErpPressable type="button" onClick={() => setContacts((prev) => [...prev, emptyContact()])} tone="primary" variant="solid" className="inline-flex items-center gap-2 px-4 py-2">
            <FaPlus />
            افزودن مخاطب
          </ErpPressable>
        </div>
        {errors.contacts && <p className="text-[var(--sds-danger)] text-sm mb-4">{errors.contacts}</p>}
        <div className="space-y-4">
          {contacts.filter((contact) => contact.isActive).map((contact, visibleIndex) => {
            const index = contacts.findIndex((item) => item === contact);
            return (
              <div key={contact.id || index} className="p-4 rounded-lg bg-[var(--sds-surface-raised)] border border-[var(--sds-border-default)]">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <ErpInput className={inputClass} placeholder="نام *" value={contact.firstName} onChange={(e) => updateContact(index, 'firstName', e.target.value)} />
                  <ErpInput className={inputClass} placeholder="نام خانوادگی *" value={contact.lastName} onChange={(e) => updateContact(index, 'lastName', e.target.value)} />
                  <ErpInput className={inputClass} placeholder="سمت" value={contact.position} onChange={(e) => updateContact(index, 'position', e.target.value)} />
                  <ErpInput className={inputClass} placeholder="ایمیل" value={contact.email} onChange={(e) => updateContact(index, 'email', e.target.value)} />
                  <ErpInput className={inputClass} placeholder="تلفن" value={contact.phone} onChange={(e) => updateContact(index, 'phone', e.target.value)} />
                  <ErpInput className={inputClass} placeholder="موبایل" value={contact.mobile} onChange={(e) => updateContact(index, 'mobile', e.target.value)} />
                </div>
                <div className="mt-3 flex items-center gap-6">
                  <label className="flex items-center gap-2 text-[var(--sds-text-muted)]">
                    <ErpInput type="checkbox" checked={contact.isPrimary} onChange={(e) => updateContact(index, 'isPrimary', e.target.checked)} />
                    مخاطب اصلی
                  </label>
                  <ErpPressable type="button" onClick={() => removeContact(index)} tone="danger" variant="ghost" className="inline-flex items-center gap-2">
                    <FaTrash />
                    حذف مخاطب {visibleIndex + 1}
                  </ErpPressable>
                </div>
              </div>
            );
          })}
          {contacts.filter((contact) => contact.isActive).length === 0 && (
            <p className="text-[var(--sds-text-muted)]">مخاطبی برای این مشتری ثبت نشده است.</p>
          )}
        </div>
      </CustomerWorkflowSection>

      <CustomerWorkflowSection>
        <h2 className="text-xl font-semibold text-[var(--sds-text-primary)] mb-6">کنترل دسترسی</h2>
        <div className="flex flex-wrap gap-4">
          <ErpPressable type="button"
            onClick={() => updateField('isBlacklisted', !formData.isBlacklisted)}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg ${formData.isBlacklisted ? 'bg-[var(--sds-danger-surface)] text-[var(--sds-danger)]' : 'bg-[var(--sds-surface-raised)] text-[var(--sds-text-muted)]'}`}
          >
            {formData.isBlacklisted ? <FaBan /> : <FaCheckCircle />}
            {formData.isBlacklisted ? 'در لیست سیاه' : 'خارج از لیست سیاه'}
          </ErpPressable>
          <ErpPressable type="button"
            onClick={() => updateField('isLocked', !formData.isLocked)}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg ${formData.isLocked ? 'bg-[var(--sds-warning-surface)] text-[var(--sds-warning)]' : 'bg-[var(--sds-surface-raised)] text-[var(--sds-text-muted)]'}`}
          >
            <FaLock />
            {formData.isLocked ? 'قفل‌شده' : 'باز'}
          </ErpPressable>
        </div>
      </CustomerWorkflowSection>

      <div className="flex items-center justify-between pb-8">
        <ErpPressable type="button" onClick={() => router.push(returnPath)} variant="ghost" className="inline-flex items-center gap-2 px-6 py-3">
          <FaArrowRight />
          انصراف
        </ErpPressable>
        <ErpPressable type="button"
          onClick={handleSave}
          disabled={saving}
          tone="primary"
          variant="solid"
          className="inline-flex items-center gap-2 px-6 py-3 disabled:opacity-50"
        >
          <FaSave />
          {saving ? 'در حال ذخیره...' : 'ذخیره تغییرات'}
        </ErpPressable>
      </div>
    </CustomerWorkflowPage>
  );
}
