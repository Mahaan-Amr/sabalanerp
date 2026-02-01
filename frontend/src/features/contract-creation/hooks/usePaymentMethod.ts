// Payment method hook
// Manages payment entries and installments

import { useState, useCallback, useMemo } from 'react';
import type { PaymentMethod, PaymentEntry } from '../types/contract.types';
import { validatePayment } from '../services/validationService';

export const usePaymentMethod = (totalContractAmount: number) => {
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>({
    payments: [],
    currency: 'تومان',
    totalContractAmount: 0
  });

  // Update total contract amount
  const updateTotalAmount = useCallback((amount: number) => {
    setPaymentMethod(prev => ({
      ...prev,
      totalContractAmount: amount
    }));
  }, []);

  // Calculate total payment amount
  const totalPaymentAmount = useMemo(() => {
    return paymentMethod.payments.reduce((sum, payment) => sum + (payment.amount || 0), 0);
  }, [paymentMethod.payments]);

  // Check if payment is balanced
  const isPaymentBalanced = useMemo(() => {
    return Math.abs(totalPaymentAmount - totalContractAmount) < 0.01;
  }, [totalPaymentAmount, totalContractAmount]);

  // Add payment entry
  const addPaymentEntry = useCallback((entry: Omit<PaymentEntry, 'id'>) => {
    const newEntry: PaymentEntry = {
      ...entry,
      id: `payment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    };
    setPaymentMethod(prev => ({
      ...prev,
      payments: [...prev.payments, newEntry]
    }));
    return newEntry.id;
  }, []);

  // Remove payment entry
  const removePaymentEntry = useCallback((id: string) => {
    setPaymentMethod(prev => ({
      ...prev,
      payments: prev.payments.filter(p => p.id !== id)
    }));
  }, []);

  // Update payment entry
  const updatePaymentEntry = useCallback((id: string, updates: Partial<PaymentEntry>) => {
    setPaymentMethod(prev => ({
      ...prev,
      payments: prev.payments.map(p => 
        p.id === id ? { ...p, ...updates } : p
      )
    }));
  }, []);

  // Validate payment
  const validatePaymentMethod = useCallback((): { isValid: boolean; errors: string[] } => {
    const validation = validatePayment(paymentMethod, totalContractAmount);
    return validation;
  }, [paymentMethod, totalContractAmount]);

  // Auto-balance payments (distribute remaining amount)
  const autoBalancePayments = useCallback(() => {
    const remaining = totalContractAmount - totalPaymentAmount;
    if (remaining <= 0 || paymentMethod.payments.length === 0) return;

    // Add remaining to first payment or create new payment
    if (paymentMethod.payments.length > 0) {
      const firstPayment = paymentMethod.payments[0];
      updatePaymentEntry(firstPayment.id, {
        amount: (firstPayment.amount || 0) + remaining
      });
    } else {
      addPaymentEntry({
        method: 'CASH',
        amount: remaining,
        status: 'WILL_BE_PAID',
        paymentDate: '',
        cashType: 'عادی'
      });
    }
  }, [totalContractAmount, totalPaymentAmount, paymentMethod.payments, updatePaymentEntry, addPaymentEntry]);

  return {
    // State
    paymentMethod,
    totalPaymentAmount,
    isPaymentBalanced,
    
    // Actions
    setPaymentMethod,
    updateTotalAmount,
    addPaymentEntry,
    removePaymentEntry,
    updatePaymentEntry,
    validatePaymentMethod,
    autoBalancePayments
  };
};

