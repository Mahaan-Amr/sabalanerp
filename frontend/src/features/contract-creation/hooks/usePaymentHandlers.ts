// usePaymentHandlers Hook
// Manages payment entry modal state and handlers

import { useState, useCallback } from 'react';
import type { ContractWizardData, PaymentEntry, PaymentEntryMethod } from '../types/contract.types';
import { sumNumericValues, toFiniteNumber } from '@/lib/numberFormat';

export type PaymentEntryFieldErrors = Partial<Record<
  'amount' | 'paymentDate' | 'checkNumber' | 'checkOwnerName' | 'handoverDate' | 'nationalCode',
  string
>>;

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

  const [paymentEntryForm, setPaymentEntryForm] = useState<Partial<PaymentEntry>>({
    method: 'CASH_CARD',
    paymentDate: '',
    amount: 0
  });

  const getCustomerNationalCode = useCallback(() => (
    wizardData.customer?.nationalCode?.trim() || ''
  ), [wizardData.customer?.nationalCode]);

  const isPaymentNationalCodeRequired = useCallback((paymentDate?: string) => {
    const normalizedPaymentDate = paymentDate?.trim();
    return !!normalizedPaymentDate && normalizedPaymentDate !== getCurrentPersianDate();
  }, [getCurrentPersianDate]);

  const paymentEntryNationalCodeRequired = isPaymentNationalCodeRequired(paymentEntryForm.paymentDate);

  const normalizePaymentEntryForm = useCallback((
    form: Partial<PaymentEntry>,
    updates: Partial<PaymentEntry> = {}
  ): Partial<PaymentEntry> => {
    const nextForm = { ...form, ...updates };
    const nationalCodeRequired = isPaymentNationalCodeRequired(nextForm.paymentDate);

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

  const updatePaymentEntryForm = useCallback((updates: Partial<PaymentEntry>) => {
    setPaymentEntryErrors((prev) => {
      const next = { ...prev };
      Object.keys(updates).forEach((key) => {
        delete next[key as keyof PaymentEntryFieldErrors];
      });
      return next;
    });
    setPaymentEntryForm((prev) => normalizePaymentEntryForm(prev, updates));
  }, [normalizePaymentEntryForm]);

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
      setShowPaymentEntryModal(true);
    }
  }, [wizardData.payment.payments, normalizePaymentEntryForm]);

  const handleSavePaymentEntry = useCallback(() => {
    const method = paymentEntryForm.method as PaymentEntryMethod | undefined;
    const nextErrors: PaymentEntryFieldErrors = {};

    if (!method) {
      setErrors({ paymentMethod: 'نوع پرداخت را انتخاب کنید' });
      return;
    }

    const paymentAmount = toFiniteNumber(paymentEntryForm.amount);
    if (paymentAmount <= 0) {
      nextErrors.amount = 'مبلغ باید بیشتر از صفر باشد';
    }

    if (method === 'CASH_CARD' || method === 'CASH_SHIBA') {
      if (!paymentEntryForm.paymentDate || !paymentEntryForm.paymentDate.trim()) {
        nextErrors.paymentDate = 'تاریخ پرداخت الزامی است';
      }
    }

    if (method === 'CHECK') {
      if (!paymentEntryForm.checkNumber || !paymentEntryForm.checkNumber.trim()) {
        nextErrors.checkNumber = 'شماره چک الزامی است';
      }
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

    if (isPaymentNationalCodeRequired(paymentEntryForm.paymentDate)) {
      const normalizedNationalCode = paymentEntryForm.nationalCode?.trim() || '';
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

    const entry: PaymentEntry = {
      id: editingPaymentEntryId || `payment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      method,
      amount: paymentAmount,
      paymentDate: paymentEntryForm.paymentDate!,
      description: paymentEntryForm.description,
      nationalCode: isPaymentNationalCodeRequired(paymentEntryForm.paymentDate)
        ? paymentEntryForm.nationalCode?.trim()
        : undefined,
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
    setPaymentEntryForm({
      method: 'CASH_CARD',
      paymentDate: '',
      amount: 0
    });
    setPaymentEntryErrors({});
    setErrors({});
  }, [paymentEntryForm, editingPaymentEntryId, wizardData.payment, updateWizardData, setErrors, isPaymentNationalCodeRequired]);

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
    setPaymentEntryForm({
      method: 'CASH_CARD',
      paymentDate: '',
      amount: 0
    });
    setPaymentEntryErrors({});
    setErrors({});
  }, [setErrors]);

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
    handleAddPaymentEntry,
    handleEditPaymentEntry,
    handleSavePaymentEntry,
    handleDeletePaymentEntry,
    handleClosePaymentEntryModal
  };
};
