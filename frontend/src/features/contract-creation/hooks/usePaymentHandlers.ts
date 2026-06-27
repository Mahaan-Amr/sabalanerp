// usePaymentHandlers Hook
// Manages payment entry modal state and handlers

import { useState, useCallback } from 'react';
import type { ContractWizardData, PaymentEntry, PaymentEntryMethod } from '../types/contract.types';
import { sumNumericValues, toFiniteNumber } from '@/lib/numberFormat';
import { crmAPI } from '@/lib/api';

export type PaymentEntryFieldErrors = Partial<Record<
  'amount' | 'paymentDate' | 'checkNumber' | 'checkOwnerName' | 'handoverDate' | 'nationalCode',
  string
>>;

type NationalCodeConflict = {
  existing: string;
  entered: string;
};

interface UsePaymentHandlersOptions {
  wizardData: ContractWizardData;
  updateWizardData: (updates: Partial<ContractWizardData>) => void;
  setErrors: (errors: Record<string, string>) => void;
  getCurrentPersianDate: () => string;
}

export const usePaymentHandlers = (options: UsePaymentHandlersOptions) => {
  const { wizardData, updateWizardData, setErrors, getCurrentPersianDate } = options;

  const [showPaymentEntryModal, setShowPaymentEntryModal] = useState(false);
  const [editingPaymentEntryId, setEditingPaymentEntryId] = useState<string | null>(null);
  const [paymentEntryErrors, setPaymentEntryErrors] = useState<PaymentEntryFieldErrors>({});
  const [nationalCodeConflict, setNationalCodeConflict] = useState<NationalCodeConflict | null>(null);

  const [paymentEntryForm, setPaymentEntryForm] = useState<Partial<PaymentEntry>>({
    method: 'CASH_CARD',
    paymentDate: '',
    amount: 0
  });

  const normalizeNationalCodeDigits = useCallback((value?: string | null): string => (
    String(value || '')
      .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
      .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
      .replace(/\D/g, '')
  ), []);

  const getCustomerNationalCode = useCallback(() => (
    normalizeNationalCodeDigits(wizardData.customer?.nationalCode)
  ), [normalizeNationalCodeDigits, wizardData.customer?.nationalCode]);

  const isPaymentNationalCodeRequired = useCallback((paymentDate?: string) => {
    const normalizedPaymentDate = paymentDate?.trim();
    return !!normalizedPaymentDate && normalizedPaymentDate !== getCurrentPersianDate();
  }, [getCurrentPersianDate]);

  const paymentEntryNationalCodeRequired =
    paymentEntryForm.method !== 'CUSTOMER_BALANCE' &&
    isPaymentNationalCodeRequired(paymentEntryForm.paymentDate);

  const normalizePaymentEntryForm = useCallback((
    form: Partial<PaymentEntry>,
    updates: Partial<PaymentEntry> = {}
  ): Partial<PaymentEntry> => {
    const nextForm = { ...form, ...updates };
    const nationalCodeRequired =
      nextForm.method !== 'CUSTOMER_BALANCE' &&
      isPaymentNationalCodeRequired(nextForm.paymentDate);

    if (!nationalCodeRequired) {
      return {
        ...nextForm,
        nationalCode: undefined
      };
    }

    if ('nationalCode' in updates) {
      return nextForm;
    }

    return {
      ...nextForm,
      nationalCode: nextForm.nationalCode || getCustomerNationalCode()
    };
  }, [getCustomerNationalCode, isPaymentNationalCodeRequired]);

  const resetPaymentEntryForm = useCallback(() => {
    setPaymentEntryForm({
      method: 'CASH_CARD',
      paymentDate: '',
      amount: 0
    });
  }, []);

  const updatePaymentEntryForm = useCallback((updates: Partial<PaymentEntry>) => {
    setNationalCodeConflict(null);
    setPaymentEntryErrors((prev) => {
      const next = { ...prev };
      Object.keys(updates).forEach((key) => {
        delete next[key as keyof PaymentEntryFieldErrors];
      });
      return next;
    });
    setPaymentEntryForm((prev) => {
      const methodChangedToCustomerBalance = updates.method === 'CUSTOMER_BALANCE' && prev.method !== 'CUSTOMER_BALANCE';
      const normalizedUpdates = methodChangedToCustomerBalance
        ? {
            ...updates,
            paymentDate: updates.paymentDate || prev.paymentDate || getCurrentPersianDate(),
            checkNumber: undefined,
            checkOwnerName: undefined,
            handoverDate: undefined,
            nationalCode: undefined
          }
        : updates;
      return normalizePaymentEntryForm(prev, normalizedUpdates);
    });
  }, [getCurrentPersianDate, normalizePaymentEntryForm]);

  const handleAddPaymentEntry = useCallback(() => {
    setEditingPaymentEntryId(null);
    const existingPaymentsSum = sumNumericValues(wizardData.payment.payments, (payment) => payment.amount);
    const remainingAmount = toFiniteNumber(wizardData.payment.totalContractAmount) - existingPaymentsSum;
    setPaymentEntryForm(normalizePaymentEntryForm({
      method: 'CASH_CARD',
      paymentDate: getCurrentPersianDate(),
      amount: remainingAmount > 0 ? remainingAmount : 0,
      checkNumber: undefined,
      checkOwnerName: undefined,
      handoverDate: undefined,
      nationalCode: undefined
    }));
    setPaymentEntryErrors({});
    setNationalCodeConflict(null);
    setShowPaymentEntryModal(true);
  }, [wizardData.payment, getCurrentPersianDate, normalizePaymentEntryForm]);

  const handleEditPaymentEntry = useCallback((entryId: string) => {
    const entry = wizardData.payment.payments.find(p => p.id === entryId);
    if (entry) {
      setEditingPaymentEntryId(entryId);
      const rawMethod = (entry as { method?: string }).method;
      const method: PaymentEntryMethod = rawMethod === 'CASH'
        ? (entry.cashType === 'SHIBA' ? 'CASH_SHIBA' : 'CASH_CARD')
        : (entry.method as PaymentEntryMethod);
      setPaymentEntryForm(normalizePaymentEntryForm({ ...entry, method }));
      setPaymentEntryErrors({});
      setNationalCodeConflict(null);
      setShowPaymentEntryModal(true);
    }
  }, [wizardData.payment.payments, normalizePaymentEntryForm]);

  const handleSavePaymentEntry = useCallback(async (saveOptions?: { allowNationalCodeConflict?: boolean }) => {
    const method = paymentEntryForm.method as PaymentEntryMethod | undefined;
    const nextErrors: PaymentEntryFieldErrors = {};
    const isCustomerBalance = method === 'CUSTOMER_BALANCE';
    const nationalCodeRequired = !isCustomerBalance && isPaymentNationalCodeRequired(paymentEntryForm.paymentDate);
    const normalizedNationalCode = normalizeNationalCodeDigits(paymentEntryForm.nationalCode);
    const customerNationalCode = getCustomerNationalCode();

    if (!method) {
      setErrors({ paymentMethod: 'نوع پرداخت را انتخاب کنید' });
      return;
    }

    const paymentAmount = toFiniteNumber(paymentEntryForm.amount);
    if (paymentAmount <= 0) {
      nextErrors.amount = 'مبلغ باید بیشتر از صفر باشد';
    }

    if (method === 'CASH_CARD' || method === 'CASH_SHIBA' || method === 'CUSTOMER_BALANCE') {
      if (!paymentEntryForm.paymentDate || !paymentEntryForm.paymentDate.trim()) {
        nextErrors.paymentDate = isCustomerBalance ? 'تاریخ استفاده از مانده الزامی است' : 'تاریخ پرداخت الزامی است';
      }
    }

    if (method === 'CHECK') {
      if (!paymentEntryForm.checkOwnerName || !paymentEntryForm.checkOwnerName.trim()) {
        nextErrors.checkOwnerName = 'نام صاحب چک الزامی است';
      }
      if (!paymentEntryForm.handoverDate || !paymentEntryForm.handoverDate.trim()) {
        nextErrors.handoverDate = 'تاریخ تحویل چک الزامی است';
      }
      if (!paymentEntryForm.paymentDate || !paymentEntryForm.paymentDate.trim()) {
        nextErrors.paymentDate = 'تاریخ سررسید چک الزامی است';
      }
    }

    if (nationalCodeRequired) {
      if (!normalizedNationalCode) {
        nextErrors.nationalCode = 'کد ملی برای پرداخت با تاریخ غیر از امروز الزامی است';
      } else if (normalizedNationalCode.length !== 10) {
        nextErrors.nationalCode = 'کد ملی باید 10 رقم باشد';
      }
    }

    if (Object.keys(nextErrors).length > 0) {
      setPaymentEntryErrors(nextErrors);
      setErrors({});
      return;
    }

    if (
      nationalCodeRequired &&
      customerNationalCode &&
      normalizedNationalCode &&
      customerNationalCode !== normalizedNationalCode &&
      !saveOptions?.allowNationalCodeConflict
    ) {
      setNationalCodeConflict({
        existing: customerNationalCode,
        entered: normalizedNationalCode
      });
      setErrors({});
      return;
    }

    const entry: PaymentEntry = {
      id: editingPaymentEntryId || `payment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      method,
      amount: paymentAmount,
      paymentDate: paymentEntryForm.paymentDate!,
      description: paymentEntryForm.description,
      nationalCode: nationalCodeRequired ? normalizedNationalCode : undefined,
      checkNumber: paymentEntryForm.checkNumber,
      checkOwnerName: paymentEntryForm.checkOwnerName,
      handoverDate: paymentEntryForm.handoverDate,
      cashType: paymentEntryForm.cashType,
      status: paymentEntryForm.status
    };

    const updatedPayments = editingPaymentEntryId
      ? wizardData.payment.payments.map(p => p.id === editingPaymentEntryId ? entry : p)
      : [...wizardData.payment.payments, entry];

    updateWizardData({
      payment: {
        ...wizardData.payment,
        payments: updatedPayments
      }
    });

    setShowPaymentEntryModal(false);
    setEditingPaymentEntryId(null);
    resetPaymentEntryForm();
    setPaymentEntryErrors({});
    setNationalCodeConflict(null);
    setErrors({});

    if (
      nationalCodeRequired &&
      normalizedNationalCode &&
      !customerNationalCode &&
      wizardData.customerId &&
      !saveOptions?.allowNationalCodeConflict
    ) {
      try {
        await crmAPI.updateCustomer(wizardData.customerId, {
          nationalCode: normalizedNationalCode
        });

        if (wizardData.customer) {
          updateWizardData({
            customer: {
              ...wizardData.customer,
              nationalCode: normalizedNationalCode
            }
          });
        }
      } catch (error) {
        console.error('Failed to persist customer national code from payment entry:', error);
        setErrors({
          paymentWarning: 'پرداخت ذخیره شد، اما کد ملی در اطلاعات مشتری ثبت نشد.'
        });
      }
    }
  }, [
    paymentEntryForm,
    editingPaymentEntryId,
    wizardData.payment,
    wizardData.customerId,
    wizardData.customer,
    updateWizardData,
    setErrors,
    isPaymentNationalCodeRequired,
    normalizeNationalCodeDigits,
    getCustomerNationalCode,
    resetPaymentEntryForm
  ]);

  const handleContinueNationalCodeConflict = useCallback(() => {
    void handleSavePaymentEntry({ allowNationalCodeConflict: true });
  }, [handleSavePaymentEntry]);

  const handleDeletePaymentEntry = useCallback((entryId: string) => {
    const updatedPayments = wizardData.payment.payments.filter(p => p.id !== entryId);
    updateWizardData({
      payment: {
        ...wizardData.payment,
        payments: updatedPayments
      }
    });
  }, [wizardData.payment, updateWizardData]);

  const handleClosePaymentEntryModal = useCallback(() => {
    setShowPaymentEntryModal(false);
    setEditingPaymentEntryId(null);
    resetPaymentEntryForm();
    setPaymentEntryErrors({});
    setNationalCodeConflict(null);
    setErrors({});
  }, [setErrors, resetPaymentEntryForm]);

  return {
    showPaymentEntryModal,
    setShowPaymentEntryModal,
    editingPaymentEntryId,
    setEditingPaymentEntryId,
    paymentEntryForm,
    setPaymentEntryForm,
    updatePaymentEntryForm,
    paymentEntryErrors,
    setPaymentEntryErrors,
    paymentEntryNationalCodeRequired,
    nationalCodeConflict,
    setNationalCodeConflict,
    handleAddPaymentEntry,
    handleEditPaymentEntry,
    handleSavePaymentEntry,
    handleContinueNationalCodeConflict,
    handleDeletePaymentEntry,
    handleClosePaymentEntryModal
  };
};
