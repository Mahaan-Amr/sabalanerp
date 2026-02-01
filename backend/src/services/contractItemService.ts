// Contract item service
// Handles contract item business logic

import { PrismaClient } from '@prisma/client';
import { validateContractAccess } from './contractService';

const prisma = new PrismaClient();

export interface CreateContractItemData {
  productId: string;
  productType?: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  description?: string;
  isMandatory?: boolean;
  mandatoryPercentage?: number;
  originalTotalPrice?: number;
  stairSystemId?: string;
  stairPartType?: string;
}

export interface UpdateContractItemData {
  quantity?: number;
  unitPrice?: number;
  totalPrice?: number;
  description?: string;
  isMandatory?: boolean;
  mandatoryPercentage?: number;
  originalTotalPrice?: number;
  stairSystemId?: string;
  stairPartType?: string;
}

/**
 * Create a new contract item
 */
export async function createContractItem(
  contractId: string,
  data: CreateContractItemData,
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

  // Create contract item
  const contractItem = await prisma.contractItem.create({
    data: {
      contractId,
      productId: data.productId,
      productType: data.productType || null,
      quantity: parseFloat(String(data.quantity)),
      unitPrice: parseFloat(String(data.unitPrice)),
      totalPrice: parseFloat(String(data.totalPrice)),
      description: data.description || null,
      isMandatory: data.isMandatory || false,
      mandatoryPercentage: data.mandatoryPercentage ? parseFloat(String(data.mandatoryPercentage)) : null,
      originalTotalPrice: data.originalTotalPrice ? parseFloat(String(data.originalTotalPrice)) : null,
      stairSystemId: data.stairSystemId || null,
      stairPartType: data.stairPartType || null
    },
    include: {
      product: true
    }
  });

  return contractItem;
}

/**
 * Get all contract items for a contract
 */
export async function getContractItems(
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

  // Get contract items
  const items = await prisma.contractItem.findMany({
    where: { contractId },
    include: {
      product: true
    },
    orderBy: {
      createdAt: 'asc'
    }
  });

  return items;
}

/**
 * Update a contract item
 */
export async function updateContractItem(
  itemId: string,
  data: UpdateContractItemData,
  userId: string
) {
  // Get contract item with contract
  const contractItem = await prisma.contractItem.findUnique({
    where: { id: itemId },
    include: {
      contract: {
        include: { department: true }
      }
    }
  });

  if (!contractItem) {
    throw new Error('Contract item not found');
  }

  // Validate user access
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, departmentId: true }
  });

  if (!user) {
    throw new Error('User not found');
  }

  if (!validateContractAccess(contractItem.contract, user)) {
    throw new Error('Access denied');
  }

  // Only allow updates if contract is in DRAFT status
  if (contractItem.contract.status !== 'DRAFT') {
    throw new Error('Contract item cannot be modified in current contract status');
  }

  // Update contract item
  const updatedItem = await prisma.contractItem.update({
    where: { id: itemId },
    data: {
      quantity: data.quantity !== undefined ? parseFloat(String(data.quantity)) : contractItem.quantity,
      unitPrice: data.unitPrice !== undefined ? parseFloat(String(data.unitPrice)) : contractItem.unitPrice,
      totalPrice: data.totalPrice !== undefined ? parseFloat(String(data.totalPrice)) : contractItem.totalPrice,
      description: data.description !== undefined ? data.description : contractItem.description,
      isMandatory: data.isMandatory !== undefined ? data.isMandatory : contractItem.isMandatory,
      mandatoryPercentage: data.mandatoryPercentage !== undefined 
        ? (data.mandatoryPercentage ? parseFloat(String(data.mandatoryPercentage)) : null)
        : contractItem.mandatoryPercentage,
      originalTotalPrice: data.originalTotalPrice !== undefined 
        ? (data.originalTotalPrice ? parseFloat(String(data.originalTotalPrice)) : null)
        : contractItem.originalTotalPrice,
      stairSystemId: data.stairSystemId !== undefined ? data.stairSystemId : contractItem.stairSystemId,
      stairPartType: data.stairPartType !== undefined ? data.stairPartType : contractItem.stairPartType
    },
    include: {
      product: true
    }
  });

  return updatedItem;
}

/**
 * Delete a contract item
 */
export async function deleteContractItem(
  itemId: string,
  userId: string
) {
  // Get contract item with contract
  const contractItem = await prisma.contractItem.findUnique({
    where: { id: itemId },
    include: {
      contract: {
        include: { department: true }
      }
    }
  });

  if (!contractItem) {
    throw new Error('Contract item not found');
  }

  // Validate user access
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, departmentId: true }
  });

  if (!user) {
    throw new Error('User not found');
  }

  if (!validateContractAccess(contractItem.contract, user)) {
    throw new Error('Access denied');
  }

  // Only allow deletion if contract is in DRAFT status
  if (contractItem.contract.status !== 'DRAFT') {
    throw new Error('Contract item cannot be deleted in current contract status');
  }

  // Delete contract item
  await prisma.contractItem.delete({
    where: { id: itemId }
  });

  return { success: true };
}

