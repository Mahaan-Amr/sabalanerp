import express, { Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { PrismaClient } from '@prisma/client';
import { protect, authorize, AuthRequest } from '../middleware/auth';
import { requireFeatureAccess, FEATURE_PERMISSIONS, FEATURES } from '../middleware/feature';
import { sanitizeContractHtml } from '../utils/htmlSanitizer';

const router = express.Router();
const prisma = new PrismaClient();

// @desc    Get all contract templates
// @route   GET /api/contract-templates
// @access  Private
router.get('/', protect, requireFeatureAccess(FEATURES.SALES_CONTRACT_TEMPLATES_VIEW, FEATURE_PERMISSIONS.VIEW), async (req: any, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;
    const category = req.query.category as string;
    const isActive = req.query.isActive !== 'false'; // Default to true

    let whereClause: any = { isActive };

    if (category) {
      whereClause.category = category;
    }

    const templates = await prisma.contractTemplate.findMany({
      where: whereClause,
      skip,
      take: limit,
      include: {
        createdByUser: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            username: true,
          }
        },
        _count: {
          select: {
            contracts: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    const total = await prisma.contractTemplate.count({ where: whereClause });

    res.json({
      success: true,
      data: templates,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get contract templates error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    Get contract template by ID
// @route   GET /api/contract-templates/:id
// @access  Private
router.get('/:id', protect, requireFeatureAccess(FEATURES.SALES_CONTRACT_TEMPLATES_VIEW, FEATURE_PERMISSIONS.VIEW), async (req: AuthRequest, res: Response) => {
  try {
    const template = await prisma.contractTemplate.findUnique({
      where: { id: req.params.id },
      include: {
        createdByUser: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            username: true,
          }
        },
        contracts: {
          take: 5,
          orderBy: {
            createdAt: 'desc'
          },
          select: {
            id: true,
            contractNumber: true,
            titlePersian: true,
            status: true,
            createdAt: true
          }
        }
      }
    });

    if (!template) {
      return res.status(404).json({
        success: false,
        error: 'Contract template not found'
      });
    }

    res.json({
      success: true,
      data: template
    });
  } catch (error) {
    console.error('Get contract template error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    Create new contract template
// @route   POST /api/contract-templates
// @access  Private
router.post('/', protect, requireFeatureAccess(FEATURES.SALES_CONTRACT_TEMPLATES_CREATE, FEATURE_PERMISSIONS.EDIT), [
  body('name').notEmpty().withMessage('Template name is required'),
  body('namePersian').notEmpty().withMessage('Persian template name is required'),
  body('content').notEmpty().withMessage('Template content is required'),
], async (req: AuthRequest, res: Response) => {
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
      name,
      namePersian,
      description,
      content,
      variables,
      structure,
      calculations,
      category
    } = req.body;

    const template = await prisma.contractTemplate.create({
      data: {
        name,
        namePersian,
        description: description || null,
        content: sanitizeContractHtml(content),
        variables: variables || null,
        structure: structure || null,
        calculations: calculations || null,
        category: category || null,
        createdBy: req.user!.id,
      },
      include: {
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
      data: template
    });
  } catch (error) {
    console.error('Create contract template error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    Update contract template
// @route   PUT /api/contract-templates/:id
// @access  Private
router.put('/:id', protect, requireFeatureAccess(FEATURES.SALES_CONTRACT_TEMPLATES_EDIT, FEATURE_PERMISSIONS.EDIT), [
  body('name').notEmpty().withMessage('Template name is required'),
  body('namePersian').notEmpty().withMessage('Persian template name is required'),
  body('content').notEmpty().withMessage('Template content is required'),
], async (req: AuthRequest, res: Response) => {
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
      name,
      namePersian,
      description,
      content,
      variables,
      structure,
      calculations,
      category,
      isActive
    } = req.body;

    // Check if template exists
    const existingTemplate = await prisma.contractTemplate.findUnique({
      where: { id: req.params.id }
    });

    if (!existingTemplate) {
      return res.status(404).json({
        success: false,
        error: 'Contract template not found'
      });
    }

    const template = await prisma.contractTemplate.update({
      where: { id: req.params.id },
      data: {
        name,
        namePersian,
        description: description || null,
        content: sanitizeContractHtml(content),
        variables: variables || null,
        structure: structure || null,
        calculations: calculations || null,
        category: category || null,
        isActive: isActive !== undefined ? isActive : existingTemplate.isActive,
      },
      include: {
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
      data: template
    });
  } catch (error) {
    console.error('Update contract template error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    Delete contract template
// @route   DELETE /api/contract-templates/:id
// @access  Private/Admin
router.delete('/:id', protect, authorize('ADMIN'), requireFeatureAccess(FEATURES.SALES_CONTRACT_TEMPLATES_DELETE, FEATURE_PERMISSIONS.EDIT), async (req: AuthRequest, res: Response) => {
  try {
    const template = await prisma.contractTemplate.findUnique({
      where: { id: req.params.id },
      include: {
        _count: {
          select: {
            contracts: true
          }
        }
      }
    });

    if (!template) {
      return res.status(404).json({
        success: false,
        error: 'Contract template not found'
      });
    }

    if (template._count.contracts > 0) {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete template that is being used by contracts'
      });
    }

    await prisma.contractTemplate.delete({
      where: { id: req.params.id }
    });

    res.json({
      success: true,
      message: 'Contract template deleted successfully'
    });
  } catch (error) {
    console.error('Delete contract template error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    Generate contract from template
// @route   POST /api/contract-templates/:id/generate
// @access  Private
router.post('/:id/generate', protect, requireFeatureAccess(FEATURES.SALES_CONTRACT_TEMPLATES_GENERATE, FEATURE_PERMISSIONS.EDIT), [
  body('contractData').notEmpty().withMessage('Contract data is required'),
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { customerId, departmentId, contractData, title, titlePersian } = req.body;
    
    // Handle optional customer and department
    let finalCustomerId = customerId;
    let finalDepartmentId = departmentId;
    
    // If no customer provided, create a default one or use the first available
    if (!finalCustomerId) {
      const defaultCustomer = await prisma.customer.findFirst();
      if (defaultCustomer) {
        finalCustomerId = defaultCustomer.id;
      } else {
        // Create a default customer
        const newCustomer = await prisma.customer.create({
          data: {
            firstName: 'مشتری',
            lastName: 'پیش‌فرض',
            companyName: 'شرکت پیش‌فرض',
            email: 'default@customer.com',
            phone: '0000000000',
            address: 'آدرس ثبت نشده',
            city: 'تهران',
            country: 'ایران'
          }
        });
        finalCustomerId = newCustomer.id;
      }
    }
    
    // If no department provided, use the first available or create default
    if (!finalDepartmentId) {
      const defaultDepartment = await prisma.department.findFirst();
      if (defaultDepartment) {
        finalDepartmentId = defaultDepartment.id;
      } else {
        // Create a default department
        const newDepartment = await prisma.department.create({
          data: {
            name: 'Default Department',
            namePersian: 'دپارتمان پیش‌فرض',
            description: 'دپارتمان پیش‌فرض سیستم'
          }
        });
        finalDepartmentId = newDepartment.id;
      }
    }

    // Get template
    const template = await prisma.contractTemplate.findUnique({
      where: { id: req.params.id }
    });

    if (!template) {
      return res.status(404).json({
        success: false,
        error: 'Contract template not found'
      });
    }

    // Check if user has access to this department
    // Allow if user is ADMIN, or if user belongs to the department, or if user has no department assigned (flexible access)
    if (req.user!.role !== 'ADMIN' && req.user!.departmentId !== null && departmentId !== req.user!.departmentId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied to this department'
      });
    }

    // Generate next sequential contract number (numeric, starts at 1000)
    // Strategy: read the latest created contract and derive the next number.
    // Supports legacy values like "CNT-000001" by extracting numeric part.
    const lastContract = await prisma.contract.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { contractNumber: true }
    });

    const extractNumeric = (value: string | null | undefined): number | null => {
      if (!value) return null;
      const pureNumericMatch = value.match(/^\d+$/);
      if (pureNumericMatch) return parseInt(pureNumericMatch[0], 10);
      const legacyMatch = value.match(/(\d+)/); // e.g., CNT-000123 ? 123
      return legacyMatch ? parseInt(legacyMatch[1], 10) : null;
    };

    const lastNumber = extractNumeric(lastContract?.contractNumber) ?? 999;
    const nextNumber = Math.max(1000, lastNumber + 1);
    const contractNumber = String(nextNumber);

    // Inject the generated contract number into contractData for content generation
    const contractDataWithNumber = { ...contractData, contractNumber };

    // Generate contract content with variable substitution (uses contractNumber)
    const generatedContent = await generateContractContent(template, contractDataWithNumber);

    // Calculate total amount if provided
    let totalAmount: number | null = null;
    if (contractData.totalAmount) {
      totalAmount = parseFloat(contractData.totalAmount);
    }

    const contract = await prisma.contract.create({
      data: {
        contractNumber,
        title: title || template.name,
        titlePersian: titlePersian || template.namePersian,
        content: generatedContent,
        customerId: finalCustomerId,
        departmentId: finalDepartmentId,
        templateId: template.id,
        createdBy: req.user!.id,
        totalAmount,
        contractData: contractDataWithNumber || null,
        calculations: contractData?.calculations || null,
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
    console.error('Generate contract error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// Helper function to generate contract content with variable substitution
async function generateContractContent(template: any, contractData: any): Promise<string> {
  let content = template.content;

  // Replace basic variables
  const variables = {
    '{{contractDate}}': new Date().toLocaleDateString('fa-IR'),
    '{{contractNumber}}': contractData.contractNumber || 'CNT-XXXXXX',
    '{{buyerName}}': contractData.buyerName || '',
    '{{buyerNationalId}}': contractData.buyerNationalId || '',
    '{{buyerPhone}}': contractData.buyerPhone || '',
    '{{projectAddress}}': contractData.projectAddress || '',
    '{{totalAmount}}': contractData.totalAmount || '0',
    '{{totalAmountWords}}': convertToPersianWords(contractData.totalAmount || 0),
    '{{paymentMethod}}': contractData.paymentMethod || '',
    '{{sellerName}}': 'مجموعه سنگ طبیعی سبلان',
    '{{sellerPhone}}': '-',
  };

  // Replace all variables in content
  Object.entries(variables).forEach(([key, value]) => {
    content = content.replace(new RegExp(key, 'g'), value);
  });

  // Generate table rows if contractData has items
  if (contractData.items && Array.isArray(contractData.items)) {
    const tableRows = generateTableRows(contractData.items);
    content = content.replace('{{tableRows}}', tableRows);
  }

  return sanitizeContractHtml(content);
}

// Helper function to generate table rows
function generateTableRows(items: any[]): string {
  return items.map((item, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${item.code || ''}</td>
      <td>${item.stoneType || ''}</td>
      <td>${item.thickness || ''}</td>
      <td>${item.length || ''}</td>
      <td>${item.width || ''}</td>
      <td>${item.quantity || ''}</td>
      <td>${item.squareMeter || ''}</td>
      <td>${item.unitPrice || ''}</td>
      <td>${item.totalPrice || ''}</td>
      <td>${item.description || ''}</td>
    </tr>
  `).join('');
}

// Helper function to convert numbers to Persian words
function convertToPersianWords(num: number): string {
  // This is a simplified version - in production, you'd want a more comprehensive converter
  const persianNumbers = ['صفر', 'یک', 'دو', 'سه', 'چهار', 'پنج', 'شش', 'هفت', 'هشت', 'نه'];
  
  if (num === 0) return 'صفر';
  if (num < 10) return persianNumbers[num];
  
  // For larger numbers, you'd implement a full converter
  return num.toLocaleString('fa-IR') + ' تومان';
}

export default router;

