import express from 'express';
import { body, validationResult } from 'express-validator';
import { PrismaClient } from '@prisma/client';
import { protect, authorize } from '../middleware/auth';
import { requireFeatureAccess, FEATURE_PERMISSIONS, FEATURES } from '../middleware/feature';

const router = express.Router();
const prisma = new PrismaClient();

// @desc    Get all departments
// @route   GET /api/departments
// @access  Private
router.get('/', protect, requireFeatureAccess(FEATURES.CORE_DEPARTMENTS_VIEW, FEATURE_PERMISSIONS.VIEW), async (req: any, res) => {
  try {
    const departments = await prisma.department.findMany({
      where: { isActive: true },
      include: {
        _count: {
          select: {
            users: true,
            contracts: true
          }
        }
      },
      orderBy: {
        name: 'asc'
      }
    });

    res.json({
      success: true,
      data: departments
    });
  } catch (error) {
    console.error('Get departments error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    Get department by ID
// @route   GET /api/departments/:id
// @access  Private
router.get('/:id', protect, requireFeatureAccess(FEATURES.CORE_DEPARTMENTS_VIEW, FEATURE_PERMISSIONS.VIEW), async (req: any, res) => {
  try {
    const department = await prisma.department.findUnique({
      where: { id: req.params.id },
      include: {
        users: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            username: true,
            email: true,
            role: true,
            isActive: true,
          }
        },
        contracts: {
          include: {
            customer: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                companyName: true,
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
          },
          take: 10 // Limit to recent contracts
        },
        _count: {
          select: {
            users: true,
            contracts: true
          }
        }
      }
    });

    if (!department) {
      return res.status(404).json({
        success: false,
        error: 'Department not found'
      });
    }

    res.json({
      success: true,
      data: department
    });
  } catch (error) {
    console.error('Get department error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    Create new department
// @route   POST /api/departments
// @access  Private/Admin
router.post('/', protect, authorize('ADMIN'), requireFeatureAccess(FEATURES.CORE_DEPARTMENTS_CREATE, FEATURE_PERMISSIONS.EDIT), [
  body('name').notEmpty().withMessage('Name is required'),
  body('namePersian').notEmpty().withMessage('Persian name is required'),
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

    const { name, namePersian, description } = req.body;

    const department = await prisma.department.create({
      data: {
        name,
        namePersian,
        description: description || null,
      }
    });

    res.status(201).json({
      success: true,
      data: department
    });
  } catch (error) {
    console.error('Create department error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    Update department
// @route   PUT /api/departments/:id
// @access  Private/Admin
router.put('/:id', protect, authorize('ADMIN'), requireFeatureAccess(FEATURES.CORE_DEPARTMENTS_EDIT, FEATURE_PERMISSIONS.EDIT), [
  body('name').optional().notEmpty().withMessage('Name cannot be empty'),
  body('namePersian').optional().notEmpty().withMessage('Persian name cannot be empty'),
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

    const department = await prisma.department.findUnique({
      where: { id: req.params.id }
    });

    if (!department) {
      return res.status(404).json({
        success: false,
        error: 'Department not found'
      });
    }

    const updatedDepartment = await prisma.department.update({
      where: { id: req.params.id },
      data: req.body
    });

    res.json({
      success: true,
      data: updatedDepartment
    });
  } catch (error) {
    console.error('Update department error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    Delete department (soft delete)
// @route   DELETE /api/departments/:id
// @access  Private/Admin
router.delete('/:id', protect, authorize('ADMIN'), requireFeatureAccess(FEATURES.CORE_DEPARTMENTS_DELETE, FEATURE_PERMISSIONS.EDIT), async (req: any, res) => {
  try {
    const department = await prisma.department.findUnique({
      where: { id: req.params.id },
      include: {
        _count: {
          select: {
            users: true,
            contracts: true
          }
        }
      }
    });

    if (!department) {
      return res.status(404).json({
        success: false,
        error: 'Department not found'
      });
    }

    // Check if department has users or contracts
    if (department._count.users > 0 || department._count.contracts > 0) {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete department with existing users or contracts'
      });
    }

    await prisma.department.update({
      where: { id: req.params.id },
      data: { isActive: false }
    });

    res.json({
      success: true,
      message: 'Department deleted successfully'
    });
  } catch (error) {
    console.error('Delete department error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

export default router;
