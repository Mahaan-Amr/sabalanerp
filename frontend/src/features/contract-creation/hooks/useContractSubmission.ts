// useContractSubmission Hook
// Manages contract creation and submission

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { ContractWizardData } from '../types/contract.types';
import { salesAPI } from '@/lib/api';
import { PersianCalendar } from '@/lib/persian-calendar';

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
      // Calculate total amount
      const totalAmount = wizardData.products.reduce((sum, product) => sum + product.totalPrice, 0);
      
      // Create contract
      const contractData = {
        title: 'قرارداد فروش سنگ',
        titlePersian: 'قرارداد فروش سنگ',
        customerId: wizardData.customerId,
        departmentId: userDepartment || departments?.[0]?.id || 'default-department-id',
        content: generateContractHTML({
          contractNumber: wizardData.contractNumber,
          contractDate: wizardData.contractDate,
          customer: wizardData.customer,
          project: wizardData.project,
          products: wizardData.products,
          deliveries: wizardData.deliveries,
          payment: wizardData.payment
        }),
        contractData: {
          contractNumber: wizardData.contractNumber,
          contractDate: wizardData.contractDate,
          customer: wizardData.customer,
          project: wizardData.project,
          products: wizardData.products,
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
        
        // Store contract ID in signature state for Step 8
        updateWizardData({
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
            phoneNumber:
              wizardData.customer?.homeNumber ||
              wizardData.customer?.workNumber ||
              wizardData.customer?.projectManagerNumber ||
              wizardData.customer?.phoneNumbers?.find((p) => p.isPrimary)?.number ||
              wizardData.customer?.phoneNumbers?.[0]?.number ||
              null
          }
        });
        
        // Create contract items
        for (const product of wizardData.products) {
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
              const product = wizardData.products[dp.productIndex];
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
        
        // Move to Step 8 (Digital Signature) instead of redirecting
        setCurrentStep(8);
      } else {
        setErrors({ general: response.data.error || 'خطا در ثبت قرارداد' });
      }
    } catch (error: any) {
      console.error('Error creating contract:', error);
      console.error('Error response:', error.response?.data);
      
      if (error.response?.data?.details) {
        // Show validation errors
        const validationErrors = error.response.data.details.map((err: any) => err.msg).join(', ');
        setErrors({ general: `خطاهای اعتبارسنجی: ${validationErrors}` });
      } else {
        setErrors({ general: error.response?.data?.error || 'خطا در ایجاد قرارداد' });
      }
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


