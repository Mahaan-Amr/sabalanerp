import express, { Response } from 'express';
import { body, validationResult } from 'express-validator';
import { PrismaClient } from '@prisma/client';
import { protect, authorize } from '../middleware/auth';
import { requireFeatureAccess, FEATURE_PERMISSIONS, FEATURES, FEATURE_LABELS, FEATURE_WORKSPACE_MAP } from '../middleware/feature';

const router = express.Router();
const prisma = new PrismaClient();

const isManager = (req: any) => req.user?.role === 'MANAGER';

const getFeatureWorkspace = (feature: string): string | null => {
  if (!Object.values(FEATURES).includes(feature as any)) {
    return null;
  }
  return FEATURE_WORKSPACE_MAP[feature as keyof typeof FEATURE_WORKSPACE_MAP] || null;
};

const validateFeatureWorkspacePair = (feature: string, workspace: string): string | null => {
  const mappedWorkspace = getFeatureWorkspace(feature);
  if (!mappedWorkspace) {
    return 'Invalid feature';
  }
  if (mappedWorkspace !== workspace) {
    return `Workspace "${workspace}" is not valid for feature "${feature}"`;
  }
  return null;
};

// ==================== FEATURE PERMISSIONS ====================

// @desc    Get feature definitions (source of truth for UI)
// @route   GET /api/permissions/features/definitions
// @access  Private/Admin
router.get('/features/definitions', protect, authorize('ADMIN', 'MANAGER'), async (req: any, res: Response) => {
  try {
    const data = Object.values(FEATURES).map((feature) => ({
      key: feature,
      label: FEATURE_LABELS[feature] || feature,
      workspace: FEATURE_WORKSPACE_MAP[feature]
    }));

    data.sort((a, b) => {
      const workspaceCompare = a.workspace.localeCompare(b.workspace);
      if (workspaceCompare !== 0) return workspaceCompare;
      return a.label.localeCompare(b.label);
    });

    res.json({
      success: true,
      data
    });
  } catch (error) {
    console.error('Get feature definitions error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    Get all feature permissions
// @route   GET /api/permissions/features
// @access  Private/Admin
router.get('/features', protect, authorize('ADMIN', 'MANAGER'), async (req: any, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const skip = (page - 1) * limit;
    const userId = req.query.userId as string;
    const workspace = req.query.workspace as string;
    const feature = req.query.feature as string;

    let whereClause: any = {};

    if (isManager(req) && userId) {
      const targetUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { role: true }
      });
      if (targetUser?.role === 'ADMIN') {
        return res.status(403).json({
          success: false,
          error: 'Managers cannot access admin permissions'
        });
      }
    }

    if (userId) whereClause.userId = userId;
    if (workspace) whereClause.workspace = workspace;
    if (feature) whereClause.feature = feature;

    if (isManager(req)) {
      whereClause.user = { role: { not: 'ADMIN' } };
    }

    const permissions = await prisma.featurePermission.findMany({
      where: whereClause,
      skip,
      take: limit,
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: true
          }
        },
        granter: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    const total = await prisma.featurePermission.count({ where: whereClause });

    res.json({
      success: true,
      data: permissions,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get feature permissions error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    Get feature permissions for a specific user
// @route   GET /api/permissions/features/user/:userId
// @access  Private/Admin
router.get('/features/user/:userId', protect, authorize('ADMIN', 'MANAGER'), async (req: any, res: Response) => {
  try {
    const { userId } = req.params;

    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true }
    });

    if (!targetUser) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    if (req.user.role === 'MANAGER' && targetUser.role === 'ADMIN') {
      return res.status(403).json({
        success: false,
        error: 'Managers cannot access admin permissions'
      });
    }

    const permissions = await prisma.featurePermission.findMany({
      where: { userId },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: true
          }
        },
        granter: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    res.json({
      success: true,
      data: permissions
    });
  } catch (error) {
    console.error('Get user feature permissions error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    Create new feature permission
// @route   POST /api/permissions/features
// @access  Private/Admin
router.post('/features', protect, authorize('ADMIN', 'MANAGER'), [
  body('userId').notEmpty().withMessage('User ID is required'),
  body('workspace').notEmpty().withMessage('Workspace is required'),
  body('feature').notEmpty().withMessage('Feature is required'),
  body('permissionLevel').isIn(['view', 'edit', 'admin']).withMessage('Invalid permission level'),
  body('expiresAt').optional().isISO8601().withMessage('Invalid expiration date')
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

    const { userId, workspace, feature, permissionLevel, expiresAt } = req.body;

    const featureWorkspaceError = validateFeatureWorkspacePair(feature, workspace);
    if (featureWorkspaceError) {
      return res.status(400).json({
        success: false,
        error: featureWorkspaceError
      });
    }

    // Check if permission already exists
    const existingPermission = await prisma.featurePermission.findUnique({
      where: {
        userId_workspace_feature: {
          userId,
          workspace,
          feature
        }
      }
    });

    if (existingPermission) {
      return res.status(400).json({
        success: false,
        error: 'Feature permission already exists for this user'
      });
    }

    // Verify user exists
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    if (req.user.role === 'MANAGER' && user.role === 'ADMIN') {
      return res.status(403).json({
        success: false,
        error: 'Managers cannot grant permissions to admin users'
      });
    }

    const permission = await prisma.featurePermission.create({
      data: {
        userId,
        workspace,
        feature,
        permissionLevel,
        grantedBy: req.user.id,
        expiresAt: expiresAt ? new Date(expiresAt) : null
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: true
          }
        },
        granter: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        }
      }
    });

    console.info('[permissions] feature permission created', {
      actorId: req.user.id,
      targetUserId: userId,
      workspace,
      feature,
      permissionLevel
    });

    res.status(201).json({
      success: true,
      data: permission
    });
  } catch (error) {
    console.error('Create feature permission error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    Update feature permission
// @route   PUT /api/permissions/features/:id
// @access  Private/Admin
router.put('/features/:id', protect, authorize('ADMIN', 'MANAGER'), [
  body('workspace').optional().notEmpty().withMessage('Workspace cannot be empty'),
  body('feature').optional().notEmpty().withMessage('Feature cannot be empty'),
  body('permissionLevel').optional().isIn(['view', 'edit', 'admin']).withMessage('Invalid permission level'),
  body('expiresAt').optional().isISO8601().withMessage('Invalid expiration date'),
  body('isActive').optional().isBoolean().withMessage('Invalid active status')
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
    const { permissionLevel, expiresAt, isActive, workspace, feature } = req.body;

    const permission = await prisma.featurePermission.findUnique({
      where: { id }
    });

    if (!permission) {
      return res.status(404).json({
        success: false,
        error: 'Feature permission not found'
      });
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: permission.userId }
    });

    if (req.user.role === 'MANAGER' && targetUser?.role === 'ADMIN') {
      return res.status(403).json({
        success: false,
        error: 'Managers cannot modify admin permissions'
      });
    }

    const nextFeature = feature ?? permission.feature;
    const nextWorkspace = workspace ?? permission.workspace;
    const featureWorkspaceError = validateFeatureWorkspacePair(nextFeature, nextWorkspace);
    if (featureWorkspaceError) {
      return res.status(400).json({
        success: false,
        error: featureWorkspaceError
      });
    }

    const updatedPermission = await prisma.featurePermission.update({
      where: { id },
      data: {
        ...(feature && { feature }),
        ...(workspace && { workspace }),
        ...(permissionLevel && { permissionLevel }),
        ...(expiresAt !== undefined && { expiresAt: expiresAt ? new Date(expiresAt) : null }),
        ...(isActive !== undefined && { isActive }),
        grantedBy: req.user.id,
        grantedAt: new Date()
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: true
          }
        },
        granter: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        }
      }
    });

    console.info('[permissions] feature permission updated', {
      actorId: req.user.id,
      permissionId: id,
      targetUserId: permission.userId,
      workspace: nextWorkspace,
      feature: nextFeature,
      permissionLevel: permissionLevel ?? permission.permissionLevel
    });

    res.json({
      success: true,
      data: updatedPermission
    });
  } catch (error) {
    console.error('Update feature permission error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    Delete feature permission
// @route   DELETE /api/permissions/features/:id
// @access  Private/Admin
router.delete('/features/:id', protect, authorize('ADMIN', 'MANAGER'), async (req: any, res: Response) => {
  try {
    const { id } = req.params;

    const permission = await prisma.featurePermission.findUnique({
      where: { id }
    });

    if (!permission) {
      return res.status(404).json({
        success: false,
        error: 'Feature permission not found'
      });
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: permission.userId }
    });

    if (req.user.role === 'MANAGER' && targetUser?.role === 'ADMIN') {
      return res.status(403).json({
        success: false,
        error: 'Managers cannot delete admin permissions'
      });
    }

    await prisma.featurePermission.delete({
      where: { id }
    });

    console.info('[permissions] feature permission deleted', {
      actorId: req.user.id,
      permissionId: id,
      targetUserId: permission.userId,
      workspace: permission.workspace,
      feature: permission.feature
    });

    res.json({
      success: true,
      message: 'Feature permission deleted successfully'
    });
  } catch (error) {
    console.error('Delete feature permission error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// ==================== ROLE FEATURE PERMISSIONS ====================

// @desc    Get all role feature permissions
// @route   GET /api/permissions/role-features
// @access  Private/Admin
router.get('/role-features', protect, authorize('ADMIN', 'MANAGER'), async (req: any, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const skip = (page - 1) * limit;
    const role = req.query.role as string;
    const workspace = req.query.workspace as string;
    const feature = req.query.feature as string;

    let whereClause: any = {};

    if (role) whereClause.role = role;
    if (workspace) whereClause.workspace = workspace;
    if (feature) whereClause.feature = feature;

    if (isManager(req)) {
      if (role === 'ADMIN') {
        return res.status(403).json({
          success: false,
          error: 'Managers cannot access admin role permissions'
        });
      }
      whereClause.role = { not: 'ADMIN' };
      if (role && role !== 'ADMIN') {
        whereClause.role = role;
      }
    }

    const permissions = await prisma.roleFeaturePermission.findMany({
      where: whereClause,
      skip,
      take: limit,
      orderBy: {
        createdAt: 'desc'
      }
    });

    const total = await prisma.roleFeaturePermission.count({ where: whereClause });

    res.json({
      success: true,
      data: permissions,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get role feature permissions error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    Create new role feature permission
// @route   POST /api/permissions/role-features
// @access  Private/Admin
router.post('/role-features', protect, authorize('ADMIN', 'MANAGER'), [
  body('role').notEmpty().withMessage('Role is required'),
  body('workspace').notEmpty().withMessage('Workspace is required'),
  body('feature').notEmpty().withMessage('Feature is required'),
  body('permissionLevel').isIn(['view', 'edit', 'admin']).withMessage('Invalid permission level')
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

    const { role, workspace, feature, permissionLevel } = req.body;

    if (req.user.role === 'MANAGER' && role === 'ADMIN') {
      return res.status(403).json({
        success: false,
        error: 'Managers cannot modify admin role permissions'
      });
    }

    const featureWorkspaceError = validateFeatureWorkspacePair(feature, workspace);
    if (featureWorkspaceError) {
      return res.status(400).json({
        success: false,
        error: featureWorkspaceError
      });
    }

    // Check if permission already exists
    const existingPermission = await prisma.roleFeaturePermission.findUnique({
      where: {
        role_workspace_feature: {
          role,
          workspace,
          feature
        }
      }
    });

    if (existingPermission) {
      return res.status(400).json({
        success: false,
        error: 'Role feature permission already exists'
      });
    }

    const permission = await prisma.roleFeaturePermission.create({
      data: {
        role,
        workspace,
        feature,
        permissionLevel
      }
    });

    console.info('[permissions] role feature permission created', {
      actorId: req.user.id,
      role,
      workspace,
      feature,
      permissionLevel
    });

    res.status(201).json({
      success: true,
      data: permission
    });
  } catch (error) {
    console.error('Create role feature permission error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    Update role feature permission
// @route   PUT /api/permissions/role-features/:id
// @access  Private/Admin
router.put('/role-features/:id', protect, authorize('ADMIN', 'MANAGER'), [
  body('workspace').optional().notEmpty().withMessage('Workspace cannot be empty'),
  body('feature').optional().notEmpty().withMessage('Feature cannot be empty'),
  body('permissionLevel').optional().isIn(['view', 'edit', 'admin']).withMessage('Invalid permission level'),
  body('isActive').optional().isBoolean().withMessage('Invalid active status')
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
    const { permissionLevel, isActive, workspace, feature } = req.body;

    const permission = await prisma.roleFeaturePermission.findUnique({
      where: { id }
    });

    if (!permission) {
      return res.status(404).json({
        success: false,
        error: 'Role feature permission not found'
      });
    }

    if (req.user.role === 'MANAGER' && permission.role === 'ADMIN') {
      return res.status(403).json({
        success: false,
        error: 'Managers cannot modify admin role permissions'
      });
    }

    const nextFeature = feature ?? permission.feature;
    const nextWorkspace = workspace ?? permission.workspace;
    const featureWorkspaceError = validateFeatureWorkspacePair(nextFeature, nextWorkspace);
    if (featureWorkspaceError) {
      return res.status(400).json({
        success: false,
        error: featureWorkspaceError
      });
    }

    const updatedPermission = await prisma.roleFeaturePermission.update({
      where: { id },
      data: {
        ...(feature && { feature }),
        ...(workspace && { workspace }),
        ...(permissionLevel && { permissionLevel }),
        ...(isActive !== undefined && { isActive })
      }
    });

    console.info('[permissions] role feature permission updated', {
      actorId: req.user.id,
      permissionId: id,
      role: permission.role,
      workspace: nextWorkspace,
      feature: nextFeature,
      permissionLevel: permissionLevel ?? permission.permissionLevel
    });

    res.json({
      success: true,
      data: updatedPermission
    });
  } catch (error) {
    console.error('Update role feature permission error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    Delete role feature permission
// @route   DELETE /api/permissions/role-features/:id
// @access  Private/Admin
router.delete('/role-features/:id', protect, authorize('ADMIN', 'MANAGER'), async (req: any, res: Response) => {
  try {
    const { id } = req.params;

    const permission = await prisma.roleFeaturePermission.findUnique({
      where: { id }
    });

    if (!permission) {
      return res.status(404).json({
        success: false,
        error: 'Role feature permission not found'
      });
    }

    if (req.user.role === 'MANAGER' && permission.role === 'ADMIN') {
      return res.status(403).json({
        success: false,
        error: 'Managers cannot modify admin role permissions'
      });
    }

    await prisma.roleFeaturePermission.delete({
      where: { id }
    });

    console.info('[permissions] role feature permission deleted', {
      actorId: req.user.id,
      permissionId: id,
      role: permission.role,
      workspace: permission.workspace,
      feature: permission.feature
    });

    res.json({
      success: true,
      message: 'Role feature permission deleted successfully'
    });
  } catch (error) {
    console.error('Delete role feature permission error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// ==================== USER FEATURES SUMMARY ====================

// @desc    Get user's accessible features summary
// @route   GET /api/permissions/user/:userId/features
// @access  Private/Admin
router.get('/user/:userId/features', protect, authorize('ADMIN', 'MANAGER'), async (req: any, res: Response) => {
  try {
    const { userId } = req.params;

    // Get user details
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        role: true
      }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    if (req.user.role === 'MANAGER' && user.role === 'ADMIN') {
      return res.status(403).json({
        success: false,
        error: 'Managers cannot access admin permissions'
      });
    }

    // Get user's feature permissions
    const userFeaturePermissions = await prisma.featurePermission.findMany({
      where: { userId, isActive: true },
      include: {
        granter: {
          select: {
            firstName: true,
            lastName: true,
            email: true
          }
        }
      }
    });

    // Get role-based feature permissions
    const roleFeaturePermissions = await prisma.roleFeaturePermission.findMany({
      where: { role: user.role, isActive: true }
    });

    // Get workspace permissions (fallback)
    const userWorkspacePermissions = await prisma.workspacePermission.findMany({
      where: { userId, isActive: true }
    });

    const roleWorkspacePermissions = await prisma.roleWorkspacePermission.findMany({
      where: { role: user.role, isActive: true }
    });

    res.json({
      success: true,
      data: {
        user,
        featurePermissions: userFeaturePermissions,
        roleFeaturePermissions,
        workspacePermissions: userWorkspacePermissions,
        roleWorkspacePermissions
      }
    });
  } catch (error) {
    console.error('Get user features summary error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

export default router;
