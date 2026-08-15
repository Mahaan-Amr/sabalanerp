'use client';
import { ErpBadge, ErpButton, ErpCard, ErpInput, ErpPressable } from '@/components/erp';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  FaArrowRight,
  FaSave,
  FaPlus,
  FaTrash,
  FaPhone,
  FaMapMarkerAlt,
  FaUser,
  FaBuilding,
  FaExclamationTriangle,
  FaCheckCircle,
  FaTimes
} from 'react-icons/fa';
import { crmAPI, dashboardAPI } from '@/lib/api';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { getCrmPermissions, User as PermissionUser } from '@/lib/permissions';
import { PROJECT_TYPE_OPTIONS } from '@/lib/projectTypes';
import PersianCalendar from '@/lib/persian-calendar';
import PersianCalendarComponent from '@/components/PersianCalendar';
import EnhancedDropdown from '@/components/EnhancedDropdown';
import { InlineFieldError, mapAxiosFormErrors } from '@/lib/formErrors';
import {
  normalizeIranianMobile,
  normalizePhoneDigits,
  validateOptionalIranianMobile,
  validateRequiredIranianMobile
} from '@/lib/phoneFormat';
import { CustomerWorkflowPage, CustomerWorkflowSection } from '@/features/crm/customer-workflow/CustomerWorkflowUi';

interface ProjectAddress {
  id?: string;
  address: string;
  city: string;
  postalCode?: string;
  projectName?: string;
  projectType?: string;
  projectManagerName?: string;
  projectManagerNumber?: string;
}

interface PhoneNumber {
  id?: string;
  number: string;
  type: 'mobile' | 'home' | 'work' | 'other';
  isPrimary: boolean;
}

interface DuplicateCustomerSuggestion {
  id: string;
  firstName: string;
  lastName: string;
  companyName?: string | null;
  nationalCode?: string | null;
  ownerUser?: {
    id: string;
    firstName?: string | null;
    lastName?: string | null;
    username?: string | null;
  } | null;
  phoneNumbers?: Array<{
    id: string;
    number: string;
    type: string;
    isPrimary: boolean;
    isActive?: boolean;
  }>;
  projectAddresses?: ProjectAddress[];
}

interface CustomerFormData {
  // Basic Information
  firstName: string;
  lastName: string;
  customerType: 'Individual' | 'Company' | 'Government' | 'Collaborative';
  status: 'Active' | 'Inactive' | 'Prospect' | 'Lead';

  // Contact Information (Step 2)
  phoneNumber1: string;
  phoneNumber2: string;
  nationalCode: string;

  // Additional Information (Step 2.2 - Collapsible)
  companyName: string;
  brandName: string;
  homeAddress: string;
  homeNumber: string;
  workAddress: string;
  workNumber: string;
  whatsappNumber: string;
  birthDate: string;
  mainJob: string;
  referrerFirstName: string;
  referrerLastName: string;
  referrerPhoneNumber: string;

  // Project Information (Step 3)
  projectName: string;
  projectAddress: string;
  projectCity: string;
  projectType: string;

  // Project Manager Information (Step 3.2 - Collapsible)
  projectManagerName: string;
  projectManagerNumber: string;

  // Security & Access Control
  isBlacklisted: boolean;
  isLocked: boolean;

  // Related Data
  projectAddresses: ProjectAddress[];
  phoneNumbers: PhoneNumber[];
}

interface User extends PermissionUser {}

export default function CreateCustomerPage() {
  const router = useRouter();
  const { hasPermission } = useWorkspace();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [crmPermissions, setCrmPermissions] = useState({
    canViewCustomers: false,
    canCreateCustomers: false,
    canEditCustomers: false,
    canDeleteCustomers: false,
  });
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [duplicateCustomers, setDuplicateCustomers] = useState<DuplicateCustomerSuggestion[]>([]);
  const [step, setStep] = useState(0);
  const [showAdditionalInfo, setShowAdditionalInfo] = useState(false);

  useEffect(() => {
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

  const [formData, setFormData] = useState<CustomerFormData>({
    // Basic Information
    firstName: '',
    lastName: '',
    customerType: 'Individual',
    status: 'Active',

    // Contact Information (Step 2)
    phoneNumber1: '',
    phoneNumber2: '',
    nationalCode: '',

    // Additional Information (Step 2.2 - Collapsible)
    companyName: '',
    brandName: '',
    homeAddress: '',
    homeNumber: '',
    workAddress: '',
    workNumber: '',
    whatsappNumber: '',
    birthDate: '',
    mainJob: '',
    referrerFirstName: '',
    referrerLastName: '',
    referrerPhoneNumber: '',

    // Project Information (Step 3)
    projectName: '',
    projectAddress: '',
    projectCity: '',
    projectType: '',

    // Project Manager Information (Step 3.2 - Collapsible)
    projectManagerName: '',
    projectManagerNumber: '',

    // Security & Access Control
    isBlacklisted: false,
    isLocked: false,

    // Related Data
    projectAddresses: [],
    phoneNumbers: []
  });

  useEffect(() => {
    const requestedCustomerType = new URLSearchParams(window.location.search).get('customerType');
    if (requestedCustomerType === 'Collaborative') {
      setFormData(prev => ({ ...prev, customerType: 'Collaborative' }));
    }
  }, []);

  // Step configuration - New structure
  const isCollaborativeCustomer = formData.customerType === 'Collaborative';
  const steps = [
    { key: 'customerType', label: 'نوع مشتری', fields: ['customerType'] },
    { key: 'basic', label: 'اطلاعات پایه', fields: ['firstName', 'lastName', 'phoneNumber1', 'phoneNumber2', 'nationalCode'] },
    ...(isCollaborativeCustomer ? [] : [{ key: 'project', label: 'اطلاعات پروژه', fields: ['projectName', 'projectAddress', 'projectCity', 'projectType'] }])
  ];

  useEffect(() => {
    if (step >= steps.length) {
      setStep(Math.max(0, steps.length - 1));
    }
  }, [step, steps.length]);

  const validateStep = (stepIndex: number): boolean => {
    const currentStep = steps[stepIndex];
    const newErrors: Record<string, string> = {};

    // Validate required fields for each step
    if (currentStep.key === 'customerType') {
      // Customer type is now optional - no validation needed
    }

    if (currentStep.key === 'basic') {
      // Only these 3 fields are required in basic step
      if (!formData.firstName.trim()) newErrors.firstName = 'نام الزامی است';
      if (!formData.lastName.trim()) newErrors.lastName = 'نام خانوادگی الزامی است';
      const phone1Error = validateRequiredIranianMobile(formData.phoneNumber1);
      if (phone1Error) newErrors.phoneNumber1 = phone1Error;
      const phone2Error = validateOptionalIranianMobile(formData.phoneNumber2);
      if (phone2Error) newErrors.phoneNumber2 = phone2Error;
      if (duplicateCustomers.length > 0) {
        newErrors.phoneNumber1 = 'مشتری با این شماره تماس قبلا ثبت شده است.';
      }

      // Optional fields with validation if provided
      if (formData.nationalCode && formData.nationalCode.length !== 10) {
        newErrors.nationalCode = 'کد ملی باید 10 رقم باشد';
      }
      const referrerPhoneNumberError = validateOptionalIranianMobile(formData.referrerPhoneNumber);
      if (referrerPhoneNumberError) newErrors.referrerPhoneNumber = referrerPhoneNumberError;
    }

    if (currentStep.key === 'project') {
      // Only these 2 fields are required in project step
      if (!formData.projectName.trim()) newErrors.projectName = 'نام پروژه الزامی است';
      if (!formData.projectAddress.trim()) newErrors.projectAddress = 'آدرس پروژه الزامی است';

      // Project type is now optional - no validation needed
      const projectManagerNumberError = validateOptionalIranianMobile(formData.projectManagerNumber);
      if (projectManagerNumberError) newErrors.projectManagerNumber = projectManagerNumberError;
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleInputChange = (field: keyof CustomerFormData, value: any) => {
    const nextValue =
      field === 'phoneNumber1' ||
      field === 'phoneNumber2' ||
      field === 'whatsappNumber' ||
      field === 'projectManagerNumber' ||
      field === 'referrerPhoneNumber'
        ? normalizeIranianMobile(value)
        : field === 'nationalCode' || field === 'homeNumber' || field === 'workNumber'
          ? normalizePhoneDigits(value)
          : value;
    setFormData(prev => ({ ...prev, [field]: nextValue }));
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  useEffect(() => {
    const phoneNumber1 = normalizeIranianMobile(formData.phoneNumber1);
    const phoneNumber2 = normalizeIranianMobile(formData.phoneNumber2);
    const validPhoneNumbers = [phoneNumber1, phoneNumber2]
      .filter((phone, index, phones) => phone && /^09\d{9}$/.test(phone) && phones.indexOf(phone) === index)
      .map((phone) => ({ number: phone }));

    if (validPhoneNumbers.length === 0) {
      setDuplicateCustomers([]);
      setErrors((prev) => {
        if (!prev.phoneNumber1?.includes('قبلا ثبت شده') && !prev.phoneNumber2?.includes('قبلا ثبت شده')) return prev;
        const next = { ...prev };
        if (next.phoneNumber1?.includes('قبلا ثبت شده')) delete next.phoneNumber1;
        if (next.phoneNumber2?.includes('قبلا ثبت شده')) delete next.phoneNumber2;
        return next;
      });
      return;
    }

    const timeoutId = window.setTimeout(async () => {
      try {
        const response = await crmAPI.checkDuplicateCustomer({
          nationalCode: null,
          phoneNumbers: validPhoneNumbers
        });
        const matches = response.data?.data?.matches || [];
        setDuplicateCustomers(matches);
        setErrors((prev) => {
          const next = { ...prev };
          if (next.phoneNumber1?.includes('قبلا ثبت شده')) delete next.phoneNumber1;
          if (next.phoneNumber2?.includes('قبلا ثبت شده')) delete next.phoneNumber2;
          if (matches.length > 0) {
            next.phoneNumber1 = 'مشتری با این شماره تماس قبلا ثبت شده است.';
          }
          return next;
        });
      } catch (error) {
        console.error('Duplicate customer check failed:', error);
      }
    }, 450);

    return () => window.clearTimeout(timeoutId);
  }, [formData.phoneNumber1, formData.phoneNumber2]);

  const handleNext = () => {
    if (validateStep(step) && step < steps.length - 1) {
      setStep(step + 1);
    }
  };

  const handlePrevious = () => {
    if (step > 0) {
      setStep(step - 1);
    }
  };

  const addProjectAddress = () => {
    setFormData(prev => ({
      ...prev,
      projectAddresses: [...prev.projectAddresses, {
        address: '',
        city: '',
        postalCode: '',
        projectName: '',
        projectType: ''
      }]
    }));
  };

  const updateProjectAddress = (index: number, field: keyof ProjectAddress, value: string) => {
    setFormData(prev => ({
      ...prev,
      projectAddresses: prev.projectAddresses.map((addr, i) =>
        i === index ? { ...addr, [field]: value } : addr
      )
    }));
  };

  const removeProjectAddress = (index: number) => {
    setFormData(prev => ({
      ...prev,
      projectAddresses: prev.projectAddresses.filter((_, i) => i !== index)
    }));
  };

  const addPhoneNumber = () => {
    setFormData(prev => ({
      ...prev,
      phoneNumbers: [...prev.phoneNumbers, {
        number: '',
        type: 'mobile',
        isPrimary: prev.phoneNumbers.length === 0 // First phone is primary by default
      }]
    }));
  };

  const updatePhoneNumber = (index: number, field: keyof PhoneNumber, value: any) => {
    setFormData(prev => ({
      ...prev,
      phoneNumbers: prev.phoneNumbers.map((phone, i) => {
        if (i === index) {
          const updatedPhone = { ...phone, [field]: value };
          // If setting as primary, unset others
          if (field === 'isPrimary' && value) {
            return updatedPhone;
          }
          return updatedPhone;
        }
        // If another phone is being set as primary, unset this one
        if (field === 'isPrimary' && value && phone.isPrimary) {
          return { ...phone, isPrimary: false };
        }
        return phone;
      })
    }));
  };

  const removePhoneNumber = (index: number) => {
    setFormData(prev => ({
      ...prev,
      phoneNumbers: prev.phoneNumbers.filter((_, i) => i !== index)
    }));
  };

  const getOwnerLabel = (customer: DuplicateCustomerSuggestion) => {
    const ownerName = [customer.ownerUser?.firstName, customer.ownerUser?.lastName].filter(Boolean).join(' ').trim();
    return ownerName || customer.ownerUser?.username || 'بدون مسئول فروش';
  };

  const getContractReturnUrl = (stepParam: string | number = '2') => {
    const urlParams = new URLSearchParams(window.location.search);
    let contractKind = urlParams.get('contractKind');
    try {
      const savedStateRaw = localStorage.getItem('contractWizardState');
      const savedState = savedStateRaw ? JSON.parse(savedStateRaw) : null;
      contractKind = contractKind || savedState?.wizardData?.contractKind || null;
    } catch {
      // Fall back to the standard contract route.
    }
    const route = contractKind === 'collaboration'
      ? '/dashboard/sales/contracts/collaboration/create'
      : '/dashboard/sales/contracts/create';
    return `${route}?returnTo=contract&step=${stepParam}`;
  };

  const selectDuplicateForContract = (customer: DuplicateCustomerSuggestion) => {
    const urlParams = new URLSearchParams(window.location.search);
    const returnTo = urlParams.get('returnTo');
    const stepParam = urlParams.get('step') || '2';

    if (returnTo !== 'contract') return;

    try {
      const savedStateRaw = localStorage.getItem('contractWizardState');
      const savedState = savedStateRaw ? JSON.parse(savedStateRaw) : { currentStep: Number(stepParam), wizardData: {} };
      localStorage.setItem('contractWizardState', JSON.stringify({
        currentStep: Number(stepParam),
        wizardData: {
          ...savedState.wizardData,
          customerId: customer.id,
          customer: {
            ...customer,
            projectAddresses: customer.projectAddresses || [],
            phoneNumbers: customer.phoneNumbers || []
          }
        }
      }));
    } catch (error) {
      console.error('Error preparing duplicate customer selection:', error);
    }

    router.push(getContractReturnUrl(stepParam));
  };

  const handleSubmit = async () => {
    if (!validateStep(step)) return;
    const submitErrors: Record<string, string> = {};
    const phone1Error = validateRequiredIranianMobile(formData.phoneNumber1);
    const phone2Error = validateOptionalIranianMobile(formData.phoneNumber2);
    const projectManagerNumberError = validateOptionalIranianMobile(formData.projectManagerNumber);
    const referrerPhoneNumberError = validateOptionalIranianMobile(formData.referrerPhoneNumber);
    if (phone1Error) submitErrors.phoneNumber1 = phone1Error;
    if (phone2Error) submitErrors.phoneNumber2 = phone2Error;
    if (projectManagerNumberError) submitErrors.projectManagerNumber = projectManagerNumberError;
    if (referrerPhoneNumberError) submitErrors.referrerPhoneNumber = referrerPhoneNumberError;
    if (duplicateCustomers.length > 0) {
      submitErrors.phoneNumber1 = 'مشتری با این شماره تماس قبلا ثبت شده است.';
      submitErrors.submit = 'مشتری با این شماره تماس قبلا ثبت شده است. از مشتری‌های پیشنهادی انتخاب کنید یا شماره را اصلاح کنید.';
    }
    if (Object.keys(submitErrors).length > 0) {
      setErrors(submitErrors);
      return;
    }

    try {
      setLoading(true);
      setDuplicateCustomers([]);
      const phoneNumber1 = normalizeIranianMobile(formData.phoneNumber1);
      const phoneNumber2 = normalizeIranianMobile(formData.phoneNumber2);
      const projectManagerNumber = normalizeIranianMobile(formData.projectManagerNumber);
      const referrerPhoneNumber = normalizeIranianMobile(formData.referrerPhoneNumber);

      // Prepare data for API
      const customerData = {
        // Basic Information
        firstName: formData.firstName.trim(),
        lastName: formData.lastName.trim(),
        customerType: formData.customerType,
        status: formData.status,

        // Contact Information
        nationalCode: formData.nationalCode.trim() || null,
        homeAddress: formData.homeAddress.trim() || null,
        homeNumber: normalizePhoneDigits(formData.homeNumber) || null,
        workAddress: formData.workAddress.trim() || null,
        workNumber: normalizePhoneDigits(formData.workNumber) || null,

        // Additional Information
        companyName: formData.companyName.trim() || null,
        brandName: formData.brandName.trim() || null,
        whatsappNumber: normalizeIranianMobile(formData.whatsappNumber) || null,
        birthDate: formData.birthDate || null,
        mainJob: formData.mainJob.trim() || null,
        referrerFirstName: formData.referrerFirstName.trim() || null,
        referrerLastName: formData.referrerLastName.trim() || null,
        referrerPhoneNumber: referrerPhoneNumber || null,

        // Project Management
        projectManagerName: formData.projectManagerName.trim() || null,
        projectManagerNumber: projectManagerNumber || null,

        // Security & Access Control
        isBlacklisted: false,
        isLocked: false,

        // Create projectAddresses array from individual project fields
        projectAddresses: formData.projectName.trim() && formData.projectAddress.trim() ? [{
          address: formData.projectAddress.trim(),
          city: formData.projectCity.trim() || null,
          postalCode: null,
          projectName: formData.projectName.trim(),
          projectType: formData.projectType.trim() || null,
          projectManagerName: formData.projectManagerName.trim() || null,
          projectManagerNumber: projectManagerNumber || null
        }] : [],

        // Create phoneNumbers array from individual phone fields
        phoneNumbers: [
          ...(phoneNumber1 ? [{ number: phoneNumber1, type: 'mobile', isPrimary: true }] : []),
          ...(phoneNumber2 ? [{ number: phoneNumber2, type: 'mobile', isPrimary: false }] : [])
        ]
      };

      console.log('Sending customer data:', JSON.stringify(customerData, null, 2));
      const response = await crmAPI.createCustomer(customerData);

      if (response.data.success) {
        // Check if we should return to contract wizard
        const urlParams = new URLSearchParams(window.location.search);
        const returnTo = urlParams.get('returnTo');
        const step = urlParams.get('step');

        if (returnTo === 'contract' && step) {
          // Redirect back to contract wizard
          router.push(getContractReturnUrl(step));
        } else {
          // Default redirect to customers list
          router.push('/dashboard/crm/customers');
        }
      } else {
        setErrors({ submit: 'خطا در ایجاد مشتری' });
      }
    } catch (error: any) {
      console.error('Error creating customer:', error);
      if (error.response?.status === 409 && error.response?.data?.code === 'DUPLICATE_CUSTOMER') {
        const matches = error.response?.data?.data?.matches || [];
        setDuplicateCustomers(matches);
        setErrors({
          submit: 'مشتری با این شماره تماس یا کد ملی قبلا ثبت شده است. از مشتری‌های پیشنهادی انتخاب کنید.'
        });
      } else {
        const mappedErrors = mapAxiosFormErrors(error, 'خطا در ایجاد مشتری', {
          phoneNumbers: 'phoneNumber1',
          'phoneNumbers.0.number': 'phoneNumber1',
          'phoneNumbers[0].number': 'phoneNumber1',
          'phoneNumbers.1.number': 'phoneNumber2',
          'phoneNumbers[1].number': 'phoneNumber2',
          'projectAddresses.0.projectManagerNumber': 'projectManagerNumber',
          'projectAddresses[0].projectManagerNumber': 'projectManagerNumber'
        });
        const { general, ...fieldErrors } = mappedErrors;
        setErrors({ ...fieldErrors, submit: general || error.response?.data?.error || 'خطا در ایجاد مشتری' });
      }
    } finally {
      setLoading(false);
    }
  };

  const renderStepContent = () => {
    const currentStep = steps[step];

    switch (currentStep.key) {
      case 'customerType':
        return (
          <div className="space-y-6">
            <div className="text-center">
              <h3 className="text-xl font-semibold text-[var(--sds-text-primary)] mb-4">نوع مشتری را انتخاب کنید</h3>
              <p className="text-[var(--sds-text-muted)] mb-8">در این مرحله نوع مشتری را مشخص کنید تا فرم مناسب نمایش داده شود.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
              <ErpPressable
                type="button"
                onClick={() => handleInputChange('customerType', 'Individual')}
                className={`p-6 rounded-lg border-2 transition-all duration-200 ${
                  formData.customerType === 'Individual'
                    ? 'border-[var(--sds-border-strong)] bg-[var(--sds-accent)] text-[var(--sds-text-inverse)]'
                    : 'border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] text-[var(--sds-text-primary)] hover:border-[var(--sds-border-default)] hover:bg-[var(--sds-surface-raised)]'
                }`}
              >
                <div className="text-center">
                  <FaUser className="mx-auto text-3xl mb-4" />
                  <h4 className="text-lg font-semibold mb-2">حقیقی</h4>
                  <p className="text-sm text-[var(--sds-text-muted)]">مشتری شخصی و فردی</p>
                </div>
              </ErpPressable>

              <ErpPressable
                type="button"
                onClick={() => handleInputChange('customerType', 'Company')}
                className={`p-6 rounded-lg border-2 transition-all duration-200 ${
                  formData.customerType === 'Company'
                    ? 'border-[var(--sds-border-strong)] bg-[var(--sds-accent)] text-[var(--sds-text-inverse)]'
                    : 'border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] text-[var(--sds-text-primary)] hover:border-[var(--sds-border-default)] hover:bg-[var(--sds-surface-raised)]'
                }`}
              >
                <div className="text-center">
                  <FaBuilding className="mx-auto text-3xl mb-4" />
                  <h4 className="text-lg font-semibold mb-2">حقوقی</h4>
                  <p className="text-sm text-[var(--sds-text-muted)]">مشتری شرکتی یا سازمانی</p>
                </div>
              </ErpPressable>

              <ErpPressable
                type="button"
                onClick={() => handleInputChange('customerType', 'Government')}
                className={`p-6 rounded-lg border-2 transition-all duration-200 ${
                  formData.customerType === 'Government'
                    ? 'border-[var(--sds-border-strong)] bg-[var(--sds-accent)] text-[var(--sds-text-inverse)]'
                    : 'border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] text-[var(--sds-text-primary)] hover:border-[var(--sds-border-default)] hover:bg-[var(--sds-surface-raised)]'
                }`}
              >
                <div className="text-center">
                  <FaBuilding className="mx-auto text-3xl mb-4" />
                  <h4 className="text-lg font-semibold mb-2">دولتی</h4>
                  <p className="text-sm text-[var(--sds-text-muted)]">مشتری دولتی یا عمومی</p>
                </div>
              </ErpPressable>

              <ErpPressable
                type="button"
                onClick={() => handleInputChange('customerType', 'Collaborative')}
                className={`p-6 rounded-lg border-2 transition-all duration-200 ${
                  formData.customerType === 'Collaborative'
                    ? 'border-[var(--sds-border-strong)] bg-[var(--sds-accent)] text-[var(--sds-text-inverse)]'
                    : 'border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] text-[var(--sds-text-primary)] hover:border-[var(--sds-border-default)] hover:bg-[var(--sds-surface-raised)]'
                }`}
              >
                <div className="text-center">
                  <FaUser className="mx-auto text-3xl mb-4" />
                  <h4 className="text-lg font-semibold mb-2">همکاری</h4>
                  <p className="text-sm text-[var(--sds-text-muted)]">فرد یا گروه همکار بدون پروژه</p>
                </div>
              </ErpPressable>
            </div>

          </div>
        );

      case 'basic':
        return (
          <div className="space-y-6">
            {/* Basic Information Fields */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-[var(--sds-text-muted)] mb-2">نام *</label>
                <ErpInput
                  type="text"
                  value={formData.firstName}
                  onChange={(e) => handleInputChange('firstName', e.target.value)}
                  className="w-full px-4 py-3 bg-[var(--sds-surface-raised)] border border-[var(--sds-border-default)] rounded-lg text-[var(--sds-text-primary)] placeholder:text-[var(--sds-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--sds-focus-ring)]"
                  placeholder="نام"
                />
                {errors.firstName && <p className="text-[var(--sds-danger)] text-sm mt-1">{errors.firstName}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--sds-text-muted)] mb-2">نام خانوادگی *</label>
                <ErpInput
                  type="text"
                  value={formData.lastName}
                  onChange={(e) => handleInputChange('lastName', e.target.value)}
                  className="w-full px-4 py-3 bg-[var(--sds-surface-raised)] border border-[var(--sds-border-default)] rounded-lg text-[var(--sds-text-primary)] placeholder:text-[var(--sds-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--sds-focus-ring)]"
                  placeholder="نام خانوادگی"
                />
                {errors.lastName && <p className="text-[var(--sds-danger)] text-sm mt-1">{errors.lastName}</p>}
              </div>

              <div>
                <label htmlFor="customer-phoneNumber1" className="block text-sm font-medium text-[var(--sds-text-muted)] mb-2">شماره تماس اول *</label>
                <ErpInput
                  type="text"
                  value={formData.phoneNumber1}
                  onChange={(e) => handleInputChange('phoneNumber1', e.target.value)}
                  className="w-full px-4 py-3 bg-[var(--sds-surface-raised)] border border-[var(--sds-border-default)] rounded-lg text-[var(--sds-text-primary)] placeholder:text-[var(--sds-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--sds-focus-ring)]"
                  placeholder="شماره تماس اول"
                  id="customer-phoneNumber1"
                  aria-invalid={Boolean(errors.phoneNumber1)}
                  aria-describedby={errors.phoneNumber1 ? 'customer-phoneNumber1-error' : undefined}
                />
                {errors.phoneNumber1 && <p id="customer-phoneNumber1-error" role="alert" className="text-[var(--sds-danger)] text-sm mt-1">{errors.phoneNumber1}</p>}
              </div>

              <div>
                <label htmlFor="customer-phoneNumber2" className="block text-sm font-medium text-[var(--sds-text-muted)] mb-2">شماره تماس دوم</label>
                <ErpInput
                  type="text"
                  value={formData.phoneNumber2}
                  onChange={(e) => handleInputChange('phoneNumber2', e.target.value)}
                  className="w-full px-4 py-3 bg-[var(--sds-surface-raised)] border border-[var(--sds-border-default)] rounded-lg text-[var(--sds-text-primary)] placeholder:text-[var(--sds-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--sds-focus-ring)]"
                  placeholder="شماره تماس دوم"
                  id="customer-phoneNumber2"
                  aria-invalid={Boolean(errors.phoneNumber2)}
                  aria-describedby={errors.phoneNumber2 ? 'customer-phoneNumber2-error' : undefined}
                />
                <InlineFieldError id="customer-phoneNumber2-error" message={errors.phoneNumber2} />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--sds-text-muted)] mb-2">کد ملی</label>
                <ErpInput
                  type="text"
                  value={formData.nationalCode}
                  onChange={(e) => handleInputChange('nationalCode', e.target.value)}
                  className="w-full px-4 py-3 bg-[var(--sds-surface-raised)] border border-[var(--sds-border-default)] rounded-lg text-[var(--sds-text-primary)] placeholder:text-[var(--sds-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--sds-focus-ring)]"
                  placeholder="کد ملی (10 رقم)"
                  maxLength={10}
                />
                {errors.nationalCode && <p className="text-[var(--sds-danger)] text-sm mt-1">{errors.nationalCode}</p>}
              </div>
            </div>

            {/* Collapsible Additional Information Section */}
            <div className="mt-8">
              <ErpPressable
                type="button"
                onClick={() => setShowAdditionalInfo(!showAdditionalInfo)}
                className="w-full flex items-center justify-between p-4 bg-[var(--sds-surface-raised)] border border-[var(--sds-border-default)] rounded-lg text-[var(--sds-text-primary)] hover:bg-[var(--sds-surface-raised)] transition-colors"
              >
                <span className="text-lg font-medium">اطلاعات تکمیلی</span>
                <span className={`transform transition-transform ${showAdditionalInfo ? 'rotate-180' : ''}`}>
                  <FaArrowRight className="h-4 w-4" />
                </span>
              </ErpPressable>

              {showAdditionalInfo && (
                <div className="mt-4 p-6 bg-[var(--sds-surface-raised)] border border-[var(--sds-border-default)] rounded-lg">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-[var(--sds-text-muted)] mb-2">نام شرکت / سازمان</label>
                      <ErpInput
                        type="text"
                        value={formData.companyName}
                        onChange={(e) => handleInputChange('companyName', e.target.value)}
                        className="w-full px-4 py-3 bg-[var(--sds-surface-raised)] border border-[var(--sds-border-default)] rounded-lg text-[var(--sds-text-primary)] placeholder:text-[var(--sds-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--sds-focus-ring)]"
                        placeholder="نام شرکت / سازمان"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-[var(--sds-text-muted)] mb-2">نام برند</label>
                      <ErpInput
                        type="text"
                        value={formData.brandName}
                        onChange={(e) => handleInputChange('brandName', e.target.value)}
                        className="w-full px-4 py-3 bg-[var(--sds-surface-raised)] border border-[var(--sds-border-default)] rounded-lg text-[var(--sds-text-primary)] placeholder:text-[var(--sds-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--sds-focus-ring)]"
                        placeholder="نام برند"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-[var(--sds-text-muted)] mb-2">آدرس منزل</label>
                      <ErpInput
                        type="text"
                        value={formData.homeAddress}
                        onChange={(e) => handleInputChange('homeAddress', e.target.value)}
                        className="w-full px-4 py-3 bg-[var(--sds-surface-raised)] border border-[var(--sds-border-default)] rounded-lg text-[var(--sds-text-primary)] placeholder:text-[var(--sds-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--sds-focus-ring)]"
                        placeholder="آدرس منزل"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-[var(--sds-text-muted)] mb-2">شماره منزل</label>
                      <ErpInput
                        type="text"
                        value={formData.homeNumber}
                        onChange={(e) => handleInputChange('homeNumber', e.target.value)}
                        className="w-full px-4 py-3 bg-[var(--sds-surface-raised)] border border-[var(--sds-border-default)] rounded-lg text-[var(--sds-text-primary)] placeholder:text-[var(--sds-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--sds-focus-ring)]"
                        placeholder="شماره منزل"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-[var(--sds-text-muted)] mb-2">آدرس محل کار</label>
                      <ErpInput
                        type="text"
                        value={formData.workAddress}
                        onChange={(e) => handleInputChange('workAddress', e.target.value)}
                        className="w-full px-4 py-3 bg-[var(--sds-surface-raised)] border border-[var(--sds-border-default)] rounded-lg text-[var(--sds-text-primary)] placeholder:text-[var(--sds-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--sds-focus-ring)]"
                        placeholder="آدرس محل کار"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-[var(--sds-text-muted)] mb-2">شماره محل کار</label>
                      <ErpInput
                        type="text"
                        value={formData.workNumber}
                        onChange={(e) => handleInputChange('workNumber', e.target.value)}
                        className="w-full px-4 py-3 bg-[var(--sds-surface-raised)] border border-[var(--sds-border-default)] rounded-lg text-[var(--sds-text-primary)] placeholder:text-[var(--sds-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--sds-focus-ring)]"
                        placeholder="شماره محل کار"
                      />
                    </div>

                    <div>
                      <label htmlFor="customer-whatsappNumber" className="block text-sm font-medium text-[var(--sds-text-muted)] mb-2">شماره واتساپ</label>
                      <ErpInput
                        type="text"
                        value={formData.whatsappNumber}
                        onChange={(e) => handleInputChange('whatsappNumber', e.target.value)}
                        className="w-full px-4 py-3 bg-[var(--sds-surface-raised)] border border-[var(--sds-border-default)] rounded-lg text-[var(--sds-text-primary)] placeholder:text-[var(--sds-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--sds-focus-ring)]"
                        placeholder="شماره واتساپ"
                        id="customer-whatsappNumber"
                        aria-invalid={Boolean(errors.whatsappNumber)}
                        aria-describedby={errors.whatsappNumber ? 'customer-whatsappNumber-error' : undefined}
                      />
                      <InlineFieldError id="customer-whatsappNumber-error" message={errors.whatsappNumber} />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-[var(--sds-text-muted)] mb-2">تاریخ تولد</label>
                      <PersianCalendarComponent
                        value={formData.birthDate}
                        onChange={(date: string) => handleInputChange('birthDate', date)}
                        className="w-full"
                        enableYearSelection={true}
                        minYear={1300}
                        maxYear={1410}
                        placeholder="تاریخ تولد را انتخاب کنید"
                      />
                    </div>

                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-[var(--sds-text-muted)] mb-2">شغل اصلی</label>
                      <ErpInput
                        type="text"
                        value={formData.mainJob}
                        onChange={(e) => handleInputChange('mainJob', e.target.value)}
                        className="w-full px-4 py-3 bg-[var(--sds-surface-raised)] border border-[var(--sds-border-default)] rounded-lg text-[var(--sds-text-primary)] placeholder:text-[var(--sds-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--sds-focus-ring)]"
                        placeholder="شغل اصلی"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-[var(--sds-text-muted)] mb-2">نام معرف</label>
                      <ErpInput
                        type="text"
                        value={formData.referrerFirstName}
                        onChange={(e) => handleInputChange('referrerFirstName', e.target.value)}
                        className="w-full px-4 py-3 bg-[var(--sds-surface-raised)] border border-[var(--sds-border-default)] rounded-lg text-[var(--sds-text-primary)] placeholder:text-[var(--sds-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--sds-focus-ring)]"
                        placeholder="نام معرف"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-[var(--sds-text-muted)] mb-2">نام خانوادگی معرف</label>
                      <ErpInput
                        type="text"
                        value={formData.referrerLastName}
                        onChange={(e) => handleInputChange('referrerLastName', e.target.value)}
                        className="w-full px-4 py-3 bg-[var(--sds-surface-raised)] border border-[var(--sds-border-default)] rounded-lg text-[var(--sds-text-primary)] placeholder:text-[var(--sds-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--sds-focus-ring)]"
                        placeholder="نام خانوادگی معرف"
                      />
                    </div>

                    <div className="md:col-span-2">
                      <label htmlFor="customer-referrerPhoneNumber" className="block text-sm font-medium text-[var(--sds-text-muted)] mb-2">شماره تماس معرف</label>
                      <ErpInput
                        type="text"
                        value={formData.referrerPhoneNumber}
                        onChange={(e) => handleInputChange('referrerPhoneNumber', e.target.value)}
                        className="w-full px-4 py-3 bg-[var(--sds-surface-raised)] border border-[var(--sds-border-default)] rounded-lg text-[var(--sds-text-primary)] placeholder:text-[var(--sds-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--sds-focus-ring)]"
                        placeholder="شماره تماس معرف"
                        id="customer-referrerPhoneNumber"
                        aria-invalid={Boolean(errors.referrerPhoneNumber)}
                        aria-describedby={errors.referrerPhoneNumber ? 'customer-referrerPhoneNumber-error' : undefined}
                      />
                      <InlineFieldError id="customer-referrerPhoneNumber-error" message={errors.referrerPhoneNumber} />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        );


      case 'project':
        return (
          <div className="space-y-6">
            {/* Project Information Fields */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-[var(--sds-text-muted)] mb-2">نام پروژه *</label>
                <ErpInput
                  type="text"
                  value={formData.projectName}
                  onChange={(e) => handleInputChange('projectName', e.target.value)}
                  className="w-full px-4 py-3 bg-[var(--sds-surface-raised)] border border-[var(--sds-border-default)] rounded-lg text-[var(--sds-text-primary)] placeholder:text-[var(--sds-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--sds-focus-ring)]"
                  placeholder="نام پروژه"
                />
                {errors.projectName && <p className="text-[var(--sds-danger)] text-sm mt-1">{errors.projectName}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--sds-text-muted)] mb-2">آدرس پروژه *</label>
                <ErpInput
                  type="text"
                  value={formData.projectAddress}
                  onChange={(e) => handleInputChange('projectAddress', e.target.value)}
                  className="w-full px-4 py-3 bg-[var(--sds-surface-raised)] border border-[var(--sds-border-default)] rounded-lg text-[var(--sds-text-primary)] placeholder:text-[var(--sds-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--sds-focus-ring)]"
                  placeholder="آدرس پروژه"
                />
                {errors.projectAddress && <p className="text-[var(--sds-danger)] text-sm mt-1">{errors.projectAddress}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--sds-text-muted)] mb-2">شهر پروژه</label>
                <ErpInput
                  type="text"
                  value={formData.projectCity}
                  onChange={(e) => handleInputChange('projectCity', e.target.value)}
                  className="w-full px-4 py-3 bg-[var(--sds-surface-raised)] border border-[var(--sds-border-default)] rounded-lg text-[var(--sds-text-primary)] placeholder:text-[var(--sds-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--sds-focus-ring)]"
                  placeholder="شهر پروژه"
                />
              </div>

              <div className="md:col-span-2">
                <EnhancedDropdown
                  label="نوع پروژه"
                  value={formData.projectType}
                  onChange={(value) => handleInputChange('projectType', value)}
                  placeholder="نوع پروژه را انتخاب کنید"
                  options={PROJECT_TYPE_OPTIONS}
                  searchable={true}
                  clearable={true}
                />
              </div>
            </div>

            {/* Collapsible Project Manager Information Section */}
            <div className="mt-8">
              <ErpPressable
                type="button"
                onClick={() => setShowAdditionalInfo(!showAdditionalInfo)}
                className="w-full flex items-center justify-between p-4 bg-[var(--sds-surface-raised)] border border-[var(--sds-border-default)] rounded-lg text-[var(--sds-text-primary)] hover:bg-[var(--sds-surface-raised)] transition-colors"
              >
                <span className="text-lg font-medium">مدیر پروژه</span>
                <span className={`transform transition-transform ${showAdditionalInfo ? 'rotate-180' : ''}`}>
                  <FaArrowRight className="h-4 w-4" />
                </span>
              </ErpPressable>

              {showAdditionalInfo && (
                <div className="mt-4 p-6 bg-[var(--sds-surface-raised)] border border-[var(--sds-border-default)] rounded-lg">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-[var(--sds-text-muted)] mb-2">نام مدیر پروژه</label>
                      <ErpInput
                        type="text"
                        value={formData.projectManagerName}
                        onChange={(e) => handleInputChange('projectManagerName', e.target.value)}
                        className="w-full px-4 py-3 bg-[var(--sds-surface-raised)] border border-[var(--sds-border-default)] rounded-lg text-[var(--sds-text-primary)] placeholder:text-[var(--sds-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--sds-focus-ring)]"
                        placeholder="نام مدیر پروژه"
                      />
                    </div>

                    <div>
                      <label htmlFor="customer-projectManagerNumber" className="block text-sm font-medium text-[var(--sds-text-muted)] mb-2">شماره تماس مدیر پروژه</label>
                      <ErpInput
                        type="text"
                        value={formData.projectManagerNumber}
                        onChange={(e) => handleInputChange('projectManagerNumber', e.target.value)}
                        className="w-full px-4 py-3 bg-[var(--sds-surface-raised)] border border-[var(--sds-border-default)] rounded-lg text-[var(--sds-text-primary)] placeholder:text-[var(--sds-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--sds-focus-ring)]"
                        placeholder="شماره تماس مدیر پروژه"
                        id="customer-projectManagerNumber"
                        aria-invalid={Boolean(errors.projectManagerNumber)}
                        aria-describedby={errors.projectManagerNumber ? 'customer-projectManagerNumber-error' : undefined}
                      />
                      <InlineFieldError id="customer-projectManagerNumber-error" message={errors.projectManagerNumber} />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        );


      default:
        return null;
    }
  };

  if (!crmPermissions.canCreateCustomers) {
    return (
      <CustomerWorkflowPage title="ایجاد مشتری جدید" backHref="/dashboard/crm/customers" feedback={{ kind: 'permission', title: 'شما دسترسی لازم برای ایجاد مشتری را ندارید.' }} />
    );
  }

  const isReturningToContract =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('returnTo') === 'contract';

  const returnToContract = () => {
    const urlParams = new URLSearchParams(window.location.search);
    const requestedStep = urlParams.get('step');
    const savedState = localStorage.getItem('contractWizardState');
    if (savedState) {
      const { currentStep } = JSON.parse(savedState);
      router.push(getContractReturnUrl(currentStep));
      return;
    }
    router.push(getContractReturnUrl(requestedStep || undefined));
  };

  return (
    <CustomerWorkflowPage
      title="ایجاد مشتری جدید"
      description="اطلاعات مشتری را مرحله‌به‌مرحله ثبت کنید."
      backHref="/dashboard/crm/customers"
      actions={isReturningToContract ? [{ label: 'لغو و بازگشت به قرارداد', icon: FaTimes, tone: 'danger', variant: 'outline', onClick: returnToContract }] : []}
      progress={{ current: step + 1, total: steps.length, label: steps[step].label }}
      feedback={errors.submit
        ? { kind: 'error', title: errors.submit }
        : step > 0 || Object.entries(formData).some(([key, value]) => !['customerType', 'status'].includes(key) && (Array.isArray(value) ? value.length > 0 : Boolean(value)))
          ? { kind: 'stale', title: 'اطلاعات واردشده تا زمان ثبت نهایی ذخیره نمی‌شوند.' }
          : undefined}
    >

      {/* Form Content */}
      <CustomerWorkflowSection title={steps[step].label}>
        {renderStepContent()}
      </CustomerWorkflowSection>

      {duplicateCustomers.length > 0 && (
        <CustomerWorkflowSection title="مشتری مشابه پیدا شد" description="ایجاد مشتری تکراری مجاز نیست. مشتری موجود را انتخاب کنید یا اطلاعات وارد شده را اصلاح کنید.">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {duplicateCustomers.map((customer) => {
              const primaryPhone =
                customer.phoneNumbers?.find((phone) => phone.isPrimary)?.number ||
                customer.phoneNumbers?.[0]?.number;

              return (
                <ErpCard key={customer.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h4 className="font-semibold text-[var(--sds-text-primary)]">
                        {customer.firstName} {customer.lastName}
                      </h4>
                      {customer.companyName && <p className="mt-1 text-sm text-[var(--sds-text-muted)]">{customer.companyName}</p>}
                    </div>
                    <ErpBadge tone="warning">تکراری</ErpBadge>
                  </div>
                  <div className="mt-3 space-y-1 text-sm text-[var(--sds-text-muted)]">
                    {primaryPhone && <p>شماره تماس: {primaryPhone}</p>}
                    {customer.nationalCode && <p>کد ملی: {customer.nationalCode}</p>}
                    <p>مسئول فروش: {getOwnerLabel(customer)}</p>
                  </div>
                  {isReturningToContract && (
                    <ErpButton label="انتخاب این مشتری و ادامه قرارداد" onClick={() => selectDuplicateForContract(customer)} className="mt-4 w-full" />
                  )}
                </ErpCard>
              );
            })}
          </div>
        </CustomerWorkflowSection>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <ErpPressable type="button"
          onClick={handlePrevious}
          disabled={step === 0}
          variant="ghost"
          className="px-6 py-3 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          قبلی
        </ErpPressable>

        <div className="flex items-center gap-4">
          {step === steps.length - 1 ? (
            <ErpPressable type="button"
              onClick={handleSubmit}
              disabled={loading}
              tone="primary"
              variant="solid"
              className="inline-flex items-center gap-2 px-6 py-3 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-[var(--sds-border-default)]"></div>
                  در حال ثبت...
                </>
              ) : (
                <>
                  <FaSave className="text-lg" />
                  ثبت مشتری
                </>
              )}
            </ErpPressable>
          ) : (
            <ErpPressable type="button"
              onClick={handleNext}
              tone="primary"
              variant="solid"
              className="inline-flex items-center gap-2 px-6 py-3"
            >
              بعدی
              <FaArrowRight className="text-lg" />
            </ErpPressable>
          )}
        </div>
      </div>
    </CustomerWorkflowPage>
  );
}
