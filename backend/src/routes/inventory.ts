import express, { Response } from 'express';
import { body, query, validationResult } from 'express-validator';
import { PrismaClient } from '@prisma/client';
import { protect } from '../middleware/auth';
import { requireWorkspaceAccess, WORKSPACE_PERMISSIONS, WORKSPACES } from '../middleware/workspace';
import { requireFeatureAccess, FEATURES } from '../middleware/feature';

const router = express.Router();
const prisma = new PrismaClient();

// ==================== CUT TYPES ====================

// @desc    Get all cut types
// @route   GET /api/inventory/cut-types
// @access  Private/Inventory Workspace
router.get('/cut-types', protect, requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.VIEW), [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
  query('search').optional().isString().withMessage('Search must be a string'),
  query('isActive').optional().isBoolean().withMessage('isActive must be a boolean'),
], async (req: any, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const search = req.query.search || '';
    const isActive = req.query.isActive !== undefined ? req.query.isActive === 'true' : undefined;

    const whereClause: any = {};
    
    if (search) {
      whereClause.OR = [
        { namePersian: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } }
      ];
    }
    
    if (isActive !== undefined) {
      whereClause.isActive = isActive;
    }

    const [cutTypes, total] = await Promise.all([
      prisma.cutType.findMany({
        where: whereClause,
        skip,
        take: limit,
        orderBy: [{ createdAt: 'desc' }]
      }),
      prisma.cutType.count({ where: whereClause })
    ]);

    res.json({
      success: true,
      data: cutTypes,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get cut types error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// @desc    Create cut type
// @route   POST /api/inventory/cut-types
// @access  Private/Inventory Workspace
router.post('/cut-types', protect, requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.ADMIN), [
  body('code').notEmpty().withMessage('Code is required'),
  body('namePersian').notEmpty().withMessage('Persian name is required'),
  body('name').optional().isString(),
  body('description').optional().isString(),
], async (req: any, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { code, name, namePersian, description } = req.body;

    // Check if code already exists
    const existingCutType = await prisma.cutType.findUnique({
      where: { code }
    });

    if (existingCutType) {
      return res.status(400).json({ success: false, error: 'Code already exists' });
    }

    const cutType = await prisma.cutType.create({
      data: {
        code,
        name,
        namePersian,
        description
      }
    });

    res.status(201).json({ success: true, data: cutType });
  } catch (error) {
    console.error('Create cut type error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// @desc    Update cut type
// @route   PUT /api/inventory/cut-types/:id
// @access  Private/Inventory Workspace
router.put('/cut-types/:id', protect, requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.ADMIN), [
  body('code').optional().isString(),
  body('name').optional().isString(),
  body('namePersian').optional().isString(),
  body('description').optional().isString(),
  body('isActive').optional().isBoolean(),
], async (req: any, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { id } = req.params;
    const updateData = req.body;

    // Check if code already exists (if being updated)
    if (updateData.code) {
      const existingCutType = await prisma.cutType.findFirst({
        where: { 
          code: updateData.code,
          id: { not: id }
        }
      });

      if (existingCutType) {
        return res.status(400).json({ success: false, error: 'Code already exists' });
      }
    }

    const cutType = await prisma.cutType.update({
      where: { id },
      data: updateData
    });

    res.json({ success: true, data: cutType });
  } catch (error) {
    console.error('Update cut type error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// @desc    Delete cut type
// @route   DELETE /api/inventory/cut-types/:id
// @access  Private/Inventory Workspace
router.delete('/cut-types/:id', protect, requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.ADMIN), async (req: any, res: Response) => {
  try {
    const { id } = req.params;

    // Check if cut type exists
    const cutType = await prisma.cutType.findUnique({
      where: { id }
    });

    if (!cutType) {
      return res.status(404).json({ success: false, error: 'Cut type not found' });
    }

    // Soft delete
    await prisma.cutType.update({
      where: { id },
      data: { isActive: false }
    });

    res.json({ success: true, message: 'Cut type deleted successfully' });
  } catch (error) {
    console.error('Delete cut type error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// ==================== STONE MATERIALS ====================

// @desc    Get all stone materials
// @route   GET /api/inventory/stone-materials
// @access  Private/Inventory Workspace
router.get('/stone-materials', protect, requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.VIEW), [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
  query('search').optional().isString().withMessage('Search must be a string'),
  query('isActive').optional().isBoolean().withMessage('isActive must be a boolean'),
], async (req: any, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const search = req.query.search || '';
    const isActive = req.query.isActive !== undefined ? req.query.isActive === 'true' : undefined;

    const whereClause: any = {};
    
    if (search) {
      whereClause.OR = [
        { namePersian: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } }
      ];
    }
    
    if (isActive !== undefined) {
      whereClause.isActive = isActive;
    }

    const [stoneMaterials, total] = await Promise.all([
      prisma.stoneMaterial.findMany({
        where: whereClause,
        skip,
        take: limit,
        orderBy: [{ createdAt: 'desc' }]
      }),
      prisma.stoneMaterial.count({ where: whereClause })
    ]);

    res.json({
      success: true,
      data: stoneMaterials,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get stone materials error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// @desc    Create stone material
// @route   POST /api/inventory/stone-materials
// @access  Private/Inventory Workspace
router.post('/stone-materials', protect, requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.ADMIN), [
  body('code').notEmpty().withMessage('Code is required'),
  body('namePersian').notEmpty().withMessage('Persian name is required'),
  body('name').optional().isString(),
  body('description').optional().isString(),
], async (req: any, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { code, name, namePersian, description } = req.body;

    // Check if code already exists
    const existingStoneMaterial = await prisma.stoneMaterial.findUnique({
      where: { code }
    });

    if (existingStoneMaterial) {
      return res.status(400).json({ success: false, error: 'Code already exists' });
    }

    const stoneMaterial = await prisma.stoneMaterial.create({
      data: {
        code,
        name,
        namePersian,
        description
      }
    });

    res.status(201).json({ success: true, data: stoneMaterial });
  } catch (error) {
    console.error('Create stone material error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// @desc    Update stone material
// @route   PUT /api/inventory/stone-materials/:id
// @access  Private/Inventory Workspace
router.put('/stone-materials/:id', protect, requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.ADMIN), [
  body('code').optional().isString(),
  body('name').optional().isString(),
  body('namePersian').optional().isString(),
  body('description').optional().isString(),
  body('isActive').optional().isBoolean(),
], async (req: any, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { id } = req.params;
    const updateData = req.body;

    // Check if code already exists (if being updated)
    if (updateData.code) {
      const existingStoneMaterial = await prisma.stoneMaterial.findFirst({
        where: { 
          code: updateData.code,
          id: { not: id }
        }
      });

      if (existingStoneMaterial) {
        return res.status(400).json({ success: false, error: 'Code already exists' });
      }
    }

    const stoneMaterial = await prisma.stoneMaterial.update({
      where: { id },
      data: updateData
    });

    res.json({ success: true, data: stoneMaterial });
  } catch (error) {
    console.error('Update stone material error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// @desc    Delete stone material
// @route   DELETE /api/inventory/stone-materials/:id
// @access  Private/Inventory Workspace
router.delete('/stone-materials/:id', protect, requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.ADMIN), async (req: any, res: Response) => {
  try {
    const { id } = req.params;

    // Check if stone material exists
    const stoneMaterial = await prisma.stoneMaterial.findUnique({
      where: { id }
    });

    if (!stoneMaterial) {
      return res.status(404).json({ success: false, error: 'Stone material not found' });
    }

    // Soft delete
    await prisma.stoneMaterial.update({
      where: { id },
      data: { isActive: false }
    });

    res.json({ success: true, message: 'Stone material deleted successfully' });
  } catch (error) {
    console.error('Delete stone material error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// ==================== CUT WIDTHS ====================

// @desc    Get all cut widths
// @route   GET /api/inventory/cut-widths
// @access  Private/Inventory Workspace
router.get('/cut-widths', protect, requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.VIEW), [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
  query('search').optional().isString().withMessage('Search must be a string'),
  query('isActive').optional().isBoolean().withMessage('isActive must be a boolean'),
], async (req: any, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const search = req.query.search || '';
    const isActive = req.query.isActive !== undefined ? req.query.isActive === 'true' : undefined;

    const whereClause: any = {};
    
    if (search) {
      whereClause.OR = [
        { namePersian: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } }
      ];
    }
    
    if (isActive !== undefined) {
      whereClause.isActive = isActive;
    }

    const [cutWidths, total] = await Promise.all([
      prisma.cutWidth.findMany({
        where: whereClause,
        skip,
        take: limit,
        orderBy: [{ value: 'asc' }]
      }),
      prisma.cutWidth.count({ where: whereClause })
    ]);

    res.json({
      success: true,
      data: cutWidths,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get cut widths error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// @desc    Create cut width
// @route   POST /api/inventory/cut-widths
// @access  Private/Inventory Workspace
router.post('/cut-widths', protect, requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.ADMIN), [
  body('code').notEmpty().withMessage('Code is required'),
  body('namePersian').notEmpty().withMessage('Persian name is required'),
  body('value').isNumeric().withMessage('Value must be a number'),
  body('unit').optional().isString(),
  body('name').optional().isString(),
  body('description').optional().isString(),
], async (req: any, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { code, name, namePersian, value, unit = 'cm', description } = req.body;

    // Check if code already exists
    const existingCutWidth = await prisma.cutWidth.findUnique({
      where: { code }
    });

    if (existingCutWidth) {
      return res.status(400).json({ success: false, error: 'Code already exists' });
    }

    const cutWidth = await prisma.cutWidth.create({
      data: {
        code,
        name,
        namePersian,
        value: parseFloat(value),
        unit,
        description
      }
    });

    res.status(201).json({ success: true, data: cutWidth });
  } catch (error) {
    console.error('Create cut width error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// @desc    Update cut width
// @route   PUT /api/inventory/cut-widths/:id
// @access  Private/Inventory Workspace
router.put('/cut-widths/:id', protect, requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.ADMIN), [
  body('code').optional().isString(),
  body('name').optional().isString(),
  body('namePersian').optional().isString(),
  body('value').optional().isNumeric(),
  body('unit').optional().isString(),
  body('description').optional().isString(),
  body('isActive').optional().isBoolean(),
], async (req: any, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { id } = req.params;
    const updateData = req.body;

    // Check if code already exists (if being updated)
    if (updateData.code) {
      const existingCutWidth = await prisma.cutWidth.findFirst({
        where: { 
          code: updateData.code,
          id: { not: id }
        }
      });

      if (existingCutWidth) {
        return res.status(400).json({ success: false, error: 'Code already exists' });
      }
    }

    // Convert value to number if provided
    if (updateData.value) {
      updateData.value = parseFloat(updateData.value);
    }

    const cutWidth = await prisma.cutWidth.update({
      where: { id },
      data: updateData
    });

    res.json({ success: true, data: cutWidth });
  } catch (error) {
    console.error('Update cut width error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// @desc    Delete cut width
// @route   DELETE /api/inventory/cut-widths/:id
// @access  Private/Inventory Workspace
router.delete('/cut-widths/:id', protect, requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.ADMIN), async (req: any, res: Response) => {
  try {
    const { id } = req.params;

    // Check if cut width exists
    const cutWidth = await prisma.cutWidth.findUnique({
      where: { id }
    });

    if (!cutWidth) {
      return res.status(404).json({ success: false, error: 'Cut width not found' });
    }

    // Soft delete
    await prisma.cutWidth.update({
      where: { id },
      data: { isActive: false }
    });

    res.json({ success: true, message: 'Cut width deleted successfully' });
  } catch (error) {
    console.error('Delete cut width error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// ==================== THICKNESSES ====================

// @desc    Get all thicknesses
// @route   GET /api/inventory/thicknesses
// @access  Private/Inventory Workspace
router.get('/thicknesses', protect, requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.VIEW), [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
  query('search').optional().isString().withMessage('Search must be a string'),
  query('isActive').optional().isBoolean().withMessage('isActive must be a boolean'),
], async (req: any, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const search = req.query.search || '';
    const isActive = req.query.isActive !== undefined ? req.query.isActive === 'true' : undefined;

    const whereClause: any = {};
    
    if (search) {
      whereClause.OR = [
        { namePersian: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } }
      ];
    }
    
    if (isActive !== undefined) {
      whereClause.isActive = isActive;
    }

    const [thicknesses, total] = await Promise.all([
      prisma.thickness.findMany({
        where: whereClause,
        skip,
        take: limit,
        orderBy: [{ value: 'asc' }]
      }),
      prisma.thickness.count({ where: whereClause })
    ]);

    res.json({
      success: true,
      data: thicknesses,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get thicknesses error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// @desc    Create thickness
// @route   POST /api/inventory/thicknesses
// @access  Private/Inventory Workspace
router.post('/thicknesses', protect, requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.ADMIN), [
  body('code').notEmpty().withMessage('Code is required'),
  body('namePersian').notEmpty().withMessage('Persian name is required'),
  body('value').isNumeric().withMessage('Value must be a number'),
  body('unit').optional().isString(),
  body('name').optional().isString(),
  body('description').optional().isString(),
], async (req: any, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { code, name, namePersian, value, unit = 'cm', description } = req.body;

    // Check if code already exists
    const existingThickness = await prisma.thickness.findUnique({
      where: { code }
    });

    if (existingThickness) {
      return res.status(400).json({ success: false, error: 'Code already exists' });
    }

    const thickness = await prisma.thickness.create({
      data: {
        code,
        name,
        namePersian,
        value: parseFloat(value),
        unit,
        description
      }
    });

    res.status(201).json({ success: true, data: thickness });
  } catch (error) {
    console.error('Create thickness error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// @desc    Update thickness
// @route   PUT /api/inventory/thicknesses/:id
// @access  Private/Inventory Workspace
router.put('/thicknesses/:id', protect, requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.ADMIN), [
  body('code').optional().isString(),
  body('name').optional().isString(),
  body('namePersian').optional().isString(),
  body('value').optional().isNumeric(),
  body('unit').optional().isString(),
  body('description').optional().isString(),
  body('isActive').optional().isBoolean(),
], async (req: any, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { id } = req.params;
    const updateData = req.body;

    // Check if code already exists (if being updated)
    if (updateData.code) {
      const existingThickness = await prisma.thickness.findFirst({
        where: { 
          code: updateData.code,
          id: { not: id }
        }
      });

      if (existingThickness) {
        return res.status(400).json({ success: false, error: 'Code already exists' });
      }
    }

    // Convert value to number if provided
    if (updateData.value) {
      updateData.value = parseFloat(updateData.value);
    }

    const thickness = await prisma.thickness.update({
      where: { id },
      data: updateData
    });

    res.json({ success: true, data: thickness });
  } catch (error) {
    console.error('Update thickness error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// @desc    Delete thickness
// @route   DELETE /api/inventory/thicknesses/:id
// @access  Private/Inventory Workspace
router.delete('/thicknesses/:id', protect, requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.ADMIN), async (req: any, res: Response) => {
  try {
    const { id } = req.params;

    // Check if thickness exists
    const thickness = await prisma.thickness.findUnique({
      where: { id }
    });

    if (!thickness) {
      return res.status(404).json({ success: false, error: 'Thickness not found' });
    }

    // Soft delete
    await prisma.thickness.update({
      where: { id },
      data: { isActive: false }
    });

    res.json({ success: true, message: 'Thickness deleted successfully' });
  } catch (error) {
    console.error('Delete thickness error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// ==================== MINES ====================

// @desc    Get all mines
// @route   GET /api/inventory/mines
// @access  Private/Inventory Workspace
router.get('/mines', protect, requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.VIEW), [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
  query('search').optional().isString().withMessage('Search must be a string'),
  query('isActive').optional().isBoolean().withMessage('isActive must be a boolean'),
], async (req: any, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const search = req.query.search || '';
    const isActive = req.query.isActive !== undefined ? req.query.isActive === 'true' : undefined;

    const whereClause: any = {};
    
    if (search) {
      whereClause.OR = [
        { namePersian: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } }
      ];
    }
    
    if (isActive !== undefined) {
      whereClause.isActive = isActive;
    }

    const [mines, total] = await Promise.all([
      prisma.mine.findMany({
        where: whereClause,
        skip,
        take: limit,
        orderBy: [{ createdAt: 'desc' }]
      }),
      prisma.mine.count({ where: whereClause })
    ]);

    res.json({
      success: true,
      data: mines,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get mines error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// @desc    Create mine
// @route   POST /api/inventory/mines
// @access  Private/Inventory Workspace
router.post('/mines', protect, requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.ADMIN), [
  body('code').notEmpty().withMessage('Code is required'),
  body('namePersian').notEmpty().withMessage('Persian name is required'),
  body('name').optional().isString(),
  body('description').optional().isString(),
], async (req: any, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { code, name, namePersian, description } = req.body;

    // Check if code already exists
    const existingMine = await prisma.mine.findUnique({
      where: { code }
    });

    if (existingMine) {
      return res.status(400).json({ success: false, error: 'Code already exists' });
    }

    const mine = await prisma.mine.create({
      data: {
        code,
        name,
        namePersian,
        description
      }
    });

    res.status(201).json({ success: true, data: mine });
  } catch (error) {
    console.error('Create mine error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// @desc    Update mine
// @route   PUT /api/inventory/mines/:id
// @access  Private/Inventory Workspace
router.put('/mines/:id', protect, requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.ADMIN), [
  body('code').optional().isString(),
  body('name').optional().isString(),
  body('namePersian').optional().isString(),
  body('description').optional().isString(),
  body('isActive').optional().isBoolean(),
], async (req: any, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { id } = req.params;
    const updateData = req.body;

    // Check if code already exists (if being updated)
    if (updateData.code) {
      const existingMine = await prisma.mine.findFirst({
        where: { 
          code: updateData.code,
          id: { not: id }
        }
      });

      if (existingMine) {
        return res.status(400).json({ success: false, error: 'Code already exists' });
      }
    }

    const mine = await prisma.mine.update({
      where: { id },
      data: updateData
    });

    res.json({ success: true, data: mine });
  } catch (error) {
    console.error('Update mine error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// @desc    Delete mine
// @route   DELETE /api/inventory/mines/:id
// @access  Private/Inventory Workspace
router.delete('/mines/:id', protect, requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.ADMIN), async (req: any, res: Response) => {
  try {
    const { id } = req.params;

    // Check if mine exists
    const mine = await prisma.mine.findUnique({
      where: { id }
    });

    if (!mine) {
      return res.status(404).json({ success: false, error: 'Mine not found' });
    }

    // Soft delete
    await prisma.mine.update({
      where: { id },
      data: { isActive: false }
    });

    res.json({ success: true, message: 'Mine deleted successfully' });
  } catch (error) {
    console.error('Delete mine error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// ==================== FINISH TYPES ====================

// @desc    Get all finish types
// @route   GET /api/inventory/finish-types
// @access  Private/Inventory Workspace
router.get('/finish-types', protect, requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.VIEW), [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
  query('search').optional().isString().withMessage('Search must be a string'),
  query('isActive').optional().isBoolean().withMessage('isActive must be a boolean'),
], async (req: any, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const search = req.query.search || '';
    const isActive = req.query.isActive !== undefined ? req.query.isActive === 'true' : undefined;

    const whereClause: any = {};
    
    if (search) {
      whereClause.OR = [
        { namePersian: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } }
      ];
    }
    
    if (isActive !== undefined) {
      whereClause.isActive = isActive;
    }

    const [finishTypes, total] = await Promise.all([
      prisma.finishType.findMany({
        where: whereClause,
        skip,
        take: limit,
        orderBy: [{ createdAt: 'desc' }]
      }),
      prisma.finishType.count({ where: whereClause })
    ]);

    res.json({
      success: true,
      data: finishTypes,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get finish types error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// @desc    Create finish type
// @route   POST /api/inventory/finish-types
// @access  Private/Inventory Workspace
router.post('/finish-types', protect, requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.ADMIN), [
  body('code').notEmpty().withMessage('Code is required'),
  body('namePersian').notEmpty().withMessage('Persian name is required'),
  body('name').optional().isString(),
  body('description').optional().isString(),
], async (req: any, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { code, name, namePersian, description } = req.body;

    // Check if code already exists
    const existingFinishType = await prisma.finishType.findUnique({
      where: { code }
    });

    if (existingFinishType) {
      return res.status(400).json({ success: false, error: 'Code already exists' });
    }

    const finishType = await prisma.finishType.create({
      data: {
        code,
        name,
        namePersian,
        description
      }
    });

    res.status(201).json({ success: true, data: finishType });
  } catch (error) {
    console.error('Create finish type error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// @desc    Update finish type
// @route   PUT /api/inventory/finish-types/:id
// @access  Private/Inventory Workspace
router.put('/finish-types/:id', protect, requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.ADMIN), [
  body('code').optional().isString(),
  body('name').optional().isString(),
  body('namePersian').optional().isString(),
  body('description').optional().isString(),
  body('isActive').optional().isBoolean(),
], async (req: any, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { id } = req.params;
    const updateData = req.body;

    // Check if code already exists (if being updated)
    if (updateData.code) {
      const existingFinishType = await prisma.finishType.findFirst({
        where: { 
          code: updateData.code,
          id: { not: id }
        }
      });

      if (existingFinishType) {
        return res.status(400).json({ success: false, error: 'Code already exists' });
      }
    }

    const finishType = await prisma.finishType.update({
      where: { id },
      data: updateData
    });

    res.json({ success: true, data: finishType });
  } catch (error) {
    console.error('Update finish type error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// @desc    Delete finish type
// @route   DELETE /api/inventory/finish-types/:id
// @access  Private/Inventory Workspace
router.delete('/finish-types/:id', protect, requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.ADMIN), async (req: any, res: Response) => {
  try {
    const { id } = req.params;

    // Check if finish type exists
    const finishType = await prisma.finishType.findUnique({
      where: { id }
    });

    if (!finishType) {
      return res.status(404).json({ success: false, error: 'Finish type not found' });
    }

    // Soft delete
    await prisma.finishType.update({
      where: { id },
      data: { isActive: false }
    });

    res.json({ success: true, message: 'Finish type deleted successfully' });
  } catch (error) {
    console.error('Delete finish type error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// ==================== COLORS ====================

// @desc    Get all colors
// @route   GET /api/inventory/colors
// @access  Private/Inventory Workspace
router.get('/colors', protect, requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.VIEW), [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
  query('search').optional().isString().withMessage('Search must be a string'),
  query('isActive').optional().isBoolean().withMessage('isActive must be a boolean'),
], async (req: any, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const search = req.query.search || '';
    const isActive = req.query.isActive !== undefined ? req.query.isActive === 'true' : undefined;

    const whereClause: any = {};
    
    if (search) {
      whereClause.OR = [
        { namePersian: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } }
      ];
    }
    
    if (isActive !== undefined) {
      whereClause.isActive = isActive;
    }

    const [colors, total] = await Promise.all([
      prisma.color.findMany({
        where: whereClause,
        skip,
        take: limit,
        orderBy: [{ createdAt: 'desc' }]
      }),
      prisma.color.count({ where: whereClause })
    ]);

    res.json({
      success: true,
      data: colors,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get colors error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// @desc    Create color
// @route   POST /api/inventory/colors
// @access  Private/Inventory Workspace
router.post('/colors', protect, requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.ADMIN), [
  body('code').notEmpty().withMessage('Code is required'),
  body('namePersian').notEmpty().withMessage('Persian name is required'),
  body('name').optional().isString(),
  body('description').optional().isString(),
], async (req: any, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { code, name, namePersian, description } = req.body;

    // Check if code already exists
    const existingColor = await prisma.color.findUnique({
      where: { code }
    });

    if (existingColor) {
      return res.status(400).json({ success: false, error: 'Code already exists' });
    }

    const color = await prisma.color.create({
      data: {
        code,
        name,
        namePersian,
        description
      }
    });

    res.status(201).json({ success: true, data: color });
  } catch (error) {
    console.error('Create color error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// @desc    Update color
// @route   PUT /api/inventory/colors/:id
// @access  Private/Inventory Workspace
router.put('/colors/:id', protect, requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.ADMIN), [
  body('code').optional().isString(),
  body('name').optional().isString(),
  body('namePersian').optional().isString(),
  body('description').optional().isString(),
  body('isActive').optional().isBoolean(),
], async (req: any, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { id } = req.params;
    const updateData = req.body;

    // Check if code already exists (if being updated)
    if (updateData.code) {
      const existingColor = await prisma.color.findFirst({
        where: { 
          code: updateData.code,
          id: { not: id }
        }
      });

      if (existingColor) {
        return res.status(400).json({ success: false, error: 'Code already exists' });
      }
    }

    const color = await prisma.color.update({
      where: { id },
      data: updateData
    });

    res.json({ success: true, data: color });
  } catch (error) {
    console.error('Update color error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// @desc    Delete color
// @route   DELETE /api/inventory/colors/:id
// @access  Private/Inventory Workspace
router.delete('/colors/:id', protect, requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.ADMIN), async (req: any, res: Response) => {
  try {
    const { id } = req.params;

    // Check if color exists
    const color = await prisma.color.findUnique({
      where: { id }
    });

    if (!color) {
      return res.status(404).json({ success: false, error: 'Color not found' });
    }

    // Soft delete
    await prisma.color.update({
      where: { id },
      data: { isActive: false }
    });

    res.json({ success: true, message: 'Color deleted successfully' });
  } catch (error) {
    console.error('Delete color error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

export default router;
