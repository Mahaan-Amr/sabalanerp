import { prisma } from '../lib/prisma';
import express, { Response } from 'express';
import { randomUUID } from 'node:crypto';
import {
  parseCanonicalProductGraph,
  projectCanonicalGraphToLegacyProducts,
  projectCanonicalProductGraph
} from '@sabalanerp/contract-product-graph';
import { body, validationResult } from 'express-validator';
import { CorrectionRequestStatus, Prisma, PrismaClient } from '@prisma/client';
import { protect } from '../middleware/auth';
import { requireWorkspaceAccess, WORKSPACE_PERMISSIONS, WORKSPACES } from '../middleware/workspace';
import { requireFeatureAccess, FEATURE_PERMISSIONS, FEATURES } from '../middleware/feature';
import { createContractItem } from '../services/contractItemService';
import { resolveNarrowFeatureAccess } from '../services/narrowFeatureAccess';
import { getEffectiveUserAccess } from '../services/effectiveAccessService';
import { createDelivery, getDeliveries } from '../services/deliveryService';
import { createPayment, getPayments, validatePaymentData } from '../services/paymentService';
import {
  ContractProductGraphValidationError,
  createContract,
  updateContract,
  getContract,
  validateContractAccess,
  approveContract,
  rejectContract
} from '../services/contractService';
import { getNextContractNumberPreview } from '../services/contractNumberService';
import { contractConfirmationService } from '../services/contractConfirmationService';
import { buildAccountingSummaryForContracts } from '../services/accountingService';
import { getRequestEvidence } from '../utils/requestEvidence';
import { buildContractSearchConditions, parseContractStatuses } from '../services/contractListQuery';
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
import type { ContractPrintVariant } from '../utils/printTemplate';
import { assignLegacyRealizedCredit, reassignContractSeller, snapshotRealizedSale } from '../services/salesAttributionService';
import {
  persistSalesContractProductGraphCommand
} from '../services/contractProductGraphPersistence';
import {
  migrateLegacyContractProductGraph,
  readContractProductGraphWithoutWriting
} from '../services/contractProductGraphMigration';
import { buildSellerProductHistory } from '../services/sellerProductHistory';
import { assertContractQuantityEvidenceReadyForFinalization } from '../services/contractQuantityEvidenceGuard';
import { ApprovedPricingEvidenceError, asApprovedPricingEvidenceError } from '../services/approvedPricing/evidenceError';
import {
  acquireSalesContractEditSession,
  assertSalesContractEditOwnership,
  checkpointSalesContractRecovery,
  discoverRecoverableSalesContractCreationDraft,
  discardSalesContractCreationDraft,
  heartbeatSalesContractEditSession,
  releaseSalesContractEditSession
} from '../services/contractEditSessionService';
import salesReportsRouter from './salesReports';
import { publishNotificationEvent } from '../services/notificationService';
import { resolveWorkspaceRecipientIds } from '../services/domainNotificationRecipients';
import { ContractPartyIdentityValidationError } from '../services/contractPartyIdentity';

const router = express.Router();
const rejectContractGraphWritesWhenReadOnly = (_req: any, res: Response, next: () => void) => {
  if (String(process.env.CONTRACT_PRODUCT_GRAPH_READ_ONLY || '').toLowerCase() === 'true') {
    res.status(503).json({
      success: false,
      error: 'Contract product editing is temporarily read-only.'
    });
    return;
  }
  next();
};
const getRequestContractEditSession = (req: any, fallbackBaseRevision = 0) => ({
    draftId: String(req.headers['x-contract-draft-id'] || ''),
    userId: req.user.id,
    browserSessionId: String(req.headers['x-contract-browser-session-id'] || ''),
    leaseToken: String(req.headers['x-contract-lease-token'] || ''),
    baseRevision: Number(req.headers['x-contract-base-revision'] ?? fallbackBaseRevision)
  });
const assertRequestContractEditOwnership = async (req: any, fallbackBaseRevision = 0) =>
  assertSalesContractEditOwnership(getRequestContractEditSession(req, fallbackBaseRevision));
const releaseCommittedContractEditSession = async (req: any, fallbackBaseRevision = 0) => {
  try {
    const result = await releaseSalesContractEditSession(
      getRequestContractEditSession(req, fallbackBaseRevision)
    );
    if (!result.ok && result.code !== 'edit-session-missing') {
      console.error('Committed contract edit session cleanup was rejected:', {
        code: result.code,
        draftId: String(req.headers['x-contract-draft-id'] || '')
      });
    }
  } catch (error) {
    console.error('Committed contract edit session cleanup failed:', error);
  }
};
const userHasCancelAfterApprovalPermission = async (user: any): Promise<boolean> => {
  if (!user) return false;
  const access = await resolveNarrowFeatureAccess(prisma, {
    userId: user.id,
    role: user.role,
    workspace: WORKSPACES.SALES,
    feature: FEATURES.SALES_CONTRACTS_CANCEL_AFTER_APPROVAL,
    requiredPermission: FEATURE_PERMISSIONS.EDIT,
  });
  return access.allowed;
};

// ==================== SALES CONTRACTS ====================

const canManageDiscountRanges = async (user: any) => {
  if (user?.role === 'ADMIN') return true;
  if (!user?.id) return false;
  const effective = await getEffectiveUserAccess(prisma, { userId: user.id, userRole: user.role });
  return effective.workspaces.some(({ workspace, permission }) => workspace === WORKSPACES.SALES && permission === 'admin');
};

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
    if (!activeOnly && !await canManageDiscountRanges(req.user)) {
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
    if (!await canManageDiscountRanges(req.user)) {
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
    if (!await canManageDiscountRanges(req.user)) {
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
    if (!await canManageDiscountRanges(req.user)) {
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

// @desc    Get the authenticated seller's recent/frequent catalog selections
// @route   GET /api/sales/contracts/product-history
// @access  Private/Sales Workspace
router.get('/contracts/product-history', protect, requireWorkspaceAccess(WORKSPACES.SALES, WORKSPACE_PERMISSIONS.VIEW), async (req: any, res: Response) => {
  try {
    const contracts = await prisma.salesContract.findMany({
      where: { createdBy: req.user.id },
      orderBy: { createdAt: 'desc' },
      take: 250,
      select: {
        createdAt: true,
        contractData: true
      }
    });
    res.json({
      success: true,
      data: buildSellerProductHistory(contracts)
    });
    return;
  } catch (error) {
    console.error('Get seller product history error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
    return;
  }
});

router.post(
  '/contract-edit-sessions/creation-draft/discover',
  protect,
  requireWorkspaceAccess(WORKSPACES.SALES, WORKSPACE_PERMISSIONS.EDIT),
  async (req: any, res: Response) => {
    try {
      const browserSessionId = String(req.body.browserSessionId || '').trim();
      if (!browserSessionId) {
        return res.status(400).json({ success: false, error: 'Invalid draft discovery request' });
      }
      const draft = await discoverRecoverableSalesContractCreationDraft({
        userId: req.user.id,
        browserSessionId
      });
      return res.json({ success: true, data: draft });
    } catch (error) {
      console.error('Discover contract creation draft error:', error);
      return res.status(500).json({ success: false, error: 'Server error' });
    }
  }
);

router.post(
  '/contract-edit-sessions/:draftId/acquire',
  protect,
  requireWorkspaceAccess(WORKSPACES.SALES, WORKSPACE_PERMISSIONS.EDIT),
  async (req: any, res: Response) => {
    try {
      const browserSessionId = String(req.body.browserSessionId || '').trim();
      const draftId = String(req.params.draftId || '').trim();
      const schemaVersion = Number(req.body.schemaVersion);
      const requestedBaseRevision = Number(req.body.baseRevision);
      const contractId = typeof req.body.contractId === 'string'
        ? req.body.contractId.trim()
        : null;
      if (!draftId || !browserSessionId || !Number.isInteger(schemaVersion) || !Number.isInteger(requestedBaseRevision)) {
        return res.status(400).json({ success: false, error: 'Invalid edit session request' });
      }
      let baseRevision = requestedBaseRevision;
      if (contractId) {
        const contract = await prisma.salesContract.findUnique({
          where: { id: contractId },
          select: {
            departmentId: true,
            isInactive: true,
            productGraphState: { select: { revision: true } }
          }
        });
        if (!contract) {
          return res.status(404).json({ success: false, error: 'Contract not found' });
        }
        if (!validateContractAccess(contract, req.user)) {
          return res.status(403).json({ success: false, error: 'Access denied' });
        }
        if (contract.isInactive) {
          return res.status(409).json({ success: false, error: 'Inactive contracts are read-only' });
        }
        baseRevision = contract.productGraphState?.revision ?? 0;
        if (requestedBaseRevision !== baseRevision) {
          return res.status(409).json({
            success: false,
            data: {
              code: 'revision-conflict',
              recovery: null,
              currentBaseRevision: baseRevision
            }
          });
        }
      }
      const result = await acquireSalesContractEditSession({
        draftId,
        contractId,
        userId: req.user.id,
        browserSessionId,
        schemaVersion,
        baseRevision,
        takeover: req.body.takeover === true
      });
      if (!result.ok) {
        if (result.code === 'draft-owner-mismatch') {
          return res.status(404).json({
            success: false,
            data: { code: result.code, recovery: null }
          });
        }
        return res.status(409).json({ success: false, data: result });
      }
      return res.json({ success: true, data: result });
    } catch (error) {
      console.error('Acquire contract edit session error:', error);
      return res.status(500).json({ success: false, error: 'Server error' });
    }
  }
);

router.post(
  '/contract-edit-sessions/:draftId/heartbeat',
  protect,
  requireWorkspaceAccess(WORKSPACES.SALES, WORKSPACE_PERMISSIONS.EDIT),
  async (req: any, res: Response) => {
    try {
      const result = await heartbeatSalesContractEditSession({
        draftId: String(req.params.draftId || '').trim(),
        userId: req.user.id,
        browserSessionId: String(req.body.browserSessionId || '').trim(),
        leaseToken: String(req.body.leaseToken || '').trim(),
        baseRevision: Number(req.body.baseRevision)
      });
      if (!result.ok) {
        return res.status(409).json({ success: false, data: result });
      }
      return res.json({ success: true });
    } catch (error) {
      console.error('Heartbeat contract edit session error:', error);
      return res.status(500).json({ success: false, error: 'Server error' });
    }
  }
);

router.post(
  '/contract-edit-sessions/:draftId/discard',
  protect,
  requireWorkspaceAccess(WORKSPACES.SALES, WORKSPACE_PERMISSIONS.EDIT),
  async (req: any, res: Response) => {
    try {
      const discarded = await discardSalesContractCreationDraft({
        draftId: String(req.params.draftId || '').trim(),
        userId: req.user.id
      });
      if (!discarded) {
        return res.status(404).json({ success: false, error: 'Contract creation draft not found' });
      }
      return res.json({ success: true });
    } catch (error) {
      console.error('Discard contract creation draft error:', error);
      return res.status(500).json({ success: false, error: 'Server error' });
    }
  }
);

router.put(
  '/contract-edit-sessions/:draftId/recovery',
  protect,
  requireWorkspaceAccess(WORKSPACES.SALES, WORKSPACE_PERMISSIONS.EDIT),
  async (req: any, res: Response) => {
    try {
      const result = await checkpointSalesContractRecovery({
        draftId: String(req.params.draftId || '').trim(),
        userId: req.user.id,
        browserSessionId: String(req.body.browserSessionId || '').trim(),
        leaseToken: String(req.body.leaseToken || '').trim(),
        schemaVersion: Number(req.body.schemaVersion),
        baseRevision: Number(req.body.baseRevision),
        recovery: req.body.recovery
      });
      if (!result.ok) {
        return res.status(409).json({ success: false, data: result });
      }
      return res.json({ success: true, data: result });
    } catch (error) {
      console.error('Checkpoint contract recovery error:', error);
      return res.status(500).json({ success: false, error: 'Server error' });
    }
  }
);

router.delete(
  '/contract-edit-sessions/:draftId',
  protect,
  requireWorkspaceAccess(WORKSPACES.SALES, WORKSPACE_PERMISSIONS.EDIT),
  async (req: any, res: Response) => {
    try {
      const result = await releaseSalesContractEditSession({
        draftId: String(req.params.draftId || '').trim(),
        userId: req.user.id,
        browserSessionId: String(req.body.browserSessionId || '').trim(),
        leaseToken: String(req.body.leaseToken || '').trim(),
        baseRevision: Number(req.body.baseRevision)
      });
      if (!result.ok) {
        return res.status(409).json({ success: false, data: result });
      }
      return res.json({ success: true });
    } catch (error) {
      console.error('Release contract edit session error:', error);
      return res.status(500).json({ success: false, error: 'Server error' });
    }
  }
);

// @desc    Get all sales contracts
// @route   GET /api/sales/contracts
// @access  Private/Sales Workspace
router.get('/contracts', protect, requireWorkspaceAccess(WORKSPACES.SALES, WORKSPACE_PERMISSIONS.VIEW), requireFeatureAccess(FEATURES.SALES_CONTRACTS_VIEW, FEATURE_PERMISSIONS.VIEW), async (req: any, res: Response) => {
  try {
    const page = Math.max(parseInt(req.query.page as string) || 1, 1);
    const requestedLimit = parseInt(req.query.limit as string) || 10;
    const limit = Math.min(Math.max(requestedLimit, 1), 100);
    const skip = (page - 1) * limit;
    const statuses = parseContractStatuses(req.query.status);
    const departmentId = req.query.departmentId as string;
    const search = String(req.query.search || '').trim();
    const lifecycleView = req.query.lifecycleView === 'inactive' ? 'inactive' : 'active';

    // Build where clause based on user role and department
    let whereClause: any = { isInactive: lifecycleView === 'inactive' };
    
    if (req.user.role === 'ADMIN') {
      // Admins can see all contracts
      if (statuses.length) whereClause.status = { in: statuses };
      if (departmentId) whereClause.departmentId = departmentId;
    } else if (req.user.departmentId) {
      // Regular users can only see contracts from their department
      whereClause.departmentId = req.user.departmentId;
      if (statuses.length) whereClause.status = { in: statuses };
    } else if (statuses.length) {
      whereClause.status = { in: statuses };
    }

    if (search) {
      whereClause = {
        AND: [
          whereClause,
          { OR: buildContractSearchConditions(search) }
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
        },
        responsibleSeller: {
          select: { id: true, firstName: true, lastName: true, username: true }
        },
        realizedSeller: {
          select: { id: true, firstName: true, lastName: true, username: true }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    const contractIds = contracts.map((contract) => contract.id);
    const [financiallyApprovedRecords, approvedCorrectionRequests, accountingSummaries] = contractIds.length
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
        prisma.accountingCorrectionRequest.findMany({
          where: {
            contractId: { in: contractIds },
            status: CorrectionRequestStatus.APPROVED_FOR_SALES_EDIT
          },
          select: {
            contractId: true,
            id: true,
            category: true,
            accountantNote: true
          }
        }),
        buildAccountingSummaryForContracts(contracts)
      ])
      : [[], [], new Map()];
    const financiallyApprovedByContractId = new Map(
      financiallyApprovedRecords.map((record) => [record.contractId, record.financiallyApprovedAt] as const)
    );
    const approvedCorrectionByContractId = new Map(
      approvedCorrectionRequests.map((request) => [request.contractId, request] as const)
    );
    const contractsWithAccountingLock = contracts.map((contract) => ({
      ...contract,
      accountingEditLocked: financiallyApprovedByContractId.has(contract.id),
      canOpenCorrectionEdit: approvedCorrectionByContractId.has(contract.id),
      activeCorrectionRequest: approvedCorrectionByContractId.get(contract.id) || null,
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

    const printableContract = (contract as any).productGraphState
      ? {
          ...contract,
          contractData: {
            ...((contract.contractData as any) || {}),
            products: projectCanonicalGraphToLegacyProducts(
              parseCanonicalProductGraph((contract as any).productGraphState.graph)
            )
          }
        }
      : contract;
    const variant: ContractPrintVariant = req.query.variant === 'summary' ? 'summary' : 'original';
    const fresh = variant === 'summary' || String(req.query.fresh || 'false').toLowerCase() === 'true';
    const shouldDownload = String(req.query.download || 'false').toLowerCase() === 'true';
    const currentSignatures = (contract.signatures as any) || {};
    const cachedPdfPath = currentSignatures?.print?.pdfPath as string | undefined;
    const pdfFingerprint = buildSalesContractPdfFingerprint(printableContract, variant);
    const downloadName = variant === 'summary'
      ? buildSalesContractPdfDownloadName(contract).replace(/\.pdf$/i, '_summary.pdf')
      : buildSalesContractPdfDownloadName(contract);

    if (
      !fresh &&
      variant === 'original' &&
      cachedPdfPath &&
      isSalesContractPdfCacheFresh(contract, currentSignatures?.print?.fingerprint, pdfFingerprint) &&
      ensureStoredSalesContractPdfExists(cachedPdfPath)
    ) {
      if (shouldDownload) {
        return res.download(
          resolveStoredSalesContractPdfPath(cachedPdfPath),
          downloadName
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

    const pdfPath = await generateSalesContractPdf(printableContract, variant);
    const generatedAt = new Date().toISOString();

    if (variant === 'original') {
      const updatedPrintSignature = {
        ...(currentSignatures?.print || {}),
        pdfPath,
        generatedAt,
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
    }

    if (shouldDownload) {
      return res.download(
        resolveStoredSalesContractPdfPath(pdfPath),
        downloadName
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
        generatedAt,
        fromCache: false,
        variant
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
router.post('/contracts', rejectContractGraphWritesWhenReadOnly, protect, requireWorkspaceAccess(WORKSPACES.SALES, WORKSPACE_PERMISSIONS.EDIT), requireFeatureAccess(FEATURES.SALES_CONTRACTS_CREATE, FEATURE_PERMISSIONS.EDIT), [
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
    const editOwnership = await assertRequestContractEditOwnership(req, 0);
    if (!editOwnership.ok) {
      return res.status(409).json({ success: false, conflict: editOwnership });
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
      contractData,
      operationIdentityRepairEvidence,
      productSemanticRepairEvidence,
      potentialProjectId,
      _relations
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
      contractData,
      operationIdentityRepairEvidence,
      productSemanticRepairEvidence,
      potentialProjectId,
      _relations
    }, req.user.id, async (tx, createdContract) => {
      const accountingRecipients = await resolveWorkspaceRecipientIds(tx, WORKSPACES.ACCOUNTING, 'view');
      await publishNotificationEvent(tx, {
        type: 'SALES_CONTRACT_READY_FOR_ACCOUNTING',
        deduplicationKey: `sales-contract-ready-for-accounting:${createdContract.id}:${createdContract.updatedAt.toISOString()}`,
        recipientIds: accountingRecipients,
        actorId: req.user.id,
        workspace: WORKSPACES.ACCOUNTING,
        feature: FEATURES.ACCOUNTING_CONTRACTS_VIEW,
        resourceType: 'sales-contract',
        resourceId: createdContract.id,
        referenceId: createdContract.contractNumber,
        actionUrl: `/dashboard/accounting/contracts/${createdContract.id}`,
        payload: { actorName: req.user.username },
      });
    });

    await releaseCommittedContractEditSession(req, 0);
    res.status(201).json({
      success: true,
      data: contract
    });
    return;
  } catch (error: any) {
    if (error instanceof ContractPartyIdentityValidationError) {
      return res.status(422).json({ success: false, code: error.code, error: error.message });
    }
    console.error('Create sales contract error:', error);
    if (error instanceof ContractProductGraphValidationError) {
      return res.status(422).json({
        success: false,
        code: error.code,
        error: 'اطلاعات محصولات قرارداد نیاز به بازبینی دارد',
        details: error.issues.map(issue => ({
          code: issue.code,
          causeCode: issue.causeCode,
          path: issue.path[0],
          message: issue.message,
          productRowId: issue.productRowId
        }))
      });
    }
    if (error.message === 'User not found' || error.message === 'CRM potential project not found') {
      return res.status(404).json({
        success: false,
        error: error.message
      });
    }
    if (error.message === 'CRM potential project customer does not match contract customer' || error.message === 'CRM potential project is already linked to a sales contract') {
      return res.status(400).json({ success: false, error: error.message });
    }
    const trackingId = randomUUID();
    console.error('Unexpected create sales contract failure:', { trackingId, error });
    res.status(500).json({
      success: false,
      error: `ثبت قرارداد انجام نشد؛ لطفاً با پشتیبانی تماس بگیرید. کد پیگیری: ${trackingId}`,
      trackingId
    });
    return;
  }
});

router.post(
  '/contracts/:id/product-graph/commands',
  rejectContractGraphWritesWhenReadOnly,
  protect,
  requireWorkspaceAccess(WORKSPACES.SALES, WORKSPACE_PERMISSIONS.EDIT),
  requireFeatureAccess(FEATURES.SALES_CONTRACTS_EDIT, FEATURE_PERMISSIONS.EDIT),
  async (req: any, res: Response) => {
    try {
      const contract = await prisma.salesContract.findUnique({
        where: { id: req.params.id },
        select: { id: true, departmentId: true }
      });
      if (!contract) {
        return res.status(404).json({ success: false, error: 'Contract not found' });
      }
      if (!validateContractAccess(contract, req.user)) {
        return res.status(403).json({ success: false, error: 'Access denied' });
      }
      const editOwnership = await assertRequestContractEditOwnership(req, Number(req.body?.baseRevision));
      if (!editOwnership.ok) {
        return res.status(409).json({ success: false, conflict: editOwnership });
      }
      const result = await persistSalesContractProductGraphCommand({
        contractId: contract.id,
        actorId: req.user.id,
        command: req.body
      });
      if (!result.ok) {
        const stale = result.conflicts.some(conflict => conflict.code === 'revision-conflict');
        return res.status(stale ? 409 : 422).json({ success: false, conflicts: result.conflicts });
      }
      return res.json({ success: true, data: result });
    } catch (error) {
      console.error('Persist contract product graph command error:', error);
      return res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Invalid product graph command'
      });
    }
  }
);

router.get(
  '/contracts/:id/product-graph',
  protect,
  requireWorkspaceAccess(WORKSPACES.SALES, WORKSPACE_PERMISSIONS.VIEW),
  requireFeatureAccess(FEATURES.SALES_CONTRACTS_VIEW, FEATURE_PERMISSIONS.VIEW),
  async (req: any, res: Response) => {
    try {
      const contract = await prisma.salesContract.findUnique({
        where: { id: req.params.id },
        select: { id: true, departmentId: true }
      });
      if (!contract) {
        return res.status(404).json({ success: false, error: 'Contract not found' });
      }
      if (!validateContractAccess(contract, req.user)) {
        return res.status(403).json({ success: false, error: 'Access denied' });
      }
      const state = await readContractProductGraphWithoutWriting(prisma, contract.id);
      return res.json({ success: true, data: state });
    } catch (error) {
      console.error('Load contract product graph error:', error);
      return res.status(500).json({ success: false, error: 'Server error' });
    }
  }
);

router.post(
  '/contracts/:id/product-graph/migrate',
  rejectContractGraphWritesWhenReadOnly,
  protect,
  requireWorkspaceAccess(WORKSPACES.SALES, WORKSPACE_PERMISSIONS.EDIT),
  requireFeatureAccess(FEATURES.SALES_CONTRACTS_EDIT, FEATURE_PERMISSIONS.EDIT),
  async (req: any, res: Response) => {
    try {
      const contract = await prisma.salesContract.findUnique({
        where: { id: req.params.id },
        select: { id: true, departmentId: true }
      });
      if (!contract) return res.status(404).json({ success: false, error: 'Contract not found' });
      if (!validateContractAccess(contract, req.user)) {
        return res.status(403).json({ success: false, error: 'Access denied' });
      }
      const ownership = await assertRequestContractEditOwnership(req, 0);
      if (!ownership.ok) return res.status(409).json({ success: false, conflict: ownership });
      const result = await migrateLegacyContractProductGraph(prisma, {
        contractId: contract.id,
        actorId: req.user.id,
        backupReference: String(req.body?.backupReference || process.env.CONTRACT_GRAPH_BACKUP_REFERENCE || '')
      });
      if (!result.ok) return res.status(422).json({ success: false, conflicts: result.conflicts });
      return res.json({ success: true, data: result });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Migration failed';
      return res.status(message === 'Contract not found' ? 404 : 400).json({
        success: false,
        error: message
      });
    }
  }
);

router.post(
  '/contracts/:id/correction-requests',
  protect,
  requireWorkspaceAccess(WORKSPACES.SALES, WORKSPACE_PERMISSIONS.EDIT),
  requireFeatureAccess(FEATURES.SALES_CONTRACTS_EDIT, FEATURE_PERMISSIONS.EDIT),
  [
    body('reason').isString().trim().isLength({ min: 3 }),
    body('category').optional().isIn([
      'CUSTOMER_IDENTITY', 'AMOUNT_PRICING', 'PAYMENT_PLAN', 'DELIVERY_SCHEDULE',
      'TAX_INFO', 'DOCUMENT_SIGNATURE', 'OTHER',
    ]),
    body('priority').optional().isIn(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
  ],
  (_req: any, res: Response) => res.status(410).json({
    success: false,
    message: 'درخواست اصلاح قرارداد از فضای حسابداری آغاز می‌شود. موضوع را برای کاربر مجاز حسابداری ارسال کنید.',
  }),
);

// @desc    Update sales contract
// @route   PUT /api/sales/contracts/:id
// @access  Private/Sales Workspace
router.put('/contracts/:id', rejectContractGraphWritesWhenReadOnly, protect, requireWorkspaceAccess(WORKSPACES.SALES, WORKSPACE_PERMISSIONS.EDIT), requireFeatureAccess(FEATURES.SALES_CONTRACTS_EDIT, FEATURE_PERMISSIONS.EDIT), [
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
    const editOwnership = await assertRequestContractEditOwnership(req, 0);
    if (!editOwnership.ok) {
      return res.status(409).json({ success: false, conflict: editOwnership });
    }

    const updatedContract = await updateContract(req.params.id, req.body, req.user.id);

    await releaseCommittedContractEditSession(req, 0);
    res.json({
      success: true,
      data: updatedContract
    });
    return;
  } catch (error: any) {
    console.error('Update sales contract error:', error);
    if (error instanceof ContractProductGraphValidationError) {
      return res.status(422).json({
        success: false,
        code: error.code,
        error: 'اطلاعات محصولات قرارداد نیاز به بازبینی دارد',
        details: error.issues.map(issue => ({
          code: issue.code,
          path: issue.path[0],
          message: issue.message,
          productRowId: issue.productRowId
        }))
      });
    }
    if (error instanceof ContractPartyIdentityValidationError) {
      return res.status(422).json({ success: false, code: error.code, error: error.message });
    }
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
    const trackingId = randomUUID();
    console.error('Unexpected update sales contract failure:', { trackingId, error });
    res.status(500).json({
      success: false,
      error: `ذخیره تغییرات قرارداد انجام نشد؛ لطفاً با پشتیبانی تماس بگیرید. کد پیگیری: ${trackingId}`,
      trackingId
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

    if (contract.isInactive) {
      return res.status(409).json({ success: false, error: 'Inactive contracts are read-only' });
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

    await prisma.$transaction(async (tx) => {
      await tx.salesContract.update({
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
        }
      });
      if (contract.status === 'SIGNED' || contract.status === 'PRINTED') {
        await snapshotRealizedSale(tx, contract.id, req.user.id, contract.signedAt || new Date());
      }
    });

    const updatedContract = await prisma.salesContract.findUniqueOrThrow({
      where: { id: req.params.id },
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

    if (contract.isInactive) {
      return res.status(409).json({ success: false, error: 'Inactive contracts are read-only' });
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

    const signedAt = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "sales_contracts" WHERE "id" = ${req.params.id} FOR UPDATE
      `);
      const lockedContract = await tx.salesContract.findUnique({ where: { id: req.params.id } });
      if (!lockedContract || lockedContract.isInactive || lockedContract.status !== 'APPROVED') {
        throw new ApprovedPricingEvidenceError('Contract changed before finalization');
      }
      if (req.user.role !== 'ADMIN' && req.user.departmentId && lockedContract.departmentId !== req.user.departmentId) {
        throw new ApprovedPricingEvidenceError('Contract access changed before finalization');
      }
      await assertContractQuantityEvidenceReadyForFinalization(tx, lockedContract.id);
      const signed = await tx.salesContract.updateMany({
        where: { id: req.params.id, status: 'APPROVED', updatedAt: lockedContract.updatedAt },
        data: {
          status: 'SIGNED',
          signedBy: req.user.id,
          signedAt,
          signatures: {
            ...(lockedContract.signatures as any || {}),
            sign: {
              by: req.user.id,
              at: signedAt.toISOString(),
              note: note || null
            }
          }
        }
      });
      if (signed.count !== 1) throw new ApprovedPricingEvidenceError('Contract changed during finalization');
      await snapshotRealizedSale(tx, lockedContract.id, req.user.id, signedAt);
    });

    const updatedContract = await prisma.salesContract.findUniqueOrThrow({
      where: { id: req.params.id },
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
    if (asApprovedPricingEvidenceError(error)) {
      res.status(409).json({
        success: false,
        error: 'ثبت نهایی انجام نشد؛ دوباره تلاش کنید'
      });
      return;
    }
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
    return;
  }
});

router.put(
  '/contracts/:id/responsible-seller',
  protect,
  requireWorkspaceAccess(WORKSPACES.SALES, WORKSPACE_PERMISSIONS.ADMIN),
  [
    body('sellerId').notEmpty().withMessage('فروشنده مسئول جدید الزامی است'),
    body('reason').trim().notEmpty().withMessage('دلیل تغییر مسئول الزامی است')
  ],
  async (req: any, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'Validation failed', details: errors.array() });
    try {
      const contract = await prisma.salesContract.findUnique({ where: { id: req.params.id }, select: { departmentId: true, isInactive: true } });
      if (!contract) return res.status(404).json({ success: false, error: 'Contract not found' });
      if (contract.isInactive) return res.status(409).json({ success: false, error: 'Inactive contracts are read-only' });
      if (req.user.role !== 'ADMIN' && contract.departmentId !== req.user.departmentId) {
        return res.status(403).json({ success: false, error: 'Access denied' });
      }
      const updated = await reassignContractSeller(prisma, {
        contractId: req.params.id,
        nextSellerId: req.body.sellerId,
        actorId: req.user.id,
        reason: req.body.reason
      });
      return res.json({ success: true, data: updated });
    } catch (error: any) {
      return res.status(400).json({ success: false, error: error.message });
    }
  }
);

router.put(
  '/contracts/:id/legacy-realized-credit',
  protect,
  requireWorkspaceAccess(WORKSPACES.SALES, WORKSPACE_PERMISSIONS.ADMIN),
  [
    body('sellerId').notEmpty().withMessage('فروشنده فروش قطعی الزامی است'),
    body('reason').trim().notEmpty().withMessage('دلیل انتساب تاریخی الزامی است')
  ],
  async (req: any, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'Validation failed', details: errors.array() });
    try {
      const contract = await prisma.salesContract.findUnique({ where: { id: req.params.id }, select: { departmentId: true, isInactive: true } });
      if (!contract) return res.status(404).json({ success: false, error: 'Contract not found' });
      if (contract.isInactive) return res.status(409).json({ success: false, error: 'Inactive contracts are read-only' });
      if (req.user.role !== 'ADMIN' && contract.departmentId !== req.user.departmentId) {
        return res.status(403).json({ success: false, error: 'Access denied' });
      }
      const updated = await assignLegacyRealizedCredit(prisma, {
        contractId: req.params.id,
        sellerId: req.body.sellerId,
        actorId: req.user.id,
        reason: req.body.reason
      });
      return res.json({ success: true, data: updated });
    } catch (error: any) {
      return res.status(400).json({ success: false, error: error.message });
    }
  }
);

// ==================== SALES DASHBOARD ====================

// @desc    Get sales dashboard statistics
// @route   GET /api/sales/dashboard/stats
// @access  Private/Sales Workspace
router.get('/dashboard/stats', protect, requireWorkspaceAccess(WORKSPACES.SALES, WORKSPACE_PERMISSIONS.VIEW), requireFeatureAccess(FEATURES.SALES_DASHBOARD_VIEW, FEATURE_PERMISSIONS.VIEW), async (req: any, res: Response) => {
  try {
    // Build where clause based on user role and department
    let whereClause: any = { isInactive: false };
    
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
    let whereClause: any = { isInactive: false };
    
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
    if (error.message === 'Contract is inactive') {
      return res.status(409).json({ success: false, error: 'قرارداد غیرفعال است و تحویل جدید برای آن ثبت نمی‌شود' });
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
    if (error.message === 'Contract is inactive') {
      return res.status(409).json({ success: false, error: 'قرارداد غیرفعال است و پرداخت فروش جدید برای آن ثبت نمی‌شود' });
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

      if (contract.isInactive) {
        return res.status(409).json({ success: false, error: 'Inactive contracts are read-only' });
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

      if (contract.isInactive) {
        return res.status(409).json({ success: false, error: 'Inactive contracts are read-only' });
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

      if (contract.isInactive) {
        return res.status(409).json({ success: false, error: 'Inactive contracts are read-only' });
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
    if (error.message === 'Contract is inactive') {
      return res.status(409).json({ success: false, error: 'Inactive contracts are read-only' });
    }
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
    return;
  }
});

router.use('/reports', salesReportsRouter);

export default router;
