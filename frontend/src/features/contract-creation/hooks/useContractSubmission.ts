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
import { getPreparedQuantity, getPreparedUnit, isPreparedProductType, normalizeContractProductType } from '../utils/preparedProductUtils';
import { calculateProductOperations } from '@sabalanerp/contract-product-graph';
import { getDeliverableProductEntries, reconcileDeliveryProductReferences } from '../utils/deliveryScheduleController';
import { normalizeMandatoryLongitudinalCuttingPricing } from '../utils/mandatoryCuttingPricing';
import { hasUnresolvedLegacyRemainingChildAddOns } from '../services/remainingStoneChildAddOnService';
import { getContractGrossPayableTotal, reconcileContractProductPricing } from '../utils/contractProductPricing';
import { reconcileContractProductGraph } from '../utils/contractProductGraphReconciliation';
import {
  hasUnconfirmedProductQuantityOverride,
  normalizeProductFinishingCollection
} from '../utils/productFinishingCollections';

interface UseContractSubmissionOptions {
  wizardData: ContractWizardData;
  updateWizardData: (updates: Partial<ContractWizardData>) => void;
  setCurrentStep: (step: number) => void;
  setErrors: (errors: Record<string, string>) => void;
  setLoading: (loading: boolean) => void;
  validateCurrentStep: () => boolean;
  validateAllSteps?: () => boolean;
  generateContractHTML: (data: any) => string;
  userDepartment?: string;
  departments?: Array<{ id: string }>;
  mode?: 'create' | 'edit';
  contractId?: string;
  editSession?: {
    draftId: string;
    browserSessionId: string;
    leaseToken: string;
    baseRevision: number;
  } | null;
  onCommitted?: () => Promise<void> | void;
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

const toIsoDate = (value?: string | null): string | undefined => {
  if (!value) return undefined;
  try {
    if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(value)) {
      return PersianCalendar.toGregorian(value, 'jYYYY/jMM/jDD').toISOString();
    }
  } catch (error) {
    console.error('Error converting Persian date:', error);
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
};

export const useContractSubmission = (options: UseContractSubmissionOptions) => {
  const {
    wizardData,
    updateWizardData,
    setCurrentStep,
    setErrors,
    setLoading,
    validateCurrentStep,
    validateAllSteps,
    generateContractHTML,
    userDepartment,
    departments,
    mode = 'create',
    contractId,
    editSession,
    onCommitted
  } = options;

  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleCreateContract = useCallback(async () => {
    const isEditMode = mode === 'edit';
    const editContractId = contractId;
    if (isEditMode) {
      if (!editContractId) {
        setErrors({ general: 'شناسه قرارداد برای ویرایش مشخص نیست.' });
        return;
      }
      if (validateAllSteps && !validateAllSteps()) return;
    } else if (!validateCurrentStep()) {
      return;
    }

    const unresolvedLegacyAddOnRows = wizardData.products.filter(hasUnresolvedLegacyRemainingChildAddOns);
    if (unresolvedLegacyAddOnRows.length > 0) {
      setErrors({
        products: `${unresolvedLegacyAddOnRows.length} محصول باقی‌مانده دارای افزونه قدیمی تعیین‌تکلیف‌نشده است. در مرحله انتخاب محصولات، برای هر مورد «پذیرش و محاسبه مجدد» یا «حذف» را انتخاب کنید.`
      });
      setCurrentStep(5);
      return;
    }

    const productGraphConflicts = reconcileContractProductGraph(wizardData.products);
    if (productGraphConflicts.length > 0) {
      setErrors({
        products: `ثبت قرارداد متوقف شد: ${productGraphConflicts.map((conflict) => conflict.message).join(' | ')}`
      });
      setCurrentStep(5);
      return;
    }

    const currentDeliveryReferences = reconcileDeliveryProductReferences(wizardData.products, wizardData.deliveries);
    if (currentDeliveryReferences.conflicts.length > 0) {
      setErrors({
        deliveries: `برنامه تحویل نیاز به بازبینی دارد: ${currentDeliveryReferences.conflicts.map((conflict) => conflict.message).join(' | ')}`
      });
      setCurrentStep(5);
      return;
    }

    if (wizardData.products.some(hasUnconfirmedProductQuantityOverride)) {
      setErrors({ products: 'مقدار دستی ابزار یا پرداخت پس از تغییر هندسه نیاز به تأیید دارد.' });
      setCurrentStep(5);
      return;
    }
    
    setIsSubmitting(true);
    setLoading(true);
    try {
      const targetDepartmentId = userDepartment || departments?.[0]?.id;
      if (!targetDepartmentId) {
        setErrors({ general: 'برای ثبت قرارداد، دپارتمان فروش کاربر باید مشخص باشد.' });
        return;
      }

      // Calculate total amount
      const normalizedProducts = wizardData.products.map((originalProduct) => {
        const normalizedProductType = normalizeContractProductType(originalProduct.productType) || originalProduct.productType;
        let productWithType = {
          ...originalProduct,
          productType: normalizedProductType,
          ...(isPreparedProductType(normalizedProductType) && {
            preparedUnit: getPreparedUnit(originalProduct),
            preparedQuantity: getPreparedQuantity(originalProduct),
            quantity: getPreparedQuantity(originalProduct),
            squareMeters: getPreparedUnit(originalProduct) === 'squareMeter' ? getPreparedQuantity(originalProduct) : 0,
            unitPrice: originalProduct.unitPrice ?? originalProduct.pricePerSquareMeter ?? 0,
            pricePerSquareMeter: originalProduct.unitPrice ?? originalProduct.pricePerSquareMeter ?? 0
          })
        };
        if (originalProduct.operationPolicyInput) {
          const operationResult = calculateProductOperations(originalProduct.operationPolicyInput);
          if (!operationResult.ok) {
            throw new Error(operationResult.conflicts.map(conflict => conflict.message).join(' | '));
          }
          const appliedById = new Map(
            (originalProduct.appliedSubServices || []).map(item => [item.id, item])
          );
          const finishingsById = new Map(
            (originalProduct.finishings || []).map(item => [item.selectionId, item])
          );
          productWithType = {
            ...productWithType,
            appliedSubServices: operationResult.result.tools.map(tool => ({
              ...(appliedById.get(tool.toolSelectionId) as any),
              id: tool.toolSelectionId,
              subServiceId: tool.catalogItemId,
              meter: Number(tool.finalQuantity),
              cost: Number(tool.amountToman),
              calculationBase: tool.unit === 'meter' ? 'length' : 'squareMeters',
              edges: Object.fromEntries((tool.edges || []).map(edge => [edge, true]))
            })),
            finishings: operationResult.result.finishings.map(finishing => ({
              ...(finishingsById.get(finishing.finishingSelectionId) as any),
              selectionId: finishing.finishingSelectionId,
              finishingId: finishing.catalogItemId,
              name: finishing.name,
              calculationBase: finishing.unit === 'meter' ? 'length' : 'squareMeters',
              unitPrice: Number(finishing.rateToman),
              automaticQuantity: Number(finishing.automaticQuantity),
              quantity: Number(finishing.finalQuantity),
              quantityMode: finishing.quantityOverride ? 'manual' : 'auto',
              overrideStatus: 'current',
              cost: Number(finishing.amountToman)
            })),
            totalSubServiceCost: operationResult.result.tools.reduce(
              (sum, tool) => sum + Number(tool.amountToman), 0
            )
          };
        }
        const product = normalizeMandatoryLongitudinalCuttingPricing(productWithType);
        const finishing = normalizeProductFinishing(product);
        if (!finishing) return reconcileContractProductPricing({
          ...product,
          finishings: normalizeProductFinishingCollection(product)
        });
        return reconcileContractProductPricing({
          ...product,
          finishings: normalizeProductFinishingCollection(product),
          finishingCalculationBase: product.finishingCalculationBase || finishing.calculationBase,
          finishingUnitPrice: product.finishingUnitPrice ?? finishing.unitPrice,
          finishingQuantity: product.finishingQuantity ?? finishing.quantity,
          finishingPricePerSquareMeter: product.finishingPricePerSquareMeter ?? finishing.unitPrice,
          finishingSquareMeters:
            product.finishingSquareMeters ??
            (finishing.calculationBase === 'squareMeters' ? finishing.quantity : null),
          finishingCost: product.finishingCost ?? finishing.cost
        });
      });
      const totalAmount = wizardData.payment.totalContractAmount ||
        getContractGrossPayableTotal(normalizedProducts, wizardData.serviceRows || []);
      const normalizedDeliveryReferences = reconcileDeliveryProductReferences(normalizedProducts, currentDeliveryReferences.deliveries);
      const deliverableProductRowIds = new Set(
        getDeliverableProductEntries(normalizedProducts)
          .map(({ product }) => product.rowId)
          .filter((rowId): rowId is string => !!rowId)
      );
      const contractDeliveries = deliverableProductRowIds.size === 0
        ? []
        : normalizedDeliveryReferences.deliveries.map((delivery) => ({
          ...delivery,
          products: delivery.products.filter((product) =>
            product.rowType !== 'service' &&
            !!product.productRowId &&
            deliverableProductRowIds.has(product.productRowId)
          )
        })).filter((delivery) => delivery.products.length > 0);
      
      // Create/update contract
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
          serviceRows: wizardData.serviceRows || [],
          deliveries: contractDeliveries,
          payment: wizardData.payment,
          discount: wizardData.discount || null
        }),
        contractData: {
          ...wizardData,
          contractNumber: wizardData.contractNumber,
          contractDate: wizardData.contractDate,
          customerId: wizardData.customerId || wizardData.customer?.id || '',
          projectId: wizardData.projectId || wizardData.project?.id || '',
          customer: wizardData.customer,
          project: wizardData.project,
          products: normalizedProducts,
          serviceRows: wizardData.serviceRows || [],
          deliveries: contractDeliveries,
          payment: wizardData.payment,
          discount: wizardData.discount || null
        },
        totalAmount,
        currency: 'تومان',
        potentialProjectId: typeof window !== 'undefined'
          ? new URLSearchParams(window.location.search).get('potentialProjectId') || undefined
          : undefined,
        _relations: {
          items: normalizedProducts.map((product) => ({
            productId: product.productId,
            productRowId: product.rowId,
            productType: product.productType,
            quantity: product.quantity,
            unitPrice: product.unitPrice ?? product.pricePerSquareMeter,
            totalPrice: product.totalPrice,
            description: product.description || null,
            isMandatory: product.isMandatory || false,
            mandatoryPercentage: product.mandatoryPercentage || null,
            originalTotalPrice: product.originalTotalPrice || null,
            stairSystemId: product.stairSystemId || null,
            stairPartType: product.stairPartType || null
          })),
          deliveries: contractDeliveries.map((delivery) => ({
            deliveryDate: toIsoDate(delivery.deliveryDate) || new Date().toISOString(),
            deliveryAddress: delivery.deliveryAddress || wizardData.project?.address || '',
            driver: delivery.projectManagerName || null,
            vehicle: delivery.receiverName || null,
            notes: delivery.notes || null,
            products: delivery.products
              .filter((dp) => dp.rowType !== 'service' && !!dp.productRowId)
              .map((dp) => {
              const product = normalizedProducts.find((candidate) => candidate.rowId === dp.productRowId);
              return {
                productId: product?.productId || dp.productId,
                productRowId: dp.productRowId,
                quantity: dp.amount ?? dp.quantity,
                notes: product?.description || null
              };
            })
          })),
          payments: wizardData.payment.payments.map((paymentEntry) => {
            const method = paymentEntry.method as string;
            const paymentMethod = method === 'CHECK' ? 'CHECK' : method === 'CUSTOMER_BALANCE' ? 'RECEIPT' : 'CASH';
            const cashType = method === 'CASH_SHIBA' ? 'SHIBA' : method === 'CASH_CARD' ? 'CARD' : undefined;
            const notes = [
              method === 'CUSTOMER_BALANCE' ? 'استفاده از باقی مانده مشتری' : null,
              paymentEntry.description || null
            ].filter(Boolean).join('، ');
            return {
              paymentMethod,
              totalAmount: paymentEntry.amount,
              currency: wizardData.payment.currency,
              status: paymentEntry.status === 'PAID' ? 'COMPLETED' : 'PENDING',
              paymentDate: toIsoDate(paymentEntry.paymentDate),
              checkNumber: paymentEntry.checkNumber || null,
              checkOwnerName: paymentEntry.checkOwnerName || null,
              handoverDate: toIsoDate(paymentEntry.handoverDate),
              cashType: cashType ?? paymentEntry.cashType ?? null,
              nationalCode: paymentEntry.nationalCode || null,
              notes: notes || null
            };
          })
        }
      };
      
      const response = isEditMode
        ? await salesAPI.updateContract(editContractId as string, contractData, editSession || undefined)
        : await salesAPI.createContract(contractData, editSession || undefined);
      
      if (response.data.success) {
        if (isEditMode) {
          await onCommitted?.();
          router.push(`/dashboard/sales/contracts/${editContractId}`);
          return;
        }
        const createdContractId = response.data.data.id;
        const savedContractNumber = response.data.data.contractNumber || wizardData.contractNumber;
        const creatorSequenceNumber = response.data.data.creatorSequenceNumber ?? wizardData.creatorSequenceNumber ?? null;
        
        // Store contract ID in signature state for Step 8
        updateWizardData({
          products: normalizedProducts,
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
            contractId: createdContractId,
            contractStatus: response.data.data.status || null,
            phoneNumber: getCustomerSmsPhoneNumber(wizardData.customer)
          }
        });
        
        // Move to final step (Digital Signature) instead of redirecting
        if (typeof window !== 'undefined') {
          localStorage.removeItem(CONTRACT_DRAFT_STORAGE_KEY);
        }
        await onCommitted?.();
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
    validateAllSteps,
    generateContractHTML,
    userDepartment,
    departments,
    mode,
    contractId,
    editSession,
    onCommitted,
    router
  ]);

  return {
    handleCreateContract,
    isSubmitting
  };
};
