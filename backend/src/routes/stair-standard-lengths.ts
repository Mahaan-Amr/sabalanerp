import express, { Request, Response } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { PrismaClient, Prisma } from '@prisma/client';
import { protect } from '../middleware/auth';
import { requireWorkspaceAccess, WORKSPACES, WORKSPACE_PERMISSIONS } from '../middleware/workspace';

const router = express.Router();
const prisma = new PrismaClient();

const decimalFromInput = (value: number | string) => {
  const parsed = typeof value === 'number' ? value : parseFloat(value);
  if (!isFinite(parsed)) {
    throw new Error('Invalid numeric value');
  }
  return new Prisma.Decimal(parsed);
};

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

router.get(
  '/',
  protect,
  requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.VIEW),
  [
    query('isActive').optional().isBoolean().withMessage('isActive must be a boolean'),
    query('search').optional().isString().withMessage('search must be a string')
  ],
  async (req: Request, res: Response): Promise<Response | void> => {
    try {
      const validationError = handleValidationErrors(req, res);
      if (validationError) return validationError;

      const { isActive, search } = req.query;
      const whereClause: Prisma.StairStandardLengthWhereInput = {};

      if (isActive !== undefined) {
        whereClause.isActive = isActive === 'true';
      }

      if (search) {
        whereClause.OR = [
          { label: { contains: search as string, mode: 'insensitive' } },
          { description: { contains: search as string, mode: 'insensitive' } }
        ];
      }

      const data = await prisma.stairStandardLength.findMany({
        where: whereClause,
        orderBy: [{ value: 'asc' }, { unit: 'asc' }]
      });

      res.json({
        success: true,
        data
      });
    } catch (error) {
      console.error('Error fetching stair standard lengths:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }
);

router.get(
  '/:id',
  protect,
  requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.VIEW),
  async (req: Request, res: Response): Promise<Response | void> => {
    try {
      const { id } = req.params;
      const record = await prisma.stairStandardLength.findUnique({
        where: { id }
      });

      if (!record) {
        return res.status(404).json({
          success: false,
          error: 'Stair standard length not found'
        });
      }

      res.json({ success: true, data: record });
    } catch (error) {
      console.error('Error fetching stair standard length:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }
);

router.post(
  '/',
  protect,
  requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.EDIT),
  [
    body('value').notEmpty().isFloat({ gt: 0 }).withMessage('Value must be greater than 0'),
    body('unit').optional().isIn(['m', 'cm']).withMessage('Unit must be m or cm'),
    body('label').optional().isString().trim(),
    body('description').optional().isString().trim(),
    body('isActive').optional().isBoolean()
  ],
  async (req: Request, res: Response): Promise<Response | void> => {
    try {
      const validationError = handleValidationErrors(req, res);
      if (validationError) return validationError;

      const {
        value,
        unit = 'm',
        label,
        description,
        isActive = true
      }: { value: number; unit?: 'm' | 'cm'; label?: string; description?: string; isActive?: boolean } = req.body as any;

      const decimalValue = decimalFromInput(value);

      const existing = await prisma.stairStandardLength.findFirst({
        where: {
          value: decimalValue,
          unit
        }
      });

      if (existing) {
        return res.status(400).json({
          success: false,
          error: 'A standard length with the same value and unit already exists'
        });
      }

      const record = await prisma.stairStandardLength.create({
        data: {
          value: decimalValue,
          unit,
          label,
          description,
          isActive
        }
      });

      res.status(201).json({ success: true, data: record });
    } catch (error) {
      console.error('Error creating stair standard length:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }
);

router.put(
  '/:id',
  protect,
  requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.EDIT),
  [
    param('id').notEmpty().withMessage('ID is required'),
    body('value').optional().isFloat({ gt: 0 }).withMessage('Value must be greater than 0'),
    body('unit').optional().isIn(['m', 'cm']).withMessage('Unit must be m or cm'),
    body('label').optional().isString().trim(),
    body('description').optional().isString().trim(),
    body('isActive').optional().isBoolean()
  ],
  async (req: Request, res: Response): Promise<Response | void> => {
    try {
      const validationError = handleValidationErrors(req, res);
      if (validationError) return validationError;
      const { id } = req.params;

      const existing = await prisma.stairStandardLength.findUnique({ where: { id } });
      if (!existing) {
        return res.status(404).json({
          success: false,
          error: 'Stair standard length not found'
        });
      }

      const { value, unit } = req.body;
      const valueDecimal = value !== undefined ? decimalFromInput(value) : undefined;
      const unitValue: 'm' | 'cm' | undefined = unit;

      const data: Prisma.StairStandardLengthUpdateInput = {
        label: req.body.label,
        description: req.body.description,
        isActive: typeof req.body.isActive === 'boolean' ? req.body.isActive : undefined
      };

      if (valueDecimal !== undefined) {
        data.value = valueDecimal;
      }

      if (unitValue) {
        data.unit = unitValue;
      }

      if (valueDecimal !== undefined || unitValue) {
        const newValue = valueDecimal !== undefined ? valueDecimal : existing.value;
        const newUnit = unitValue ?? existing.unit;
        const duplicate = await prisma.stairStandardLength.findFirst({
          where: {
            value: newValue,
            unit: newUnit,
            NOT: { id }
          }
        });
        if (duplicate) {
          return res.status(400).json({
            success: false,
            error: 'Another standard length with the same value and unit already exists'
          });
        }
      }

      const record = await prisma.stairStandardLength.update({
        where: { id },
        data
      });

      res.json({ success: true, data: record });
    } catch (error) {
      console.error('Error updating stair standard length:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }
);

router.delete(
  '/:id',
  protect,
  requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.EDIT),
  async (req: Request, res: Response): Promise<Response | void> => {
    try {
      const { id } = req.params;
      const existing = await prisma.stairStandardLength.findUnique({ where: { id } });

      if (!existing) {
        return res.status(404).json({
          success: false,
          error: 'Stair standard length not found'
        });
      }

      await prisma.stairStandardLength.delete({ where: { id } });
      res.json({
        success: true,
        message: 'Stair standard length deleted successfully'
      });
    } catch (error) {
      console.error('Error deleting stair standard length:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }
);

router.patch(
  '/:id/toggle',
  protect,
  requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.EDIT),
  async (req: Request, res: Response): Promise<Response | void> => {
    try {
      const { id } = req.params;
      const existing = await prisma.stairStandardLength.findUnique({ where: { id } });
      if (!existing) {
        return res.status(404).json({
          success: false,
          error: 'Stair standard length not found'
        });
      }

      const updated = await prisma.stairStandardLength.update({
        where: { id },
        data: { isActive: !existing.isActive }
      });

      res.json({ success: true, data: updated });
    } catch (error) {
      console.error('Error toggling stair standard length:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }
);

export default router;

