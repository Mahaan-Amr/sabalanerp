import express, { Request, Response } from 'express';
import { body, query, validationResult } from 'express-validator';
import { PrismaClient } from '@prisma/client';
import { protect } from '../middleware/auth';
import { requireWorkspaceAccess, WORKSPACES, WORKSPACE_PERMISSIONS } from '../middleware/workspace';

const router = express.Router();
const prisma = new PrismaClient();

// @desc    Get all sub-services with filtering and search
// @route   GET /api/sub-services
// @access  Private/Inventory Workspace
router.get('/', protect, requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.VIEW), [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 1000 }).withMessage('Limit must be between 1 and 1000'),
  query('search').optional().isString().withMessage('Search must be a string'),
  query('isActive').optional().isIn(['true', 'false', '0', '1']).withMessage('isActive must be true or false'),
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

    // Get sub-services with pagination
    const [subServices, total] = await Promise.all([
      prisma.subService.findMany({
        where: whereClause,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' }
      }),
      prisma.subService.count({ where: whereClause })
    ]);

    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      data: subServices,
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
    console.error('Error fetching sub-services:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// @desc    Get sub-service by ID
// @route   GET /api/sub-services/:id
// @access  Private/Inventory Workspace
router.get('/:id', protect, requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.VIEW), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const subService = await prisma.subService.findUnique({
      where: { id }
    });

    if (!subService) {
      return res.status(404).json({
        success: false,
        error: 'Sub-service not found'
      });
    }

    res.json({
      success: true,
      data: subService
    });
  } catch (error) {
    console.error('Error fetching sub-service:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// @desc    Create new sub-service
// @route   POST /api/sub-services
// @access  Private/Inventory Workspace
router.post('/', protect, requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.EDIT), [
  body('code').notEmpty().withMessage('Code is required'),
  body('namePersian').notEmpty().withMessage('Persian name is required'),
  body('name').optional().isString(),
  body('description').optional().isString(),
  body('pricePerMeter').notEmpty().withMessage('Price per meter is required').isNumeric().withMessage('Price per meter must be a number'),
  body('calculationBase').optional().isIn(['length', 'squareMeters']).withMessage('Calculation base must be either "length" or "squareMeters"'),
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

    const { code, name, namePersian, description, pricePerMeter, calculationBase = 'length', isActive = true } = req.body;

    // Check if code already exists
    const existingSubService = await prisma.subService.findUnique({
      where: { code }
    });

    if (existingSubService) {
      return res.status(400).json({
        success: false,
        error: 'Sub-service with this code already exists'
      });
    }

    const subService = await prisma.subService.create({
      data: {
        code,
        name,
        namePersian,
        description,
        pricePerMeter: parseFloat(pricePerMeter),
        calculationBase,
        isActive
      }
    });

    res.status(201).json({
      success: true,
      data: subService
    });
  } catch (error) {
    console.error('Error creating sub-service:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// @desc    Update sub-service
// @route   PUT /api/sub-services/:id
// @access  Private/Inventory Workspace
router.put('/:id', protect, requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.EDIT), [
  body('code').optional().isString(),
  body('name').optional().isString(),
  body('namePersian').optional().isString(),
  body('description').optional().isString(),
  body('pricePerMeter').optional().isNumeric().withMessage('Price per meter must be a number'),
  body('calculationBase').optional().isIn(['length', 'squareMeters']).withMessage('Calculation base must be either "length" or "squareMeters"'),
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
    const { pricePerMeter, ...restUpdateData } = req.body;
    
    // Prepare update data
    const updateData: any = { ...restUpdateData };
    if (pricePerMeter !== undefined) {
      updateData.pricePerMeter = parseFloat(pricePerMeter);
    }

    // Check if sub-service exists
    const existingSubService = await prisma.subService.findUnique({
      where: { id }
    });

    if (!existingSubService) {
      return res.status(404).json({
        success: false,
        error: 'Sub-service not found'
      });
    }

    // Check if new code already exists (if code is being updated)
    if (updateData.code && updateData.code !== existingSubService.code) {
      const codeExists = await prisma.subService.findUnique({
        where: { code: updateData.code }
      });

      if (codeExists) {
        return res.status(400).json({
          success: false,
          error: 'Sub-service with this code already exists'
        });
      }
    }

    const subService = await prisma.subService.update({
      where: { id },
      data: updateData
    });

    res.json({
      success: true,
      data: subService
    });
  } catch (error) {
    console.error('Error updating sub-service:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// @desc    Delete sub-service
// @route   DELETE /api/sub-services/:id
// @access  Private/Inventory Workspace
router.delete('/:id', protect, requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.EDIT), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Check if sub-service exists
    const existingSubService = await prisma.subService.findUnique({
      where: { id }
    });

    if (!existingSubService) {
      return res.status(404).json({
        success: false,
        error: 'Sub-service not found'
      });
    }

    await prisma.subService.delete({
      where: { id }
    });

    res.json({
      success: true,
      message: 'Sub-service deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting sub-service:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// @desc    Toggle sub-service status
// @route   PATCH /api/sub-services/:id/toggle
// @access  Private/Inventory Workspace
router.patch('/:id/toggle', protect, requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.EDIT), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const subService = await prisma.subService.findUnique({
      where: { id }
    });

    if (!subService) {
      return res.status(404).json({
        success: false,
        error: 'Sub-service not found'
      });
    }

    const updatedSubService = await prisma.subService.update({
      where: { id },
      data: { isActive: !subService.isActive }
    });

    res.json({
      success: true,
      data: updatedSubService
    });
  } catch (error) {
    console.error('Error toggling sub-service status:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

export default router;

