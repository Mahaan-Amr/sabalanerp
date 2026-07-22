import express, { Response } from 'express';
import { body, validationResult } from 'express-validator';
import { Prisma, PrismaClient } from '@prisma/client';
import { protect, authorize, AuthRequest } from '../middleware/auth';
import bcrypt from 'bcryptjs';
import { WORKSPACE_PERMISSIONS, WORKSPACES } from '../middleware/workspace';
import { FEATURE_PERMISSIONS, FEATURE_WORKSPACE_MAP, FEATURES } from '../middleware/feature';
import { resolveExistingPersonnelLink } from '../services/hrPersonnelBoundary';
import { assertUserCanBeDeleted, collectUserDeletionBlockers, UserDeletionPolicyError } from '../services/userDeletionPolicy';

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
  },
  workSchedules: {
    include: { days: { orderBy: { weekday: 'asc' as const } } },
    orderBy: { effectiveFrom: 'desc' as const },
    take: 1
  }
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
  body('personnelMode').optional().isIn(['none', 'existing', 'auto']),
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
      personnelMode = 'none',
      personnelId,
      workspacePermissions = [],
      featurePermissions = []
    } = req.body;

    if (req.body.workSchedule !== undefined) {
      return res.status(409).json({
        success: false,
        code: 'HR_WORK_SCHEDULE_OWNED',
        error: 'برنامه کاری از مدیریت کاربر قابل تغییر نیست؛ آن را در پرونده پرسنلی منابع انسانی ثبت کنید.',
        canonicalPath: '/dashboard/hr/personnel'
      });
    }

    if (personnelMode === 'auto') {
      return res.status(409).json({
        success: false,
        code: 'LEGACY_PERSONNEL_AUTO_CREATION_DISABLED',
        error: 'ساخت خودکار پرسنل از حساب کاربری متوقف شده است؛ حالت بدون اتصال یا اتصال به پرسنل موجود را انتخاب کنید.',
        canonicalPath: '/dashboard/hr/personnel'
      });
    }

    if (personnelMode === 'existing' && !personnelId) {
      return res.status(400).json({ success: false, error: 'برای اتصال حساب، انتخاب پرسنل موجود الزامی است.' });
    }

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
      const linkedPersonnelId = personnelMode === 'existing' || personnelId
        ? await resolveExistingPersonnelLink(tx, { personnelId })
        : null;

      const createdUser = await tx.user.create({
        data: {
          email,
          username,
          password: hashedPassword,
          firstName,
          lastName,
          role,
          departmentId: departmentId || null,
          personnelId: linkedPersonnelId,
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
  body('personnelMode').optional().isIn(['none', 'existing', 'auto']),
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

    if (req.body.workSchedule !== undefined) {
      return res.status(409).json({
        success: false,
        code: 'HR_WORK_SCHEDULE_OWNED',
        error: 'برنامه کاری از مدیریت کاربر قابل تغییر نیست؛ آن را در پرونده پرسنلی منابع انسانی ثبت کنید.',
        canonicalPath: '/dashboard/hr/personnel'
      });
    }

    if (personnelMode === 'auto') {
      return res.status(409).json({
        success: false,
        code: 'LEGACY_PERSONNEL_AUTO_CREATION_DISABLED',
        error: 'ساخت خودکار پرسنل از حساب کاربری متوقف شده است؛ حالت بدون اتصال یا اتصال به پرسنل موجود را انتخاب کنید.',
        canonicalPath: '/dashboard/hr/personnel'
      });
    }

    if (personnelMode === 'existing' && !personnelId) {
      return res.status(400).json({ success: false, error: 'برای اتصال حساب، انتخاب پرسنل موجود الزامی است.' });
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
      const shouldRelink = personnelMode === 'existing' && personnelId;
      const linkedPersonnelId = shouldRelink
        ? await resolveExistingPersonnelLink(tx, { personnelId, currentUserId: existingUser.id })
        : existingUser.personnelId;

      return tx.user.update({
        where: { id: req.params.id },
        data: {
          ...(firstName && { firstName }),
          ...(lastName && { lastName }),
          ...(email && { email }),
          ...(username && { username }),
          ...(role && { role }),
          personnelId: linkedPersonnelId,
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
router.delete('/:id', protect, authorize('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        username: true,
        role: true,
        isActive: true,
        personnelId: true,
        securityPersonnel: { select: { id: true } },
        _count: true
      }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    const [adminCount, activeAdminCount] = user.role === 'ADMIN'
      ? await Promise.all([
        prisma.user.count({ where: { role: 'ADMIN' } }),
        prisma.user.count({ where: { role: 'ADMIN', isActive: true } })
      ])
      : [0, 0];

    assertUserCanBeDeleted({
      actor: req.user!,
      target: user,
      confirmationUsername: req.body?.confirmationUsername,
      adminCount,
      activeAdminCount
    });

    const operationalBlockers = collectUserDeletionBlockers(
      user._count as unknown as Record<string, number>,
      { hasSecurityPersonnel: Boolean(user.securityPersonnel) }
    );
    if (operationalBlockers.length > 0) {
      return res.status(409).json({
        success: false,
        code: 'USER_DELETE_OPERATIONAL_HISTORY',
        error: 'این حساب به سوابق عملیاتی متصل است و حذف آن ممکن است داده‌های کاری را از بین ببرد. حساب را غیرفعال کنید.',
        details: { relations: operationalBlockers }
      });
    }

    const cleanup = await prisma.$transaction(async (tx) => {
      const [workspacePermissions, featurePermissions, hiringAuthorities] = await Promise.all([
        tx.workspacePermission.count({ where: { userId: user.id } }),
        tx.featurePermission.count({ where: { userId: user.id } }),
        tx.hrHiringAuthority.count({ where: { userId: user.id } })
      ]);

      await tx.hrHiringAuthority.deleteMany({ where: { userId: user.id } });
      await tx.featurePermission.deleteMany({ where: { userId: user.id } });
      await tx.workspacePermission.deleteMany({ where: { userId: user.id } });
      await tx.user.delete({ where: { id: user.id } });

      return {
        workspacePermissions,
        featurePermissions,
        hiringAuthorities,
        personnelPreserved: Boolean(user.personnelId)
      };
    });

    res.json({
      success: true,
      message: 'حساب کاربری و دسترسی‌های وابسته با موفقیت حذف شدند.',
      data: { deletedUserId: user.id, cleanup }
    });
  } catch (error: any) {
    console.error('Delete user error:', error);
    if (error instanceof UserDeletionPolicyError) {
      return res.status(error.status).json({ success: false, code: error.code, error: error.message });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      return res.status(409).json({
        success: false,
        code: 'USER_DELETE_OPERATIONAL_HISTORY',
        error: 'این حساب به سوابق عملیاتی متصل است و حذف کامل آن امن نیست. ابتدا حساب را غیرفعال کنید یا وابستگی اعلام‌شده را بررسی کنید.',
        details: error.meta
      });
    }
    res.status(500).json({
      success: false,
      code: 'USER_DELETE_FAILED',
      error: 'حذف حساب کاربری ناموفق بود.'
    });
  }
});

export default router;
