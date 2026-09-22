'use client';
import { ErpBadge, ErpButton, ErpCard, ErpField as CustomerWorkflowField, ErpInput, ErpPressable, ErpSegmentedControl } from '@/components/erp';
import { useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
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
import PersianCalendar from '@/lib/persian-calendar';
import PersianCalendarComponent from '@/components/PersianCalendar';
import { mapAxiosFormErrors } from '@/lib/formErrors';
import {
  normalizeIranianMobile,
  normalizePhoneDigits,
  validateOptionalIranianMobile,
  validateRequiredIranianMobile
} from '@/lib/phoneFormat';
import { CustomerWorkflowPage, CustomerWorkflowSection, hasCustomerDraftChanges } from '@/features/crm/customer-workflow/CustomerWorkflowUi';
import { CustomerProjectFormFields } from '@/features/crm/customer-workflow/CustomerProjectFormFields';
import { writeContractReturnSelection } from '@/features/contract-creation/utils/contractReturnSelection';
import { canonicalHash } from '@sabalanerp/partner-sales-contracts';

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
  marketerFirstName: string;
  marketerLastName: string;
  marketerPhoneNumber: string;

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
  const searchParams = useSearchParams();
  const partnerContractMode = searchParams.get('partnerContract') === '1';
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
  const [partnerDuplicateMatch, setPartnerDuplicateMatch] = useState<{
    matchReference: string; displayName: string; city: string; maskedWitness: string;
  } | null>(null);
  const [partnerOwnedDuplicate, setPartnerOwnedDuplicate] = useState<{
    customerId: string; displayName: string; phone?: string;
  } | null>(null);
  const [transferReason, setTransferReason] = useState('');
  const [transferNotice, setTransferNotice] = useState('');
  const [pendingTransfer, setPendingTransfer] = useState<{ transferId: string; revision: number } | null>(null);
  const transferRequestRef = useRef<{ signature: string; commandId: string; correlationId: string } | null>(null);
  const transferCancelRef = useRef<{ transferId: string; commandId: string; correlationId: string } | null>(null);
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
    marketerFirstName: '',
    marketerLastName: '',
    marketerPhoneNumber: '',

    // Security & Access Control
    isBlacklisted: false,
    isLocked: false,

    // Related Data
    projectAddresses: [],
    phoneNumbers: []
  });

  useEffect(() => {
    const requestedCustomerType = new URLSearchParams(window.location.search).get('customerType');
    if (requestedCustomerType === 'Collaborative' && !partnerContractMode) {
      setFormData(prev => ({ ...prev, customerType: 'Collaborative' }));
    }
  }, [partnerContractMode]);

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
      const expectedIdentityLength = formData.customerType === 'Individual' ? 10 : 11;
      if (formData.nationalCode && formData.nationalCode.length !== expectedIdentityLength) {
        newErrors.nationalCode = formData.customerType === 'Individual'
          ? 'کد ملی باید ۱۰ رقم باشد'
          : 'شناسه ملی حقوقی باید ۱۱ رقم باشد';
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
      field === 'marketerPhoneNumber' ||
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
    if (partnerContractMode) {
      setDuplicateCustomers([]);
      return;
    }
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
  }, [formData.phoneNumber1, formData.phoneNumber2, partnerContractMode]);

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

  const getContractReturnUrl = (stepParam: string | number = '2', selection?: {
    customerId?: string; projectId?: string;
  }) => {
    const urlParams = new URLSearchParams(window.location.search);
    let contractKind = urlParams.get('contractKind');
    try {
      const savedStateRaw = localStorage.getItem('contractWizardState');
      const savedState = savedStateRaw ? JSON.parse(savedStateRaw) : null;
      contractKind = contractKind || savedState?.wizardData?.contractKind || null;
    } catch {
      // Fall back to the standard contract route.
    }
    const route = !partnerContractMode && contractKind === 'collaboration'
      ? '/dashboard/sales/contracts/collaboration/create'
      : '/dashboard/sales/contracts/create';
    const result = new URLSearchParams({ returnTo: 'contract', step: String(stepParam) });
    const draftId = urlParams.get('draftId');
    if (draftId) result.set('draftId', draftId);
    if (partnerContractMode) result.set('partnerContract', '1');
    if (selection?.customerId) result.set('customerId', selection.customerId);
    if (selection?.projectId) result.set('projectId', selection.projectId);
    return `${route}?${result.toString()}`;
  };

  const selectDuplicateForContract = (customer: DuplicateCustomerSuggestion) => {
    const urlParams = new URLSearchParams(window.location.search);
    const returnTo = urlParams.get('returnTo');
    const stepParam = urlParams.get('step') || '2';

    if (returnTo !== 'contract') return;

    const selectionSaved = writeContractReturnSelection({
      currentStep: Number(stepParam),
      customerId: customer.id
    });
    if (!selectionSaved) {
      setErrors({ submit: 'فضای ذخیرهٔ مرورگر پر است؛ بازگشت به قرارداد برای جلوگیری از انتخاب مشتری اشتباه متوقف شد.' });
      return;
    }

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
    const marketerPhoneNumberError = validateOptionalIranianMobile(formData.marketerPhoneNumber);
    const referrerPhoneNumberError = validateOptionalIranianMobile(formData.referrerPhoneNumber);
    if (phone1Error) submitErrors.phoneNumber1 = phone1Error;
    if (phone2Error) submitErrors.phoneNumber2 = phone2Error;
    if (projectManagerNumberError) submitErrors.projectManagerNumber = projectManagerNumberError;
    if (marketerPhoneNumberError) submitErrors.marketerPhoneNumber = marketerPhoneNumberError;
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
      const marketerPhoneNumber = normalizeIranianMobile(formData.marketerPhoneNumber);
      const referrerPhoneNumber = normalizeIranianMobile(formData.referrerPhoneNumber);

      if (partnerContractMode) {
        const optional = (value: string) => value.trim() || undefined;
        const intent = {
          schemaVersion: 1 as const,
          reason: 'ثبت مشتری و پروژه برای قرارداد فروش همکار',
          customer: {
            firstName: formData.firstName.trim(), lastName: formData.lastName.trim(),
            customerType: formData.customerType as 'Individual' | 'Company' | 'Government',
            phoneNumber1, ...(phoneNumber2 ? { phoneNumber2 } : {}),
            ...(optional(formData.nationalCode) ? { nationalCode: optional(formData.nationalCode) } : {}),
            ...(optional(formData.companyName) ? { companyName: optional(formData.companyName) } : {}),
            ...(optional(formData.brandName) ? { brandName: optional(formData.brandName) } : {}),
            ...(optional(formData.homeAddress) ? { homeAddress: optional(formData.homeAddress) } : {}),
            ...(optional(formData.homeNumber) ? { homeNumber: optional(formData.homeNumber) } : {}),
            ...(optional(formData.workAddress) ? { workAddress: optional(formData.workAddress) } : {}),
            ...(optional(formData.workNumber) ? { workNumber: optional(formData.workNumber) } : {}),
            ...(optional(formData.whatsappNumber) ? { whatsappNumber: optional(formData.whatsappNumber) } : {}),
            ...(optional(formData.birthDate) ? { birthDate: optional(formData.birthDate) } : {}),
            ...(optional(formData.mainJob) ? { mainJob: optional(formData.mainJob) } : {}),
            ...(optional(formData.referrerFirstName) ? { referrerFirstName: optional(formData.referrerFirstName) } : {}),
            ...(optional(formData.referrerLastName) ? { referrerLastName: optional(formData.referrerLastName) } : {}),
            ...(referrerPhoneNumber ? { referrerPhoneNumber } : {}),
          },
          project: {
            projectName: formData.projectName.trim(), address: formData.projectAddress.trim(),
            ...(optional(formData.projectCity) ? { city: optional(formData.projectCity) } : {}),
            ...(optional(formData.projectType) ? { projectType: optional(formData.projectType) } : {}),
            ...(optional(formData.projectManagerName) ? { projectManagerName: optional(formData.projectManagerName) } : {}),
            ...(projectManagerNumber ? { projectManagerNumber } : {}),
            ...(optional(formData.marketerFirstName) ? { marketerFirstName: optional(formData.marketerFirstName) } : {}),
            ...(optional(formData.marketerLastName) ? { marketerLastName: optional(formData.marketerLastName) } : {}),
            ...(marketerPhoneNumber ? { marketerPhoneNumber } : {}),
          },
        };
        const payloadHash = await canonicalHash(intent);
        const commandId = `partner-contract-customer-${crypto.randomUUID()}`;
        const response = await crmAPI.createPartnerContractCustomer({ ...intent, commandId,
          correlationId: `partner-contract-customer-correlation-${crypto.randomUUID()}`,
          idempotencyKey: commandId, payloadHash });
        const result = response.data?.data as { customer?: { customerId?: string; displayName?: string; phone?: string };
          project?: { id?: string }; duplicate?: 'OWNED' } | undefined;
        const createdCustomerId = result?.customer?.customerId;
        if (!createdCustomerId) throw new Error('Invalid Partner Customer response');
        if (result?.duplicate === 'OWNED') {
          setPartnerOwnedDuplicate({ customerId: createdCustomerId,
            displayName: result.customer?.displayName || 'مشتری موجود',
            ...(result.customer?.phone ? { phone: result.customer.phone } : {}) });
          setErrors({ submit: 'این مشتری قبلاً در فهرست شما ثبت شده است. برای استفاده در قرارداد، او را انتخاب کنید.' });
          return;
        }
        router.push(getContractReturnUrl(result?.project?.id ? '3' : '2', {
          customerId: createdCustomerId, projectId: result?.project?.id,
        }));
        return;
      }

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
          projectManagerNumber: projectManagerNumber || null,
          marketerFirstName: formData.marketerFirstName.trim() || null,
          marketerLastName: formData.marketerLastName.trim() || null,
          marketerPhoneNumber: marketerPhoneNumber || null
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
          const selectionSaved = writeContractReturnSelection({
            currentStep: Number(step),
            customerId: response.data.data.id
          });
          if (!selectionSaved) {
            setErrors({ submit: 'مشتری ایجاد شد، اما فضای ذخیرهٔ مرورگر پر است؛ بازگشت خودکار برای جلوگیری از انتخاب مشتری اشتباه متوقف شد.' });
            return;
          }
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
      if (partnerContractMode && error.response?.status === 409 && error.response?.data?.code === 'STATE_CONFLICT') {
        try {
          const correlationId = `partner-duplicate-correlation-${crypto.randomUUID()}`;
          const duplicate = await crmAPI.findPartnerDuplicateCustomer({ schemaVersion: 1, correlationId,
            phone: normalizeIranianMobile(formData.phoneNumber1),
            ...(formData.nationalCode.trim() ? { nationalCode: formData.nationalCode.trim() } : {}) });
          const match = duplicate.data?.data;
          if (match?.matchReference) {
            setPartnerDuplicateMatch(match);
            setErrors({ submit: 'این مشتری در اختیار فروشنده دیگری است. در صورت نیاز درخواست انتقال ثبت کنید.' });
            return;
          }
        } catch { /* Preserve the non-disclosing duplicate response below. */ }
        setErrors({ submit: 'مشتری تکراری است، اما اطلاعات امن انتقال در دسترس نیست.' });
      } else if (error.response?.status === 409 && error.response?.data?.code === 'DUPLICATE_CUSTOMER') {
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

  const requestPartnerTransfer = async () => {
    if (!partnerDuplicateMatch || !/[\u0600-\u06ff]/.test(transferReason)) return;
    setLoading(true);
    try {
      const intent = { schemaVersion: 1 as const, matchReference: partnerDuplicateMatch.matchReference,
        reason: transferReason.trim() };
      const payloadHash = await canonicalHash(intent);
      const signature = JSON.stringify(intent);
      if (!transferRequestRef.current || transferRequestRef.current.signature !== signature) {
        transferRequestRef.current = { signature, commandId: `partner-transfer-${crypto.randomUUID()}`,
          correlationId: `partner-transfer-correlation-${crypto.randomUUID()}` };
      }
      const { commandId, correlationId } = transferRequestRef.current;
      const response = await crmAPI.requestPartnerCustomerTransfer({ ...intent, commandId,
        correlationId,
        idempotencyKey: commandId, payloadHash });
      const outcome = response.data?.data as { transferId?: string; revision?: number } | undefined;
      if (!outcome?.transferId || typeof outcome.revision !== 'number') throw new Error('Invalid transfer response');
      setPendingTransfer({ transferId: outcome.transferId, revision: outcome.revision });
      transferRequestRef.current = null;
      setPartnerDuplicateMatch(null);
      setTransferReason('');
      setErrors({});
      setTransferNotice('درخواست انتقال ثبت شد. تأیید انتقال، مشتری را خودکار به این قرارداد متصل نمی‌کند.');
    } catch {
      setErrors({ submit: 'ثبت درخواست انتقال انجام نشد؛ دوباره تلاش کنید.' });
    } finally {
      setLoading(false);
    }
  };

  const cancelPartnerTransfer = async () => {
    if (!pendingTransfer || loading) return;
    setLoading(true);
    try {
      const intent = { schemaVersion: 1 as const, transferId: pendingTransfer.transferId,
        expectedRevision: pendingTransfer.revision, reason: 'لغو درخواست انتقال توسط درخواست‌کننده' };
      const payloadHash = await canonicalHash(intent);
      if (!transferCancelRef.current || transferCancelRef.current.transferId !== pendingTransfer.transferId) {
        transferCancelRef.current = { transferId: pendingTransfer.transferId,
          commandId: `partner-transfer-cancel-${crypto.randomUUID()}`,
          correlationId: `partner-transfer-cancel-correlation-${crypto.randomUUID()}` };
      }
      const { commandId, correlationId } = transferCancelRef.current;
      await crmAPI.cancelPartnerCustomerTransfer(pendingTransfer.transferId, { ...intent,
        commandId, correlationId, idempotencyKey: commandId, payloadHash });
      transferCancelRef.current = null;
      setPendingTransfer(null);
      setTransferNotice('درخواست انتقال لغو شد.');
      setErrors({});
    } catch {
      setErrors({ submit: 'لغو درخواست انتقال انجام نشد؛ وضعیت درخواست را دوباره بررسی کنید.' });
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

            <ErpSegmentedControl
              value={formData.customerType}
              onChange={(value) => handleInputChange('customerType', value)}
              options={[
                { value: 'Individual', label: 'حقیقی', icon: FaUser },
                { value: 'Company', label: 'حقوقی', icon: FaBuilding },
                { value: 'Government', label: 'دولتی', icon: FaBuilding },
                ...(!partnerContractMode ? [{ value: 'Collaborative', label: 'همکاری', icon: FaUser }] : []),
              ]}
            />

          </div>
        );

      case 'basic':
        return (
          <div className="space-y-6">
            {/* Basic Information Fields */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <CustomerWorkflowField label="نام" error={errors.firstName} required>
                <ErpInput
                  type="text"
                  value={formData.firstName}
                  onChange={(e) => handleInputChange('firstName', e.target.value)}
                  placeholder="نام"
                />
              </CustomerWorkflowField>

              <CustomerWorkflowField label="نام خانوادگی" error={errors.lastName} required>
                <ErpInput
                  type="text"
                  value={formData.lastName}
                  onChange={(e) => handleInputChange('lastName', e.target.value)}
                  placeholder="نام خانوادگی"
                />
              </CustomerWorkflowField>

              <CustomerWorkflowField label="شماره تماس اول" error={errors.phoneNumber1} required>
                <ErpInput
                  type="text"
                  value={formData.phoneNumber1}
                  onChange={(e) => handleInputChange('phoneNumber1', e.target.value)}
                  placeholder="شماره تماس اول"
                />
              </CustomerWorkflowField>

              <CustomerWorkflowField label="شماره تماس دوم" error={errors.phoneNumber2}>
                <ErpInput
                  type="text"
                  value={formData.phoneNumber2}
                  onChange={(e) => handleInputChange('phoneNumber2', e.target.value)}
                  placeholder="شماره تماس دوم"
                />
              </CustomerWorkflowField>

              <CustomerWorkflowField label={formData.customerType === 'Individual' ? 'کد ملی' : 'شناسه ملی حقوقی'} error={errors.nationalCode}>
                <ErpInput
                  type="text"
                  value={formData.nationalCode}
                  onChange={(e) => handleInputChange('nationalCode', e.target.value)}
                  placeholder={formData.customerType === 'Individual' ? 'کد ملی (۱۰ رقم)' : 'شناسه ملی (۱۱ رقم)'}
                  maxLength={formData.customerType === 'Individual' ? 10 : 11}
                />
              </CustomerWorkflowField>
            </div>

            {/* Collapsible Additional Information Section */}
            <div className="mt-8">
              <ErpPressable
                type="button"
                onClick={() => setShowAdditionalInfo(!showAdditionalInfo)}
                aria-expanded={showAdditionalInfo}
                variant="outline"
                className="w-full justify-between p-4"
              >
                <span className="text-lg font-medium">اطلاعات تکمیلی</span>
                <span className={`transform transition-transform ${showAdditionalInfo ? 'rotate-180' : ''}`}>
                  <FaArrowRight className="h-4 w-4" />
                </span>
              </ErpPressable>

              {showAdditionalInfo && (
                <ErpCard className="mt-4 p-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <CustomerWorkflowField label="نام شرکت / سازمان">
                <ErpInput
                        type="text"
                        value={formData.companyName}
                        onChange={(e) => handleInputChange('companyName', e.target.value)}
                        placeholder="نام شرکت / سازمان"
                      />
              </CustomerWorkflowField>

                    <CustomerWorkflowField label="نام برند">
                <ErpInput
                        type="text"
                        value={formData.brandName}
                        onChange={(e) => handleInputChange('brandName', e.target.value)}
                        placeholder="نام برند"
                      />
              </CustomerWorkflowField>

                    <CustomerWorkflowField label="آدرس منزل">
                <ErpInput
                        type="text"
                        value={formData.homeAddress}
                        onChange={(e) => handleInputChange('homeAddress', e.target.value)}
                        placeholder="آدرس منزل"
                      />
              </CustomerWorkflowField>

                    <CustomerWorkflowField label="شماره منزل">
                <ErpInput
                        type="text"
                        value={formData.homeNumber}
                        onChange={(e) => handleInputChange('homeNumber', e.target.value)}
                        placeholder="شماره منزل"
                      />
              </CustomerWorkflowField>

                    <CustomerWorkflowField label="آدرس محل کار">
                <ErpInput
                        type="text"
                        value={formData.workAddress}
                        onChange={(e) => handleInputChange('workAddress', e.target.value)}
                        placeholder="آدرس محل کار"
                      />
              </CustomerWorkflowField>

                    <CustomerWorkflowField label="شماره محل کار">
                <ErpInput
                        type="text"
                        value={formData.workNumber}
                        onChange={(e) => handleInputChange('workNumber', e.target.value)}
                        placeholder="شماره محل کار"
                      />
              </CustomerWorkflowField>

                    <CustomerWorkflowField label="شماره واتساپ" error={errors.whatsappNumber}>
                <ErpInput
                        type="text"
                        value={formData.whatsappNumber}
                        onChange={(e) => handleInputChange('whatsappNumber', e.target.value)}
                        placeholder="شماره واتساپ"
                        id="customer-whatsappNumber"
                        aria-invalid={Boolean(errors.whatsappNumber)}
                        aria-describedby={errors.whatsappNumber ? 'customer-whatsappNumber-error' : undefined}
                      />
              </CustomerWorkflowField>

                    <CustomerWorkflowField label="تاریخ تولد">
                      <PersianCalendarComponent value={formData.birthDate} onChange={(date: string) => handleInputChange('birthDate', date)} className="w-full" enableYearSelection minYear={1300} maxYear={1410} placeholder="تاریخ تولد را انتخاب کنید" />
                    </CustomerWorkflowField>
                    <CustomerWorkflowField label="شغل اصلی" className="md:col-span-2">
                      <ErpInput
                        type="text"
                        value={formData.mainJob}
                        onChange={(e) => handleInputChange('mainJob', e.target.value)}
                        placeholder="شغل اصلی"
                      />
                    </CustomerWorkflowField>

                    <CustomerWorkflowField label="نام معرف">
                <ErpInput
                        type="text"
                        value={formData.referrerFirstName}
                        onChange={(e) => handleInputChange('referrerFirstName', e.target.value)}
                        placeholder="نام معرف"
                      />
              </CustomerWorkflowField>

                    <CustomerWorkflowField label="نام خانوادگی معرف">
                <ErpInput
                        type="text"
                        value={formData.referrerLastName}
                        onChange={(e) => handleInputChange('referrerLastName', e.target.value)}
                        placeholder="نام خانوادگی معرف"
                      />
              </CustomerWorkflowField>

                    <CustomerWorkflowField label="شماره تماس معرف" error={errors.referrerPhoneNumber} className="md:col-span-2">
                <ErpInput
                        type="text"
                        value={formData.referrerPhoneNumber}
                        onChange={(e) => handleInputChange('referrerPhoneNumber', e.target.value)}
                        placeholder="شماره تماس معرف"
                        id="customer-referrerPhoneNumber"
                        aria-invalid={Boolean(errors.referrerPhoneNumber)}
                        aria-describedby={errors.referrerPhoneNumber ? 'customer-referrerPhoneNumber-error' : undefined}
                      />
              </CustomerWorkflowField>
                  </div>
                </ErpCard>
              )}
            </div>
          </div>
        );


      case 'project':
        return (
          <CustomerProjectFormFields value={formData}
            errors={errors}
            onChange={(field, value) => handleInputChange(field, value)} />
        );


      default:
        return null;
    }
  };

  if (!crmPermissions.canCreateCustomers && !partnerContractMode) {
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
        : transferNotice
          ? { kind: 'success', title: transferNotice }
        : hasCustomerDraftChanges(formData)
          ? { kind: 'stale', title: 'اطلاعات واردشده تا زمان ثبت نهایی ذخیره نمی‌شوند.' }
          : undefined}
    >

      {/* Form Content */}
      <CustomerWorkflowSection title={steps[step].label}>
        {renderStepContent()}
      </CustomerWorkflowSection>

      {partnerDuplicateMatch && (
        <CustomerWorkflowSection title="مشتری مشابه در فروش همکار"
          description="برای حفظ محرمانگی فقط اطلاعات محدود نمایش داده می‌شود. درخواست انتقال مستقل از پیش‌نویس قرارداد است.">
          <ErpCard className="space-y-4 p-4">
            <div>
              <p className="font-semibold">{partnerDuplicateMatch.displayName}</p>
              <p className="mt-1 text-sm text-[var(--sds-text-muted)]">
                {partnerDuplicateMatch.city} · {partnerDuplicateMatch.maskedWitness}
              </p>
            </div>
            <CustomerWorkflowField label="دلیل درخواست انتقال" required>
              <ErpInput value={transferReason} onChange={(event) => setTransferReason(event.target.value)}
                placeholder="دلیل فارسی درخواست انتقال را وارد کنید" />
            </CustomerWorkflowField>
            <ErpButton label="ثبت درخواست انتقال مشتری" tone="warning" disabled={loading || !/[\u0600-\u06ff]/.test(transferReason)}
              onClick={() => void requestPartnerTransfer()} />
          </ErpCard>
        </CustomerWorkflowSection>
      )}

      {pendingTransfer && (
        <CustomerWorkflowSection title="درخواست انتقال در انتظار بررسی"
          description="این درخواست از پیش‌نویس قرارداد مستقل است و تا پیش از تصمیم مسئول فعلی قابل لغو است.">
          <ErpCard className="p-4">
            <ErpButton label="لغو درخواست انتقال" tone="danger" variant="outline" disabled={loading}
              onClick={() => void cancelPartnerTransfer()} />
          </ErpCard>
        </CustomerWorkflowSection>
      )}

      {partnerOwnedDuplicate && (
        <CustomerWorkflowSection title="مشتری موجود در فهرست شما"
          description="برای جلوگیری از انتخاب ناخواسته، ادامه فقط با تأیید شما انجام می‌شود.">
          <ErpCard className="space-y-4 p-4">
            <div>
              <p className="font-semibold">{partnerOwnedDuplicate.displayName}</p>
              {partnerOwnedDuplicate.phone && <p className="mt-1 text-sm text-[var(--sds-text-muted)]">
                {partnerOwnedDuplicate.phone}
              </p>}
            </div>
            <ErpButton label="انتخاب این مشتری و بازگشت به قرارداد" onClick={() => router.push(getContractReturnUrl('3', {
              customerId: partnerOwnedDuplicate.customerId,
            }))} />
          </ErpCard>
        </CustomerWorkflowSection>
      )}

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
