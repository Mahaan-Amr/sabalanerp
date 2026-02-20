import express, { Request, Response } from 'express';
import { body, query, validationResult } from 'express-validator';
import { PrismaClient } from '@prisma/client';
import { protect } from '../middleware/auth';
import { requireWorkspaceAccess, WORKSPACES, WORKSPACE_PERMISSIONS } from '../middleware/workspace';
import { requireFeatureAccess, requireAnyFeatureAccess, FEATURE_PERMISSIONS, FEATURES } from '../middleware/feature';

const router = express.Router();
const prisma = new PrismaClient();

// @desc    Get all cutting types with filtering and search
// @route   GET /api/cutting-types
// @access  Private/Inventory Workspace
router.get('/', protect, requireAnyFeatureAccess([
  FEATURES.INVENTORY_CUTTING_TYPES_VIEW,
  FEATURES.SALES_CONTRACTS_VIEW,
  FEATURES.SALES_CONTRACTS_CREATE
], FEATURE_PERMISSIONS.VIEW), [
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

    // Get cutting types with pagination
    const [cuttingTypes, total] = await Promise.all([
      prisma.cuttingType.findMany({
        where: whereClause,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' }
      }),
      prisma.cuttingType.count({ where: whereClause })
    ]);

    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      data: cuttingTypes,
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
    console.error('Error fetching cutting types:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// @desc    Get cutting type by ID
// @route   GET /api/cutting-types/:id
// @access  Private/Inventory Workspace
router.get('/:id', protect, requireAnyFeatureAccess([
  FEATURES.INVENTORY_CUTTING_TYPES_VIEW,
  FEATURES.SALES_CONTRACTS_VIEW,
  FEATURES.SALES_CONTRACTS_CREATE
], FEATURE_PERMISSIONS.VIEW), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const cuttingType = await prisma.cuttingType.findUnique({
      where: { id }
    });

    if (!cuttingType) {
      return res.status(404).json({
        success: false,
        error: 'Cutting type not found'
      });
    }

    res.json({
      success: true,
      data: cuttingType
    });
  } catch (error) {
    console.error('Error fetching cutting type:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// @desc    Create new cutting type
// @route   POST /api/cutting-types
// @access  Private/Inventory Workspace
router.post('/', protect, requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.EDIT), requireFeatureAccess(FEATURES.INVENTORY_CUTTING_TYPES_CREATE, FEATURE_PERMISSIONS.EDIT), [
  body('code').notEmpty().withMessage('Code is required'),
  body('namePersian').notEmpty().withMessage('Persian name is required'),
  body('name').optional().isString(),
  body('description').optional().isString(),
  body('pricePerMeter').optional().isNumeric().withMessage('Price per meter must be a number'),
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

    const { code, name, namePersian, description, pricePerMeter, isActive = true } = req.body;

    // Check if code already exists
    const existingCuttingType = await prisma.cuttingType.findUnique({
      where: { code }
    });

    if (existingCuttingType) {
      return res.status(400).json({
        success: false,
        error: 'Cutting type with this code already exists'
      });
    }

    const cuttingType = await prisma.cuttingType.create({
      data: {
        code,
        name,
        namePersian,
        description,
        pricePerMeter: pricePerMeter ? parseFloat(pricePerMeter) : null,
        isActive
      }
    });

    res.status(201).json({
      success: true,
      data: cuttingType
    });
  } catch (error) {
    console.error('Error creating cutting type:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// @desc    Update cutting type
// @route   PUT /api/cutting-types/:id
// @access  Private/Inventory Workspace
router.put('/:id', protect, requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.EDIT), requireFeatureAccess(FEATURES.INVENTORY_CUTTING_TYPES_EDIT, FEATURE_PERMISSIONS.EDIT), [
  body('code').optional().isString(),
  body('name').optional().isString(),
  body('namePersian').optional().isString(),
  body('description').optional().isString(),
  body('pricePerMeter').optional().isNumeric().withMessage('Price per meter must be a number'),
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
      updateData.pricePerMeter = pricePerMeter !== null && pricePerMeter !== '' ? parseFloat(pricePerMeter) : null;
    }

    // Check if cutting type exists
    const existingCuttingType = await prisma.cuttingType.findUnique({
      where: { id }
    });

    if (!existingCuttingType) {
      return res.status(404).json({
        success: false,
        error: 'Cutting type not found'
      });
    }

    // Check if new code already exists (if code is being updated)
    if (updateData.code && updateData.code !== existingCuttingType.code) {
      const codeExists = await prisma.cuttingType.findUnique({
        where: { code: updateData.code }
      });

      if (codeExists) {
        return res.status(400).json({
          success: false,
          error: 'Cutting type with this code already exists'
        });
      }
    }

    const cuttingType = await prisma.cuttingType.update({
      where: { id },
      data: updateData
    });

    res.json({
      success: true,
      data: cuttingType
    });
  } catch (error) {
    console.error('Error updating cutting type:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// @desc    Delete cutting type
// @route   DELETE /api/cutting-types/:id
// @access  Private/Inventory Workspace
router.delete('/:id', protect, requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.EDIT), requireFeatureAccess(FEATURES.INVENTORY_CUTTING_TYPES_DELETE, FEATURE_PERMISSIONS.EDIT), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Check if cutting type exists
    const existingCuttingType = await prisma.cuttingType.findUnique({
      where: { id }
    });

    if (!existingCuttingType) {
      return res.status(404).json({
        success: false,
        error: 'Cutting type not found'
      });
    }

    await prisma.cuttingType.delete({
      where: { id }
    });

    res.json({
      success: true,
      message: 'Cutting type deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting cutting type:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// @desc    Toggle cutting type status
// @route   PATCH /api/cutting-types/:id/toggle
// @access  Private/Inventory Workspace
router.patch('/:id/toggle', protect, requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.EDIT), requireFeatureAccess(FEATURES.INVENTORY_CUTTING_TYPES_TOGGLE, FEATURE_PERMISSIONS.EDIT), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const cuttingType = await prisma.cuttingType.findUnique({
      where: { id }
    });

    if (!cuttingType) {
      return res.status(404).json({
        success: false,
        error: 'Cutting type not found'
      });
    }

    const updatedCuttingType = await prisma.cuttingType.update({
      where: { id },
      data: { isActive: !cuttingType.isActive }
    });

    res.json({
      success: true,
      data: updatedCuttingType
    });
  } catch (error) {
    console.error('Error toggling cutting type status:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

export default router;
