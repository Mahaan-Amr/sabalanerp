// useContractSubmission Hook
// Manages contract creation and submission

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { ContractWizardData } from '../types/contract.types';
import { salesAPI } from '@/lib/api';
import { PersianCalendar } from '@/lib/persian-calendar';
import { sumNumericValues } from '@/lib/numberFormat';
import { mapAxiosFormErrors } from '@/lib/formErrors';
import { CONTRACT_DRAFT_STORAGE_KEY } from '../utils/contractDraftStorage';
import { normalizeProductFinishing } from '../utils/finishingUtils';

interface UseContractSubmissionOptions {
  wizardData: ContractWizardData;
  updateWizardData: (updates: Partial<ContractWizardData>) => void;
  setCurrentStep: (step: number) => void;
  setErrors: (errors: Record<string, string>) => void;
  setLoading: (loading: boolean) => void;
  validateCurrentStep: () => boolean;
  generateContractHTML: (data: any) => string;
  userDepartment?: string;
  departments?: Array<{ id: string }>;
}

const normalizeIranMobileNumber = (value?: string | null) => {
  if (!value) return null;

  const digits = value.replace(/\D/g, '');
  let normalized = digits;

  if (digits.startsWith('0098')) {
    normalized = `0${digits.slice(4)}`;
  } else if (digits.startsWith('98') && digits.length === 12) {
    normalized = `0${digits.slice(2)}`;
  } else if (digits.startsWith('9') && digits.length === 10) {
    normalized = `0${digits}`;
  }

  return /^09\d{9}$/.test(normalized) ? normalized : null;
};

const getCustomerSmsPhoneNumber = (customer: ContractWizardData['customer']) => {
  const phoneNumbers = customer?.phoneNumbers || [];
  const candidates = [
    phoneNumbers.find((phone) => phone.isPrimary && phone.type === 'mobile')?.number,
    ...phoneNumbers.filter((phone) => phone.type === 'mobile').map((phone) => phone.number),
    phoneNumbers.find((phone) => phone.isPrimary)?.number,
    customer?.projectManagerNumber,
    ...phoneNumbers.filter((phone) => phone.isActive !== false).map((phone) => phone.number),
    ...phoneNumbers.map((phone) => phone.number),
    customer?.homeNumber,
    customer?.workNumber
  ];

  for (const candidate of candidates) {
    const mobile = normalizeIranMobileNumber(candidate);
    if (mobile) return mobile;
  }

  return null;
};

export const useContractSubmission = (options: UseContractSubmissionOptions) => {
  const {
    wizardData,
    updateWizardData,
    setCurrentStep,
    setErrors,
    setLoading,
    validateCurrentStep,
    generateContractHTML,
    userDepartment,
    departments
  } = options;

  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleCreateContract = useCallback(async () => {
    if (!validateCurrentStep()) return;
    
    setIsSubmitting(true);
    setLoading(true);
    try {
      const targetDepartmentId = userDepartment || departments?.[0]?.id;
      if (!targetDepartmentId) {
        setErrors({ general: 'برای ثبت قرارداد، دپارتمان فروش کاربر باید مشخص باشد.' });
        return;
      }

      // Calculate total amount
      const normalizedProducts = wizardData.products.map((product) => {
        const finishing = normalizeProductFinishing(product);
        if (!finishing) return product;
        return {
          ...product,
          finishingCalculationBase: product.finishingCalculationBase || finishing.calculationBase,
          finishingUnitPrice: product.finishingUnitPrice ?? finishing.unitPrice,
          finishingQuantity: product.finishingQuantity ?? finishing.quantity,
          finishingPricePerSquareMeter: product.finishingPricePerSquareMeter ?? finishing.unitPrice,
          finishingSquareMeters:
            product.finishingSquareMeters ??
            (finishing.calculationBase === 'squareMeters' ? finishing.quantity : null),
          finishingCost: product.finishingCost ?? finishing.cost
        };
      });
      const totalAmount = sumNumericValues(normalizedProducts, (product) => product.totalPrice);
      
      // Create contract
      const contractData = {
        title: 'قرارداد فروش سنگ',
        titlePersian: 'قرارداد فروش سنگ',
        customerId: wizardData.customerId,
        departmentId: targetDepartmentId,
        content: generateContractHTML({
          contractNumber: wizardData.contractNumber,
          contractDate: wizardData.contractDate,
          customer: wizardData.customer,
          project: wizardData.project,
          products: normalizedProducts,
          deliveries: wizardData.deliveries,
          payment: wizardData.payment
        }),
        contractData: {
          contractNumber: wizardData.contractNumber,
          contractDate: wizardData.contractDate,
          customer: wizardData.customer,
          project: wizardData.project,
          products: normalizedProducts,
          deliveries: wizardData.deliveries,
          payment: wizardData.payment
        },
        totalAmount,
        currency: 'تومان'
      };
      
      console.log('Sending contract data:', contractData);
      const response = await salesAPI.createContract(contractData);
      console.log('Contract creation response:', response.data);
      
      if (response.data.success) {
        const contractId = response.data.data.id;
        const savedContractNumber = response.data.data.contractNumber || wizardData.contractNumber;
        const creatorSequenceNumber = response.data.data.creatorSequenceNumber ?? wizardData.creatorSequenceNumber ?? null;
        
        // Store contract ID in signature state for Step 8
        updateWizardData({
          contractNumber: savedContractNumber,
          creatorSequenceNumber,
          signature: {
            ...(wizardData.signature || {
              phoneNumber: null,
              contractId: null,
              contractStatus: null,
              confirmationSent: false,
              confirmationStatus: null,
              linkExpiresAt: null,
              otpExpiresAt: null,
              attemptsUsed: 0,
              maxAttempts: 5,
              resendCount: 0,
              lastSentAt: null,
              lastOpenedAt: null
            }),
            contractId: contractId,
            contractStatus: response.data.data.status || null,
            phoneNumber: getCustomerSmsPhoneNumber(wizardData.customer)
          }
        });
        
        // Create contract items
        for (const product of normalizedProducts) {
          await salesAPI.createContractItem(contractId, {
            productId: product.productId,
            productType: product.productType,
            quantity: product.quantity,
            unitPrice: product.pricePerSquareMeter,
            totalPrice: product.totalPrice,
            description: product.description || null,
            isMandatory: product.isMandatory || false,
            mandatoryPercentage: product.mandatoryPercentage || null,
            originalTotalPrice: product.originalTotalPrice || null,
            // Stair system linking fields
            stairSystemId: product.stairSystemId || null,
            stairPartType: product.stairPartType || null
          });
        }
        
        // Create deliveries
        for (const delivery of wizardData.deliveries) {
          await salesAPI.createDelivery(contractId, {
            deliveryDate: delivery.deliveryDate,
            deliveryAddress: wizardData.project?.address || '',
            driver: delivery.projectManagerName || undefined,
            vehicle: delivery.receiverName || undefined,
            notes: delivery.notes,
            products: delivery.products.map(dp => {
              const product = normalizedProducts[dp.productIndex];
              return {
                productId: dp.productId,
                quantity: dp.quantity,
                notes: product?.description || ''
              };
            })
          });
        }
        
        // Create payments (compound payments - one per entry)
        for (const paymentEntry of wizardData.payment.payments) {
          const method = paymentEntry.method as string;
          // Map frontend method to API: CASH_CARD/CASH_SHIBA -> CASH + cashType; CHECK -> CHECK
          const paymentMethod = method === 'CHECK' ? 'CHECK' : 'CASH';
          const cashType = method === 'CASH_SHIBA' ? 'SHIBA' : method === 'CASH_CARD' ? 'CARD' : undefined;

          let paymentDate: Date | undefined;
          if (paymentEntry.paymentDate) {
            try {
              paymentDate = PersianCalendar.toGregorian(paymentEntry.paymentDate, 'jYYYY/jMM/jDD');
            } catch (error) {
              console.error('Error converting Persian date:', error);
            }
          }
          let handoverDate: Date | undefined;
          if (paymentEntry.handoverDate) {
            try {
              handoverDate = PersianCalendar.toGregorian(paymentEntry.handoverDate, 'jYYYY/jMM/jDD');
            } catch (error) {
              console.error('Error converting handover date:', error);
            }
          }

          const paymentStatus = paymentEntry.status === 'PAID' ? 'COMPLETED' : 'PENDING';

          await salesAPI.createPayment(contractId, {
            paymentMethod,
            totalAmount: paymentEntry.amount,
            currency: wizardData.payment.currency,
            status: paymentStatus,
            paymentDate: paymentDate?.toISOString(),
            checkNumber: paymentEntry.checkNumber,
            checkOwnerName: paymentEntry.checkOwnerName,
            handoverDate: handoverDate?.toISOString(),
            cashType: cashType ?? paymentEntry.cashType,
            nationalCode: paymentEntry.nationalCode,
            notes: paymentEntry.description
          });
        }
        
        // Move to final step (Digital Signature) instead of redirecting
        if (typeof window !== 'undefined') {
          localStorage.removeItem(CONTRACT_DRAFT_STORAGE_KEY);
        }
        setCurrentStep(7);
      } else {
        setErrors({ general: response.data.error || 'خطا در ثبت قرارداد' });
      }
    } catch (error: any) {
      console.error('Error creating contract:', error);
      console.error('Error response:', error.response?.data);
      
      setErrors(mapAxiosFormErrors(error, 'خطا در ایجاد قرارداد'));
    } finally {
      setIsSubmitting(false);
      setLoading(false);
    }
  }, [
    wizardData,
    updateWizardData,
    setCurrentStep,
    setErrors,
    setLoading,
    validateCurrentStep,
    generateContractHTML,
    userDepartment,
    departments
  ]);

  return {
    handleCreateContract,
    isSubmitting
  };
};


