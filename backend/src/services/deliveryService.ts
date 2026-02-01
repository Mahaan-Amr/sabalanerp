// Delivery service
// Handles delivery business logic

import { PrismaClient } from '@prisma/client';
import { validateContractAccess } from './contractService';

const prisma = new PrismaClient();

export interface CreateDeliveryData {
  deliveryDate: string;
  deliveryAddress: string;
  driver?: string;
  vehicle?: string;
  notes?: string;
  products: Array<{
    productId: string;
    quantity: number;
    notes?: string;
  }>;
}

export interface UpdateDeliveryData {
  deliveryDate?: string;
  deliveryAddress?: string;
  driver?: string;
  vehicle?: string;
  notes?: string;
  products?: Array<{
    productId: string;
    quantity: number;
    notes?: string;
  }>;
}

/**
 * Create a new delivery
 */
export async function createDelivery(
  contractId: string,
  data: CreateDeliveryData,
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

  // Create delivery
  const delivery = await prisma.delivery.create({
    data: {
      contractId,
      deliveryDate: new Date(data.deliveryDate),
      deliveryAddress: data.deliveryAddress,
      driver: data.driver || null,
      vehicle: data.vehicle || null,
      notes: data.notes || null,
      products: {
        create: data.products.map((product) => ({
          productId: product.productId,
          quantity: parseFloat(String(product.quantity)),
          notes: product.notes || null
        }))
      }
    },
    include: {
      products: {
        include: {
          product: true
        }
      }
    }
  });

  return delivery;
}

/**
 * Get all deliveries for a contract
 */
export async function getDeliveries(
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

  // Get deliveries
  const deliveries = await prisma.delivery.findMany({
    where: { contractId },
    include: {
      products: {
        include: {
          product: true
        }
      }
    },
    orderBy: { deliveryDate: 'asc' }
  });

  return deliveries;
}

/**
 * Update a delivery
 */
export async function updateDelivery(
  deliveryId: string,
  data: UpdateDeliveryData,
  userId: string
) {
  // Get delivery with contract
  const delivery = await prisma.delivery.findUnique({
    where: { id: deliveryId },
    include: {
      contract: {
        include: { department: true }
      }
    }
  });

  if (!delivery) {
    throw new Error('Delivery not found');
  }

  // Validate user access
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, departmentId: true }
  });

  if (!user) {
    throw new Error('User not found');
  }

  if (!validateContractAccess(delivery.contract, user)) {
    throw new Error('Access denied');
  }

  // Update delivery
  const updatedDelivery = await prisma.delivery.update({
    where: { id: deliveryId },
    data: {
      deliveryDate: data.deliveryDate ? new Date(data.deliveryDate) : delivery.deliveryDate,
      deliveryAddress: data.deliveryAddress !== undefined ? data.deliveryAddress : delivery.deliveryAddress,
      driver: data.driver !== undefined ? data.driver : delivery.driver,
      vehicle: data.vehicle !== undefined ? data.vehicle : delivery.vehicle,
      notes: data.notes !== undefined ? data.notes : delivery.notes,
      products: data.products ? {
        deleteMany: {},
        create: data.products.map((product) => ({
          productId: product.productId,
          quantity: parseFloat(String(product.quantity)),
          notes: product.notes || null
        }))
      } : undefined
    },
    include: {
      products: {
        include: {
          product: true
        }
      }
    }
  });

  return updatedDelivery;
}

/**
 * Delete a delivery
 */
export async function deleteDelivery(
  deliveryId: string,
  userId: string
) {
  // Get delivery with contract
  const delivery = await prisma.delivery.findUnique({
    where: { id: deliveryId },
    include: {
      contract: {
        include: { department: true }
      }
    }
  });

  if (!delivery) {
    throw new Error('Delivery not found');
  }

  // Validate user access
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, departmentId: true }
  });

  if (!user) {
    throw new Error('User not found');
  }

  if (!validateContractAccess(delivery.contract, user)) {
    throw new Error('Access denied');
  }

  // Delete delivery (products will be cascade deleted)
  await prisma.delivery.delete({
    where: { id: deliveryId }
  });

  return { success: true };
}

