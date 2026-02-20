import express from 'express';
import { body, validationResult } from 'express-validator';
import { PrismaClient } from '@prisma/client';
import { protect, authorize } from '../middleware/auth';
import { requireFeatureAccess, FEATURE_PERMISSIONS, FEATURES } from '../middleware/feature';

const router = express.Router();
const prisma = new PrismaClient();

// Legacy customer model routes.
// NOTE: New sales contract wizard must use /api/crm/customers (CrmCustomer) only.
router.use((req, _res, next) => {
  console.warn('[legacy-customers-route-hit]', {
    method: req.method,
    path: req.originalUrl,
    source: 'backend/src/routes/customers.ts'
  });
  next();
});

// @desc    [Legacy] Get all customers
// @route   GET /api/customers
// @access  Private
router.get('/', protect, requireFeatureAccess(FEATURES.SALES_CUSTOMERS_VIEW, FEATURE_PERMISSIONS.VIEW), async (req: any, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;
    const search = req.query.search as string;

    let whereClause: any = { isActive: true };

    if (search) {
      whereClause.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { companyName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ];
    }

    const customers = await prisma.customer.findMany({
      where: whereClause,
      skip,
      take: limit,
      include: {
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

    const total = await prisma.customer.count({ where: whereClause });

    res.json({
      success: true,
      data: customers,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get customers error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    [Legacy] Get customer by ID
// @route   GET /api/customers/:id
// @access  Private
router.get('/:id', protect, requireFeatureAccess(FEATURES.SALES_CUSTOMERS_VIEW, FEATURE_PERMISSIONS.VIEW), async (req: any, res) => {
  try {
    const customer = await prisma.customer.findUnique({
      where: { id: req.params.id },
      include: {
        contracts: {
          include: {
            department: {
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
            }
          },
          orderBy: {
            createdAt: 'desc'
          }
        },
        _count: {
          select: {
            contracts: true
          }
        }
      }
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        error: 'Customer not found'
      });
    }

    res.json({
      success: true,
      data: customer
    });
  } catch (error) {
    console.error('Get customer error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    [Legacy] Create new customer
// @route   POST /api/customers
// @access  Private
router.post('/', protect, requireFeatureAccess(FEATURES.SALES_CUSTOMERS_CREATE, FEATURE_PERMISSIONS.EDIT), [
  body('firstName').notEmpty().withMessage('First name is required'),
  body('lastName').notEmpty().withMessage('Last name is required'),
  body('email').optional().isEmail().withMessage('Invalid email format'),
  body('phone').optional().isMobilePhone('fa-IR').withMessage('Invalid phone format'),
], async (req: any, res) => {
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
      firstName,
      lastName,
      companyName,
      email,
      phone,
      address,
      city,
      country
    } = req.body;

    const customer = await prisma.customer.create({
      data: {
        firstName,
        lastName,
        companyName: companyName || null,
        email: email || null,
        phone: phone || null,
        address: address || null,
        city: city || null,
        country: country || 'ایران',
      }
    });

    res.status(201).json({
      success: true,
      data: customer
    });
  } catch (error) {
    console.error('Create customer error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    [Legacy] Update customer
// @route   PUT /api/customers/:id
// @access  Private
router.put('/:id', protect, requireFeatureAccess(FEATURES.SALES_CUSTOMERS_EDIT, FEATURE_PERMISSIONS.EDIT), [
  body('firstName').optional().notEmpty().withMessage('First name cannot be empty'),
  body('lastName').optional().notEmpty().withMessage('Last name cannot be empty'),
  body('email').optional().isEmail().withMessage('Invalid email format'),
  body('phone').optional().isMobilePhone('fa-IR').withMessage('Invalid phone format'),
], async (req: any, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const customer = await prisma.customer.findUnique({
      where: { id: req.params.id }
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        error: 'Customer not found'
      });
    }

    const updatedCustomer = await prisma.customer.update({
      where: { id: req.params.id },
      data: req.body
    });

    res.json({
      success: true,
      data: updatedCustomer
    });
  } catch (error) {
    console.error('Update customer error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    [Legacy] Delete customer (soft delete)
// @route   DELETE /api/customers/:id
// @access  Private/Admin
router.delete('/:id', protect, authorize('ADMIN'), requireFeatureAccess(FEATURES.SALES_CUSTOMERS_DELETE, FEATURE_PERMISSIONS.EDIT), async (req: any, res) => {
  try {
    const customer = await prisma.customer.findUnique({
      where: { id: req.params.id },
      include: {
        _count: {
          select: {
            contracts: true
          }
        }
      }
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        error: 'Customer not found'
      });
    }

    // Check if customer has contracts
    if (customer._count.contracts > 0) {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete customer with existing contracts'
      });
    }

    await prisma.customer.update({
      where: { id: req.params.id },
      data: { isActive: false }
    });

    res.json({
      success: true,
      message: 'Customer deleted successfully'
    });
  } catch (error) {
    console.error('Delete customer error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

export default router;

