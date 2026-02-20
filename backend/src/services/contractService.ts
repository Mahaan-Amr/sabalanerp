// Contract service
// Handles contract business logic

import { PrismaClient } from '@prisma/client';
import { generateContractNumber } from './contractNumberService';

const prisma = new PrismaClient();

export interface CreateContractData {
  title: string;
  titlePersian: string;
  customerId: string;
  departmentId: string;
  templateId?: string;
  content: string;
  totalAmount?: number;
  currency?: string;
  notes?: string;
  contractData?: any;
}

export interface UpdateContractData {
  title?: string;
  titlePersian?: string;
  content?: string;
  totalAmount?: number;
  currency?: string;
  notes?: string;
  contractData?: any;
}

/**
 * Create a new sales contract
 */
export async function createContract(
  data: CreateContractData,
  userId: string
) {
  // Generate contract number
  const contractNumber = await generateContractNumber(userId);

  // Create contract
  const contract = await prisma.salesContract.create({
    data: {
      contractNumber,
      title: data.title,
      titlePersian: data.titlePersian,
      content: data.content,
      customerId: data.customerId,
      departmentId: data.departmentId,
      templateId: data.templateId || null,
      createdBy: userId,
      totalAmount: data.totalAmount ? parseFloat(String(data.totalAmount)) : null,
      currency: data.currency || 'تومان',
      notes: data.notes || null,
      contractData: data.contractData || null,
    },
    include: {
      customer: {
        include: {
          primaryContact: true
        }
      },
      department: true,
      template: true,
      createdByUser: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          username: true,
        }
      }
    }
  });

  return contract;
}

/**
 * Update an existing contract
 */
export async function updateContract(
  contractId: string,
  data: UpdateContractData,
  userId: string
) {
  // Get existing contract
  const contract = await prisma.salesContract.findUnique({
    where: { id: contractId }
  });

  if (!contract) {
    throw new Error('Contract not found');
  }

  // Only allow updates if contract is in DRAFT status
  if (contract.status !== 'DRAFT') {
    throw new Error('Contract cannot be modified in current status');
  }

  // Update contract
  const updatedContract = await prisma.salesContract.update({
    where: { id: contractId },
    data: {
      title: data.title,
      titlePersian: data.titlePersian,
      content: data.content,
      totalAmount: data.totalAmount ? parseFloat(String(data.totalAmount)) : contract.totalAmount,
      currency: data.currency,
      notes: data.notes,
      contractData: data.contractData,
    },
    include: {
      customer: {
        include: {
          primaryContact: true
        }
      },
      department: true,
      template: true,
      createdByUser: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          username: true,
        }
      }
    }
  });

  return updatedContract;
}

/**
 * Get contract by ID
 */
export async function getContract(contractId: string) {
  const contract = await prisma.salesContract.findUnique({
    where: { id: contractId },
    include: {
      customer: {
        include: {
          primaryContact: true,
          contacts: true
        }
      },
      department: true,
      template: true,
      createdByUser: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          username: true,
        }
      },
      approvedByUser: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          username: true,
        }
      },
      signedByUser: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          username: true,
        }
      },
      items: {
        include: {
          product: true
        }
      }
    }
  });

  return contract;
}

/**
 * Validate contract access
 */
export function validateContractAccess(
  contract: { departmentId: string | null },
  user: { role: string; departmentId: string | null }
): boolean {
  // Admins can access all contracts
  if (user.role === 'ADMIN') {
    return true;
  }

  // Users can only access contracts from their department
  if (user.departmentId && contract.departmentId === user.departmentId) {
    return true;
  }

  // If user has no department, allow flexible access
  if (!user.departmentId) {
    return true;
  }

  return false;
}

/**
 * Approve contract
 */
export async function approveContract(
  contractId: string,
  userId: string,
  note?: string
) {
  const contract = await prisma.salesContract.findUnique({
    where: { id: contractId }
  });

  if (!contract) {
    throw new Error('Contract not found');
  }

  if (contract.status !== 'DRAFT' && contract.status !== 'PENDING_APPROVAL') {
    throw new Error('Contract cannot be approved in current status');
  }

  const updatedContract = await prisma.salesContract.update({
    where: { id: contractId },
    data: {
      status: 'APPROVED',
      approvedBy: userId,
      signatures: {
        ...(contract.signatures as any || {}),
        approve: {
          by: userId,
          at: new Date().toISOString(),
          note: note || null
        }
      }
    }
  });

  return updatedContract;
}

/**
 * Reject contract
 */
export async function rejectContract(
  contractId: string,
  userId: string,
  note?: string
) {
  const contract = await prisma.salesContract.findUnique({
    where: { id: contractId }
  });

  if (!contract) {
    throw new Error('Contract not found');
  }

  if (contract.status !== 'DRAFT' && contract.status !== 'PENDING_APPROVAL') {
    throw new Error('Contract cannot be rejected in current status');
  }

  const updatedContract = await prisma.salesContract.update({
    where: { id: contractId },
    data: {
      status: 'CANCELLED',
      signatures: {
        ...(contract.signatures as any || {}),
        reject: {
          by: userId,
          at: new Date().toISOString(),
          note: note || null
        }
      }
    }
  });

  return updatedContract;
}


