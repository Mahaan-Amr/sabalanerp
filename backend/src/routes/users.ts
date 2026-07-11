import express, { Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { PrismaClient } from '@prisma/client';
import { protect, authorize, AuthRequest } from '../middleware/auth';
import bcrypt from 'bcryptjs';
import { WORKSPACE_PERMISSIONS, WORKSPACES } from '../middleware/workspace';
import { FEATURE_PERMISSIONS, FEATURE_WORKSPACE_MAP, FEATURES } from '../middleware/feature';

const router = express.Router();
const prisma = new PrismaClient();
const CUID_REGEX = /^c[a-z0-9]{24}$/;
const FEATURE_EXCEPTION_PERMISSION_LEVELS = [
  FEATURE_PERMISSIONS.VIEW,
  FEATURE_PERMISSIONS.EDIT
];

const getFeatureWorkspace = (feature: string): string | null => {
  if (!Object.values(FEATURES).includes(feature as any)) {
    return null;
  }
  return FEATURE_WORKSPACE_MAP[feature as keyof typeof FEATURE_WORKSPACE_MAP] || null;
};

const hasAdminPermissionLevel = (permissions: Array<{ permissionLevel?: string }>) =>
  permissions.some((permission) => permission.permissionLevel === WORKSPACE_PERMISSIONS.ADMIN);

const normalizePhone = (value?: string | null) => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  return trimmed
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[\s\-().]/g, '');
};

const personnelSelect = {
  id: true,
  firstName: true,
  lastName: true,
  isActive: true,
  department: {
    select: {
      id: true,
      name: true,
      namePersian: true,
    }
  }
};

const samePersonnelWhere = (firstName: string, lastName: string, departmentId?: string | null) => ({
  firstName,
  lastName,
  departmentId: departmentId || null
});

const ensurePersonnelForUser = async (
  tx: any,
  input: {
    firstName: string;
    lastName: string;
    departmentId?: string | null;
    isActive: boolean;
    personnelMode?: string;
    personnelId?: string;
    currentUserId?: string;
  }
) => {
  const firstName = String(input.firstName || '').trim();
  const lastName = String(input.lastName || '').trim();
  const departmentId = input.departmentId || null;

  if (input.personnelMode === 'existing' && input.personnelId) {
    const existing = await tx.personnel.findUnique({
      where: { id: input.personnelId },
      include: { user: { select: { id: true } } }
    });
    if (!existing) throw new Error('پرسنل انتخاب‌شده پیدا نشد.');
    if (existing.user && existing.user.id !== input.currentUserId) throw new Error('این پرسنل قبلاً به کاربر دیگری متصل شده است.');
    return tx.personnel.update({
      where: { id: existing.id },
      data: { firstName, lastName, departmentId, isActive: input.isActive },
      select: { id: true }
    });
  }

  if (input.personnelId) {
    const linked = await tx.personnel.findUnique({
      where: { id: input.personnelId },
      include: { user: { select: { id: true } } }
    });
    if (linked && (!linked.user || linked.user.id === input.currentUserId)) {
      return tx.personnel.update({
        where: { id: linked.id },
        data: { firstName, lastName, departmentId, isActive: input.isActive },
        select: { id: true }
      });
    }
  }

  const matching = await tx.personnel.findFirst({
    where: samePersonnelWhere(firstName, lastName, departmentId),
    include: { user: { select: { id: true } } }
  });
  if (matching) {
    if (matching.user && matching.user.id !== input.currentUserId) throw new Error('پرسنل هم‌نام در همین بخش قبلاً به کاربر دیگری متصل شده است.');
    return tx.personnel.update({
      where: { id: matching.id },
      data: { firstName, lastName, departmentId, isActive: input.isActive },
      select: { id: true }
    });
  }

  return tx.personnel.create({
    data: { firstName, lastName, departmentId, isActive: input.isActive },
    select: { id: true }
  });
};

// @desc    Get all users
// @route   GET /api/users
// @access  Private/Admin
router.get('/', protect, authorize('ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const whereClause = req.user?.role === 'MANAGER'
      ? { role: { not: 'ADMIN' as const } }
      : undefined;

    const users = await prisma.user.findMany({
      where: whereClause,
      skip,
      take: limit,
      select: {
        id: true,
        email: true,
        username: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        department: {
          select: {
            id: true,
            name: true,
            namePersian: true,
          }
        },
        profile: true,
        personnel: { select: personnelSelect },
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    const total = await prisma.user.count({ where: whereClause });

    res.json({
      success: true,
      data: users,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    Create new user (Admin only)
// @route   POST /api/users
// @access  Private/Admin
router.post('/', protect, authorize('ADMIN', 'MANAGER'), [
  body('email').isEmail().normalizeEmail(),
  body('username').isLength({ min: 3 }).trim().escape(),
  body('password').isLength({ min: 6 }),
  body('firstName').trim().escape(),
  body('lastName').trim().escape(),
  body('phone').optional({ values: 'falsy' }).isString().trim(),
  body('role').optional().isIn(['USER', 'MODERATOR', 'ADMIN', 'SALES', 'MANAGER']),
  body('departmentId')
    .optional({ values: 'falsy' })
    .isString()
    .custom((value) => CUID_REGEX.test(value))
    .withMessage('Invalid department ID'),
  body('isActive').optional().isBoolean(),
  body('personnelMode').optional().isIn(['auto', 'existing']),
  body('personnelId').optional({ values: 'falsy' }).isString(),
  body('workspacePermissions').optional().isArray(),
  body('workspacePermissions.*.workspace')
    .optional()
    .isIn(Object.values(WORKSPACES))
    .withMessage('Invalid workspace'),
  body('workspacePermissions.*.permissionLevel')
    .optional()
    .isIn(Object.values(WORKSPACE_PERMISSIONS))
    .withMessage('Invalid workspace permission level'),
  body('workspacePermissions.*.expiresAt')
    .optional({ values: 'falsy' })
    .isISO8601()
    .withMessage('Invalid workspace permission expiration date'),
  body('featurePermissions').optional().isArray(),
  body('featurePermissions.*.workspace')
    .optional()
    .isIn(Object.values(WORKSPACES))
    .withMessage('Invalid feature workspace'),
  body('featurePermissions.*.feature')
    .optional()
    .isIn(Object.values(FEATURES))
    .withMessage('Invalid feature'),
  body('featurePermissions.*.permissionLevel')
    .optional()
    .isIn(FEATURE_EXCEPTION_PERMISSION_LEVELS)
    .withMessage('Feature exceptions only support view or edit'),
  body('featurePermissions.*.expiresAt')
    .optional({ values: 'falsy' })
    .isISO8601()
    .withMessage('Invalid feature permission expiration date'),
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { 
      email, 
      username, 
      password, 
      firstName, 
      lastName, 
      phone,
      role = 'USER',
      departmentId,
      isActive = true,
      personnelMode = 'auto',
      personnelId,
      workspacePermissions = [],
      featurePermissions = []
    } = req.body;

    const normalizedWorkspacePermissions = Array.from(
      new Map(
        (Array.isArray(workspacePermissions) ? workspacePermissions : [])
          .filter((permission) => permission?.workspace && permission?.permissionLevel)
          .map((permission) => [permission.workspace, permission])
      ).values()
    );
    const normalizedFeaturePermissions = Array.from(
      new Map(
        (Array.isArray(featurePermissions) ? featurePermissions : [])
          .filter((permission) => permission?.workspace && permission?.feature && permission?.permissionLevel)
          .map((permission) => [`${permission.workspace}:${permission.feature}`, permission])
      ).values()
    );

    for (const permission of normalizedFeaturePermissions) {
      const expectedWorkspace = getFeatureWorkspace(permission.feature);
      if (!expectedWorkspace || expectedWorkspace !== permission.workspace) {
        return res.status(400).json({
          success: false,
          error: `Workspace "${permission.workspace}" is not valid for feature "${permission.feature}"`
        });
      }
      if (permission.permissionLevel === FEATURE_PERMISSIONS.ADMIN) {
        return res.status(400).json({
          success: false,
          error: 'Feature exceptions only support view or edit'
        });
      }
    }

    if (departmentId) {
      const department = await prisma.department.findUnique({
        where: { id: departmentId },
        select: { id: true, isActive: true }
      });

      if (!department || !department.isActive) {
        return res.status(400).json({
          success: false,
          error: 'Department not found or inactive'
        });
      }
    }

    if (req.user?.role === 'MANAGER' && ['ADMIN', 'MANAGER'].includes(role)) {
      return res.status(403).json({
        success: false,
        error: 'Managers cannot create admin or manager users'
      });
    }

    if (
      req.user?.role === 'MANAGER' &&
      (hasAdminPermissionLevel(normalizedWorkspacePermissions as Array<{ permissionLevel?: string }>) ||
        hasAdminPermissionLevel(normalizedFeaturePermissions as Array<{ permissionLevel?: string }>))
    ) {
      return res.status(403).json({
        success: false,
        error: 'Managers cannot grant admin-level permissions'
      });
    }

    // Check if user already exists
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { email },
          { username }
        ]
      }
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: 'User already exists with this email or username'
      });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const normalizedPhone = normalizePhone(phone);

    const user = await prisma.$transaction(async (tx) => {
      const personnel = await ensurePersonnelForUser(tx, {
        firstName,
        lastName,
        departmentId: departmentId || null,
        isActive,
        personnelMode,
        personnelId
      });

      const createdUser = await tx.user.create({
        data: {
          email,
          username,
          password: hashedPassword,
          firstName,
          lastName,
          role,
          departmentId: departmentId || null,
          personnelId: personnel.id,
          isActive,
          ...(normalizedPhone && {
            profile: {
              create: {
                phone: normalizedPhone
              }
            }
          }),
        },
        select: {
          id: true,
          email: true,
          username: true,
          firstName: true,
          lastName: true,
          role: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
          department: {
            select: {
              id: true,
              name: true,
              namePersian: true,
            }
          },
          profile: true,
          personnel: { select: personnelSelect },
        }
      });

      if (normalizedWorkspacePermissions.length > 0) {
        await tx.workspacePermission.createMany({
          data: normalizedWorkspacePermissions.map((permission) => ({
            userId: createdUser.id,
            workspace: permission.workspace,
            permissionLevel: permission.permissionLevel,
            grantedBy: req.user?.id,
            expiresAt: permission.expiresAt ? new Date(permission.expiresAt) : null
          }))
        });
      }

      if (normalizedFeaturePermissions.length > 0) {
        await tx.featurePermission.createMany({
          data: normalizedFeaturePermissions.map((permission) => ({
            userId: createdUser.id,
            workspace: permission.workspace,
            feature: permission.feature,
            permissionLevel: permission.permissionLevel,
            grantedBy: req.user?.id,
            expiresAt: permission.expiresAt ? new Date(permission.expiresAt) : null
          }))
        });
      }

      return {
        ...createdUser,
        permissionSummary: {
          workspacePermissions: normalizedWorkspacePermissions.length,
          featurePermissions: normalizedFeaturePermissions.length
        }
      };
    });

    res.status(201).json({
      success: true,
      data: user
    });
  } catch (error: any) {
    console.error('Create user error:', error);
    res.status(error.message?.includes('پرسنل') ? 409 : 500).json({
      success: false,
      error: error.message?.includes('پرسنل') ? error.message : 'Server error during user creation'
    });
  }
});

// @desc    Get user by ID
// @route   GET /api/users/:id
// @access  Private
router.get('/:id', protect, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        email: true,
        username: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        department: {
          select: {
            id: true,
            name: true,
            namePersian: true,
          }
        },
        profile: true,
        personnel: { select: personnelSelect },
      }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Users can only view their own profile unless they're admin or manager
    if (req.user!.id !== user.id && !['ADMIN', 'MANAGER'].includes(req.user!.role)) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized to view this user'
      });
    }

    if (req.user!.role === 'MANAGER' && user.role === 'ADMIN') {
      return res.status(403).json({
        success: false,
        error: 'Managers cannot view admin users'
      });
    }

    res.json({
      success: true,
      data: user
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    Update user
// @route   PUT /api/users/:id
// @access  Private
router.put('/:id', protect, authorize('ADMIN', 'MANAGER'), [
  body('firstName').optional().trim().escape(),
  body('lastName').optional().trim().escape(),
  body('email').optional().isEmail().normalizeEmail(),
  body('username').optional().isLength({ min: 3 }).trim().escape(),
  body('phone').optional({ values: 'falsy' }).isString().trim(),
  body('role').optional().isIn(['USER', 'MODERATOR', 'ADMIN', 'SALES', 'MANAGER']),
  body('departmentId')
    .optional({ values: 'falsy' })
    .isString()
    .custom((value) => CUID_REGEX.test(value))
    .withMessage('Invalid department ID'),
  body('isActive').optional().isBoolean(),
  body('personnelMode').optional().isIn(['auto', 'existing']),
  body('personnelId').optional({ values: 'falsy' }).isString(),
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { firstName, lastName, email, username, phone, role, departmentId, isActive, personnelMode, personnelId } = req.body;

    if (departmentId) {
      const department = await prisma.department.findUnique({
        where: { id: departmentId },
        select: { id: true, isActive: true }
      });

      if (!department || !department.isActive) {
        return res.status(400).json({
          success: false,
          error: 'Department not found or inactive'
        });
      }
    }

    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { id: req.params.id },
      include: { personnel: true }
    });

    if (!existingUser) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Users can only update their own profile unless they're admin or manager
    if (req.user!.id !== existingUser.id && !['ADMIN', 'MANAGER'].includes(req.user!.role)) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized to update this user'
      });
    }

    if (req.user!.role === 'MANAGER' && existingUser.role === 'ADMIN') {
      return res.status(403).json({
        success: false,
        error: 'Managers cannot update admin users'
      });
    }

    if (req.user!.role === 'MANAGER' && role && ['ADMIN', 'MANAGER'].includes(role)) {
      return res.status(403).json({
        success: false,
        error: 'Managers cannot assign admin or manager role'
      });
    }

    // Check if email is already taken by another user
    if (email && email !== existingUser.email) {
      const emailExists = await prisma.user.findUnique({
        where: { email }
      });

      if (emailExists) {
        return res.status(400).json({
          success: false,
          error: 'Email already taken'
        });
      }
    }

    if (username && username !== existingUser.username) {
      const usernameExists = await prisma.user.findUnique({
        where: { username }
      });

      if (usernameExists) {
        return res.status(400).json({
          success: false,
          error: 'Username already taken'
        });
      }
    }

    const normalizedPhone = phone !== undefined ? normalizePhone(phone) : undefined;

    const updatedUser = await prisma.$transaction(async (tx) => {
      const nextFirstName = firstName || existingUser.firstName;
      const nextLastName = lastName || existingUser.lastName;
      const nextDepartmentId = departmentId !== undefined ? departmentId || null : existingUser.departmentId;
      const nextIsActive = isActive !== undefined ? Boolean(isActive) : existingUser.isActive;
      const shouldRelink = personnelMode === 'existing' && personnelId;
      const linkedPersonnel = await ensurePersonnelForUser(tx, {
        firstName: nextFirstName,
        lastName: nextLastName,
        departmentId: nextDepartmentId,
        isActive: nextIsActive,
        personnelMode: shouldRelink ? 'existing' : 'auto',
        personnelId: shouldRelink ? personnelId : existingUser.personnelId || undefined,
        currentUserId: existingUser.id
      });

      return tx.user.update({
        where: { id: req.params.id },
        data: {
          ...(firstName && { firstName }),
          ...(lastName && { lastName }),
          ...(email && { email }),
          ...(username && { username }),
          ...(role && { role }),
          personnelId: linkedPersonnel.id,
          ...(departmentId !== undefined && { departmentId: departmentId || null }),
          ...(isActive !== undefined && { isActive }),
          ...(normalizedPhone !== undefined && {
            profile: {
              upsert: {
                create: { phone: normalizedPhone },
                update: { phone: normalizedPhone }
              }
            }
          }),
        },
        select: {
          id: true,
          email: true,
          username: true,
          firstName: true,
          lastName: true,
          role: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
          department: {
            select: {
              id: true,
              name: true,
              namePersian: true,
            }
          },
          profile: true,
          personnel: { select: personnelSelect },
        }
      });
    });

    res.json({
      success: true,
      data: updatedUser
    });
  } catch (error: any) {
    console.error('Update user error:', error);
    res.status(error.message?.includes('پرسنل') ? 409 : 500).json({
      success: false,
      error: error.message?.includes('پرسنل') ? error.message : 'Server error'
    });
  }
});

// @desc    Delete user
// @route   DELETE /api/users/:id
// @access  Private/Admin
router.delete('/:id', protect, authorize('ADMIN', 'MANAGER'), async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    if ((req as AuthRequest).user?.role === 'MANAGER' && user.role === 'ADMIN') {
      return res.status(403).json({
        success: false,
        error: 'Managers cannot delete admin users'
      });
    }

    await prisma.user.delete({
      where: { id: req.params.id }
    });

    res.json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

export default router;
