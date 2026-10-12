import { authorizeOperationMinimumChange, canEditOperationMinimum } from '../services/operationMinimumPermission';
import { prisma } from '../lib/prisma';
import express, { Request, Response } from 'express';
import { body, query, validationResult } from 'express-validator';
import { PrismaClient } from '@prisma/client';
import { protect } from '../middleware/auth';
import { requireWorkspaceAccess, WORKSPACES, WORKSPACE_PERMISSIONS } from '../middleware/workspace';
import { requireFeatureAccess, requireAnyFeatureAccess, FEATURE_PERMISSIONS, FEATURES } from '../middleware/feature';

const router = express.Router();

router.get('/minimum-access', protect, async (req: any, res: Response) => {
  try { return res.json({ success: true, data: { canEdit: await canEditOperationMinimum(req.user) } }); }
  catch (error: any) { console.error('Operation minimum permission failed', error);
    return res.status(500).json({ success: false, error: 'بررسی مجوز حداقل مقدار انجام نشد؛ دوباره تلاش کنید.' }); }
});

router.patch('/:id/minimum', protect, async (req: any, res: Response) => {
  try {
    if (!await canEditOperationMinimum(req.user)) return res.status(403).json({ success: false,
      error: 'مجوز تغییر حداقل مقدار ابزار و فرآوری سنگ برای شما فعال نیست.' });
    if (!Object.prototype.hasOwnProperty.call(req.body, 'minimumQuantity')) return res.status(400).json({ success: false,
      error: 'حداقل مقدار را وارد کنید؛ برای حذف محدودیت مقدار را خالی بگذارید.' });
    const existing = await prisma.subService.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ success: false, error: 'ابزار یا فرآوری سنگ یافت نشد.' });
    const minimumQuantity = await authorizeOperationMinimumChange(req.user, req.body.minimumQuantity, existing.minimumQuantity);
    const data = await prisma.subService.update({ where: { id: existing.id }, data: { minimumQuantity } });
    return res.json({ success: true, data });
  } catch (error: any) {
    console.error('Operation minimum update failed', error);
    const validation = error.message?.startsWith('حداقل مقدار');
    return res.status(error.status || (validation ? 400 : 500)).json({ success: false,
      error: error.status || validation ? error.message : 'ذخیره حداقل مقدار انجام نشد؛ دوباره تلاش کنید.' });
  }
});


// @desc    Get all sub-services with filtering and search
// @route   GET /api/sub-services
// @access  Private/Inventory Workspace or Sales contract workflow read access
router.get('/', protect, requireAnyFeatureAccess([
  FEATURES.INVENTORY_SUB_SERVICES_VIEW,
  FEATURES.SALES_CONTRACTS_VIEW,
  FEATURES.SALES_CONTRACTS_CREATE,
  FEATURES.SALES_CONTRACTS_EDIT
], FEATURE_PERMISSIONS.VIEW), [
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
        error: 'اطلاعات ابزار معتبر نیست؛ فیلدهای مشخص‌شده را اصلاح کنید.',
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
  } catch (error: any) {
    console.error('Error fetching sub-services:', error);
    return res.status(500).json({
      success: false,
      error: 'عملیات ابزار انجام نشد؛ دوباره تلاش کنید.'
    });
  }
});

// @desc    Get sub-service by ID
// @route   GET /api/sub-services/:id
// @access  Private/Inventory Workspace or Sales contract workflow read access
router.get('/:id', protect, requireAnyFeatureAccess([
  FEATURES.INVENTORY_SUB_SERVICES_VIEW,
  FEATURES.SALES_CONTRACTS_VIEW,
  FEATURES.SALES_CONTRACTS_CREATE,
  FEATURES.SALES_CONTRACTS_EDIT
], FEATURE_PERMISSIONS.VIEW), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const subService = await prisma.subService.findUnique({
      where: { id }
    });

    if (!subService) {
      return res.status(404).json({
        success: false,
        error: 'ابزار یافت نشد.'
      });
    }

    res.json({
      success: true,
      data: subService
    });
  } catch (error: any) {
    console.error('Error fetching sub-service:', error);
    return res.status(500).json({
      success: false,
      error: 'عملیات ابزار انجام نشد؛ دوباره تلاش کنید.'
    });
  }
});

// @desc    Create new sub-service
// @route   POST /api/sub-services
// @access  Private/Inventory Workspace
router.post('/', protect, requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.EDIT), requireFeatureAccess(FEATURES.INVENTORY_SUB_SERVICES_CREATE, FEATURE_PERMISSIONS.EDIT), [
  body('code').notEmpty().withMessage('کد ابزار الزامی است.'),
  body('namePersian').notEmpty().withMessage('نام فارسی ابزار الزامی است.'),
  body('name').optional().isString(),
  body('description').optional().isString(),
  body('pricePerMeter').notEmpty().withMessage('قیمت پایه ابزار الزامی است.').isNumeric().withMessage('قیمت پایه ابزار باید عدد باشد.'),
  body('calculationBase').optional().isIn(['length', 'squareMeters']).withMessage('واحد محاسبه ابزار باید متر طول یا متر مربع باشد.'),
  body('images').optional().isArray(),
  body('isActive').optional().isBoolean()
], async (req: any, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'اطلاعات ابزار معتبر نیست؛ فیلدهای مشخص‌شده را اصلاح کنید.',
        details: errors.array()
      });
    }

    const { code, name, namePersian, description, pricePerMeter, calculationBase = 'length', images = [], isActive = true } = req.body;

    // Check if code already exists
    const existingSubService = await prisma.subService.findUnique({
      where: { code }
    });

    if (existingSubService) {
      return res.status(400).json({
        success: false,
        error: 'ابزاری با این کد وجود دارد؛ کد دیگری وارد کنید.'
      });
    }

    const minimumQuantity = await authorizeOperationMinimumChange(req.user, req.body.minimumQuantity);
    const subService = await prisma.subService.create({
      data: {
        code,
        name,
        namePersian,
        description,
        pricePerMeter: parseFloat(pricePerMeter),
        calculationBase,
        minimumQuantity,
        images,
        isActive
      }
    });

    res.status(201).json({
      success: true,
      data: subService
    });
  } catch (error: any) {
    console.error('Error creating sub-service:', error);
    if (error.status || error.message?.startsWith('حداقل مقدار')) return res.status(error.status || 400).json({ success: false, error: error.message, details: [{ path: 'minimumQuantity', msg: error.message }] });
    return res.status(500).json({
      success: false,
      error: 'عملیات ابزار انجام نشد؛ دوباره تلاش کنید.'
    });
  }
});

// @desc    Update sub-service
// @route   PUT /api/sub-services/:id
// @access  Private/Inventory Workspace
router.put('/:id', protect, requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.EDIT), requireFeatureAccess(FEATURES.INVENTORY_SUB_SERVICES_EDIT, FEATURE_PERMISSIONS.EDIT), [
  body('code').optional().isString(),
  body('name').optional().isString(),
  body('namePersian').optional().isString(),
  body('description').optional().isString(),
  body('pricePerMeter').optional().isNumeric().withMessage('قیمت پایه ابزار باید عدد باشد.'),
  body('calculationBase').optional().isIn(['length', 'squareMeters']).withMessage('واحد محاسبه ابزار باید متر طول یا متر مربع باشد.'),
  body('images').optional().isArray(),
  body('isActive').optional().isBoolean()
], async (req: any, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'اطلاعات ابزار معتبر نیست؛ فیلدهای مشخص‌شده را اصلاح کنید.',
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
        error: 'ابزار یافت نشد.'
      });
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'minimumQuantity')) {
      const minimumQuantity = await authorizeOperationMinimumChange(req.user, req.body.minimumQuantity, existingSubService.minimumQuantity);
      if (minimumQuantity ? !minimumQuantity.eq(existingSubService.minimumQuantity ?? 0) : Boolean(existingSubService.minimumQuantity && !existingSubService.minimumQuantity.isZero())) updateData.minimumQuantity = minimumQuantity;
      else delete updateData.minimumQuantity;
    }

    // Check if new code already exists (if code is being updated)
    if (updateData.code && updateData.code !== existingSubService.code) {
      const codeExists = await prisma.subService.findUnique({
        where: { code: updateData.code }
      });

      if (codeExists) {
        return res.status(400).json({
          success: false,
          error: 'ابزاری با این کد وجود دارد؛ کد دیگری وارد کنید.'
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
  } catch (error: any) {
    console.error('Error updating sub-service:', error);
    if (error.status || error.message?.startsWith('حداقل مقدار')) return res.status(error.status || 400).json({ success: false, error: error.message, details: [{ path: 'minimumQuantity', msg: error.message }] });
    return res.status(500).json({
      success: false,
      error: 'عملیات ابزار انجام نشد؛ دوباره تلاش کنید.'
    });
  }
});

// @desc    Delete sub-service
// @route   DELETE /api/sub-services/:id
// @access  Private/Inventory Workspace
router.delete('/:id', protect, requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.EDIT), requireFeatureAccess(FEATURES.INVENTORY_SUB_SERVICES_DELETE, FEATURE_PERMISSIONS.EDIT), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Check if sub-service exists
    const existingSubService = await prisma.subService.findUnique({
      where: { id }
    });

    if (!existingSubService) {
      return res.status(404).json({
        success: false,
        error: 'ابزار یافت نشد.'
      });
    }

    await prisma.subService.delete({
      where: { id }
    });

    res.json({
      success: true,
      message: 'ابزار حذف شد.'
    });
  } catch (error: any) {
    console.error('Error deleting sub-service:', error);
    return res.status(500).json({
      success: false,
      error: 'عملیات ابزار انجام نشد؛ دوباره تلاش کنید.'
    });
  }
});

// @desc    Toggle sub-service status
// @route   PATCH /api/sub-services/:id/toggle
// @access  Private/Inventory Workspace
router.patch('/:id/toggle', protect, requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.EDIT), requireFeatureAccess(FEATURES.INVENTORY_SUB_SERVICES_TOGGLE, FEATURE_PERMISSIONS.EDIT), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const subService = await prisma.subService.findUnique({
      where: { id }
    });

    if (!subService) {
      return res.status(404).json({
        success: false,
        error: 'ابزار یافت نشد.'
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
  } catch (error: any) {
    console.error('Error toggling sub-service status:', error);
    return res.status(500).json({
      success: false,
      error: 'عملیات ابزار انجام نشد؛ دوباره تلاش کنید.'
    });
  }
});

export default router;

