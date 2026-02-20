import express, { Response } from 'express';
import { body, validationResult } from 'express-validator';
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { protect } from '../middleware/auth';
import { requireWorkspaceAccess, WORKSPACE_PERMISSIONS, WORKSPACES } from '../middleware/workspace';
import { requireFeatureAccess, FEATURE_PERMISSIONS, FEATURES } from '../middleware/feature';
import { generatePdfFromHtml } from '../utils/pdf';
import { renderContractHtml } from '../utils/printTemplate';
import { createContractItem } from '../services/contractItemService';
import { createDelivery, getDeliveries } from '../services/deliveryService';
import { createPayment, getPayments, validatePaymentData } from '../services/paymentService';
import { createContract, updateContract, getContract, validateContractAccess, approveContract, rejectContract } from '../services/contractService';
import { generateContractNumber, getUserPrefix } from '../services/contractNumberService';
import { contractConfirmationService } from '../services/contractConfirmationService';
import { getRequestEvidence } from '../utils/requestEvidence';

const router = express.Router();
const prisma = new PrismaClient();
const salesContractPrintableInclude = {
  customer: {
    include: {
      phoneNumbers: true,
      primaryContact: true
    }
  },
  department: true,
  createdByUser: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      username: true
    }
  },
  approvedByUser: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      username: true
    }
  },
  signedByUser: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      username: true
    }
  },
  items: {
    include: {
      product: true
    }
  },
  deliveries: {
    include: {
      products: {
        include: {
          product: true
        }
      }
    }
  },
  payments: {
    include: {
      installments: {
        orderBy: {
          installmentNumber: 'asc' as const
        }
      }
    }
  }
};

const resolvePdfUrl = (req: any, pdfPath: string): string | null => {
  if (!pdfPath) return null;
  if (pdfPath.startsWith('http://') || pdfPath.startsWith('https://')) {
    return pdfPath;
  }

  const fileName = path.basename(pdfPath);
  if (!fileName) return null;

  const host = req.get('host');
  const protocol = req.protocol || 'http';
  const encodedFileName = encodeURIComponent(fileName);
  return `${protocol}://${host}/files/contracts/${encodedFileName}`;
};

const ensureStoredPdfExists = (pdfPath: string): boolean => {
  if (!pdfPath) return false;
  if (pdfPath.startsWith('http://') || pdfPath.startsWith('https://')) return true;

  const resolvedPath = path.isAbsolute(pdfPath)
    ? pdfPath
    : path.join(process.cwd(), 'storage', 'contracts', path.basename(pdfPath));

  return fs.existsSync(resolvedPath);
};

const generateSalesContractPdf = async (contract: any) => {
  const timestamp = Date.now();
  const fileName = `sales_contract_${contract.contractNumber}_${timestamp}`;
  const contractData = contract?.contractData || {};
  const relationItemsCount = Array.isArray(contract?.items) ? contract.items.length : 0;
  const relationDeliveriesCount = Array.isArray(contract?.deliveries) ? contract.deliveries.length : 0;
  const relationPaymentsCount = Array.isArray(contract?.payments) ? contract.payments.length : 0;
  const snapshotProductsCount = Array.isArray(contractData?.products) ? contractData.products.length : 0;
  const snapshotDeliveriesCount = Array.isArray(contractData?.deliveries) ? contractData.deliveries.length : 0;
  const snapshotPaymentsCount = Array.isArray(contractData?.payment?.payments) ? contractData.payment.payments.length : 0;

  console.info('[sales-pdf] generating contract pdf', {
    contractId: contract?.id,
    contractNumber: contract?.contractNumber,
    relationItemsCount,
    relationDeliveriesCount,
    relationPaymentsCount,
    snapshotProductsCount,
    snapshotDeliveriesCount,
    snapshotPaymentsCount
  });

  const html = renderContractHtml({
    ...contract,
    contractData: contract.contractData
  });

  return generatePdfFromHtml({
    htmlContent: html,
    fileName,
    landscape: false,
    scale: 1,
    widthMm: 210,
    heightMm: 297
  });
};

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


// @desc    Get next contract number with gap-filling logic
// @route   GET /api/sales/contracts/next-number
// @access  Private/Sales Workspace
router.get('/contracts/next-number', protect, requireWorkspaceAccess(WORKSPACES.SALES, WORKSPACE_PERMISSIONS.VIEW), requireFeatureAccess(FEATURES.SALES_CONTRACT_NUMBER_VIEW, FEATURE_PERMISSIONS.VIEW), async (req: any, res: Response) => {
  try {
    const contractNumber = await generateContractNumber(req.user.id);
    
    res.json({
      success: true,
      data: { contractNumber }
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
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;
    const status = req.query.status as string;
    const departmentId = req.query.departmentId as string;

    // Build where clause based on user role and department
    let whereClause: any = {};
    
    if (req.user.role === 'ADMIN') {
      // Admins can see all contracts
      if (status) whereClause.status = status;
      if (departmentId) whereClause.departmentId = departmentId;
    } else {
      // Regular users can only see contracts from their department
      whereClause.departmentId = req.user.departmentId;
      if (status) whereClause.status = status;
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

    const total = await prisma.salesContract.count({ where: whereClause });

    res.json({
      success: true,
      data: contracts,
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
    const currentSignatures = (contract.signatures as any) || {};
    const cachedPdfPath = currentSignatures?.print?.pdfPath as string | undefined;

    if (!fresh && cachedPdfPath && ensureStoredPdfExists(cachedPdfPath)) {
      const cachedUrl = resolvePdfUrl(req, cachedPdfPath);
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
      generatedAt: new Date().toISOString()
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

    const url = resolvePdfUrl(req, pdfPath);
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
    if (req.user.role !== 'ADMIN' && req.user.departmentId !== null && departmentId !== req.user.departmentId) {
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
    if (error.message === 'Access denied' || error.message === 'Contract cannot be modified in current status') {
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
    if (req.user.role !== 'ADMIN' && contract.departmentId !== req.user.departmentId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }

    if (contract.status !== 'SIGNED' && contract.status !== 'PRINTED') {
      return res.status(400).json({
        success: false,
        error: 'Contract must be signed before printing'
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
        status: 'PRINTED',
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
    if (req.user.role !== 'ADMIN' && contract.departmentId !== req.user.departmentId) {
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
    
    if (req.user.role !== 'ADMIN') {
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
    
    if (req.user.role !== 'ADMIN') {
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

      if (req.user.role !== 'ADMIN' && contract.departmentId !== req.user.departmentId) {
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

      if (req.user.role !== 'ADMIN' && contract.departmentId !== req.user.departmentId) {
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

      if (req.user.role !== 'ADMIN' && contract.departmentId !== req.user.departmentId) {
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

      if (req.user.role !== 'ADMIN' && contract.departmentId !== req.user.departmentId) {
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





