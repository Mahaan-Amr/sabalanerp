import express, { Response } from 'express';
import { body, validationResult } from 'express-validator';
import { PrismaClient } from '@prisma/client';
import { protect } from '../middleware/auth';
import { requireWorkspaceAccess, WORKSPACE_PERMISSIONS, WORKSPACES } from '../middleware/workspace';
import { requireFeatureAccess, FEATURE_PERMISSIONS, FEATURES } from '../middleware/feature';
import { createContractItem } from '../services/contractItemService';
import { createDelivery, getDeliveries } from '../services/deliveryService';
import { createPayment, getPayments, validatePaymentData } from '../services/paymentService';
import { createContract, updateContract, getContract, validateContractAccess, approveContract, rejectContract } from '../services/contractService';
import { getNextContractNumberPreview } from '../services/contractNumberService';
import { contractConfirmationService } from '../services/contractConfirmationService';
import { buildAccountingSummaryForContracts } from '../services/accountingService';
import { getRequestEvidence } from '../utils/requestEvidence';
import {
  buildSalesContractPdfDownloadName,
  buildSalesContractPdfFingerprint,
  ensureStoredSalesContractPdfExists,
  generateSalesContractPdf,
  isSalesContractPdfCacheFresh,
  resolveStoredSalesContractPdfPath,
  resolveSalesContractPdfUrl,
  salesContractPrintableInclude
} from '../utils/salesContractPdf';

const router = express.Router();
const prisma = new PrismaClient();
const userHasCancelAfterApprovalPermission = async (user: any): Promise<boolean> => {
  if (!user || user.role === 'ADMIN') {
    return true;
  }

  const feature = FEATURES.SALES_CONTRACTS_CANCEL_AFTER_APPROVAL;
  const workspace = 'sales';

  const userFeaturePermission = await prisma.featurePermission.findUnique({
    where: {
      userId_workspace_feature: {
        userId: user.id,
        workspace,
        feature
      }
    }
  });

  if (userFeaturePermission?.isActive) {
    return true;
  }

  const roleFeaturePermission = await prisma.roleFeaturePermission.findUnique({
    where: {
      role_workspace_feature: {
        role: user.role,
        workspace,
        feature
      }
    }
  });

  return !!roleFeaturePermission?.isActive;
};

// ==================== SALES CONTRACTS ====================

const canManageDiscountRanges = (user: any) => ['ADMIN', 'MANAGER'].includes(user?.role);

const toDiscountRangeDto = (range: any) => ({
  id: range.id,
  minAmount: Number(range.minAmount),
  maxAmount: range.maxAmount === null || range.maxAmount === undefined ? null : Number(range.maxAmount),
  maxDiscountPercent: Number(range.maxDiscountPercent),
  isActive: range.isActive,
  createdAt: range.createdAt,
  updatedAt: range.updatedAt
});

const parseOptionalBoolean = (value: unknown, fallback: boolean): boolean => {
  if (value === undefined) return fallback;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return fallback;
};

const validateDiscountRangeBounds = async ({
  minAmount,
  maxAmount,
  excludeId
}: {
  minAmount: number;
  maxAmount?: number | null;
  excludeId?: string;
}) => {
  if (!Number.isFinite(minAmount) || minAmount < 0) {
    return 'Minimum amount must be zero or greater';
  }
  if (maxAmount !== null && maxAmount !== undefined && (!Number.isFinite(maxAmount) || maxAmount <= minAmount)) {
    return 'Maximum amount must be greater than minimum amount';
  }

  const ranges = await prisma.contractDiscountRange.findMany({
    where: {
      isActive: true,
      ...(excludeId ? { id: { not: excludeId } } : {})
    }
  });

  const nextMax = maxAmount ?? Number.POSITIVE_INFINITY;
  const overlaps = ranges.some((range) => {
    const existingMin = Number(range.minAmount);
    const existingMax = range.maxAmount === null ? Number.POSITIVE_INFINITY : Number(range.maxAmount);
    return minAmount < existingMax && existingMin < nextMax;
  });

  return overlaps ? 'Discount ranges cannot overlap' : null;
};

// @desc    Get contract discount ranges
// @route   GET /api/sales/discount-ranges
// @access  Private for active rules, Admin or Manager for full settings
router.get('/discount-ranges', protect, async (req: any, res: Response) => {
  try {
    const activeOnly = req.query.activeOnly === 'true';
    if (!activeOnly && !canManageDiscountRanges(req.user)) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const ranges = await prisma.contractDiscountRange.findMany({
      where: activeOnly ? { isActive: true } : undefined,
      orderBy: [{ minAmount: 'asc' }, { createdAt: 'asc' }]
    });

    res.json({
      success: true,
      data: ranges.map(toDiscountRangeDto)
    });
    return;
  } catch (error) {
    console.error('Get discount ranges error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
    return;
  }
});

// @desc    Create contract discount range
// @route   POST /api/sales/discount-ranges
// @access  Private/Admin or Manager
router.post('/discount-ranges', protect, [
  body('minAmount').isFloat({ min: 0 }).withMessage('Minimum amount is required'),
  body('maxAmount').optional({ nullable: true }).isFloat({ min: 0 }).withMessage('Maximum amount must be a number'),
  body('maxDiscountPercent').isFloat({ min: 0, max: 100 }).withMessage('Discount percent must be between 0 and 100'),
  body('isActive').optional().isBoolean().withMessage('Active flag must be boolean')
], async (req: any, res: Response) => {
  try {
    if (!canManageDiscountRanges(req.user)) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, error: 'Validation failed', details: errors.array() });
    }

    const minAmount = Number(req.body.minAmount);
    const maxAmount = req.body.maxAmount === null || req.body.maxAmount === '' || req.body.maxAmount === undefined
      ? null
      : Number(req.body.maxAmount);
    const isActive = parseOptionalBoolean(req.body.isActive, true);

    if (isActive) {
      const rangeError = await validateDiscountRangeBounds({ minAmount, maxAmount });
      if (rangeError) {
        return res.status(400).json({ success: false, error: rangeError });
      }
    }

    const range = await prisma.contractDiscountRange.create({
      data: {
        minAmount,
        maxAmount,
        maxDiscountPercent: Number(req.body.maxDiscountPercent),
        isActive,
        createdBy: req.user.id,
        updatedBy: req.user.id
      }
    });

    res.status(201).json({ success: true, data: toDiscountRangeDto(range) });
    return;
  } catch (error) {
    console.error('Create discount range error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
    return;
  }
});

// @desc    Update contract discount range
// @route   PUT /api/sales/discount-ranges/:id
// @access  Private/Admin or Manager
router.put('/discount-ranges/:id', protect, [
  body('minAmount').optional().isFloat({ min: 0 }).withMessage('Minimum amount must be a number'),
  body('maxAmount').optional({ nullable: true }).isFloat({ min: 0 }).withMessage('Maximum amount must be a number'),
  body('maxDiscountPercent').optional().isFloat({ min: 0, max: 100 }).withMessage('Discount percent must be between 0 and 100'),
  body('isActive').optional().isBoolean().withMessage('Active flag must be boolean')
], async (req: any, res: Response) => {
  try {
    if (!canManageDiscountRanges(req.user)) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, error: 'Validation failed', details: errors.array() });
    }

    const existing = await prisma.contractDiscountRange.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Discount range not found' });
    }

    const minAmount = req.body.minAmount !== undefined ? Number(req.body.minAmount) : Number(existing.minAmount);
    const maxAmount = req.body.maxAmount !== undefined
      ? (req.body.maxAmount === null || req.body.maxAmount === '' ? null : Number(req.body.maxAmount))
      : (existing.maxAmount === null ? null : Number(existing.maxAmount));
    const isActive = parseOptionalBoolean(req.body.isActive, existing.isActive);

    if (isActive) {
      const rangeError = await validateDiscountRangeBounds({ minAmount, maxAmount, excludeId: req.params.id });
      if (rangeError) {
        return res.status(400).json({ success: false, error: rangeError });
      }
    }

    const range = await prisma.contractDiscountRange.update({
      where: { id: req.params.id },
      data: {
        minAmount,
        maxAmount,
        maxDiscountPercent: req.body.maxDiscountPercent !== undefined
          ? Number(req.body.maxDiscountPercent)
          : existing.maxDiscountPercent,
        isActive,
        updatedBy: req.user.id
      }
    });

    res.json({ success: true, data: toDiscountRangeDto(range) });
    return;
  } catch (error) {
    console.error('Update discount range error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
    return;
  }
});

// @desc    Delete contract discount range
// @route   DELETE /api/sales/discount-ranges/:id
// @access  Private/Admin or Manager
router.delete('/discount-ranges/:id', protect, async (req: any, res: Response) => {
  try {
    if (!canManageDiscountRanges(req.user)) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    await prisma.contractDiscountRange.delete({ where: { id: req.params.id } });
    res.json({ success: true });
    return;
  } catch (error: any) {
    console.error('Delete discount range error:', error);
    if (error?.code === 'P2025') {
      return res.status(404).json({ success: false, error: 'Discount range not found' });
    }
    res.status(500).json({ success: false, error: 'Server error' });
    return;
  }
});


// @desc    Get next contract number with gap-filling logic
// @route   GET /api/sales/contracts/next-number
// @access  Private/Sales Workspace
router.get('/contracts/next-number', protect, requireWorkspaceAccess(WORKSPACES.SALES, WORKSPACE_PERMISSIONS.VIEW), requireFeatureAccess(FEATURES.SALES_CONTRACT_NUMBER_VIEW, FEATURE_PERMISSIONS.VIEW), async (req: any, res: Response) => {
  try {
    const preview = await getNextContractNumberPreview(req.user.id, prisma);
    
    res.json({
      success: true,
      data: preview
    });
    return;
  } catch (error) {
    console.error('Get next contract number error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
    return;
  }
});

// @desc    Get all sales contracts
// @route   GET /api/sales/contracts
// @access  Private/Sales Workspace
router.get('/contracts', protect, requireWorkspaceAccess(WORKSPACES.SALES, WORKSPACE_PERMISSIONS.VIEW), requireFeatureAccess(FEATURES.SALES_CONTRACTS_VIEW, FEATURE_PERMISSIONS.VIEW), async (req: any, res: Response) => {
  try {
    const page = Math.max(parseInt(req.query.page as string) || 1, 1);
    const requestedLimit = parseInt(req.query.limit as string) || 10;
    const limit = Math.min(Math.max(requestedLimit, 1), 100);
    const skip = (page - 1) * limit;
    const status = req.query.status as string;
    const departmentId = req.query.departmentId as string;
    const search = String(req.query.search || '').trim();

    // Build where clause based on user role and department
    let whereClause: any = {};
    
    if (req.user.role === 'ADMIN') {
      // Admins can see all contracts
      if (status) whereClause.status = status;
      if (departmentId) whereClause.departmentId = departmentId;
    } else if (req.user.departmentId) {
      // Regular users can only see contracts from their department
      whereClause.departmentId = req.user.departmentId;
      if (status) whereClause.status = status;
    } else if (status) {
      whereClause.status = status;
    }

    if (search) {
      const numericSearch = Number.parseInt(search, 10);
      const searchConditions: any[] = [
        { contractNumber: { contains: search, mode: 'insensitive' } },
        { title: { contains: search, mode: 'insensitive' } },
        { titlePersian: { contains: search, mode: 'insensitive' } },
        { customer: { firstName: { contains: search, mode: 'insensitive' } } },
        { customer: { lastName: { contains: search, mode: 'insensitive' } } },
        { customer: { companyName: { contains: search, mode: 'insensitive' } } },
        { customer: { nationalCode: { contains: search, mode: 'insensitive' } } },
        { customer: { projectManagerName: { contains: search, mode: 'insensitive' } } }
      ];

      if (Number.isFinite(numericSearch)) {
        searchConditions.push({ creatorSequenceNumber: numericSearch });
      }

      whereClause = {
        AND: [
          whereClause,
          { OR: searchConditions }
        ]
      };
    }

    const contracts = await prisma.salesContract.findMany({
      where: whereClause,
      skip,
      take: limit,
      include: {
        customer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            companyName: true,
            customerType: true,
            status: true,
            nationalCode: true,
            projectManagerName: true
          }
        },
        department: {
          select: {
            id: true,
            name: true,
            namePersian: true,
          }
        },
        template: {
          select: {
            id: true,
            name: true,
            namePersian: true,
          }
        },
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
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    const contractIds = contracts.map((contract) => contract.id);
    const [financiallyApprovedRecords, accountingSummaries] = contractIds.length
      ? await Promise.all([
        prisma.accountingFinancialRecord.findMany({
          where: {
            contractId: { in: contractIds },
            financiallyApprovedAt: { not: null }
          },
          select: {
            contractId: true,
            financiallyApprovedAt: true
          }
        }),
        buildAccountingSummaryForContracts(contracts)
      ])
      : [[], new Map()];
    const financiallyApprovedByContractId = new Map(
      financiallyApprovedRecords.map((record) => [record.contractId, record.financiallyApprovedAt] as const)
    );
    const contractsWithAccountingLock = contracts.map((contract) => ({
      ...contract,
      accountingEditLocked: financiallyApprovedByContractId.has(contract.id),
      accountingFinanciallyApprovedAt: financiallyApprovedByContractId.get(contract.id) || null,
      accounting: accountingSummaries.get(contract.id) || null
    }));

    const total = await prisma.salesContract.count({ where: whereClause });

    res.json({
      success: true,
      data: contractsWithAccountingLock,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get sales contracts error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    Get sales contract by ID
// @route   GET /api/sales/contracts/:id
// @access  Private/Sales Workspace
router.get('/contracts/:id', protect, requireWorkspaceAccess(WORKSPACES.SALES, WORKSPACE_PERMISSIONS.VIEW), requireFeatureAccess(FEATURES.SALES_CONTRACTS_VIEW, FEATURE_PERMISSIONS.VIEW), async (req: any, res: Response) => {
  try {
    const contract = await getContract(req.params.id);

    if (!contract) {
      return res.status(404).json({
        success: false,
        error: 'Contract not found'
      });
    }

    // Check if user has access to this contract
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { role: true, departmentId: true }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    if (!validateContractAccess(contract, user)) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }

    res.json({
      success: true,
      data: contract
    });
    return;
  } catch (error: any) {
    console.error('Get sales contract error:', error);
    if (error.message === 'Contract not found') {
      return res.status(404).json({
        success: false,
        error: error.message
      });
    }
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
    return;
  }
});
// @desc    Get sales contract PDF url (cached or fresh)
// @route   GET /api/sales/contracts/:id/pdf
// @access  Private/Sales Workspace
router.get('/contracts/:id/pdf', protect, requireWorkspaceAccess(WORKSPACES.SALES, WORKSPACE_PERMISSIONS.VIEW), requireFeatureAccess(FEATURES.SALES_CONTRACTS_VIEW, FEATURE_PERMISSIONS.VIEW), async (req: any, res: Response) => {
  try {
    const contract = await prisma.salesContract.findUnique({
      where: { id: req.params.id },
      include: salesContractPrintableInclude
    });

    if (!contract) {
      return res.status(404).json({
        success: false,
        error: 'Contract not found'
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { role: true, departmentId: true }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    if (!validateContractAccess(contract, user)) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }

    const fresh = String(req.query.fresh || 'false').toLowerCase() === 'true';
    const shouldDownload = String(req.query.download || 'false').toLowerCase() === 'true';
    const currentSignatures = (contract.signatures as any) || {};
    const cachedPdfPath = currentSignatures?.print?.pdfPath as string | undefined;
    const pdfFingerprint = buildSalesContractPdfFingerprint(contract);

    if (
      !fresh &&
      cachedPdfPath &&
      isSalesContractPdfCacheFresh(contract, currentSignatures?.print?.fingerprint, pdfFingerprint) &&
      ensureStoredSalesContractPdfExists(cachedPdfPath)
    ) {
      if (shouldDownload) {
        return res.download(
          resolveStoredSalesContractPdfPath(cachedPdfPath),
          buildSalesContractPdfDownloadName(contract)
        );
      }

      const cachedUrl = resolveSalesContractPdfUrl(req, cachedPdfPath);
      if (cachedUrl) {
        return res.json({
          success: true,
          data: {
            url: cachedUrl,
            generatedAt: currentSignatures?.print?.generatedAt || currentSignatures?.print?.at || null,
            fromCache: true
          }
        });
      }
    }

    const pdfPath = await generateSalesContractPdf(contract);

    const updatedPrintSignature = {
      ...(currentSignatures?.print || {}),
      pdfPath,
      generatedAt: new Date().toISOString(),
      fingerprint: pdfFingerprint
    };

    await prisma.salesContract.update({
      where: { id: contract.id },
      data: {
        signatures: {
          ...currentSignatures,
          print: updatedPrintSignature
        }
      }
    });

    if (shouldDownload) {
      return res.download(
        resolveStoredSalesContractPdfPath(pdfPath),
        buildSalesContractPdfDownloadName(contract)
      );
    }

    const url = resolveSalesContractPdfUrl(req, pdfPath);
    if (!url) {
      return res.status(500).json({
        success: false,
        error: 'Failed to build PDF url'
      });
    }

    return res.json({
      success: true,
      data: {
        url,
        generatedAt: updatedPrintSignature.generatedAt,
        fromCache: false
      }
    });
  } catch (error) {
    console.error('Get sales contract PDF error:', error);
    return res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    Create new sales contract
// @route   POST /api/sales/contracts
// @access  Private/Sales Workspace
router.post('/contracts', protect, requireWorkspaceAccess(WORKSPACES.SALES, WORKSPACE_PERMISSIONS.EDIT), requireFeatureAccess(FEATURES.SALES_CONTRACTS_CREATE, FEATURE_PERMISSIONS.EDIT), [
  body('title').notEmpty().withMessage('Title is required'),
  body('titlePersian').notEmpty().withMessage('Persian title is required'),
  body('customerId').notEmpty().withMessage('Customer ID is required'),
  body('departmentId').notEmpty().withMessage('Department ID is required'),
  body('content').notEmpty().withMessage('Content is required'),
], async (req: any, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const {
      title,
      titlePersian,
      customerId,
      departmentId,
      templateId,
      content,
      totalAmount,
      currency,
      notes,
      contractData
    } = req.body;

    // Check if user has access to this department
    // Allow if user is ADMIN, or if user belongs to the department, or if user has no department assigned (flexible access)
    if (req.user.role !== 'ADMIN' && req.user.departmentId && departmentId !== req.user.departmentId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied to this department'
      });
    }

    const contract = await createContract({
      title,
      titlePersian,
      customerId,
      departmentId,
      templateId,
      content,
      totalAmount,
      currency,
      notes,
      contractData
    }, req.user.id);

    res.status(201).json({
      success: true,
      data: contract
    });
    return;
  } catch (error: any) {
    console.error('Create sales contract error:', error);
    if (error.message === 'User not found') {
      return res.status(404).json({
        success: false,
        error: error.message
      });
    }
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
    return;
  }
});

// @desc    Update sales contract
// @route   PUT /api/sales/contracts/:id
// @access  Private/Sales Workspace
router.put('/contracts/:id', protect, requireWorkspaceAccess(WORKSPACES.SALES, WORKSPACE_PERMISSIONS.EDIT), requireFeatureAccess(FEATURES.SALES_CONTRACTS_EDIT, FEATURE_PERMISSIONS.EDIT), [
  body('title').optional().notEmpty().withMessage('Title cannot be empty'),
  body('titlePersian').optional().notEmpty().withMessage('Persian title cannot be empty'),
  body('content').optional().notEmpty().withMessage('Content cannot be empty'),
], async (req: any, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const updatedContract = await updateContract(req.params.id, req.body, req.user.id);

    res.json({
      success: true,
      data: updatedContract
    });
    return;
  } catch (error: any) {
    console.error('Update sales contract error:', error);
    if (error.message === 'Contract not found') {
      return res.status(404).json({
        success: false,
        error: error.message
      });
    }
    if (
      error.message === 'Access denied' ||
      error.message === 'Contract cannot be modified in current status' ||
      error.message === 'Contract cannot be modified after accounting financial approval'
    ) {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
    return;
  }
});

// @desc    Approve sales contract
// @route   PUT /api/sales/contracts/:id/approve
// @access  Private/Sales Contract Approve Feature
router.put('/contracts/:id/approve', protect, requireFeatureAccess(FEATURES.SALES_CONTRACTS_APPROVE, FEATURE_PERMISSIONS.EDIT), async (req: any, res: Response) => {
  try {
    const note: string | undefined = req.body?.note;
    const updatedContract = await approveContract(req.params.id, req.user.id, note);

    res.json({
      success: true,
      data: updatedContract
    });
    return;
  } catch (error: any) {
    console.error('Approve sales contract error:', error);
    if (error.message === 'Contract not found') {
      return res.status(404).json({
        success: false,
        error: error.message
      });
    }
    if (error.message === 'Contract cannot be approved in current status') {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
    return;
  }
});

// @desc    Print sales contract
// @route   PUT /api/sales/contracts/:id/print
// @access  Private/Sales Contract Print Feature
router.put('/contracts/:id/print', protect, requireFeatureAccess(FEATURES.SALES_CONTRACTS_PRINT, FEATURE_PERMISSIONS.EDIT), async (req: any, res: Response) => {
  try {
    const contract = await prisma.salesContract.findUnique({
      where: { id: req.params.id }
    });

    if (!contract) {
      return res.status(404).json({
        success: false,
        error: 'Contract not found'
      });
    }

    // Check if user has access to this contract
    if (req.user.role !== 'ADMIN' && req.user.departmentId && contract.departmentId !== req.user.departmentId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }

    const contractWithRelations = await prisma.salesContract.findUnique({
      where: { id: req.params.id },
      include: salesContractPrintableInclude
    });

    if (!contractWithRelations) {
      return res.status(404).json({
        success: false,
        error: 'Contract not found'
      });
    }

    const pdfPath = await generateSalesContractPdf(contractWithRelations);

    const note: string | undefined = req.body?.note;

    const updatedContract = await prisma.salesContract.update({
      where: { id: req.params.id },
      data: {
        status: contract.status === 'SIGNED' ? 'PRINTED' : contract.status,
        printedAt: new Date(),
        signatures: {
          ...(contract.signatures as any || {}),
          print: {
            by: req.user.id,
            at: new Date().toISOString(),
            note: note || null,
            pdfPath
          }
        }
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
        }
      }
    });

    res.json({
      success: true,
      data: updatedContract
    });
    return;
  } catch (error) {
    console.error('Print sales contract error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
    return;
  }
});

// @desc    Reject sales contract
// @route   PUT /api/sales/contracts/:id/reject
// @access  Private/Sales Contract Reject Feature
router.put('/contracts/:id/reject', protect, requireFeatureAccess(FEATURES.SALES_CONTRACTS_REJECT, FEATURE_PERMISSIONS.EDIT), async (req: any, res: Response) => {
  try {
    const note: string | undefined = req.body?.note;
    const updatedContract = await rejectContract(req.params.id, req.user.id, note);

    res.json({
      success: true,
      data: updatedContract
    });
    return;
  } catch (error: any) {
    console.error('Reject sales contract error:', error);
    if (error.message === 'Contract not found') {
      return res.status(404).json({
        success: false,
        error: error.message
      });
    }
    if (error.message === 'Contract cannot be rejected in current status') {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
    return;
  }
});

// @desc    Sign sales contract
// @route   PUT /api/sales/contracts/:id/sign
// @access  Private/Sales Contract Sign Feature
router.put('/contracts/:id/sign', protect, requireFeatureAccess(FEATURES.SALES_CONTRACTS_SIGN, FEATURE_PERMISSIONS.EDIT), async (req: any, res: Response) => {
  try {
    const contract = await prisma.salesContract.findUnique({
      where: { id: req.params.id }
    });

    if (!contract) {
      return res.status(404).json({
        success: false,
        error: 'Contract not found'
      });
    }

    // Check if user has access to this contract
    if (req.user.role !== 'ADMIN' && req.user.departmentId && contract.departmentId !== req.user.departmentId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }

    if (contract.status !== 'APPROVED') {
      return res.status(400).json({
        success: false,
        error: 'Contract must be approved before signing'
      });
    }

    const note: string | undefined = req.body?.note;

    const updatedContract = await prisma.salesContract.update({
      where: { id: req.params.id },
      data: {
        status: 'SIGNED',
        signedBy: req.user.id,
        signedAt: new Date(),
        signatures: {
          ...(contract.signatures as any || {}),
          sign: {
            by: req.user.id,
            at: new Date().toISOString(),
            note: note || null
          }
        }
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
        }
      }
    });

    res.json({
      success: true,
      data: updatedContract
    });
    return;
  } catch (error) {
    console.error('Sign sales contract error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
    return;
  }
});

// ==================== SALES DASHBOARD ====================

// @desc    Get sales dashboard statistics
// @route   GET /api/sales/dashboard/stats
// @access  Private/Sales Workspace
router.get('/dashboard/stats', protect, requireWorkspaceAccess(WORKSPACES.SALES, WORKSPACE_PERMISSIONS.VIEW), requireFeatureAccess(FEATURES.SALES_DASHBOARD_VIEW, FEATURE_PERMISSIONS.VIEW), async (req: any, res: Response) => {
  try {
    // Build where clause based on user role and department
    let whereClause: any = {};
    
    if (req.user.role !== 'ADMIN' && req.user.departmentId) {
      whereClause.departmentId = req.user.departmentId;
    }

    const [
      totalContracts,
      signedContracts,
      pendingContracts,
      totalRevenue,
      recentContracts
    ] = await Promise.all([
      prisma.salesContract.count({ where: whereClause }),
      prisma.salesContract.count({ where: { ...whereClause, status: 'SIGNED' } }),
      prisma.salesContract.count({ where: { ...whereClause, status: 'PENDING_APPROVAL' } }),
      prisma.salesContract.aggregate({
        where: { ...whereClause, status: 'SIGNED' },
        _sum: { totalAmount: true }
      }),
      prisma.salesContract.findMany({
        where: whereClause,
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: {
            select: {
              companyName: true,
              primaryContact: {
                select: {
                  firstName: true,
                  lastName: true
                }
              }
            }
          },
          createdByUser: {
            select: {
              firstName: true,
              lastName: true
            }
          }
        }
      })
    ]);

    const averageContractValue = signedContracts > 0
      ? Math.round(Number(totalRevenue._sum.totalAmount || 0) / signedContracts)
      : 0;

    res.json({
      success: true,
      data: {
        contracts: {
          total: totalContracts,
          signed: signedContracts,
          pending: pendingContracts,
          draft: 0, // We'll need to calculate this
          approved: 0, // We'll need to calculate this
          printed: 0, // We'll need to calculate this
          cancelled: 0, // We'll need to calculate this
          expired: 0 // We'll need to calculate this
        },
        revenue: {
          total: Number(totalRevenue._sum.totalAmount || 0),
          average: averageContractValue,
          completionRate: totalContracts > 0 ? Math.round((signedContracts / totalContracts) * 100) : 0
        },
        recentContracts
      }
    });
  } catch (error) {
    console.error('Get sales dashboard error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    Get sales dashboard (alias for /dashboard/stats)
// @route   GET /api/sales/dashboard
// @access  Private/Sales Workspace
router.get('/dashboard', protect, requireWorkspaceAccess(WORKSPACES.SALES, WORKSPACE_PERMISSIONS.VIEW), requireFeatureAccess(FEATURES.SALES_DASHBOARD_VIEW, FEATURE_PERMISSIONS.VIEW), async (req: any, res: Response) => {
  try {
    // Build where clause based on user role and department
    let whereClause: any = {};
    
    if (req.user.role !== 'ADMIN' && req.user.departmentId) {
      whereClause.departmentId = req.user.departmentId;
    }

    const [
      totalContracts,
      signedContracts,
      pendingContracts,
      totalRevenue,
      recentContracts
    ] = await Promise.all([
      prisma.salesContract.count({ where: whereClause }),
      prisma.salesContract.count({ where: { ...whereClause, status: 'SIGNED' } }),
      prisma.salesContract.count({ where: { ...whereClause, status: 'PENDING_APPROVAL' } }),
      prisma.salesContract.aggregate({
        where: { ...whereClause, status: 'SIGNED' },
        _sum: { totalAmount: true }
      }),
      prisma.salesContract.findMany({
        where: whereClause,
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: {
            select: {
              companyName: true,
              primaryContact: {
                select: {
                  firstName: true,
                  lastName: true
                }
              }
            }
          },
          createdByUser: {
            select: {
              firstName: true,
              lastName: true
            }
          }
        }
      })
    ]);

    const averageContractValue = signedContracts > 0
      ? Math.round(Number(totalRevenue._sum.totalAmount || 0) / signedContracts)
      : 0;

    res.json({
      success: true,
      data: {
        contracts: {
          total: totalContracts,
          signed: signedContracts,
          pending: pendingContracts,
          draft: 0, // We'll need to calculate this
          approved: 0, // We'll need to calculate this
          printed: 0, // We'll need to calculate this
          cancelled: 0, // We'll need to calculate this
          expired: 0 // We'll need to calculate this
        },
        revenue: {
          total: Number(totalRevenue._sum.totalAmount || 0),
          average: averageContractValue,
          completionRate: totalContracts > 0 ? Math.round((signedContracts / totalContracts) * 100) : 0
        },
        recentContracts
      }
    });
  } catch (error) {
    console.error('Get sales dashboard error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// ==================== DELIVERY MANAGEMENT ====================

// @desc    Get deliveries for a contract
// @route   GET /api/sales/contracts/:contractId/deliveries
// @access  Private/Sales Workspace
router.get('/contracts/:contractId/deliveries', protect, requireWorkspaceAccess(WORKSPACES.SALES, WORKSPACE_PERMISSIONS.VIEW), requireFeatureAccess(FEATURES.SALES_DELIVERIES_VIEW, FEATURE_PERMISSIONS.VIEW), async (req: any, res: Response) => {
  try {
    const deliveries = await getDeliveries(req.params.contractId, req.user.id);

    res.json({
      success: true,
      data: deliveries
    });
    return;
  } catch (error: any) {
    console.error('Get deliveries error:', error);
    if (error.message === 'Contract not found' || error.message === 'User not found') {
      return res.status(404).json({
        success: false,
        error: error.message
      });
    }
    if (error.message === 'Access denied') {
      return res.status(403).json({
        success: false,
        error: error.message
      });
    }
    return res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    Create new delivery
// @route   POST /api/sales/contracts/:contractId/deliveries
// @access  Private/Sales Workspace
router.post('/contracts/:contractId/deliveries', protect, requireWorkspaceAccess(WORKSPACES.SALES, WORKSPACE_PERMISSIONS.EDIT), requireFeatureAccess(FEATURES.SALES_DELIVERIES_CREATE, FEATURE_PERMISSIONS.EDIT), [
  body('deliveryDate').notEmpty().withMessage('Delivery date is required'),
  body('deliveryAddress').notEmpty().withMessage('Delivery address is required'),
  body('products').isArray().withMessage('Products array is required'),
], async (req: any, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { deliveryDate, deliveryAddress, driver, vehicle, notes, products } = req.body;

    const delivery = await createDelivery(req.params.contractId, {
      deliveryDate,
      deliveryAddress,
      driver,
      vehicle,
      notes,
      products
    }, req.user.id);

    res.status(201).json({
      success: true,
      data: delivery
    });
    return;
  } catch (error: any) {
    console.error('Create delivery error:', error);
    if (error.message === 'Contract not found' || error.message === 'User not found') {
      return res.status(404).json({
        success: false,
        error: error.message
      });
    }
    if (error.message === 'Access denied') {
      return res.status(403).json({
        success: false,
        error: error.message
      });
    }
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
    return;
  }
});

// ==================== PAYMENT MANAGEMENT ====================

// @desc    Get payments for a contract
// @route   GET /api/sales/contracts/:contractId/payments
// @access  Private/Sales Workspace
router.get('/contracts/:contractId/payments', protect, requireWorkspaceAccess(WORKSPACES.SALES, WORKSPACE_PERMISSIONS.VIEW), requireFeatureAccess(FEATURES.SALES_PAYMENTS_VIEW, FEATURE_PERMISSIONS.VIEW), async (req: any, res: Response) => {
  try {
    const payments = await getPayments(req.params.contractId, req.user.id);

    res.json({
      success: true,
      data: payments
    });
    return;
  } catch (error: any) {
    console.error('Get payments error:', error);
    if (error.message === 'Contract not found' || error.message === 'User not found') {
      return res.status(404).json({
        success: false,
        error: error.message
      });
    }
    if (error.message === 'Access denied') {
      return res.status(403).json({
        success: false,
        error: error.message
      });
    }
    return res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    Create new payment
// @route   POST /api/sales/contracts/:contractId/payments
// @access  Private/Sales Workspace
router.post('/contracts/:contractId/payments', protect, requireWorkspaceAccess(WORKSPACES.SALES, WORKSPACE_PERMISSIONS.EDIT), requireFeatureAccess(FEATURES.SALES_PAYMENTS_CREATE, FEATURE_PERMISSIONS.EDIT), [
  body('paymentMethod').isIn(['CASH', 'RECEIPT', 'CHECK']).withMessage('Valid payment method is required'),
  body('totalAmount').isDecimal().withMessage('Total amount is required'),
  body('paymentDate').optional().isISO8601().withMessage('Payment date must be a valid ISO date'),
  body('checkNumber').optional().isString().withMessage('Check number must be a string'),
  body('checkOwnerName').optional().isString().withMessage('Check owner name must be a string'),
  body('handoverDate').optional().isISO8601().withMessage('Handover date must be a valid ISO date'),
  body('cashType').optional().isString().withMessage('Cash type must be a string'),
  body('status').optional().isIn(['PENDING', 'PARTIAL', 'COMPLETED', 'CANCELLED']).withMessage('Valid payment status is required'),
  body('installments').optional().isArray().withMessage('Installments must be an array'),
], async (req: any, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { paymentMethod, totalAmount, currency, nationalCode, notes, installments, paymentDate, checkNumber, checkOwnerName, handoverDate, cashType, status } = req.body;

    const payment = await createPayment(req.params.contractId, {
      paymentMethod,
      totalAmount: parseFloat(totalAmount),
      currency,
      paymentDate,
      checkNumber,
      checkOwnerName,
      handoverDate,
      cashType,
      nationalCode,
      notes,
      status,
      installments
    }, req.user.id);

    res.status(201).json({
      success: true,
      data: payment
    });
    return;
  } catch (error: any) {
    console.error('Create payment error:', error);
    if (error.message === 'Contract not found' || error.message === 'User not found') {
      return res.status(404).json({
        success: false,
        error: error.message
      });
    }
    if (error.message === 'Access denied') {
      return res.status(403).json({
        success: false,
        error: error.message
      });
    }
    if (error.message === 'Check number is required for check payments' || error.message === 'Cash type is required for cash payments') {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
    return;
  }
});

// @desc    Send contract to customer for digital confirmation
// @route   POST /api/sales/contracts/:contractId/send-for-confirmation
// @access  Private/Sales Workspace
router.post(
  '/contracts/:contractId/send-for-confirmation',
  protect,
  requireWorkspaceAccess(WORKSPACES.SALES, WORKSPACE_PERMISSIONS.EDIT),
  requireFeatureAccess(FEATURES.SALES_VERIFICATION_SEND, FEATURE_PERMISSIONS.EDIT),
  async (req: any, res: Response) => {
    try {
      const contractId = req.params.contractId;
      const contract = await prisma.salesContract.findUnique({
        where: { id: contractId }
      });

      if (!contract) {
        return res.status(404).json({
          success: false,
          error: 'Contract not found'
        });
      }

      if (req.user.role !== 'ADMIN' && req.user.departmentId && contract.departmentId !== req.user.departmentId) {
        return res.status(403).json({
          success: false,
          error: 'Access denied'
        });
      }

      const result = await contractConfirmationService.sendForConfirmation({
        contractId,
        requestedBy: req.user.id,
        resend: false,
        meta: getRequestEvidence(req)
      });

      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.error || 'Failed to send confirmation'
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Confirmation SMS sent successfully',
        data: result.data
      });
    } catch (error) {
      console.error('Send for confirmation error:', error);
      return res.status(500).json({
        success: false,
        error: 'Server error'
      });
    }
  }
);

// @desc    Resend confirmation for contract
// @route   POST /api/sales/contracts/:contractId/resend-confirmation
// @access  Private/Sales Workspace
router.post(
  '/contracts/:contractId/resend-confirmation',
  protect,
  requireWorkspaceAccess(WORKSPACES.SALES, WORKSPACE_PERMISSIONS.EDIT),
  requireFeatureAccess(FEATURES.SALES_VERIFICATION_SEND, FEATURE_PERMISSIONS.EDIT),
  async (req: any, res: Response) => {
    try {
      const contractId = req.params.contractId;
      const contract = await prisma.salesContract.findUnique({
        where: { id: contractId }
      });

      if (!contract) {
        return res.status(404).json({
          success: false,
          error: 'Contract not found'
        });
      }

      if (req.user.role !== 'ADMIN' && req.user.departmentId && contract.departmentId !== req.user.departmentId) {
        return res.status(403).json({
          success: false,
          error: 'Access denied'
        });
      }

      const result = await contractConfirmationService.sendForConfirmation({
        contractId,
        requestedBy: req.user.id,
        resend: true,
        meta: getRequestEvidence(req)
      });

      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.error || 'Failed to resend confirmation'
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Confirmation SMS resent successfully',
        data: result.data
      });
    } catch (error) {
      console.error('Resend confirmation error:', error);
      return res.status(500).json({
        success: false,
        error: 'Server error'
      });
    }
  }
);

// @desc    Get contract confirmation status
// @route   GET /api/sales/contracts/:contractId/confirmation-status
// @access  Private/Sales Workspace
router.get(
  '/contracts/:contractId/confirmation-status',
  protect,
  requireWorkspaceAccess(WORKSPACES.SALES, WORKSPACE_PERMISSIONS.VIEW),
  requireFeatureAccess(FEATURES.SALES_VERIFICATION_TIME, FEATURE_PERMISSIONS.VIEW),
  async (req: any, res: Response) => {
    try {
      const contractId = req.params.contractId;
      const contract = await prisma.salesContract.findUnique({
        where: { id: contractId }
      });

      if (!contract) {
        return res.status(404).json({
          success: false,
          error: 'Contract not found'
        });
      }

      if (req.user.role !== 'ADMIN' && req.user.departmentId && contract.departmentId !== req.user.departmentId) {
        return res.status(403).json({
          success: false,
          error: 'Access denied'
        });
      }

      const result = await contractConfirmationService.getConfirmationStatus(contractId);
      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.error
        });
      }

      return res.status(200).json({
        success: true,
        data: result.data
      });
    } catch (error) {
      console.error('Get confirmation status error:', error);
      return res.status(500).json({
        success: false,
        error: 'Server error'
      });
    }
  }
);

// @desc    Cancel contract (approval-sensitive policy)
// @route   POST /api/sales/contracts/:contractId/cancel
// @access  Private/Sales Workspace
router.post(
  '/contracts/:contractId/cancel',
  protect,
  requireWorkspaceAccess(WORKSPACES.SALES, WORKSPACE_PERMISSIONS.EDIT),
  requireFeatureAccess(FEATURES.SALES_CONTRACTS_DELETE, FEATURE_PERMISSIONS.EDIT),
  async (req: any, res: Response) => {
    try {
      const contractId = req.params.contractId;
      const contract = await prisma.salesContract.findUnique({
        where: { id: contractId }
      });

      if (!contract) {
        return res.status(404).json({
          success: false,
          error: 'Contract not found'
        });
      }

      if (req.user.role !== 'ADMIN' && req.user.departmentId && contract.departmentId !== req.user.departmentId) {
        return res.status(403).json({
          success: false,
          error: 'Access denied'
        });
      }

      const canCancelApproved = await userHasCancelAfterApprovalPermission(req.user);
      const result = await contractConfirmationService.cancelContract({
        contractId,
        requestedBy: req.user.id,
        canCancelApproved,
        meta: getRequestEvidence(req)
      });

      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.error
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Contract cancelled successfully',
        data: result.data
      });
    } catch (error) {
      console.error('Cancel contract error:', error);
      return res.status(500).json({
        success: false,
        error: 'Server error'
      });
    }
  }
);

// @desc    Create contract item
// @route   POST /api/sales/contracts/:contractId/items
// @access  Private/Sales Workspace
router.post('/contracts/:contractId/items', protect, requireWorkspaceAccess(WORKSPACES.SALES, WORKSPACE_PERMISSIONS.EDIT), requireFeatureAccess(FEATURES.SALES_CONTRACT_ITEMS_CREATE, FEATURE_PERMISSIONS.EDIT), [
  body('productId').notEmpty().withMessage('Product ID is required'),
  body('quantity').isNumeric().withMessage('Quantity must be a number'),
  body('unitPrice').isNumeric().withMessage('Unit price must be a number'),
  body('totalPrice').isNumeric().withMessage('Total price must be a number'),
], async (req: any, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { productId, quantity, unitPrice, totalPrice, description, isMandatory, mandatoryPercentage, originalTotalPrice, stairSystemId, stairPartType, productType } = req.body;
    
    const contractItem = await createContractItem(req.params.contractId, {
      productId,
      productType,
      quantity: parseFloat(quantity),
      unitPrice: parseFloat(unitPrice),
      totalPrice: parseFloat(totalPrice),
      description,
      isMandatory,
      mandatoryPercentage: mandatoryPercentage ? parseFloat(mandatoryPercentage) : undefined,
      originalTotalPrice: originalTotalPrice ? parseFloat(originalTotalPrice) : undefined,
      stairSystemId,
      stairPartType
    }, req.user.id);

    res.status(201).json({
      success: true,
      data: contractItem
    });
    return;
  } catch (error: any) {
    console.error('Create contract item error:', error);
    if (error.message === 'Contract not found' || error.message === 'User not found') {
      return res.status(404).json({
        success: false,
        error: error.message
      });
    }
    if (error.message === 'Access denied') {
      return res.status(403).json({
        success: false,
        error: error.message
      });
    }
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
    return;
  }
});

export default router;





