import express, { Request, Response } from 'express';
import { body, query, validationResult } from 'express-validator';
import { PrismaClient } from '@prisma/client';
import { protect } from '../middleware/auth';
import { requireWorkspaceAccess, WORKSPACES, WORKSPACE_PERMISSIONS } from '../middleware/workspace';
import { requireFeatureAccess, FEATURE_PERMISSIONS, FEATURES } from '../middleware/feature';

const router = express.Router();
const prisma = new PrismaClient();

// @desc    Get all services with filtering and search
// @route   GET /api/services
// @access  Private/Inventory Workspace
router.get('/', protect, requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.VIEW), requireFeatureAccess(FEATURES.INVENTORY_SERVICES_VIEW, FEATURE_PERMISSIONS.VIEW), [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 1000 }).withMessage('Limit must be between 1 and 1000'),
  query('search').optional().isString().withMessage('Search must be a string'),
  query('isActive').optional().isBoolean().withMessage('isActive must be a boolean'),
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

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    // Build where clause for filtering
    let whereClause: any = {};

    // Search functionality
    if (req.query.search) {
      const searchTerm = req.query.search as string;
      whereClause.OR = [
        { namePersian: { contains: searchTerm, mode: 'insensitive' } },
        { name: { contains: searchTerm, mode: 'insensitive' } },
        { code: { contains: searchTerm, mode: 'insensitive' } },
        { description: { contains: searchTerm, mode: 'insensitive' } }
      ];
    }

    // Active filter
    if (req.query.isActive !== undefined) {
      whereClause.isActive = req.query.isActive === 'true';
    }

    // Get services with pagination
    const [services, total] = await Promise.all([
      prisma.service.findMany({
        where: whereClause,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' }
      }),
      prisma.service.count({ where: whereClause })
    ]);

    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      data: services,
      pagination: {
        currentPage: page,
        totalPages,
        totalItems: total,
        itemsPerPage: limit,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1
      }
    });
  } catch (error) {
    console.error('Error fetching services:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// @desc    Get service by ID
// @route   GET /api/services/:id
// @access  Private/Inventory Workspace
router.get('/:id', protect, requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.VIEW), requireFeatureAccess(FEATURES.INVENTORY_SERVICES_VIEW, FEATURE_PERMISSIONS.VIEW), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const service = await prisma.service.findUnique({
      where: { id }
    });

    if (!service) {
      return res.status(404).json({
        success: false,
        error: 'Service not found'
      });
    }

    res.json({
      success: true,
      data: service
    });
  } catch (error) {
    console.error('Error fetching service:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// @desc    Create new service
// @route   POST /api/services
// @access  Private/Inventory Workspace
router.post('/', protect, requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.EDIT), requireFeatureAccess(FEATURES.INVENTORY_SERVICES_CREATE, FEATURE_PERMISSIONS.EDIT), [
  body('code').notEmpty().withMessage('Code is required'),
  body('namePersian').notEmpty().withMessage('Persian name is required'),
  body('name').optional().isString(),
  body('description').optional().isString(),
  body('isActive').optional().isBoolean()
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

    const { code, name, namePersian, description, isActive = true } = req.body;

    // Check if code already exists
    const existingService = await prisma.service.findUnique({
      where: { code }
    });

    if (existingService) {
      return res.status(400).json({
        success: false,
        error: 'Service with this code already exists'
      });
    }

    const service = await prisma.service.create({
      data: {
        code,
        name,
        namePersian,
        description,
        isActive
      }
    });

    res.status(201).json({
      success: true,
      data: service
    });
  } catch (error) {
    console.error('Error creating service:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// @desc    Update service
// @route   PUT /api/services/:id
// @access  Private/Inventory Workspace
router.put('/:id', protect, requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.EDIT), requireFeatureAccess(FEATURES.INVENTORY_SERVICES_EDIT, FEATURE_PERMISSIONS.EDIT), [
  body('code').optional().isString(),
  body('name').optional().isString(),
  body('namePersian').optional().isString(),
  body('description').optional().isString(),
  body('isActive').optional().isBoolean()
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

    const { id } = req.params;
    const updateData = req.body;

    // Check if service exists
    const existingService = await prisma.service.findUnique({
      where: { id }
    });

    if (!existingService) {
      return res.status(404).json({
        success: false,
        error: 'Service not found'
      });
    }

    // Check if new code already exists (if code is being updated)
    if (updateData.code && updateData.code !== existingService.code) {
      const codeExists = await prisma.service.findUnique({
        where: { code: updateData.code }
      });

      if (codeExists) {
        return res.status(400).json({
          success: false,
          error: 'Service with this code already exists'
        });
      }
    }

    const service = await prisma.service.update({
      where: { id },
      data: updateData
    });

    res.json({
      success: true,
      data: service
    });
  } catch (error) {
    console.error('Error updating service:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// @desc    Delete service
// @route   DELETE /api/services/:id
// @access  Private/Inventory Workspace
router.delete('/:id', protect, requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.EDIT), requireFeatureAccess(FEATURES.INVENTORY_SERVICES_DELETE, FEATURE_PERMISSIONS.EDIT), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Check if service exists
    const existingService = await prisma.service.findUnique({
      where: { id }
    });

    if (!existingService) {
      return res.status(404).json({
        success: false,
        error: 'Service not found'
      });
    }

    await prisma.service.delete({
      where: { id }
    });

    res.json({
      success: true,
      message: 'Service deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting service:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// @desc    Toggle service status
// @route   PATCH /api/services/:id/toggle
// @access  Private/Inventory Workspace
router.patch('/:id/toggle', protect, requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.EDIT), requireFeatureAccess(FEATURES.INVENTORY_SERVICES_TOGGLE, FEATURE_PERMISSIONS.EDIT), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const service = await prisma.service.findUnique({
      where: { id }
    });

    if (!service) {
      return res.status(404).json({
        success: false,
        error: 'Service not found'
      });
    }

    const updatedService = await prisma.service.update({
      where: { id },
      data: { isActive: !service.isActive }
    });

    res.json({
      success: true,
      data: updatedService
    });
  } catch (error) {
    console.error('Error toggling service status:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

export default router;
