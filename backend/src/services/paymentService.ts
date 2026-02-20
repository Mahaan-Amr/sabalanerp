// Payment service
// Handles payment business logic

import { PrismaClient } from '@prisma/client';
import { validateContractAccess } from './contractService';

const prisma = new PrismaClient();

export interface CreatePaymentData {
  paymentMethod: 'CASH' | 'RECEIPT' | 'CHECK';
  totalAmount: number;
  currency?: string;
  paymentDate?: string;
  checkNumber?: string;
  checkOwnerName?: string;
  handoverDate?: string;
  cashType?: string;
  nationalCode?: string;
  notes?: string;
  status?: 'PENDING' | 'PARTIAL' | 'COMPLETED' | 'CANCELLED';
  installments?: Array<{
    amount: number;
    dueDate: string;
    notes?: string;
  }>;
}

export interface UpdatePaymentData {
  paymentMethod?: 'CASH' | 'RECEIPT' | 'CHECK';
  totalAmount?: number;
  currency?: string;
  paymentDate?: string;
  checkNumber?: string;
  checkOwnerName?: string;
  handoverDate?: string;
  cashType?: string;
  nationalCode?: string;
  notes?: string;
  status?: 'PENDING' | 'PARTIAL' | 'COMPLETED' | 'CANCELLED';
  installments?: Array<{
    amount: number;
    dueDate: string;
    notes?: string;
  }>;
}

/**
 * Validate payment data based on payment method
 */
export function validatePaymentData(data: CreatePaymentData | UpdatePaymentData): { isValid: boolean; error?: string } {
  // Validate check fields for check payments
  if (data.paymentMethod === 'CHECK') {
    if (!data.checkNumber) {
      return { isValid: false, error: 'Check number is required for check payments' };
    }
    if (!data.checkOwnerName || !String(data.checkOwnerName).trim()) {
      return { isValid: false, error: 'Check owner name is required for check payments' };
    }
  }

  // Validate cash type for cash payments
  if (data.paymentMethod === 'CASH' && !data.cashType) {
    return {
      isValid: false,
      error: 'Cash type is required for cash payments'
    };
  }

  return { isValid: true };
}

/**
 * Create a new payment
 */
export async function createPayment(
  contractId: string,
  data: CreatePaymentData,
  userId: string
) {
  // Validate payment data
  const validation = validatePaymentData(data);
  if (!validation.isValid) {
    throw new Error(validation.error || 'Invalid payment data');
  }

  // Get contract to validate access
  const contract = await prisma.salesContract.findUnique({
    where: { id: contractId },
    include: { department: true }
  });

  if (!contract) {
    throw new Error('Contract not found');
  }

  // Validate user access
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, departmentId: true }
  });

  if (!user) {
    throw new Error('User not found');
  }

  if (!validateContractAccess(contract, user)) {
    throw new Error('Access denied');
  }

  // Create payment
  const payment = await prisma.payment.create({
    data: {
      contractId,
      paymentMethod: data.paymentMethod,
      totalAmount: parseFloat(String(data.totalAmount)),
      currency: data.currency || 'تومان',
      status: data.status || 'PENDING',
      paymentDate: data.paymentDate ? new Date(data.paymentDate) : null,
      checkNumber: data.checkNumber || null,
      checkOwnerName: data.checkOwnerName || null,
      handoverDate: data.handoverDate ? new Date(data.handoverDate) : null,
      cashType: data.cashType || null,
      nationalCode: data.nationalCode || null,
      notes: data.notes || null,
      installments: data.installments ? {
        create: data.installments.map((installment, index) => ({
          installmentNumber: index + 1,
          amount: parseFloat(String(installment.amount)),
          dueDate: new Date(installment.dueDate),
          notes: installment.notes || null
        }))
      } : undefined
    },
    include: {
      installments: {
        orderBy: { installmentNumber: 'asc' }
      }
    }
  });

  return payment;
}

/**
 * Get all payments for a contract
 */
export async function getPayments(
  contractId: string,
  userId: string
) {
  // Get contract to validate access
  const contract = await prisma.salesContract.findUnique({
    where: { id: contractId },
    include: { department: true }
  });

  if (!contract) {
    throw new Error('Contract not found');
  }

  // Validate user access
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, departmentId: true }
  });

  if (!user) {
    throw new Error('User not found');
  }

  if (!validateContractAccess(contract, user)) {
    throw new Error('Access denied');
  }

  // Get payments
  const payments = await prisma.payment.findMany({
    where: { contractId },
    include: {
      installments: {
        orderBy: { installmentNumber: 'asc' }
      }
    },
    orderBy: { createdAt: 'desc' }
  });

  return payments;
}

/**
 * Update a payment
 */
export async function updatePayment(
  paymentId: string,
  data: UpdatePaymentData,
  userId: string
) {
  // Validate payment data if paymentMethod is being updated
  if (data.paymentMethod) {
    const validation = validatePaymentData(data);
    if (!validation.isValid) {
      throw new Error(validation.error || 'Invalid payment data');
    }
  }

  // Get payment with contract
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: {
      contract: {
        include: { department: true }
      }
    }
  });

  if (!payment) {
    throw new Error('Payment not found');
  }

  // Validate user access
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, departmentId: true }
  });

  if (!user) {
    throw new Error('User not found');
  }

  if (!validateContractAccess(payment.contract, user)) {
    throw new Error('Access denied');
  }

  // Update payment
  const updatedPayment = await prisma.payment.update({
    where: { id: paymentId },
    data: {
      paymentMethod: data.paymentMethod !== undefined ? data.paymentMethod : payment.paymentMethod,
      totalAmount: data.totalAmount !== undefined ? parseFloat(String(data.totalAmount)) : payment.totalAmount,
      currency: data.currency !== undefined ? data.currency : payment.currency,
      status: data.status !== undefined ? data.status : payment.status,
      paymentDate: data.paymentDate !== undefined ? (data.paymentDate ? new Date(data.paymentDate) : null) : payment.paymentDate,
      checkNumber: data.checkNumber !== undefined ? data.checkNumber : payment.checkNumber,
      checkOwnerName: data.checkOwnerName !== undefined ? data.checkOwnerName : payment.checkOwnerName,
      handoverDate: data.handoverDate !== undefined ? (data.handoverDate ? new Date(data.handoverDate) : null) : payment.handoverDate,
      cashType: data.cashType !== undefined ? data.cashType : payment.cashType,
      nationalCode: data.nationalCode !== undefined ? data.nationalCode : payment.nationalCode,
      notes: data.notes !== undefined ? data.notes : payment.notes,
      installments: data.installments ? {
        deleteMany: {},
        create: data.installments.map((installment, index) => ({
          installmentNumber: index + 1,
          amount: parseFloat(String(installment.amount)),
          dueDate: new Date(installment.dueDate),
          notes: installment.notes || null
        }))
      } : undefined
    },
    include: {
      installments: {
        orderBy: { installmentNumber: 'asc' }
      }
    }
  });

  return updatedPayment;
}

/**
 * Delete a payment
 */
export async function deletePayment(
  paymentId: string,
  userId: string
) {
  // Get payment with contract
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: {
      contract: {
        include: { department: true }
      }
    }
  });

  if (!payment) {
    throw new Error('Payment not found');
  }

  // Validate user access
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, departmentId: true }
  });

  if (!user) {
    throw new Error('User not found');
  }

  if (!validateContractAccess(payment.contract, user)) {
    throw new Error('Access denied');
  }

  // Delete payment (installments will be cascade deleted)
  await prisma.payment.delete({
    where: { id: paymentId }
  });

  return { success: true };
}


