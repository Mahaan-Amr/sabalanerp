import express, { Request, Response } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { Prisma, PrismaClient } from '@prisma/client';
import { protect } from '../middleware/auth';
import { requireWorkspaceAccess, WORKSPACES, WORKSPACE_PERMISSIONS } from '../middleware/workspace';
import { requireFeatureAccess, requireAnyFeatureAccess, FEATURE_PERMISSIONS, FEATURES } from '../middleware/feature';

const router = express.Router();
const prisma = new PrismaClient();

const handleValidationErrors = (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors.array()
    });
  }
  return undefined;
};

const decimalFromInput = (value: any): Prisma.Decimal => {
  if (value instanceof Prisma.Decimal) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    return new Prisma.Decimal(value);
  }
  throw new Error('Invalid decimal input');
};

router.get(
  '/',
  protect,
  requireAnyFeatureAccess(
    [
      FEATURES.INVENTORY_STONE_FINISHINGS_VIEW,
      FEATURES.SALES_CONTRACTS_VIEW,
      FEATURES.SALES_CONTRACTS_CREATE
    ],
    FEATURE_PERMISSIONS.VIEW
  ),
  [
    query('search').optional().isString(),
    query('isActive').optional().isIn(['true', 'false']),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 1000 })
  ],
  async (req: any, res: Response) => {
    const validationError = handleValidationErrors(req, res);
    if (validationError) return validationError;

    try {
      const page = parseInt(req.query.page as string, 10) || 1;
      const limit = parseInt(req.query.limit as string, 10) || 50;
      const skip = (page - 1) * limit;
      const search = req.query.search as string | undefined;
      const isActive =
        typeof req.query.isActive === 'string'
          ? req.query.isActive === 'true'
          : undefined;

      const where: Prisma.StoneFinishingWhereInput = {};

      if (search) {
        where.OR = [
          { namePersian: { contains: search, mode: 'insensitive' } },
          { name: { contains: search, mode: 'insensitive' } }
        ];
      }

      if (typeof isActive === 'boolean') {
        where.isActive = isActive;
      }

      const [items, total] = await Promise.all([
        prisma.stoneFinishing.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' }
        }),
        prisma.stoneFinishing.count({ where })
      ]);

      return res.json({
        success: true,
        data: items,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      console.error('Error fetching stone finishings:', error);
      return res.status(500).json({
        success: false,
        error: '?? ? ??? ???'
      });
    }
  }
);

router.get(
  '/:id',
  protect,
  requireAnyFeatureAccess(
    [
      FEATURES.INVENTORY_STONE_FINISHINGS_VIEW,
      FEATURES.SALES_CONTRACTS_VIEW,
      FEATURES.SALES_CONTRACTS_CREATE
    ],
    FEATURE_PERMISSIONS.VIEW
  ),
  [param('id').isString().notEmpty()],
  async (req: Request, res: Response) => {
    const validationError = handleValidationErrors(req, res);
    if (validationError) return validationError;

    try {
      const finishing = await prisma.stoneFinishing.findUnique({
        where: { id: req.params.id }
      });

      if (!finishing) {
        return res.status(404).json({
          success: false,
          error: '??? ?? ?? ?? ??'
        });
      }

      return res.json({
        success: true,
        data: finishing
      });
    } catch (error) {
      console.error('Error fetching stone finishing:', error);
      return res.status(500).json({
        success: false,
        error: '?? ? ??? ???'
      });
    }
  }
);

router.post(
  '/',
  protect,
  requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.EDIT),
  requireFeatureAccess(FEATURES.INVENTORY_STONE_FINISHINGS_CREATE, FEATURE_PERMISSIONS.EDIT),
  [
    body('namePersian').isString().notEmpty().withMessage('?? ??? ??? ??'),
    body('name').optional().isString(),
    body('description').optional().isString(),
    body('pricePerSquareMeter')
      .isFloat({ gt: 0 })
      .withMessage('?? ?? ??? ? ?? ??')
  ],
  async (req: Request, res: Response) => {
    const validationError = handleValidationErrors(req, res);
    if (validationError) return validationError;

    try {
      const finishing = await prisma.stoneFinishing.create({
        data: {
          name: req.body.name || null,
          namePersian: req.body.namePersian,
          description: req.body.description || null,
          pricePerSquareMeter: decimalFromInput(req.body.pricePerSquareMeter),
          isActive: true
        }
      });

      return res.status(201).json({
        success: true,
        data: finishing
      });
    } catch (error) {
      console.error('Error creating stone finishing:', error);
      return res.status(500).json({
        success: false,
        error: '?? ? ??? ???'
      });
    }
  }
);

router.put(
  '/:id',
  protect,
  requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.EDIT),
  requireFeatureAccess(FEATURES.INVENTORY_STONE_FINISHINGS_EDIT, FEATURE_PERMISSIONS.EDIT),
  [
    param('id').isString().notEmpty(),
    body('namePersian').isString().notEmpty().withMessage('?? ??? ??? ??'),
    body('name').optional().isString(),
    body('description').optional().isString(),
    body('pricePerSquareMeter')
      .isFloat({ gt: 0 })
      .withMessage('?? ?? ??? ? ?? ??'),
    body('isActive').optional().isBoolean()
  ],
  async (req: Request, res: Response) => {
    const validationError = handleValidationErrors(req, res);
    if (validationError) return validationError;

    try {
      const existing = await prisma.stoneFinishing.findUnique({
        where: { id: req.params.id }
      });

      if (!existing) {
        return res.status(404).json({
          success: false,
          error: '??? ?? ??'
        });
      }

      const updated = await prisma.stoneFinishing.update({
        where: { id: req.params.id },
        data: {
          name: req.body.name || null,
          namePersian: req.body.namePersian,
          description: req.body.description || null,
          pricePerSquareMeter: decimalFromInput(req.body.pricePerSquareMeter),
          isActive:
            typeof req.body.isActive === 'boolean'
              ? req.body.isActive
              : existing.isActive
        }
      });

      return res.json({
        success: true,
        data: updated
      });
    } catch (error) {
      console.error('Error updating stone finishing:', error);
      return res.status(500).json({
        success: false,
        error: '?? ? ??? ???'
      });
    }
  }
);

router.delete(
  '/:id',
  protect,
  requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.EDIT),
  requireFeatureAccess(FEATURES.INVENTORY_STONE_FINISHINGS_DELETE, FEATURE_PERMISSIONS.EDIT),
  [param('id').isString().notEmpty()],
  async (req: Request, res: Response) => {
    const validationError = handleValidationErrors(req, res);
    if (validationError) return validationError;

    try {
      const existing = await prisma.stoneFinishing.findUnique({
        where: { id: req.params.id }
      });

      if (!existing) {
        return res.status(404).json({
          success: false,
          error: '??? ?? ??'
        });
      }

      await prisma.stoneFinishing.delete({
        where: { id: req.params.id }
      });

      return res.json({
        success: true,
        message: '??? ?? ?'
      });
    } catch (error) {
      console.error('Error deleting stone finishing:', error);
      return res.status(500).json({
        success: false,
        error: '?? ? ?? ???'
      });
    }
  }
);

router.patch(
  '/:id/toggle',
  protect,
  requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.EDIT),
  requireFeatureAccess(FEATURES.INVENTORY_STONE_FINISHINGS_TOGGLE, FEATURE_PERMISSIONS.EDIT),
  [param('id').isString().notEmpty()],
  async (req: Request, res: Response) => {
    const validationError = handleValidationErrors(req, res);
    if (validationError) return validationError;

    try {
      const existing = await prisma.stoneFinishing.findUnique({
        where: { id: req.params.id }
      });

      if (!existing) {
        return res.status(404).json({
          success: false,
          error: '??? ?? ??'
        });
      }

      const updated = await prisma.stoneFinishing.update({
        where: { id: req.params.id },
        data: { isActive: !existing.isActive }
      });

      return res.json({
        success: true,
        data: updated
      });
    } catch (error) {
      console.error('Error toggling stone finishing status:', error);
      return res.status(500).json({
        success: false,
        error: '?? ? ??? ??? ???'
      });
    }
  }
);

export default router;

