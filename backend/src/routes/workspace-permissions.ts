import express, { Response } from 'express';
import { body, validationResult } from 'express-validator';
import { PrismaClient } from '@prisma/client';
import { protect, authorize } from '../middleware/auth';
import { requireWorkspaceAccess, WORKSPACE_PERMISSIONS, WORKSPACES, getUserWorkspaces } from '../middleware/workspace';

const router = express.Router();
const prisma = new PrismaClient();

// ==================== WORKSPACE PERMISSIONS ====================

// @desc    Get user's accessible workspaces
// @route   GET /api/workspace-permissions/user-workspaces
// @access  Private
router.get('/user-workspaces', protect, async (req: any, res: Response) => {
  try {
    const workspaces = await getUserWorkspaces(req.user.id, req.user.role);

    res.json({
      success: true,
      data: workspaces
    });
  } catch (error) {
    console.error('Get user workspaces error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    Get all workspace permissions (Admin only)
// @route   GET /api/workspace-permissions
// @access  Private/Admin
router.get('/', protect, authorize('ADMIN'), async (req: any, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;
    const userId = req.query.userId as string;
    const workspace = req.query.workspace as string;

    // Build where clause
    let whereClause: any = {};
    
    if (userId) whereClause.userId = userId;
    if (workspace) whereClause.workspace = workspace;

    const permissions = await prisma.workspacePermission.findMany({
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
            username: true,
            role: true
          }
        },
        granter: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            username: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    const total = await prisma.workspacePermission.count({ where: whereClause });

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
    console.error('Get workspace permissions error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    Grant workspace permission to user
// @route   POST /api/workspace-permissions
// @access  Private/Admin
router.post('/', protect, authorize('ADMIN'), [
  body('userId').notEmpty().withMessage('User ID is required'),
  body('workspace').isIn(Object.values(WORKSPACES)).withMessage('Invalid workspace'),
  body('permissionLevel').isIn(Object.values(WORKSPACE_PERMISSIONS)).withMessage('Invalid permission level'),
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

    const { userId, workspace, permissionLevel, expiresAt } = req.body;

    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Check if permission already exists
    const existingPermission = await prisma.workspacePermission.findUnique({
      where: {
        userId_workspace: {
          userId,
          workspace
        }
      }
    });

    let permission;
    if (existingPermission) {
      // Update existing permission
      permission = await prisma.workspacePermission.update({
        where: {
          userId_workspace: {
            userId,
            workspace
          }
        },
        data: {
          permissionLevel,
          grantedBy: req.user.id,
          grantedAt: new Date(),
          expiresAt: expiresAt ? new Date(expiresAt) : null,
          isActive: true
        },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              username: true,
              role: true
            }
          },
          granter: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              username: true
            }
          }
        }
      });
    } else {
      // Create new permission
      permission = await prisma.workspacePermission.create({
        data: {
          userId,
          workspace,
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
              username: true,
              role: true
            }
          },
          granter: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              username: true
            }
          }
        }
      });
    }

    res.status(201).json({
      success: true,
      data: permission
    });
  } catch (error) {
    console.error('Grant workspace permission error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    Revoke workspace permission
// @route   DELETE /api/workspace-permissions/:id
// @access  Private/Admin
router.delete('/:id', protect, authorize('ADMIN'), async (req: any, res: Response) => {
  try {
    const permission = await prisma.workspacePermission.findUnique({
      where: { id: req.params.id }
    });

    if (!permission) {
      return res.status(404).json({
        success: false,
        error: 'Permission not found'
      });
    }

    await prisma.workspacePermission.delete({
      where: { id: req.params.id }
    });

    res.json({
      success: true,
      message: 'Permission revoked successfully'
    });
  } catch (error) {
    console.error('Revoke workspace permission error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// ==================== ROLE WORKSPACE PERMISSIONS ====================

// @desc    Get all role workspace permissions
// @route   GET /api/workspace-permissions/role-permissions
// @access  Private/Admin
router.get('/role-permissions', protect, authorize('ADMIN'), async (req: any, res: Response) => {
  try {
    const permissions = await prisma.roleWorkspacePermission.findMany({
      orderBy: [
        { role: 'asc' },
        { workspace: 'asc' }
      ]
    });

    res.json({
      success: true,
      data: permissions
    });
  } catch (error) {
    console.error('Get role workspace permissions error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    Set role workspace permission
// @route   POST /api/workspace-permissions/role-permissions
// @access  Private/Admin
router.post('/role-permissions', protect, authorize('ADMIN'), [
  body('role').notEmpty().withMessage('Role is required'),
  body('workspace').isIn(Object.values(WORKSPACES)).withMessage('Invalid workspace'),
  body('permissionLevel').isIn(Object.values(WORKSPACE_PERMISSIONS)).withMessage('Invalid permission level'),
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

    const { role, workspace, permissionLevel } = req.body;

    // Check if permission already exists
    const existingPermission = await prisma.roleWorkspacePermission.findUnique({
      where: {
        role_workspace: {
          role,
          workspace
        }
      }
    });

    let permission;
    if (existingPermission) {
      // Update existing permission
      permission = await prisma.roleWorkspacePermission.update({
        where: {
          role_workspace: {
            role,
            workspace
          }
        },
        data: {
          permissionLevel,
          isActive: true
        }
      });
    } else {
      // Create new permission
      permission = await prisma.roleWorkspacePermission.create({
        data: {
          role,
          workspace,
          permissionLevel
        }
      });
    }

    res.status(201).json({
      success: true,
      data: permission
    });
  } catch (error) {
    console.error('Set role workspace permission error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    Remove role workspace permission
// @route   DELETE /api/workspace-permissions/role-permissions/:id
// @access  Private/Admin
router.delete('/role-permissions/:id', protect, authorize('ADMIN'), async (req: any, res: Response) => {
  try {
    const permission = await prisma.roleWorkspacePermission.findUnique({
      where: { id: req.params.id }
    });

    if (!permission) {
      return res.status(404).json({
        success: false,
        error: 'Permission not found'
      });
    }

    await prisma.roleWorkspacePermission.delete({
      where: { id: req.params.id }
    });

    res.json({
      success: true,
      message: 'Role permission removed successfully'
    });
  } catch (error) {
    console.error('Remove role workspace permission error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

export default router;
