'use client';

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

type CustomerType = 'Individual' | 'Company' | 'Government';
type CustomerStatus = 'Active' | 'Inactive' | 'Prospect' | 'Lead';
type PhoneType = 'MOBILE' | 'HOME' | 'WORK' | 'OTHER';

interface EditableProject {
  id?: string;
  address: string;
  city: string;
  postalCode: string;
  projectName: string;
  projectType: string;
  projectManagerName: string;
  projectManagerNumber: string;
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
  isActive: true
});

const emptyPhone = (isPrimary = false): EditablePhone => ({
  number: '',
  type: 'MOBILE',
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

const inputClass = 'w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500';
const labelClass = 'block text-sm font-medium text-gray-300 mb-2';

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
    isBlacklisted: false,
    isLocked: false
  });
  const [projects, setProjects] = useState<EditableProject[]>([]);
  const [phones, setPhones] = useState<EditablePhone[]>([]);
  const [contacts, setContacts] = useState<EditableContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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
          isActive: project.isActive !== false
        })));

        setPhones((customer.phoneNumbers || []).map((phone: any) => ({
          id: phone.id,
          number: phone.number || '',
          type: phone.type || 'MOBILE',
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
    setFormData((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: '' }));
  };

  const updateProject = (index: number, field: keyof EditableProject, value: any) => {
    setProjects((prev) => prev.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item));
  };

  const updatePhone = (index: number, field: keyof EditablePhone, value: any) => {
    setPhones((prev) => prev.map((item, itemIndex) => {
      if (field === 'isPrimary' && value) {
        return { ...item, isPrimary: itemIndex === index };
      }
      return itemIndex === index ? { ...item, [field]: value } : item;
    }));
  };

  const updateContact = (index: number, field: keyof EditableContact, value: any) => {
    setContacts((prev) => prev.map((item, itemIndex) => {
      if (field === 'isPrimary' && value) {
        return { ...item, isPrimary: itemIndex === index };
      }
      return itemIndex === index ? { ...item, [field]: value } : item;
    }));
  };

  const removeProject = (index: number) => {
    const activeCount = projects.filter((project) => project.isActive).length;
    if (projects[index].isActive && activeCount === 1 && !confirm('این آخرین پروژه فعال مشتری است. حذف شود؟')) {
      return;
    }
    setProjects((prev) => prev.map((project, itemIndex) => itemIndex === index ? { ...project, isActive: false } : project));
  };

  const removePhone = (index: number) => {
    const activeCount = phones.filter((phone) => phone.isActive).length;
    if (phones[index].isActive && activeCount <= 1) {
      setErrors((prev) => ({ ...prev, phones: 'حداقل یک شماره تماس فعال برای مشتری الزامی است' }));
      return;
    }
    setPhones((prev) => prev.map((phone, itemIndex) => itemIndex === index ? { ...phone, isActive: false, isPrimary: false } : phone));
  };

  const removeContact = (index: number) => {
    setContacts((prev) => prev.map((contact, itemIndex) => itemIndex === index ? { ...contact, isActive: false, isPrimary: false } : contact));
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

    const invalidProject = projects.find((project) => project.isActive && (!project.address.trim() || !project.city.trim()));
    if (invalidProject) {
      nextErrors.projects = 'برای پروژه‌های فعال، آدرس و شهر الزامی است';
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

    try {
      setSaving(true);
      setError(null);
      await crmAPI.updateCustomer(customerId, {
        firstName: formData.firstName.trim(),
        lastName: formData.lastName.trim(),
        customerType: formData.customerType,
        status: formData.status,
        nationalCode: formData.nationalCode.trim() || null,
        companyName: formData.companyName.trim() || null,
        industry: formData.industry.trim() || null,
        brandName: formData.brandName.trim() || null,
        brandNameDescription: formData.brandNameDescription.trim() || null,
        homeAddress: formData.homeAddress.trim() || null,
        homeNumber: formData.homeNumber.trim() || null,
        workAddress: formData.workAddress.trim() || null,
        workNumber: formData.workNumber.trim() || null,
        projectManagerName: formData.projectManagerName.trim() || null,
        projectManagerNumber: formData.projectManagerNumber.trim() || null,
        isBlacklisted: formData.isBlacklisted,
        isLocked: formData.isLocked
      });

      await Promise.all([
        ...projects.map((project) => {
          if (!project.isActive && project.id) return crmAPI.deleteProjectAddress(customerId, project.id);
          if (!project.isActive) return Promise.resolve();
          const payload = {
            address: project.address.trim(),
            city: project.city.trim(),
            postalCode: project.postalCode.trim() || null,
            projectName: project.projectName.trim() || null,
            projectType: project.projectType.trim() || null,
            projectManagerName: project.projectManagerName.trim() || null,
            projectManagerNumber: project.projectManagerNumber.trim() || null
          };
          return project.id
            ? crmAPI.updateProjectAddress(customerId, project.id, payload)
            : crmAPI.addProjectAddress(customerId, payload);
        }),
        ...phones.map((phone) => {
          if (!phone.isActive && phone.id) return crmAPI.deletePhoneNumber(customerId, phone.id);
          if (!phone.isActive) return Promise.resolve();
          const payload = {
            number: phone.number.trim(),
            type: phone.type,
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
            phone: contact.phone.trim() || null,
            mobile: contact.mobile.trim() || null,
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
      setError(err.response?.data?.error || 'خطا در ذخیره اطلاعات مشتری');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-500"></div>
      </div>
    );
  }

  if (error && !formData.firstName) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="glass-liquid-card p-6 text-center">
          <FaExclamationTriangle className="mx-auto text-4xl text-red-400 mb-4" />
          <h2 className="text-xl font-semibold text-white mb-2">خطا در دریافت اطلاعات</h2>
          <p className="text-gray-400 mb-4">{error}</p>
          <Link href="/dashboard/crm/customers" className="glass-liquid-btn-primary px-6 py-2">
            بازگشت به لیست
          </Link>
        </div>
      </div>
    );
  }

  if (!permissions.canEditCustomers) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="glass-liquid-card p-6 text-center">
          <FaExclamationTriangle className="mx-auto text-4xl text-red-400 mb-4" />
          <h2 className="text-xl font-semibold text-white mb-2">عدم دسترسی</h2>
          <p className="text-gray-400">شما دسترسی لازم برای ویرایش مشتری را ندارید</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">ویرایش مشتری</h1>
          <p className="text-gray-300">{formData.firstName} {formData.lastName}</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => router.push(returnPath)} className="glass-liquid-btn px-6 py-3">
            بازگشت
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="glass-liquid-btn-primary inline-flex items-center gap-2 px-6 py-3 disabled:opacity-50"
          >
            <FaSave className="text-lg" />
            {saving ? 'در حال ذخیره...' : 'ذخیره تغییرات'}
          </button>
        </div>
      </div>

      {error && (
        <div className="glass-liquid-card p-4 border border-red-500/40 text-red-300">
          {error}
        </div>
      )}

      <section className="glass-liquid-card p-6">
        <h2 className="text-xl font-semibold text-white mb-6 flex items-center gap-2">
          <FaUser className="text-teal-400" />
          اطلاعات پایه
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className={labelClass}>نام *</label>
            <input className={inputClass} value={formData.firstName} onChange={(e) => updateField('firstName', e.target.value)} />
            {errors.firstName && <p className="text-red-400 text-sm mt-1">{errors.firstName}</p>}
          </div>
          <div>
            <label className={labelClass}>نام خانوادگی *</label>
            <input className={inputClass} value={formData.lastName} onChange={(e) => updateField('lastName', e.target.value)} />
            {errors.lastName && <p className="text-red-400 text-sm mt-1">{errors.lastName}</p>}
          </div>
          <div>
            <label className={labelClass}>نوع مشتری</label>
            <select className={inputClass} value={formData.customerType} onChange={(e) => updateField('customerType', e.target.value as CustomerType)}>
              <option value="Individual">حقیقی</option>
              <option value="Company">حقوقی</option>
              <option value="Government">دولتی</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>وضعیت</label>
            <select className={inputClass} value={formData.status} onChange={(e) => updateField('status', e.target.value as CustomerStatus)}>
              <option value="Active">فعال</option>
              <option value="Inactive">غیرفعال</option>
              <option value="Prospect">بالقوه</option>
              <option value="Lead">سرنخ</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>کد ملی</label>
            <input className={inputClass} value={formData.nationalCode} maxLength={10} onChange={(e) => updateField('nationalCode', e.target.value)} />
            {errors.nationalCode && <p className="text-red-400 text-sm mt-1">{errors.nationalCode}</p>}
          </div>
          <div>
            <label className={labelClass}>صنعت</label>
            <input className={inputClass} value={formData.industry} onChange={(e) => updateField('industry', e.target.value)} />
          </div>
        </div>
      </section>

      <section className="glass-liquid-card p-6">
        <h2 className="text-xl font-semibold text-white mb-6 flex items-center gap-2">
          <FaBuilding className="text-blue-400" />
          اطلاعات تکمیلی
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className={labelClass}>نام شرکت / سازمان</label>
            <input className={inputClass} value={formData.companyName} onChange={(e) => updateField('companyName', e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>نام برند</label>
            <input className={inputClass} value={formData.brandName} onChange={(e) => updateField('brandName', e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <label className={labelClass}>توضیحات برند</label>
            <textarea className={inputClass} rows={3} value={formData.brandNameDescription} onChange={(e) => updateField('brandNameDescription', e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>آدرس منزل</label>
            <input className={inputClass} value={formData.homeAddress} onChange={(e) => updateField('homeAddress', e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>شماره منزل</label>
            <input className={inputClass} value={formData.homeNumber} onChange={(e) => updateField('homeNumber', e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>آدرس محل کار</label>
            <input className={inputClass} value={formData.workAddress} onChange={(e) => updateField('workAddress', e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>شماره محل کار</label>
            <input className={inputClass} value={formData.workNumber} onChange={(e) => updateField('workNumber', e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>نام مدیر پروژه</label>
            <input className={inputClass} value={formData.projectManagerName} onChange={(e) => updateField('projectManagerName', e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>شماره تماس مدیر پروژه</label>
            <input className={inputClass} value={formData.projectManagerNumber} onChange={(e) => updateField('projectManagerNumber', e.target.value)} />
          </div>
        </div>
      </section>

      <section className="glass-liquid-card p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-white flex items-center gap-2">
            <FaMapMarkerAlt className="text-orange-400" />
            پروژه‌ها
          </h2>
          <button onClick={() => setProjects((prev) => [...prev, emptyProject()])} className="glass-liquid-btn-primary inline-flex items-center gap-2 px-4 py-2">
            <FaPlus />
            افزودن پروژه
          </button>
        </div>
        {errors.projects && <p className="text-red-400 text-sm mb-4">{errors.projects}</p>}
        <div className="space-y-4">
          {projects.filter((project) => project.isActive).map((project, visibleIndex) => {
            const index = projects.findIndex((item) => item === project);
            return (
              <div key={project.id || index} className="p-4 rounded-lg bg-white/5 border border-white/10">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <input className={inputClass} placeholder="نام پروژه" value={project.projectName} onChange={(e) => updateProject(index, 'projectName', e.target.value)} />
                  <input className={inputClass} placeholder="شهر" value={project.city} onChange={(e) => updateProject(index, 'city', e.target.value)} />
                  <select className={inputClass} value={project.projectType} onChange={(e) => updateProject(index, 'projectType', e.target.value)}>
                    <option value="">انتخاب نوع پروژه</option>
                    {PROJECT_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <input className={inputClass} placeholder="نام مدیر پروژه" value={project.projectManagerName} onChange={(e) => updateProject(index, 'projectManagerName', e.target.value)} />
                  <input className={inputClass} placeholder="شماره مدیر پروژه" value={project.projectManagerNumber} onChange={(e) => updateProject(index, 'projectManagerNumber', e.target.value)} />
                  <textarea className={`${inputClass} md:col-span-2`} rows={2} placeholder="آدرس پروژه *" value={project.address} onChange={(e) => updateProject(index, 'address', e.target.value)} />
                </div>
                <button onClick={() => removeProject(index)} className="mt-3 text-red-300 hover:text-red-200 inline-flex items-center gap-2">
                  <FaTrash />
                  حذف پروژه {visibleIndex + 1}
                </button>
              </div>
            );
          })}
          {projects.filter((project) => project.isActive).length === 0 && (
            <p className="text-gray-400">هیچ پروژه فعالی برای این مشتری ثبت نشده است.</p>
          )}
        </div>
      </section>

      <section className="glass-liquid-card p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-white">شماره‌های تماس</h2>
          <button onClick={() => setPhones((prev) => [...prev, emptyPhone(prev.filter((phone) => phone.isActive).length === 0)])} className="glass-liquid-btn-primary inline-flex items-center gap-2 px-4 py-2">
            <FaPlus />
            افزودن شماره
          </button>
        </div>
        {errors.phones && <p className="text-red-400 text-sm mb-4">{errors.phones}</p>}
        <div className="space-y-4">
          {phones.filter((phone) => phone.isActive).map((phone, visibleIndex) => {
            const index = phones.findIndex((item) => item === phone);
            return (
              <div key={phone.id || index} className="grid grid-cols-1 md:grid-cols-4 gap-4 p-4 rounded-lg bg-white/5 border border-white/10">
                <input className={inputClass} placeholder="شماره تماس *" value={phone.number} onChange={(e) => updatePhone(index, 'number', e.target.value)} />
                <select className={inputClass} value={phone.type} onChange={(e) => updatePhone(index, 'type', e.target.value as PhoneType)}>
                  <option value="MOBILE">موبایل</option>
                  <option value="HOME">منزل</option>
                  <option value="WORK">محل کار</option>
                  <option value="OTHER">سایر</option>
                </select>
                <label className="flex items-center gap-2 text-gray-300">
                  <input type="checkbox" checked={phone.isPrimary} onChange={(e) => updatePhone(index, 'isPrimary', e.target.checked)} />
                  شماره اصلی
                </label>
                <button onClick={() => removePhone(index)} className="text-red-300 hover:text-red-200 inline-flex items-center gap-2">
                  <FaTrash />
                  حذف شماره {visibleIndex + 1}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      <section className="glass-liquid-card p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-white">مخاطبین</h2>
          <button onClick={() => setContacts((prev) => [...prev, emptyContact()])} className="glass-liquid-btn-primary inline-flex items-center gap-2 px-4 py-2">
            <FaPlus />
            افزودن مخاطب
          </button>
        </div>
        {errors.contacts && <p className="text-red-400 text-sm mb-4">{errors.contacts}</p>}
        <div className="space-y-4">
          {contacts.filter((contact) => contact.isActive).map((contact, visibleIndex) => {
            const index = contacts.findIndex((item) => item === contact);
            return (
              <div key={contact.id || index} className="p-4 rounded-lg bg-white/5 border border-white/10">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <input className={inputClass} placeholder="نام *" value={contact.firstName} onChange={(e) => updateContact(index, 'firstName', e.target.value)} />
                  <input className={inputClass} placeholder="نام خانوادگی *" value={contact.lastName} onChange={(e) => updateContact(index, 'lastName', e.target.value)} />
                  <input className={inputClass} placeholder="سمت" value={contact.position} onChange={(e) => updateContact(index, 'position', e.target.value)} />
                  <input className={inputClass} placeholder="ایمیل" value={contact.email} onChange={(e) => updateContact(index, 'email', e.target.value)} />
                  <input className={inputClass} placeholder="تلفن" value={contact.phone} onChange={(e) => updateContact(index, 'phone', e.target.value)} />
                  <input className={inputClass} placeholder="موبایل" value={contact.mobile} onChange={(e) => updateContact(index, 'mobile', e.target.value)} />
                </div>
                <div className="mt-3 flex items-center gap-6">
                  <label className="flex items-center gap-2 text-gray-300">
                    <input type="checkbox" checked={contact.isPrimary} onChange={(e) => updateContact(index, 'isPrimary', e.target.checked)} />
                    مخاطب اصلی
                  </label>
                  <button onClick={() => removeContact(index)} className="text-red-300 hover:text-red-200 inline-flex items-center gap-2">
                    <FaTrash />
                    حذف مخاطب {visibleIndex + 1}
                  </button>
                </div>
              </div>
            );
          })}
          {contacts.filter((contact) => contact.isActive).length === 0 && (
            <p className="text-gray-400">مخاطبی برای این مشتری ثبت نشده است.</p>
          )}
        </div>
      </section>

      <section className="glass-liquid-card p-6">
        <h2 className="text-xl font-semibold text-white mb-6">کنترل دسترسی</h2>
        <div className="flex flex-wrap gap-4">
          <button
            onClick={() => updateField('isBlacklisted', !formData.isBlacklisted)}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg ${formData.isBlacklisted ? 'bg-red-500/20 text-red-300' : 'bg-white/10 text-gray-300'}`}
          >
            {formData.isBlacklisted ? <FaBan /> : <FaCheckCircle />}
            {formData.isBlacklisted ? 'در لیست سیاه' : 'خارج از لیست سیاه'}
          </button>
          <button
            onClick={() => updateField('isLocked', !formData.isLocked)}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg ${formData.isLocked ? 'bg-orange-500/20 text-orange-300' : 'bg-white/10 text-gray-300'}`}
          >
            <FaLock />
            {formData.isLocked ? 'قفل‌شده' : 'باز'}
          </button>
        </div>
      </section>

      <div className="flex items-center justify-between pb-8">
        <button onClick={() => router.push(returnPath)} className="glass-liquid-btn inline-flex items-center gap-2 px-6 py-3">
          <FaArrowRight />
          انصراف
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="glass-liquid-btn-primary inline-flex items-center gap-2 px-6 py-3 disabled:opacity-50"
        >
          <FaSave />
          {saving ? 'در حال ذخیره...' : 'ذخیره تغییرات'}
        </button>
      </div>
    </div>
  );
}
