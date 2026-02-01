import express, { Response } from 'express';
import { body, validationResult } from 'express-validator';
import { PrismaClient } from '@prisma/client';
import { protect, authorize } from '../middleware/auth';
import { generatePdfFromHtml } from '../utils/pdf';
import { renderContractHtml } from '../utils/printTemplate';

const router = express.Router();
const prisma = new PrismaClient();

// @desc    Get all contracts
// @route   GET /api/contracts
// @access  Private
router.get('/', protect, async (req: any, res) => {
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

    const contracts = await prisma.contract.findMany({
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
            email: true,
            phone: true,
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

    const total = await prisma.contract.count({ where: whereClause });

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
    console.error('Get contracts error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    Get contract by ID
// @route   GET /api/contracts/:id
// @access  Private
router.get('/:id', protect, async (req: any, res) => {
  try {
    const contract = await prisma.contract.findUnique({
      where: { id: req.params.id },
      include: {
        customer: true,
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

    res.json({
      success: true,
      data: contract
    });
  } catch (error) {
    console.error('Get contract error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    Create new contract
// @route   POST /api/contracts
// @access  Private
router.post('/', protect, [
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
      notes
    } = req.body;

    // Check if user has access to this department
    // Allow if user is ADMIN, or if user belongs to the department, or if user has no department assigned (flexible access)
    if (req.user.role !== 'ADMIN' && req.user.departmentId !== null && departmentId !== req.user.departmentId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied to this department'
      });
    }

    // Generate contract number
    const contractCount = await prisma.contract.count();
    const contractNumber = `CNT-${String(contractCount + 1).padStart(6, '0')}`;

    const contract = await prisma.contract.create({
      data: {
        contractNumber,
        title,
        titlePersian,
        content,
        customerId,
        departmentId,
        templateId: templateId || null,
        createdBy: req.user.id,
        totalAmount: totalAmount ? parseFloat(totalAmount) : null,
        currency: currency || 'ریال',
        notes: notes || null,
      },
      include: {
        customer: true,
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

    res.status(201).json({
      success: true,
      data: contract
    });
  } catch (error) {
    console.error('Create contract error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    Update contract
// @route   PUT /api/contracts/:id
// @access  Private
router.put('/:id', protect, [
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

    const contract = await prisma.contract.findUnique({
      where: { id: req.params.id },
      include: { department: true }
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

    // Only allow updates if contract is in DRAFT status
    if (contract.status !== 'DRAFT') {
      return res.status(400).json({
        success: false,
        error: 'Contract cannot be modified in current status'
      });
    }

    const updatedContract = await prisma.contract.update({
      where: { id: req.params.id },
      data: {
        ...req.body,
        totalAmount: req.body.totalAmount ? parseFloat(req.body.totalAmount) : contract.totalAmount,
      },
      include: {
        customer: true,
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

    res.json({
      success: true,
      data: updatedContract
    });
  } catch (error) {
    console.error('Update contract error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    Approve contract
// @route   PUT /api/contracts/:id/approve
// @access  Private/Admin
router.put('/:id/approve', protect, authorize('ADMIN'), async (req: any, res: Response) => {
  try {
    const contract = await prisma.contract.findUnique({
      where: { id: req.params.id }
    });

    if (!contract) {
      return res.status(404).json({
        success: false,
        error: 'Contract not found'
      });
    }

    if (contract.status !== 'DRAFT' && contract.status !== 'PENDING_APPROVAL') {
      return res.status(400).json({
        success: false,
        error: 'Contract cannot be approved in current status'
      });
    }

    const note: string | undefined = req.body?.note;

    const updatedContract = await prisma.contract.update({
      where: { id: req.params.id },
      data: {
        status: 'APPROVED',
        approvedBy: req.user.id,
        // persist note and metadata in signatures JSON blob
        signatures: {
          ...(contract.signatures as any || {}),
          approve: {
            by: req.user.id,
            at: new Date().toISOString(),
            note: note || null
          }
        }
      },
      include: {
        customer: true,
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
        }
      }
    });

    res.json({
      success: true,
      data: updatedContract
    });
  } catch (error) {
    console.error('Approve contract error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    Reject contract
// @route   PUT /api/contracts/:id/reject
// @access  Private/Admin
router.put('/:id/reject', protect, authorize('ADMIN'), async (req: any, res: Response) => {
  try {
    const contract = await prisma.contract.findUnique({
      where: { id: req.params.id }
    });

    if (!contract) {
      return res.status(404).json({
        success: false,
        error: 'Contract not found'
      });
    }

    if (contract.status === 'SIGNED' || contract.status === 'PRINTED') {
      return res.status(400).json({
        success: false,
        error: 'Signed or printed contracts cannot be rejected'
      });
    }

    const note: string | undefined = req.body?.note;

    const updatedContract = await prisma.contract.update({
      where: { id: req.params.id },
      data: {
        status: 'CANCELLED',
        signatures: {
          ...(contract.signatures as any || {}),
          reject: {
            by: req.user.id,
            at: new Date().toISOString(),
            note: note || null
          }
        }
      },
      include: {
        customer: true,
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
        }
      }
    });

    res.json({
      success: true,
      data: updatedContract
    });
  } catch (error) {
    console.error('Reject contract error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    Sign contract
// @route   PUT /api/contracts/:id/sign
// @access  Private
router.put('/:id/sign', protect, async (req: any, res: Response) => {
  try {
    const contract = await prisma.contract.findUnique({
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

    const updatedContract = await prisma.contract.update({
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
        customer: true,
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
  } catch (error) {
    console.error('Sign contract error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    Mark contract as printed
// @route   PUT /api/contracts/:id/print
// @access  Private
router.put('/:id/print', protect, async (req: any, res: Response) => {
  try {
    const contract = await prisma.contract.findUnique({
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

    // Always regenerate PDF with latest template and data
    const contractWithRelations = await prisma.contract.findUnique({
      where: { id: req.params.id },
      include: { customer: true }
    });
    
    // Generate unique filename with timestamp to avoid caching
    const timestamp = Date.now();
    const fileName = `contract_${contract.contractNumber}_${timestamp}`;
    
    const html = renderContractHtml({
      ...contractWithRelations,
      contractData: contract.contractData
    } as any);
    
    const pdfPath = await generatePdfFromHtml({ 
      htmlContent: html, 
      fileName, 
      landscape: true, 
      scale: 1.0, 
      widthMm: 297, 
      heightMm: 210 
    });

    const note: string | undefined = req.body?.note;

    const updatedContract = await prisma.contract.update({
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
        customer: true,
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
  } catch (error) {
    console.error('Print contract error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    Delete contract
// @route   DELETE /api/contracts/:id
// @access  Private/Admin
router.delete('/:id', protect, authorize('ADMIN'), async (req: any, res: Response) => {
  try {
    const contract = await prisma.contract.findUnique({
      where: { id: req.params.id }
    });

    if (!contract) {
      return res.status(404).json({
        success: false,
        error: 'Contract not found'
      });
    }

    // Only allow deletion of DRAFT contracts
    if (contract.status !== 'DRAFT') {
      return res.status(400).json({
        success: false,
        error: 'Only draft contracts can be deleted'
      });
    }

    await prisma.contract.delete({
      where: { id: req.params.id }
    });

    res.json({
      success: true,
      message: 'Contract deleted successfully'
    });
  } catch (error) {
    console.error('Delete contract error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

export default router;
