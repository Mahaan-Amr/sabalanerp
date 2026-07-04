// Contract service
// Handles contract business logic

import { CorrectionRequestStatus, Prisma, PrismaClient } from '@prisma/client';
import { generateContractNumberAssignment } from './contractNumberService';
import { buildAccountingSummaryForContracts } from './accountingService';

const prisma = new PrismaClient();

const getApprovedSalesCorrection = (contractId: string, tx: Prisma.TransactionClient | PrismaClient = prisma) =>
  tx.accountingCorrectionRequest.findFirst({
    where: {
      contractId,
      status: CorrectionRequestStatus.APPROVED_FOR_SALES_EDIT
    },
    orderBy: { updatedAt: 'desc' }
  });

const toJsonValue = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));

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
  _relations?: {
    items?: Array<{
      productId: string;
      productType?: string | null;
      quantity: number;
      unitPrice: number;
      totalPrice: number;
      description?: string | null;
      isMandatory?: boolean;
      mandatoryPercentage?: number | null;
      originalTotalPrice?: number | null;
      stairSystemId?: string | null;
      stairPartType?: string | null;
    }>;
    deliveries?: Array<{
      deliveryDate: string;
      deliveryAddress: string;
      driver?: string | null;
      vehicle?: string | null;
      notes?: string | null;
      products: Array<{
        productId: string;
        quantity: number;
        notes?: string | null;
      }>;
    }>;
    payments?: Array<{
      paymentMethod: 'CASH' | 'RECEIPT' | 'CHECK';
      totalAmount: number;
      currency?: string;
      status?: 'PENDING' | 'PARTIAL' | 'COMPLETED' | 'CANCELLED';
      paymentDate?: string | null;
      checkNumber?: string | null;
      checkOwnerName?: string | null;
      handoverDate?: string | null;
      cashType?: string | null;
      nationalCode?: string | null;
      notes?: string | null;
    }>;
  };
}

const toDecimalNumber = (value: unknown, fallback = 0): number => {
  const parsed = parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toNullableDecimalNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
};

const toNullableDate = (value: unknown): Date | null => {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * Create a new sales contract
 */
export async function createContract(
  data: CreateContractData,
  userId: string
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const { contractNumber, creatorSequenceNumber } = await generateContractNumberAssignment(userId, tx);
        const previousContractNumber = data.contractData?.contractNumber;
        const contractData = {
          ...(data.contractData || {}),
          contractNumber,
          creatorSequenceNumber
        };
        const content = previousContractNumber
          ? String(data.content).split(String(previousContractNumber)).join(contractNumber)
          : data.content;

        return tx.salesContract.create({
          data: {
            contractNumber,
            creatorSequenceNumber,
            title: data.title,
            titlePersian: data.titlePersian,
            content,
            customerId: data.customerId,
            departmentId: data.departmentId,
            templateId: data.templateId || null,
            createdBy: userId,
            totalAmount: data.totalAmount ? parseFloat(String(data.totalAmount)) : null,
            currency: data.currency || 'تومان',
            notes: data.notes || null,
            contractData
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
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        attempt < 2
      ) {
        continue;
      }
      throw error;
    }
  }
  throw new Error('Unable to create contract number after retry');
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
    where: { id: contractId },
    include: { department: true }
  });

  if (!contract) {
    throw new Error('Contract not found');
  }

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

  const financiallyApprovedRecord = await prisma.accountingFinancialRecord.findFirst({
    where: {
      contractId,
      financiallyApprovedAt: { not: null }
    },
    select: { id: true }
  });
  const approvedSalesCorrection = await getApprovedSalesCorrection(contractId);

  if (financiallyApprovedRecord && !approvedSalesCorrection) {
    throw new Error('Contract cannot be modified after accounting financial approval');
  }

  const relations = data._relations;

  // Update contract and relation snapshots atomically.
  const updatedContract = await prisma.$transaction(async (tx) => {
    if (relations) {
      await tx.deliveryProduct.deleteMany({
        where: {
          delivery: { contractId }
        }
      });
      await tx.delivery.deleteMany({ where: { contractId } });
      await tx.paymentInstallment.deleteMany({
        where: {
          payment: { contractId }
        }
      });
      await tx.payment.deleteMany({ where: { contractId } });
      await tx.contractItem.deleteMany({ where: { contractId } });

      if (relations.items?.length) {
        await tx.contractItem.createMany({
          data: relations.items.map((item) => ({
            contractId,
            productId: item.productId,
            productType: item.productType || null,
            quantity: toDecimalNumber(item.quantity),
            unitPrice: toDecimalNumber(item.unitPrice),
            totalPrice: toDecimalNumber(item.totalPrice),
            description: item.description || null,
            isMandatory: item.isMandatory || false,
            mandatoryPercentage: toNullableDecimalNumber(item.mandatoryPercentage),
            originalTotalPrice: toNullableDecimalNumber(item.originalTotalPrice),
            stairSystemId: item.stairSystemId || null,
            stairPartType: item.stairPartType || null
          }))
        });
      }

      for (const delivery of relations.deliveries || []) {
        await tx.delivery.create({
          data: {
            contractId,
            deliveryDate: toNullableDate(delivery.deliveryDate) || new Date(),
            deliveryAddress: delivery.deliveryAddress || '',
            driver: delivery.driver || null,
            vehicle: delivery.vehicle || null,
            notes: delivery.notes || null,
            products: {
              create: (delivery.products || []).map((product) => ({
                productId: product.productId,
                quantity: toDecimalNumber(product.quantity),
                notes: product.notes || null
              }))
            }
          }
        });
      }

      if (relations.payments?.length) {
        for (const payment of relations.payments) {
          await tx.payment.create({
            data: {
              contractId,
              paymentMethod: payment.paymentMethod,
              totalAmount: toDecimalNumber(payment.totalAmount),
              currency: payment.currency || 'تومان',
              status: payment.status || 'PENDING',
              paymentDate: toNullableDate(payment.paymentDate),
              checkNumber: payment.checkNumber || null,
              checkOwnerName: payment.checkOwnerName || null,
              handoverDate: toNullableDate(payment.handoverDate),
              cashType: payment.cashType || null,
              nationalCode: payment.nationalCode || null,
              notes: payment.notes || null
            }
          });
        }
      }
    }

    if (approvedSalesCorrection) {
      const updatedCorrection = await tx.accountingCorrectionRequest.update({
        where: { id: approvedSalesCorrection.id },
        data: {
          status: CorrectionRequestStatus.SALES_EDITED,
          resolutionNote: [
            approvedSalesCorrection.resolutionNote,
            data.notes ? `Sales correction save note: ${data.notes}` : null
          ].filter(Boolean).join('\n')
        }
      });

      await tx.accountingAuditLog.create({
        data: {
          action: 'SALES_CORRECTION_SAVED',
          actorId: userId,
          contractId,
          recordId: updatedCorrection.recordId,
          entityType: 'AccountingCorrectionRequest',
          entityId: updatedCorrection.id,
          beforeState: toJsonValue(approvedSalesCorrection),
          afterState: toJsonValue(updatedCorrection),
          note: data.notes || null
        }
      });
    }

    return tx.salesContract.update({
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
        },
        items: {
          include: {
            product: true
          }
        },
        deliveries: {
          include: {
            products: true
          }
        },
        payments: true
      }
    });
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

  if (!contract) return contract;

  const financiallyApprovedRecord = await prisma.accountingFinancialRecord.findFirst({
    where: {
      contractId,
      financiallyApprovedAt: { not: null }
    },
    select: { id: true, financiallyApprovedAt: true }
  });
  const approvedSalesCorrection = await getApprovedSalesCorrection(contractId);
  const accountingSummaries = await buildAccountingSummaryForContracts([contract]);

  return {
    ...contract,
    accountingEditLocked: Boolean(financiallyApprovedRecord),
    canOpenCorrectionEdit: Boolean(approvedSalesCorrection),
    activeCorrectionRequest: approvedSalesCorrection ? {
      id: approvedSalesCorrection.id,
      category: approvedSalesCorrection.category,
      priority: approvedSalesCorrection.priority,
      status: approvedSalesCorrection.status,
      accountantNote: approvedSalesCorrection.accountantNote,
      resolutionNote: approvedSalesCorrection.resolutionNote
    } : null,
    accountingFinanciallyApprovedAt: financiallyApprovedRecord?.financiallyApprovedAt || null,
    accounting: accountingSummaries.get(contract.id) || null
  };
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


