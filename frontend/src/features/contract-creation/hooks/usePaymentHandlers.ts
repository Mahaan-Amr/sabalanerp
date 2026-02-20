// usePaymentHandlers Hook
// Manages payment entry modal state and handlers

import { useState, useCallback } from 'react';
import type { ContractWizardData, PaymentEntry, PaymentEntryMethod } from '../types/contract.types';

interface UsePaymentHandlersOptions {
  wizardData: ContractWizardData;
  updateWizardData: (updates: Partial<ContractWizardData>) => void;
  setErrors: (errors: Record<string, string>) => void;
  getCurrentPersianDate: () => string;
}

export const usePaymentHandlers = (options: UsePaymentHandlersOptions) => {
  const { wizardData, updateWizardData, setErrors, getCurrentPersianDate } = options;

  // Modal visibility
  const [showPaymentEntryModal, setShowPaymentEntryModal] = useState(false);
  const [editingPaymentEntryId, setEditingPaymentEntryId] = useState<string | null>(null);
  
  // Payment entry form state (CASH_CARD | CASH_SHIBA | CHECK)
  const [paymentEntryForm, setPaymentEntryForm] = useState<Partial<PaymentEntry>>({
    method: 'CASH_CARD',
    paymentDate: '',
    amount: 0
  });

  // Handler to add a new payment entry
  const handleAddPaymentEntry = useCallback(() => {
    setEditingPaymentEntryId(null);
    const existingPaymentsSum = wizardData.payment.payments.reduce((sum, p) => sum + p.amount, 0);
    const remainingAmount = wizardData.payment.totalContractAmount - existingPaymentsSum;
    setPaymentEntryForm({
      method: 'CASH_CARD',
      paymentDate: getCurrentPersianDate(),
      amount: remainingAmount > 0 ? remainingAmount : 0,
      checkNumber: undefined,
      checkOwnerName: undefined,
      handoverDate: undefined,
      nationalCode: undefined
    });
    setShowPaymentEntryModal(true);
  }, [wizardData.payment, getCurrentPersianDate]);

  // Handler to edit an existing payment entry (normalize legacy CASH to CASH_CARD/CASH_SHIBA)
  const handleEditPaymentEntry = useCallback((entryId: string) => {
    const entry = wizardData.payment.payments.find(p => p.id === entryId);
    if (entry) {
      setEditingPaymentEntryId(entryId);
      const rawMethod = (entry as { method?: string }).method;
      const method: PaymentEntryMethod = rawMethod === 'CASH'
        ? (entry.cashType === 'SHIBA' ? 'CASH_SHIBA' : 'CASH_CARD')
        : (entry.method as PaymentEntryMethod);
      setPaymentEntryForm({ ...entry, method });
      setShowPaymentEntryModal(true);
    }
  }, [wizardData.payment.payments]);

  // Handler to save payment entry (add or update)
  const handleSavePaymentEntry = useCallback(() => {
    const method = paymentEntryForm.method as PaymentEntryMethod | undefined;
    if (!method) {
      setErrors({ paymentMethod: 'نوع پرداخت را انتخاب کنید' });
      return;
    }
    if (!paymentEntryForm.amount || paymentEntryForm.amount <= 0) {
      setErrors({ paymentMethod: 'مبلغ باید بیشتر از صفر باشد' });
      return;
    }

    // نقدی (CASH_CARD / CASH_SHIBA): amount + paymentDate
    if (method === 'CASH_CARD' || method === 'CASH_SHIBA') {
      if (!paymentEntryForm.paymentDate || !paymentEntryForm.paymentDate.trim()) {
        setErrors({ paymentMethod: 'تاریخ پرداخت الزامی است' });
        return;
      }
    }

    // چک: checkNumber, checkOwnerName, amount, handoverDate, paymentDate (سررسید)
    if (method === 'CHECK') {
      if (!paymentEntryForm.checkNumber || !paymentEntryForm.checkNumber.trim()) {
        setErrors({ paymentMethod: 'شماره چک الزامی است' });
        return;
      }
      if (!paymentEntryForm.checkOwnerName || !paymentEntryForm.checkOwnerName.trim()) {
        setErrors({ paymentMethod: 'نام صاحب چک الزامی است' });
        return;
      }
      if (!paymentEntryForm.handoverDate || !paymentEntryForm.handoverDate.trim()) {
        setErrors({ paymentMethod: 'تاریخ تحویل چک الزامی است' });
        return;
      }
      if (!paymentEntryForm.paymentDate || !paymentEntryForm.paymentDate.trim()) {
        setErrors({ paymentMethod: 'تاریخ سررسید چک الزامی است' });
        return;
      }
    }

    const entry: PaymentEntry = {
      id: editingPaymentEntryId || `payment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      method: method as PaymentEntryMethod,
      amount: paymentEntryForm.amount,
      paymentDate: paymentEntryForm.paymentDate!,
      description: paymentEntryForm.description,
      nationalCode: paymentEntryForm.nationalCode,
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

    // Close modal and reset form
    setShowPaymentEntryModal(false);
    setEditingPaymentEntryId(null);
    setPaymentEntryForm({
      method: 'CASH_CARD',
      paymentDate: '',
      amount: 0
    });
    setErrors({});
  }, [paymentEntryForm, editingPaymentEntryId, wizardData.payment, updateWizardData, setErrors]);

  // Handler to delete a payment entry
  const handleDeletePaymentEntry = useCallback((entryId: string) => {
    const updatedPayments = wizardData.payment.payments.filter(p => p.id !== entryId);
    updateWizardData({
      payment: {
        ...wizardData.payment,
        payments: updatedPayments
      }
    });
  }, [wizardData.payment.payments, updateWizardData]);

  // Handler to close modal and reset state
  const handleClosePaymentEntryModal = useCallback(() => {
    setShowPaymentEntryModal(false);
    setEditingPaymentEntryId(null);
    setPaymentEntryForm({
      method: 'CASH_CARD',
      paymentDate: '',
      amount: 0
    });
    setErrors({});
  }, [setErrors]);

  return {
    // Modal state
    showPaymentEntryModal,
    setShowPaymentEntryModal,
    editingPaymentEntryId,
    setEditingPaymentEntryId,
    
    // Form state
    paymentEntryForm,
    setPaymentEntryForm,
    
    // Handlers
    handleAddPaymentEntry,
    handleEditPaymentEntry,
    handleSavePaymentEntry,
    handleDeletePaymentEntry,
    handleClosePaymentEntryModal
  };
};


