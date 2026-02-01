// usePaymentHandlers Hook
// Manages payment entry modal state and handlers

import { useState, useCallback } from 'react';
import type { ContractWizardData, PaymentEntry } from '../types/contract.types';

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
  
  // Payment entry form state
  const [paymentEntryForm, setPaymentEntryForm] = useState<Partial<PaymentEntry>>({
    method: 'CASH',
    status: 'WILL_BE_PAID',
    paymentDate: '',
    amount: 0
  });

  // Handler to add a new payment entry
  const handleAddPaymentEntry = useCallback(() => {
    setEditingPaymentEntryId(null);
    // Calculate remaining amount to auto-suggest
    const existingPaymentsSum = wizardData.payment.payments.reduce((sum, p) => sum + p.amount, 0);
    const remainingAmount = wizardData.payment.totalContractAmount - existingPaymentsSum;
    setPaymentEntryForm({
      method: 'CASH',
      status: 'WILL_BE_PAID',
      paymentDate: getCurrentPersianDate(),
      amount: remainingAmount > 0 ? remainingAmount : 0,
      cashType: undefined,
      checkNumber: undefined,
      nationalCode: undefined
    });
    setShowPaymentEntryModal(true);
  }, [wizardData.payment, getCurrentPersianDate]);

  // Handler to edit an existing payment entry
  const handleEditPaymentEntry = useCallback((entryId: string) => {
    const entry = wizardData.payment.payments.find(p => p.id === entryId);
    if (entry) {
      setEditingPaymentEntryId(entryId);
      setPaymentEntryForm({ ...entry });
      setShowPaymentEntryModal(true);
    }
  }, [wizardData.payment.payments]);

  // Handler to save payment entry (add or update)
  const handleSavePaymentEntry = useCallback(() => {
    // Validate required fields
    if (!paymentEntryForm.method || !paymentEntryForm.amount || paymentEntryForm.amount <= 0 || !paymentEntryForm.status || !paymentEntryForm.paymentDate) {
      setErrors({ paymentMethod: 'لطفاً تمام فیلدهای الزامی را پر کنید' });
      return;
    }

    // Validate conditional fields
    if (paymentEntryForm.method === 'CHECK' && !paymentEntryForm.checkNumber) {
      setErrors({ paymentMethod: 'شماره چک برای پرداخت چکی الزامی است' });
      return;
    }

    if (paymentEntryForm.method === 'CHECK' && !paymentEntryForm.nationalCode) {
      setErrors({ paymentMethod: 'کد ملی برای پرداخت چکی الزامی است' });
      return;
    }

    if (paymentEntryForm.method === 'CASH' && !paymentEntryForm.cashType) {
      setErrors({ paymentMethod: 'نوع پرداخت نقدی الزامی است' });
      return;
    }

    const entry: PaymentEntry = {
      id: editingPaymentEntryId || `payment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      method: paymentEntryForm.method as 'CASH' | 'CHECK',
      amount: paymentEntryForm.amount,
      status: paymentEntryForm.status as 'PAID' | 'WILL_BE_PAID',
      paymentDate: paymentEntryForm.paymentDate!,
      description: paymentEntryForm.description,
      nationalCode: paymentEntryForm.nationalCode,
      checkNumber: paymentEntryForm.checkNumber,
      cashType: paymentEntryForm.cashType
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
      method: 'CASH',
      status: 'WILL_BE_PAID',
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
      method: 'CASH',
      status: 'WILL_BE_PAID',
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

