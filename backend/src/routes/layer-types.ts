import express, { Request, Response } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { Prisma, PrismaClient } from '@prisma/client';
import { protect } from '../middleware/auth';
import { requireWorkspaceAccess, WORKSPACES, WORKSPACE_PERMISSIONS } from '../middleware/workspace';
import { requireFeatureAccess, FEATURE_PERMISSIONS, FEATURES } from '../middleware/feature';

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
  requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.VIEW),
  requireFeatureAccess(FEATURES.INVENTORY_LAYER_TYPES_VIEW, FEATURE_PERMISSIONS.VIEW),
  async (req: Request, res: Response): Promise<Response | void> => {
    try {
      const { isActive } = req.query;
      const where: Prisma.LayerTypeWhereInput = {};

      const rawIsActive = Array.isArray(isActive) ? isActive[0] : isActive;
      if (typeof rawIsActive !== 'undefined') {
        if (typeof rawIsActive === 'string') {
          where.isActive = rawIsActive === 'true';
        } else {
          where.isActive = Boolean(rawIsActive);
        }
      }

      const layerTypes = await prisma.layerType.findMany({
        where,
        orderBy: { createdAt: 'desc' }
      });

      return res.json({
        success: true,
        data: layerTypes
      });
    } catch (error) {
      console.error('Error fetching layer types:', error);
      return res.status(500).json({
        success: false,
        error: '?? ? ??? ?? ??'
      });
    }
  }
);

router.get(
  '/:id',
  protect,
  requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.VIEW),
  requireFeatureAccess(FEATURES.INVENTORY_LAYER_TYPES_VIEW, FEATURE_PERMISSIONS.VIEW),
  [param('id').isString().notEmpty().withMessage('??? ?? ??')],
  async (req: Request, res: Response): Promise<Response | void> => {
    const validationError = handleValidationErrors(req, res);
    if (validationError) return validationError;

    try {
      const layerType = await prisma.layerType.findUnique({
        where: { id: req.params.id }
      });

      if (!layerType) {
        return res.status(404).json({
          success: false,
          error: '?? ?? ?? ??'
        });
      }

      return res.json({
        success: true,
        data: layerType
      });
    } catch (error) {
      console.error('Error fetching layer type:', error);
      return res.status(500).json({
        success: false,
        error: '?? ? ??? ?? ??'
      });
    }
  }
);

router.post(
  '/',
  protect,
  requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.EDIT),
  requireFeatureAccess(FEATURES.INVENTORY_LAYER_TYPES_CREATE, FEATURE_PERMISSIONS.EDIT),
  [
    body('name').isString().notEmpty().withMessage('?? ?? ?? ??? ??'),
    body('pricePerLayer')
      .isFloat({ gt: 0 })
      .withMessage('?? ?? ?? ??? ? ?? ??'),
    body('description').optional().isString()
  ],
  async (req: Request, res: Response): Promise<Response | void> => {
    const validationError = handleValidationErrors(req, res);
    if (validationError) return validationError;

    try {
      const layerType = await prisma.layerType.create({
        data: {
          name: req.body.name,
          description: req.body.description || null,
          pricePerLayer: decimalFromInput(req.body.pricePerLayer),
          isActive: true
        }
      });

      return res.status(201).json({
        success: true,
        data: layerType
      });
    } catch (error) {
      console.error('Error creating layer type:', error);
      return res.status(500).json({
        success: false,
        error: '?? ? ??? ?? ??'
      });
    }
  }
);

router.put(
  '/:id',
  protect,
  requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.EDIT),
  requireFeatureAccess(FEATURES.INVENTORY_LAYER_TYPES_EDIT, FEATURE_PERMISSIONS.EDIT),
  [
    param('id').isString().notEmpty().withMessage('??? ?? ??'),
    body('name').isString().notEmpty().withMessage('?? ?? ?? ??? ??'),
    body('pricePerLayer')
      .isFloat({ gt: 0 })
      .withMessage('?? ?? ?? ??? ? ?? ??'),
    body('description').optional().isString()
  ],
  async (req: Request, res: Response): Promise<Response | void> => {
    const validationError = handleValidationErrors(req, res);
    if (validationError) return validationError;

    try {
      const existing = await prisma.layerType.findUnique({
        where: { id: req.params.id }
      });

      if (!existing) {
        return res.status(404).json({
          success: false,
          error: '?? ?? ?? ??'
        });
      }

      const updated = await prisma.layerType.update({
        where: { id: req.params.id },
        data: {
          name: req.body.name,
          description: req.body.description || null,
          pricePerLayer: decimalFromInput(req.body.pricePerLayer)
        }
      });

      return res.json({
        success: true,
        data: updated
      });
    } catch (error) {
      console.error('Error updating layer type:', error);
      return res.status(500).json({
        success: false,
        error: '?? ? ??? ?? ??'
      });
    }
  }
);

router.delete(
  '/:id',
  protect,
  requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.EDIT),
  requireFeatureAccess(FEATURES.INVENTORY_LAYER_TYPES_DELETE, FEATURE_PERMISSIONS.EDIT),
  [param('id').isString().notEmpty().withMessage('??? ?? ??')],
  async (req: Request, res: Response): Promise<Response | void> => {
    const validationError = handleValidationErrors(req, res);
    if (validationError) return validationError;

    try {
      await prisma.layerType.delete({
        where: { id: req.params.id }
      });

      return res.json({
        success: true,
        message: '?? ?? ? ??? ?? ?'
      });
    } catch (error) {
      console.error('Error deleting layer type:', error);
      return res.status(500).json({
        success: false,
        error: '?? ? ?? ?? ??'
      });
    }
  }
);

router.patch(
  '/:id/toggle',
  protect,
  requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.EDIT),
  requireFeatureAccess(FEATURES.INVENTORY_LAYER_TYPES_TOGGLE, FEATURE_PERMISSIONS.EDIT),
  [param('id').isString().notEmpty().withMessage('??? ?? ??')],
  async (req: Request, res: Response): Promise<Response | void> => {
    const validationError = handleValidationErrors(req, res);
    if (validationError) return validationError;

    try {
      const existing = await prisma.layerType.findUnique({
        where: { id: req.params.id }
      });

      if (!existing) {
        return res.status(404).json({
          success: false,
          error: '?? ?? ?? ??'
        });
      }

      const updated = await prisma.layerType.update({
        where: { id: req.params.id },
        data: { isActive: !existing.isActive }
      });

      return res.json({
        success: true,
        data: updated
      });
    } catch (error) {
      console.error('Error toggling layer type status:', error);
      return res.status(500).json({
        success: false,
        error: '?? ? ??? ??? ?? ??'
      });
    }
  }
);

export default router;


