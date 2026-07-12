import express, { Response } from 'express';
import { body, validationResult } from 'express-validator';
import { PrismaClient } from '@prisma/client';
import { protect } from '../middleware/auth';
import { requireWorkspaceAccess, WORKSPACE_PERMISSIONS, WORKSPACES } from '../middleware/workspace';
import { requireFeatureAccess, requireAnyFeatureAccess, FEATURE_PERMISSIONS, FEATURES } from '../middleware/feature';

const router = express.Router();
const prisma = new PrismaClient();
const DEBUG_LOGS = process.env.NODE_ENV !== 'production';

const isOwnerScopedUser = (req: any) => req?.user?.role && req.user.role !== 'ADMIN';

const buildCustomerScope = (req: any) => {
  return {};
};

const normalizeDigits = (value: unknown): string => {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value)
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/\D/g, '');
};

const normalizePhoneNumber = (value: unknown): string => {
  const digits = normalizeDigits(value);
  if (digits.startsWith('0098')) return `0${digits.slice(4)}`;
  if (digits.startsWith('98') && digits.length === 12) return `0${digits.slice(2)}`;
  if (digits.startsWith('9') && digits.length === 10) return `0${digits}`;
  return digits;
};

const normalizeNationalCode = (value: unknown): string => normalizeDigits(value);
const validateOptionalIranianMobileNumber = (value: unknown): string | null => {
  const normalized = normalizePhoneNumber(value);
  if (!normalized) return null;
  return /^09\d{9}$/.test(normalized) ? null : 'Phone number must be 11 digits and start with 09';
};
const validateRequiredIranianMobileNumber = (value: unknown): string | null => {
  const normalized = normalizePhoneNumber(value);
  if (!normalized) return 'Phone number is required';
  return /^09\d{9}$/.test(normalized) ? null : 'Phone number must be 11 digits and start with 09';
};
const normalizeOptionalIranianMobileNumber = (value: unknown): string | null => {
  const normalized = normalizePhoneNumber(value);
  return normalized || null;
};
const normalizeNullableText = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
};
const normalizePhoneType = (value: unknown): string => String(value || '').trim().toLowerCase();
const validatePhoneNumbersPayload = (phoneNumbers: unknown): string | null => {
  if (!Array.isArray(phoneNumbers)) return null;
  const invalidPhone = phoneNumbers.find((phone: any) => validateRequiredIranianMobileNumber(phone?.number));
  return invalidPhone ? 'All customer phone numbers must be 11 digits and start with 09' : null;
};

const hasFeaturePermission = async (
  user: any,
  features: string[],
  requiredPermission: 'view' | 'edit' | 'admin'
): Promise<boolean> => {
  if (!user) return false;
  if (user.role === 'ADMIN') return true;

  const levels = ['view', 'edit', 'admin'];
  const requiredLevel = levels.indexOf(requiredPermission);

  const userPermission = await prisma.featurePermission.findFirst({
    where: {
      userId: user.id,
      feature: { in: features },
      isActive: true
    }
  });

  if (userPermission && levels.indexOf(userPermission.permissionLevel) >= requiredLevel) {
    return true;
  }

  const rolePermission = await prisma.roleFeaturePermission.findFirst({
    where: {
      role: user.role,
      feature: { in: features },
      isActive: true
    }
  });

  return !!rolePermission && levels.indexOf(rolePermission.permissionLevel) >= requiredLevel;
};

const canAssignCustomerOwner = async (req: any): Promise<boolean> =>
  hasFeaturePermission(
    req.user,
    [FEATURES.CRM_CUSTOMERS_ASSIGN_OWNER, FEATURES.SALES_CUSTOMERS_ASSIGN_OWNER],
    'edit'
  );

const canManageCrmPipeline = async (req: any): Promise<boolean> => {
  if (!req.user) return false;
  if (req.user.role === 'ADMIN') return true;
  if (await hasFeaturePermission(req.user, [FEATURES.CRM_POTENTIAL_PROJECTS_REASSIGN], 'edit')) return true;

  const userWorkspacePermission = await prisma.workspacePermission.findUnique({
    where: { userId_workspace: { userId: req.user.id, workspace: WORKSPACES.CRM } }
  });
  const roleWorkspacePermission = await prisma.roleWorkspacePermission.findUnique({
    where: { role_workspace: { role: req.user.role, workspace: WORKSPACES.CRM } }
  });
  const permission = userWorkspacePermission?.isActive ? userWorkspacePermission.permissionLevel : roleWorkspacePermission?.isActive ? roleWorkspacePermission.permissionLevel : null;
  return permission === WORKSPACE_PERMISSIONS.ADMIN;
};

const parseOptionalDate = (value: unknown): Date | null => {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
};

const parseOptionalDecimal = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const parseOptionalInt = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isInteger(numeric) ? numeric : null;
};

const fullName = (user: any) => [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim() || user?.username || 'نامشخص';

const projectInclude = {
  customer: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      companyName: true,
      phoneNumbers: {
        where: { isActive: true },
        take: 2,
        select: { number: true, isPrimary: true }
      }
    }
  },
  responsibleSeller: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      username: true
    }
  },
  wonSalesContract: {
    select: {
      id: true,
      contractNumber: true,
      status: true
    }
  },
  _count: {
    select: {
      followUpReports: true,
      nextActions: true
    }
  }
} as const;

const followUpInclude = {
  customer: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      companyName: true
    }
  },
  potentialProject: {
    select: {
      id: true,
      title: true,
      status: true,
      responsibleSellerId: true
    }
  },
  seller: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      username: true
    }
  },
  nextAction: true
} as const;

const nextActionInclude = {
  customer: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      companyName: true
    }
  },
  potentialProject: {
    select: {
      id: true,
      title: true,
      status: true,
      responsibleSellerId: true
    }
  },
  assignedTo: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      username: true
    }
  }
} as const;

const ensureProjectAccessOrDeny = async (
  req: any,
  res: Response,
  projectId: string,
  options: { allowSummaryOnly?: boolean } = {}
) => {
  const project = await prisma.crmPotentialProject.findUnique({
    where: { id: projectId },
    include: projectInclude
  });

  if (!project) {
    res.status(404).json({ success: false, error: 'پروژه احتمالی پیدا نشد.' });
    return null;
  }

  if (req.user?.role === 'ADMIN' || project.responsibleSellerId === req.user?.id || (await canManageCrmPipeline(req))) {
    return project;
  }

  if (options.allowSummaryOnly) return project;

  res.status(403).json({
    success: false,
    error: 'جزئیات این پروژه احتمالی فقط برای فروشنده مسئول، مدیر CRM یا مدیر سیستم قابل مشاهده است.'
  });
  return null;
};

const customerSuggestionSelect = {
  id: true,
  firstName: true,
  lastName: true,
  companyName: true,
  customerType: true,
  status: true,
  nationalCode: true,
  ownerUserId: true,
  ownerUser: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      username: true
    }
  },
  phoneNumbers: {
    where: { isActive: true },
    select: {
      id: true,
      number: true,
      type: true,
      isPrimary: true,
      isActive: true
    }
  },
  projectAddresses: {
    where: { isActive: true },
    select: {
      id: true,
      address: true,
      city: true,
      projectName: true,
      projectType: true,
      projectManagerName: true,
      projectManagerNumber: true,
      marketerFirstName: true,
      marketerLastName: true,
      marketerPhoneNumber: true,
      isActive: true
    }
  },
  _count: {
    select: {
      potentialProjects: true
    }
  }
} as const;

const ensureOwnershipOrDeny = async (
  req: any,
  res: Response,
  customer: { id: string; ownerUserId: string | null } | null,
  context: string
) => {
  if (!customer) {
    res.status(404).json({
      success: false,
      error: 'Customer not found'
    });
    return false;
  }

  if (
    isOwnerScopedUser(req) &&
    customer.ownerUserId !== req.user.id &&
    !(await canAssignCustomerOwner(req))
  ) {
    console.warn('[crm-customer-owner-deny]', {
      userId: req.user?.id,
      role: req.user?.role,
      customerId: customer.id,
      context
    });
    res.status(403).json({
      success: false,
      error: 'Access denied: customer does not belong to current sales user'
    });
    return false;
  }

  return true;
};

const findDuplicateCustomers = async (params: {
  nationalCode?: unknown;
  phoneNumbers?: Array<{ number?: unknown }>;
}) => {
  const normalizedNationalCode = normalizeNationalCode(params.nationalCode);
  const normalizedPhones = Array.from(
    new Set(
      (Array.isArray(params.phoneNumbers) ? params.phoneNumbers : [])
        .map((phone) => normalizePhoneNumber(phone?.number))
        .filter(Boolean)
    )
  );

  if (!normalizedNationalCode && normalizedPhones.length === 0) {
    return [];
  }

  const candidates = await prisma.crmCustomer.findMany({
    where: {
      isActive: true,
      OR: [
        normalizedNationalCode ? { nationalCode: { not: null } } : undefined,
        normalizedPhones.length > 0 ? { phoneNumbers: { some: { isActive: true } } } : undefined
      ].filter(Boolean) as any
    },
    select: customerSuggestionSelect
  });

  return candidates.filter((customer) => {
    const nationalCodeMatches =
      !!normalizedNationalCode && normalizeNationalCode(customer.nationalCode) === normalizedNationalCode;
    const phoneMatches = customer.phoneNumbers.some((phone) =>
      normalizedPhones.includes(normalizePhoneNumber(phone.number))
    );
    return nationalCodeMatches || phoneMatches;
  });
};

router.post(
  '/customers/duplicate-check',
  protect,
  requireAnyFeatureAccess([FEATURES.CRM_CUSTOMERS_VIEW, FEATURES.SALES_CUSTOMERS_VIEW], FEATURE_PERMISSIONS.VIEW),
  async (req: any, res: Response): Promise<void> => {
    try {
      const duplicateCustomers = await findDuplicateCustomers({
        nationalCode: req.body?.nationalCode,
        phoneNumbers: req.body?.phoneNumbers
      });

      res.json({
        success: true,
        data: {
          hasDuplicate: duplicateCustomers.length > 0,
          matches: duplicateCustomers
        }
      });
    } catch (error) {
      console.error('Duplicate customer check error:', error);
      res.status(500).json({
        success: false,
        error: 'Server error'
      });
    }
  }
);

// ==================== CRM CUSTOMERS ====================

// @desc    Get assignable CRM customer owners
// @route   GET /api/crm/customer-owners
// @access  Private/CRM or Sales Customer Owner Assignment
router.get('/customer-owners', protect, async (req: any, res: Response): Promise<void> => {
  try {
    if (!(await canAssignCustomerOwner(req))) {
      res.status(403).json({
        success: false,
        error: 'Access denied: customer owner assignment permission is required'
      });
      return;
    }

    const users = await prisma.user.findMany({
      where: {
        isActive: true
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        username: true,
        role: true,
        department: {
          select: {
            id: true,
            name: true,
            namePersian: true
          }
        }
      },
      orderBy: [
        { firstName: 'asc' },
        { lastName: 'asc' }
      ]
    });

    res.json({
      success: true,
      data: users
    });
  } catch (error) {
    console.error('Get CRM customer owners error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

router.get('/sellers', protect, requireWorkspaceAccess(WORKSPACES.CRM, WORKSPACE_PERMISSIONS.VIEW), requireFeatureAccess(FEATURES.CRM_POTENTIAL_PROJECTS_VIEW, FEATURE_PERMISSIONS.VIEW), async (req: any, res: Response): Promise<void> => {
  try {
    const users = await prisma.user.findMany({
      where: { isActive: true },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        username: true,
        role: true,
        department: {
          select: { id: true, name: true, namePersian: true }
        }
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }]
    });

    res.json({ success: true, data: users });
  } catch (error) {
    console.error('Get CRM sellers error:', error);
    res.status(500).json({ success: false, error: 'خطا در دریافت فهرست فروشنده‌ها' });
  }
});

// @desc    Get all CRM customers
// @route   GET /api/crm/customers
// @access  Private/CRM or Sales Customer View Access
router.get('/customers', protect, requireAnyFeatureAccess([FEATURES.CRM_CUSTOMERS_VIEW, FEATURES.SALES_CUSTOMERS_VIEW], FEATURE_PERMISSIONS.VIEW), async (req: any, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;
    const search = req.query.search as string;
    const status = req.query.status as string;
    const customerType = req.query.customerType as string;

    // Build where clause
    let whereClause: any = buildCustomerScope(req);
    
    if (search) {
      whereClause.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { companyName: { contains: search, mode: 'insensitive' } },
        { nationalCode: { contains: search, mode: 'insensitive' } },
        { projectManagerName: { contains: search, mode: 'insensitive' } },
        { homeNumber: { contains: search, mode: 'insensitive' } },
        { workNumber: { contains: search, mode: 'insensitive' } },
        { brandName: { contains: search, mode: 'insensitive' } },
        { primaryContact: { firstName: { contains: search, mode: 'insensitive' } } },
        { primaryContact: { lastName: { contains: search, mode: 'insensitive' } } },
        { phoneNumbers: { some: { number: { contains: search, mode: 'insensitive' } } } }
      ];
    }
    
    if (status) whereClause.status = status;
    if (customerType) whereClause.customerType = customerType;

    const customers = await prisma.crmCustomer.findMany({
      where: whereClause,
      skip,
      take: limit,
      include: {
        primaryContact: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            position: true
          }
        },
        contacts: {
          where: { isActive: true },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            position: true,
            isPrimary: true,
            isActive: true
          }
        },
        projectAddresses: {
          where: { isActive: true },
          select: {
            id: true,
            address: true,
            city: true,
            projectName: true,
            projectType: true,
            projectManagerName: true,
            projectManagerNumber: true,
            marketerFirstName: true,
            marketerLastName: true,
            marketerPhoneNumber: true
          }
        },
        phoneNumbers: {
          where: { isActive: true },
          select: {
            id: true,
            number: true,
            type: true,
            isPrimary: true
          }
        },
        ownerUser: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            username: true
          }
        },
        _count: {
          select: {
            leads: true,
            communications: true,
            salesContracts: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    const total = await prisma.crmCustomer.count({ where: whereClause });

    res.json({
      success: true,
      data: customers,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get CRM customers error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    Get CRM customer by ID
// @route   GET /api/crm/customers/:id
// @access  Private/CRM or Sales Customer View Access
router.get('/customers/:id', protect, requireAnyFeatureAccess([FEATURES.CRM_CUSTOMERS_VIEW, FEATURES.SALES_CUSTOMERS_VIEW], FEATURE_PERMISSIONS.VIEW), async (req: any, res: Response): Promise<void> => {
  try {
    const customer = await prisma.crmCustomer.findUnique({
      where: { id: req.params.id },
      include: {
        primaryContact: true,
        contacts: {
          where: { isActive: true }
        },
        projectAddresses: {
          where: { isActive: true },
          select: {
            id: true,
            address: true,
            city: true,
            projectName: true,
            projectType: true,
            projectManagerName: true,
            projectManagerNumber: true,
            marketerFirstName: true,
            marketerLastName: true,
            marketerPhoneNumber: true
          }
        },
        phoneNumbers: {
          where: { isActive: true }
        },
        ownerUser: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            username: true
          }
        },
        leads: {
          orderBy: { createdAt: 'desc' }
        },
        potentialProjects: {
          where: { isActive: true },
          include: projectInclude,
          orderBy: { updatedAt: 'desc' }
        },
        communications: {
          orderBy: { createdAt: 'desc' },
          take: 10
        },
        salesContracts: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          include: {
            createdByUser: {
              select: {
                firstName: true,
                lastName: true
              }
            }
          }
        }
      }
    });
    if (!customer) {
      res.status(404).json({
        success: false,
        error: 'Customer not found'
      });
      return;
    }

    res.json({
      success: true,
      data: customer
    });
  } catch (error) {
    console.error('Get CRM customer error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    Create new CRM customer
// @route   POST /api/crm/customers
// @access  Private/CRM Workspace
router.post('/customers', protect, requireAnyFeatureAccess([FEATURES.CRM_CUSTOMERS_CREATE, FEATURES.SALES_CUSTOMERS_CREATE], FEATURE_PERMISSIONS.EDIT), [
  body('firstName').notEmpty().withMessage('First name is required'),
  body('lastName').notEmpty().withMessage('Last name is required'),
  body('customerType').notEmpty().withMessage('Customer type is required'),
  body('nationalCode').optional().custom((value) => {
    if (value && value.length !== 10) {
      throw new Error('National code must be 10 digits');
    }
    return true;
  }),
], async (req: any, res: Response): Promise<void> => {
  try {
    if (DEBUG_LOGS) {
      console.log('Received customer data:', JSON.stringify(req.body, null, 2));
    }
    
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      if (DEBUG_LOGS) {
        console.log('Validation errors:', errors.array());
      }
      res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
      return;
    }

    const {
      // Basic Information
      firstName,
      lastName,
      companyName,
      customerType,
      industry,
      status,
      
      // Contact Information
      nationalCode,
      homeAddress,
      homeNumber,
      workAddress,
      workNumber,
      
      // Project Management
      projectManagerName,
      projectManagerNumber,

      // Referrer Information
      referrerFirstName,
      referrerLastName,
      referrerPhoneNumber,
      
      // Brand Information
      brandName,
      brandNameDescription,
      
      // Security & Access Control
      isBlacklisted,
      isLocked,
      
      // Legacy Fields (for backward compatibility)
      address,
      city,
      country,
      communicationPreferences,
      customFields,
      
      // Related Data
      projectAddresses,
      phoneNumbers,
      primaryContact
    } = req.body;

    const phoneValidationError = validatePhoneNumbersPayload(phoneNumbers);
    const projectManagerPhoneError = validateOptionalIranianMobileNumber(projectManagerNumber);
    const referrerPhoneError = validateOptionalIranianMobileNumber(referrerPhoneNumber);
    const projectAddressPhoneError = Array.isArray(projectAddresses)
      ? projectAddresses.find((addr: any) => validateOptionalIranianMobileNumber(addr?.projectManagerNumber))
      : null;
    const projectAddressMarketerPhoneError = Array.isArray(projectAddresses)
      ? projectAddresses.find((addr: any) => validateOptionalIranianMobileNumber(addr?.marketerPhoneNumber))
      : null;
    if (phoneValidationError || projectManagerPhoneError || referrerPhoneError || projectAddressPhoneError || projectAddressMarketerPhoneError) {
      res.status(400).json({
        success: false,
        error: phoneValidationError || projectManagerPhoneError || referrerPhoneError || 'Contact phone number must be 11 digits and start with 09'
      });
      return;
    }

    const duplicateCustomers = await findDuplicateCustomers({ nationalCode, phoneNumbers });
    if (duplicateCustomers.length > 0) {
      res.status(409).json({
        success: false,
        code: 'DUPLICATE_CUSTOMER',
        error: 'Customer already exists with this phone number or national code',
        data: {
          matches: duplicateCustomers
        }
      });
      return;
    }

    const normalizedNationalCode = normalizeNationalCode(nationalCode) || null;

    // Create customer with all related data
    if (DEBUG_LOGS) {
      console.log('Creating customer with data:', {
        firstName,
        lastName,
        companyName,
        customerType,
        industry,
        status,
        nationalCode: normalizedNationalCode,
        homeAddress,
        homeNumber,
        workAddress,
        workNumber,
        projectManagerName,
        projectManagerNumber,
        referrerFirstName,
        referrerLastName,
        referrerPhoneNumber,
        brandName,
        brandNameDescription,
        isBlacklisted,
        isLocked,
        projectAddresses: projectAddresses?.length || 0,
        phoneNumbers: phoneNumbers?.length || 0
      });
    }
    
    let customer;
    try {
      customer = await prisma.crmCustomer.create({
        data: {
        // Basic Information
        firstName,
        lastName,
        companyName,
        customerType,
        industry,
        status: status || 'Active',
        
        // Contact Information
        nationalCode: normalizedNationalCode,
        homeAddress,
        homeNumber: normalizeDigits(homeNumber) || null,
        workAddress,
        workNumber: normalizeDigits(workNumber) || null,
        
        // Project Management
        projectManagerName,
        projectManagerNumber: normalizeOptionalIranianMobileNumber(projectManagerNumber),

        // Referrer Information
        referrerFirstName,
        referrerLastName,
        referrerPhoneNumber: normalizeOptionalIranianMobileNumber(referrerPhoneNumber),
        
        // Brand Information
        brandName,
        brandNameDescription,
        
        // Security & Access Control
        isBlacklisted: isBlacklisted || false,
        isLocked: isLocked || false,
        ownerUserId: req.user.id,
        createdBy: req.user.id,
        updatedBy: req.user.id,
        
        // Legacy Fields (for backward compatibility)
        address: address || null,
        city: city || null,
        country: country || 'ایران',
        communicationPreferences: communicationPreferences || null,
        customFields: customFields || null,
        
        // Related Data
        projectAddresses: projectAddresses && projectAddresses.length > 0 ? {
          create: projectAddresses.map((addr: any) => ({
            address: addr.address,
            city: addr.city,
            postalCode: addr.postalCode || null,
            projectName: addr.projectName || null,
            projectType: addr.projectType || null,
            projectManagerName: addr.projectManagerName || null,
            projectManagerNumber: normalizeOptionalIranianMobileNumber(addr.projectManagerNumber),
            marketerFirstName: addr.marketerFirstName || null,
            marketerLastName: addr.marketerLastName || null,
            marketerPhoneNumber: normalizeOptionalIranianMobileNumber(addr.marketerPhoneNumber),
            isActive: true
          }))
        } : undefined,
        
        phoneNumbers: phoneNumbers && phoneNumbers.length > 0 ? {
          create: phoneNumbers.map((phone: any) => ({
            number: normalizePhoneNumber(phone.number),
            type: String(phone.type || 'mobile').toLowerCase(),
            isPrimary: phone.isPrimary || false,
            isActive: true
          }))
        } : undefined,
        
        contacts: primaryContact ? {
          create: {
            ...primaryContact,
            isPrimary: true
          }
        } : undefined
      },
      include: {
        primaryContact: true,
        contacts: true,
        projectAddresses: true,
        phoneNumbers: true,
        ownerUser: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            username: true
          }
        }
      }
    });

    // Update primary contact reference if provided
    if (primaryContact && customer.contacts.length > 0) {
      await prisma.crmCustomer.update({
        where: { id: customer.id },
        data: {
          primaryContactId: customer.contacts[0].id
        }
      });
    }
    } catch (prismaError: any) {
      console.error('Prisma error creating customer:', prismaError);
      res.status(400).json({
        success: false,
        error: 'Database error',
        details: prismaError.message
      });
      return;
    }

    const updatedCustomer = await prisma.crmCustomer.findUnique({
      where: { id: customer.id },
      include: {
        primaryContact: true,
        contacts: true,
        projectAddresses: true,
        phoneNumbers: true
      }
    });

    res.status(201).json({
      success: true,
      data: updatedCustomer
    });
  } catch (error) {
    console.error('Create CRM customer error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    Update CRM customer
// @route   PUT /api/crm/customers/:id
// @access  Private/CRM Workspace
router.put('/customers/:id', protect, requireAnyFeatureAccess([FEATURES.CRM_CUSTOMERS_EDIT, FEATURES.SALES_CUSTOMERS_EDIT], FEATURE_PERMISSIONS.EDIT), [
  body('firstName').optional({ values: 'null' }).custom((value) => {
    if (value !== undefined && !normalizeNullableText(value)) {
      throw new Error('First name cannot be empty');
    }
    return true;
  }),
  body('lastName').optional({ values: 'null' }).custom((value) => {
    if (value !== undefined && !normalizeNullableText(value)) {
      throw new Error('Last name cannot be empty');
    }
    return true;
  }),
  body('customerType').optional({ values: 'null' }).custom((value) => {
    if (!value) return true;
    if (!['Individual', 'Company', 'Government', 'Collaborative'].includes(String(value))) {
      throw new Error('Invalid customer type');
    }
    return true;
  }),
  body('status').optional({ values: 'null' }).custom((value) => {
    if (!value) return true;
    if (!['Active', 'Inactive', 'Prospect', 'Lead'].includes(String(value))) {
      throw new Error('Invalid customer status');
    }
    return true;
  }),
  body('nationalCode').optional({ values: 'null' }).custom((value) => {
    const normalized = normalizeNationalCode(value);
    if (normalized && normalized.length !== 10) {
      throw new Error('National code must be 10 digits');
    }
    return true;
  }),
], async (req: any, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
      return;
    }

    const customer = await prisma.crmCustomer.findUnique({
      where: { id: req.params.id },
      select: { id: true, ownerUserId: true }
    });
    if (!(await ensureOwnershipOrDeny(req, res, customer, 'update_customer'))) return;

    const bodyPayload = req.body || {};
    const projectManagerPhoneError = validateOptionalIranianMobileNumber(bodyPayload.projectManagerNumber);
    const referrerPhoneError = validateOptionalIranianMobileNumber(bodyPayload.referrerPhoneNumber);
    if (projectManagerPhoneError || referrerPhoneError) {
      res.status(400).json({
        success: false,
        error: projectManagerPhoneError || referrerPhoneError,
        details: [{
          path: projectManagerPhoneError ? 'projectManagerNumber' : 'referrerPhoneNumber',
          msg: projectManagerPhoneError || referrerPhoneError
        }]
      });
      return;
    }

    const updateData: any = {};
    const nullableTextFields = [
      'companyName',
      'industry',
      'brandName',
      'brandNameDescription',
      'homeAddress',
      'workAddress',
      'projectManagerName',
      'referrerFirstName',
      'referrerLastName'
    ];

    if ('firstName' in bodyPayload) updateData.firstName = normalizeNullableText(bodyPayload.firstName);
    if ('lastName' in bodyPayload) updateData.lastName = normalizeNullableText(bodyPayload.lastName);
    if ('customerType' in bodyPayload && bodyPayload.customerType) updateData.customerType = bodyPayload.customerType;
    if ('status' in bodyPayload && bodyPayload.status) updateData.status = bodyPayload.status;
    nullableTextFields.forEach((field) => {
      if (field in bodyPayload) updateData[field] = normalizeNullableText(bodyPayload[field]);
    });
    if ('nationalCode' in bodyPayload) updateData.nationalCode = normalizeNationalCode(bodyPayload.nationalCode) || null;
    if ('homeNumber' in bodyPayload) updateData.homeNumber = normalizeDigits(bodyPayload.homeNumber) || null;
    if ('workNumber' in bodyPayload) updateData.workNumber = normalizeDigits(bodyPayload.workNumber) || null;
    if ('projectManagerNumber' in bodyPayload) {
      updateData.projectManagerNumber = normalizeOptionalIranianMobileNumber(bodyPayload.projectManagerNumber);
    }
    if ('referrerPhoneNumber' in bodyPayload) {
      updateData.referrerPhoneNumber = normalizeOptionalIranianMobileNumber(bodyPayload.referrerPhoneNumber);
    }
    if ('isBlacklisted' in bodyPayload) updateData.isBlacklisted = Boolean(bodyPayload.isBlacklisted);
    if ('isLocked' in bodyPayload) updateData.isLocked = Boolean(bodyPayload.isLocked);

    if (('firstName' in updateData && !updateData.firstName) || ('lastName' in updateData && !updateData.lastName)) {
      res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: [{ msg: 'First name and last name cannot be empty' }]
      });
      return;
    }

    const updatedCustomer = await prisma.crmCustomer.update({
      where: { id: req.params.id },
      data: {
        ...updateData,
        updatedBy: req.user.id
      },
      include: {
        primaryContact: true,
        contacts: true
      }
    });

    res.json({
      success: true,
      data: updatedCustomer
    });
  } catch (error) {
    console.error('Update CRM customer error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    Assign CRM customer owner
// @route   PUT /api/crm/customers/:id/owner
// @access  Private/CRM or Sales Customer Owner Assignment
router.put('/customers/:id/owner', protect, async (req: any, res: Response): Promise<void> => {
  try {
    if (!(await canAssignCustomerOwner(req))) {
      res.status(403).json({
        success: false,
        error: 'Access denied: customer owner assignment permission is required'
      });
      return;
    }

    const ownerUserId = req.body?.ownerUserId || null;
    if (ownerUserId) {
      const owner = await prisma.user.findUnique({
        where: { id: ownerUserId },
        select: { id: true }
      });

      if (!owner) {
        res.status(404).json({
          success: false,
          error: 'Owner user not found'
        });
        return;
      }
    }

    const customer = await prisma.crmCustomer.findUnique({
      where: { id: req.params.id },
      select: { id: true }
    });

    if (!customer) {
      res.status(404).json({
        success: false,
        error: 'Customer not found'
      });
      return;
    }

    const updatedCustomer = await prisma.crmCustomer.update({
      where: { id: req.params.id },
      data: {
        ownerUserId,
        updatedBy: req.user.id
      },
      include: {
        ownerUser: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            username: true
          }
        },
        primaryContact: true,
        contacts: true,
        projectAddresses: true,
        phoneNumbers: true
      }
    });

    res.json({
      success: true,
      data: updatedCustomer
    });
  } catch (error) {
    console.error('Assign CRM customer owner error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// ==================== PROJECT ADDRESSES ====================

// @desc    Add project address to customer
// @route   POST /api/crm/customers/:customerId/project-addresses
// @access  Private/CRM Workspace
router.post('/customers/:customerId/project-addresses', protect, requireAnyFeatureAccess([FEATURES.CRM_PROJECT_ADDRESSES_CREATE, FEATURES.SALES_CUSTOMERS_EDIT], FEATURE_PERMISSIONS.EDIT), [
  body('address').notEmpty().withMessage('Address is required'),
  body('city').notEmpty().withMessage('City is required'),
], async (req: any, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
      return;
    }

    const { customerId } = req.params;
    const {
      address,
      city,
      postalCode,
      projectName,
      projectType,
      projectManagerName,
      projectManagerNumber,
      marketerFirstName,
      marketerLastName,
      marketerPhoneNumber
    } = req.body;
    const projectManagerPhoneError = validateOptionalIranianMobileNumber(projectManagerNumber);
    const marketerPhoneError = validateOptionalIranianMobileNumber(marketerPhoneNumber);
    if (projectManagerPhoneError || marketerPhoneError) {
      res.status(400).json({
        success: false,
        error: projectManagerPhoneError || marketerPhoneError
      });
      return;
    }

    // Check if customer exists
    const customer = await prisma.crmCustomer.findUnique({
      where: { id: customerId },
      select: { id: true, ownerUserId: true }
    });
    if (!(await ensureOwnershipOrDeny(req, res, customer, 'create_project_address'))) return;

    const projectAddress = await prisma.projectAddress.create({
      data: {
        customerId,
        address,
        city,
        postalCode,
        projectName,
        projectType,
        projectManagerName,
        projectManagerNumber: normalizeOptionalIranianMobileNumber(projectManagerNumber),
        marketerFirstName,
        marketerLastName,
        marketerPhoneNumber: normalizeOptionalIranianMobileNumber(marketerPhoneNumber),
        isActive: true
      }
    });

    res.status(201).json({
      success: true,
      data: projectAddress
    });
  } catch (error) {
    console.error('Add project address error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    Update project address
// @route   PUT /api/crm/customers/:customerId/project-addresses/:projectId
// @access  Private/CRM Workspace
router.put('/customers/:customerId/project-addresses/:projectId', protect, requireAnyFeatureAccess([FEATURES.CRM_PROJECT_ADDRESSES_EDIT, FEATURES.SALES_CUSTOMERS_EDIT], FEATURE_PERMISSIONS.EDIT), [
  body('address').notEmpty().withMessage('Address is required'),
  body('city').notEmpty().withMessage('City is required'),
], async (req: any, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
      return;
    }

    const { customerId, projectId } = req.params;
    const {
      address,
      city,
      postalCode,
      projectName,
      projectType,
      projectManagerName,
      projectManagerNumber,
      marketerFirstName,
      marketerLastName,
      marketerPhoneNumber
    } = req.body;
    const projectManagerPhoneError = validateOptionalIranianMobileNumber(projectManagerNumber);
    const marketerPhoneError = validateOptionalIranianMobileNumber(marketerPhoneNumber);
    if (projectManagerPhoneError || marketerPhoneError) {
      res.status(400).json({
        success: false,
        error: projectManagerPhoneError || marketerPhoneError
      });
      return;
    }

    // Check if customer exists
    const customer = await prisma.crmCustomer.findUnique({
      where: { id: customerId },
      select: { id: true, ownerUserId: true }
    });
    if (!(await ensureOwnershipOrDeny(req, res, customer, 'update_project_address'))) return;

    // Check if project exists
    const existingProject = await prisma.projectAddress.findFirst({
      where: { id: projectId, customerId }
    });

    if (!existingProject) {
      res.status(404).json({
        success: false,
        error: 'Project not found'
      });
      return;
    }

    const projectAddress = await prisma.projectAddress.update({
      where: { id: projectId },
      data: {
        address,
        city,
        postalCode,
        projectName,
        projectType,
        projectManagerName,
        projectManagerNumber: normalizeOptionalIranianMobileNumber(projectManagerNumber),
        marketerFirstName,
        marketerLastName,
        marketerPhoneNumber: normalizeOptionalIranianMobileNumber(marketerPhoneNumber)
      }
    });

    res.json({
      success: true,
      data: projectAddress
    });
  } catch (error) {
    console.error('Update project address error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    Soft delete project address
// @route   DELETE /api/crm/customers/:customerId/project-addresses/:projectId
// @access  Private/CRM or Sales Customer Edit Access
router.delete('/customers/:customerId/project-addresses/:projectId', protect, requireAnyFeatureAccess([FEATURES.CRM_PROJECT_ADDRESSES_DELETE, FEATURES.SALES_CUSTOMERS_EDIT], FEATURE_PERMISSIONS.EDIT), async (req: any, res: Response): Promise<void> => {
  try {
    const { customerId, projectId } = req.params;

    const customer = await prisma.crmCustomer.findUnique({
      where: { id: customerId },
      select: { id: true, ownerUserId: true }
    });
    if (!(await ensureOwnershipOrDeny(req, res, customer, 'delete_project_address'))) return;

    const existingProject = await prisma.projectAddress.findFirst({
      where: { id: projectId, customerId }
    });

    if (!existingProject) {
      res.status(404).json({
        success: false,
        error: 'Project not found'
      });
      return;
    }

    const projectAddress = await prisma.projectAddress.update({
      where: { id: projectId },
      data: { isActive: false }
    });

    res.json({
      success: true,
      data: projectAddress
    });
  } catch (error) {
    console.error('Delete project address error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// ==================== PHONE NUMBERS ====================

// @desc    Add phone number to customer
// @route   POST /api/crm/customers/:customerId/phone-numbers
// @access  Private/CRM Workspace
router.post('/customers/:customerId/phone-numbers', protect, requireAnyFeatureAccess([FEATURES.CRM_PHONE_NUMBERS_CREATE, FEATURES.SALES_CUSTOMERS_EDIT], FEATURE_PERMISSIONS.EDIT), [
  body('number').notEmpty().withMessage('Phone number is required'),
  body('type').notEmpty().withMessage('Phone type is required'),
], async (req: any, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
      return;
    }

    const { customerId } = req.params;
    const { number, type, isPrimary } = req.body;
    const phoneValidationError = validateRequiredIranianMobileNumber(number);
    if (phoneValidationError) {
      res.status(400).json({
        success: false,
        error: phoneValidationError
      });
      return;
    }
    const normalizedNumber = normalizePhoneNumber(number);

    // Check if customer exists
    const customer = await prisma.crmCustomer.findUnique({
      where: { id: customerId },
      select: { id: true, ownerUserId: true }
    });
    if (!(await ensureOwnershipOrDeny(req, res, customer, 'create_phone_number'))) return;

    // If setting as primary, unset other primary numbers
    if (isPrimary) {
      await prisma.phoneNumber.updateMany({
        where: { customerId, isPrimary: true },
        data: { isPrimary: false }
      });
    }

    const phoneNumber = await prisma.phoneNumber.create({
      data: {
        customerId,
        number: normalizedNumber,
        type: normalizePhoneType(type),
        isPrimary: isPrimary || false,
        isActive: true
      }
    });

    res.status(201).json({
      success: true,
      data: phoneNumber
    });
  } catch (error) {
    console.error('Add phone number error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    Update phone number
// @route   PUT /api/crm/customers/:customerId/phone-numbers/:phoneId
// @access  Private/CRM or Sales Customer Edit Access
router.put('/customers/:customerId/phone-numbers/:phoneId', protect, requireAnyFeatureAccess([FEATURES.CRM_PHONE_NUMBERS_EDIT, FEATURES.SALES_CUSTOMERS_EDIT], FEATURE_PERMISSIONS.EDIT), [
  body('number').notEmpty().withMessage('Phone number is required'),
  body('type').notEmpty().withMessage('Phone type is required'),
], async (req: any, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
      return;
    }

    const { customerId, phoneId } = req.params;
    const { number, type, isPrimary } = req.body;
    const phoneValidationError = validateRequiredIranianMobileNumber(number);
    if (phoneValidationError) {
      res.status(400).json({
        success: false,
        error: phoneValidationError
      });
      return;
    }
    const normalizedNumber = normalizePhoneNumber(number);

    const customer = await prisma.crmCustomer.findUnique({
      where: { id: customerId },
      select: { id: true, ownerUserId: true }
    });
    if (!(await ensureOwnershipOrDeny(req, res, customer, 'update_phone_number'))) return;

    const existingPhone = await prisma.phoneNumber.findFirst({
      where: { id: phoneId, customerId }
    });

    if (!existingPhone) {
      res.status(404).json({
        success: false,
        error: 'Phone number not found'
      });
      return;
    }

    if (isPrimary) {
      await prisma.phoneNumber.updateMany({
        where: { customerId, isPrimary: true, NOT: { id: phoneId } },
        data: { isPrimary: false }
      });
    }

    const phoneNumber = await prisma.phoneNumber.update({
      where: { id: phoneId },
      data: {
        number: normalizedNumber,
        type: normalizePhoneType(type),
        isPrimary: Boolean(isPrimary),
        isActive: true
      }
    });

    res.json({
      success: true,
      data: phoneNumber
    });
  } catch (error) {
    console.error('Update phone number error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    Soft delete phone number
// @route   DELETE /api/crm/customers/:customerId/phone-numbers/:phoneId
// @access  Private/CRM or Sales Customer Edit Access
router.delete('/customers/:customerId/phone-numbers/:phoneId', protect, requireAnyFeatureAccess([FEATURES.CRM_PHONE_NUMBERS_DELETE, FEATURES.SALES_CUSTOMERS_EDIT], FEATURE_PERMISSIONS.EDIT), async (req: any, res: Response): Promise<void> => {
  try {
    const { customerId, phoneId } = req.params;

    const customer = await prisma.crmCustomer.findUnique({
      where: { id: customerId },
      select: { id: true, ownerUserId: true }
    });
    if (!(await ensureOwnershipOrDeny(req, res, customer, 'delete_phone_number'))) return;

    const existingPhone = await prisma.phoneNumber.findFirst({
      where: { id: phoneId, customerId }
    });

    if (!existingPhone) {
      res.status(404).json({
        success: false,
        error: 'Phone number not found'
      });
      return;
    }

    const activePhoneCount = await prisma.phoneNumber.count({
      where: { customerId, isActive: true }
    });

    if (existingPhone.isActive && activePhoneCount <= 1) {
      res.status(400).json({
        success: false,
        error: 'At least one active phone number is required'
      });
      return;
    }

    const phoneNumber = await prisma.phoneNumber.update({
      where: { id: phoneId },
      data: {
        isActive: false,
        isPrimary: false
      }
    });

    res.json({
      success: true,
      data: phoneNumber
    });
  } catch (error) {
    console.error('Delete phone number error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// ==================== BLACKLIST/LOCK MANAGEMENT ====================

// @desc    Toggle customer blacklist status
// @route   PUT /api/crm/customers/:id/blacklist
// @access  Private/CRM Workspace (Manager/Admin only)
router.put('/customers/:id/blacklist', protect, requireWorkspaceAccess(WORKSPACES.CRM, WORKSPACE_PERMISSIONS.ADMIN), requireFeatureAccess(FEATURES.CRM_CUSTOMERS_BLACKLIST, FEATURE_PERMISSIONS.EDIT), async (req: any, res: Response): Promise<void> => {
  try {
    const customer = await prisma.crmCustomer.findUnique({
      where: { id: req.params.id },
      select: { id: true, ownerUserId: true, isBlacklisted: true }
    });
    if (!(await ensureOwnershipOrDeny(req, res, customer, 'toggle_blacklist'))) return;

    const updatedCustomer = await prisma.crmCustomer.update({
      where: { id: req.params.id },
      data: {
        isBlacklisted: !customer!.isBlacklisted
      },
      include: {
        primaryContact: true,
        contacts: true,
        projectAddresses: true,
        phoneNumbers: true
      }
    });

    res.json({
      success: true,
      data: updatedCustomer,
      message: `Customer ${updatedCustomer.isBlacklisted ? 'blacklisted' : 'removed from blacklist'} successfully`
    });
  } catch (error) {
    console.error('Toggle blacklist error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    Toggle customer lock status
// @route   PUT /api/crm/customers/:id/lock
// @access  Private/CRM Workspace (Manager/Admin only)
router.put('/customers/:id/lock', protect, requireWorkspaceAccess(WORKSPACES.CRM, WORKSPACE_PERMISSIONS.ADMIN), requireFeatureAccess(FEATURES.CRM_CUSTOMERS_LOCK, FEATURE_PERMISSIONS.EDIT), async (req: any, res: Response): Promise<void> => {
  try {
    const customer = await prisma.crmCustomer.findUnique({
      where: { id: req.params.id },
      select: { id: true, ownerUserId: true, isLocked: true }
    });
    if (!(await ensureOwnershipOrDeny(req, res, customer, 'toggle_lock'))) return;

    const updatedCustomer = await prisma.crmCustomer.update({
      where: { id: req.params.id },
      data: {
        isLocked: !customer!.isLocked
      },
      include: {
        primaryContact: true,
        contacts: true,
        projectAddresses: true,
        phoneNumbers: true
      }
    });

    res.json({
      success: true,
      data: updatedCustomer,
      message: `Customer ${updatedCustomer.isLocked ? 'locked' : 'unlocked'} successfully`
    });
  } catch (error) {
    console.error('Toggle lock error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// ==================== CRM CONTACTS ====================

// @desc    Add contact to customer
// @route   POST /api/crm/customers/:customerId/contacts
// @access  Private/CRM Workspace
router.post('/customers/:customerId/contacts', protect, requireAnyFeatureAccess([FEATURES.CRM_CONTACTS_CREATE, FEATURES.SALES_CUSTOMERS_EDIT], FEATURE_PERMISSIONS.EDIT), [
  body('firstName').notEmpty().withMessage('First name is required'),
  body('lastName').notEmpty().withMessage('Last name is required'),
], async (req: any, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
      return;
    }

    const { customerId } = req.params;
    const { firstName, lastName, position, email, phone, mobile, isPrimary } = req.body;

    // Check if customer exists
    const customer = await prisma.crmCustomer.findUnique({
      where: { id: customerId },
      select: { id: true, ownerUserId: true }
    });
    if (!(await ensureOwnershipOrDeny(req, res, customer, 'create_contact'))) return;

    const contact = await prisma.crmContact.create({
      data: {
        customerId,
        firstName,
        lastName,
        position,
        email,
        phone,
        mobile,
        isPrimary: isPrimary || false
      }
    });

    // If this is set as primary, update customer's primary contact
    if (isPrimary) {
      await prisma.crmContact.updateMany({
        where: { customerId, isPrimary: true, NOT: { id: contact.id } },
        data: { isPrimary: false }
      });
      await prisma.crmCustomer.update({
        where: { id: customerId },
        data: { primaryContactId: contact.id }
      });
    }

    res.status(201).json({
      success: true,
      data: contact
    });
  } catch (error) {
    console.error('Add CRM contact error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    Update CRM contact
// @route   PUT /api/crm/customers/:customerId/contacts/:contactId
// @access  Private/CRM or Sales Customer Edit Access
router.put('/customers/:customerId/contacts/:contactId', protect, requireAnyFeatureAccess([FEATURES.CRM_CONTACTS_EDIT, FEATURES.SALES_CUSTOMERS_EDIT], FEATURE_PERMISSIONS.EDIT), [
  body('firstName').notEmpty().withMessage('First name is required'),
  body('lastName').notEmpty().withMessage('Last name is required'),
], async (req: any, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
      return;
    }

    const { customerId, contactId } = req.params;
    const { firstName, lastName, position, email, phone, mobile, isPrimary } = req.body;

    const customer = await prisma.crmCustomer.findUnique({
      where: { id: customerId },
      select: { id: true, ownerUserId: true }
    });
    if (!(await ensureOwnershipOrDeny(req, res, customer, 'update_contact'))) return;

    const existingContact = await prisma.crmContact.findFirst({
      where: { id: contactId, customerId }
    });

    if (!existingContact) {
      res.status(404).json({
        success: false,
        error: 'Contact not found'
      });
      return;
    }

    if (isPrimary) {
      await prisma.crmContact.updateMany({
        where: { customerId, isPrimary: true, NOT: { id: contactId } },
        data: { isPrimary: false }
      });
    }

    const contact = await prisma.crmContact.update({
      where: { id: contactId },
      data: {
        firstName,
        lastName,
        position,
        email,
        phone,
        mobile,
        isPrimary: Boolean(isPrimary),
        isActive: true
      }
    });

    if (isPrimary) {
      await prisma.crmCustomer.update({
        where: { id: customerId },
        data: { primaryContactId: contact.id }
      });
    } else if (existingContact.isPrimary) {
      await prisma.crmCustomer.update({
        where: { id: customerId },
        data: { primaryContactId: null }
      });
    }

    res.json({
      success: true,
      data: contact
    });
  } catch (error) {
    console.error('Update CRM contact error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    Soft delete CRM contact
// @route   DELETE /api/crm/customers/:customerId/contacts/:contactId
// @access  Private/CRM or Sales Customer Edit Access
router.delete('/customers/:customerId/contacts/:contactId', protect, requireAnyFeatureAccess([FEATURES.CRM_CONTACTS_DELETE, FEATURES.SALES_CUSTOMERS_EDIT], FEATURE_PERMISSIONS.EDIT), async (req: any, res: Response): Promise<void> => {
  try {
    const { customerId, contactId } = req.params;

    const customer = await prisma.crmCustomer.findUnique({
      where: { id: customerId },
      select: { id: true, ownerUserId: true, primaryContactId: true }
    });
    if (!(await ensureOwnershipOrDeny(req, res, customer, 'delete_contact'))) return;

    const existingContact = await prisma.crmContact.findFirst({
      where: { id: contactId, customerId }
    });

    if (!existingContact) {
      res.status(404).json({
        success: false,
        error: 'Contact not found'
      });
      return;
    }

    const contact = await prisma.crmContact.update({
      where: { id: contactId },
      data: {
        isActive: false,
        isPrimary: false
      }
    });

    if (customer?.primaryContactId === contactId) {
      await prisma.crmCustomer.update({
        where: { id: customerId },
        data: { primaryContactId: null }
      });
    }

    res.json({
      success: true,
      data: contact
    });
  } catch (error) {
    console.error('Delete CRM contact error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// ==================== CRM LEADS ====================

// @desc    Get all CRM leads
// @route   GET /api/crm/leads
// @access  Private/CRM Workspace
router.get('/leads', protect, requireWorkspaceAccess(WORKSPACES.CRM, WORKSPACE_PERMISSIONS.VIEW), requireFeatureAccess(FEATURES.CRM_LEADS_VIEW, FEATURE_PERMISSIONS.VIEW), async (req: any, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;
    const status = req.query.status as string;
    const source = req.query.source as string;

    // Build where clause
    let whereClause: any = {};
    
    if (status) whereClause.status = status;
    if (source) whereClause.source = source;

    const leads = await prisma.crmLead.findMany({
      where: whereClause,
      skip,
      take: limit,
      include: {
        customer: {
          select: {
            id: true,
            companyName: true,
            customerType: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    const total = await prisma.crmLead.count({ where: whereClause });

    res.json({
      success: true,
      data: leads,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get CRM leads error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    Create new CRM lead
// @route   POST /api/crm/leads
// @access  Private/CRM Workspace
router.post('/leads', protect, requireWorkspaceAccess(WORKSPACES.CRM, WORKSPACE_PERMISSIONS.EDIT), requireFeatureAccess(FEATURES.CRM_LEADS_CREATE, FEATURE_PERMISSIONS.EDIT), [
  body('companyName').notEmpty().withMessage('Company name is required'),
  body('contactName').notEmpty().withMessage('Contact name is required'),
  body('source').notEmpty().withMessage('Source is required'),
], async (req: any, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
      return;
    }

    const {
      customerId,
      source,
      status,
      score,
      companyName,
      contactName,
      email,
      phone,
      notes,
      assignedTo,
      expectedValue,
      probability
    } = req.body;

    const lead = await prisma.crmLead.create({
      data: {
        customerId,
        source,
        status: status || 'New',
        score: score || 0,
        companyName,
        contactName,
        email,
        phone,
        notes,
        assignedTo,
        expectedValue: expectedValue ? parseFloat(expectedValue) : null,
        probability: probability || 0
      },
      include: {
        customer: {
          select: {
            id: true,
            companyName: true,
            customerType: true
          }
        }
      }
    });

    res.status(201).json({
      success: true,
      data: lead
    });
  } catch (error) {
    console.error('Create CRM lead error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// ==================== CRM POTENTIAL PROJECTS ====================

router.get('/potential-projects', protect, requireWorkspaceAccess(WORKSPACES.CRM, WORKSPACE_PERMISSIONS.VIEW), requireFeatureAccess(FEATURES.CRM_POTENTIAL_PROJECTS_VIEW, FEATURE_PERMISSIONS.VIEW), async (req: any, res: Response): Promise<void> => {
  try {
    const page = Math.max(parseInt(req.query.page as string) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 20, 1), 100);
    const skip = (page - 1) * limit;
    const search = String(req.query.search || '').trim();
    const status = String(req.query.status || '').trim();
    const sellerId = String(req.query.sellerId || '').trim();
    const workType = String(req.query.workType || '').trim();
    const scope = String(req.query.scope || '').trim();
    const canManage = await canManageCrmPipeline(req);

    const where: any = { isActive: true };
    if (status) where.status = status;
    if (workType) where.workType = workType;
    if (sellerId && canManage) where.responsibleSellerId = sellerId;
    if (scope === 'mine' || (!canManage && req.user?.role !== 'ADMIN')) where.responsibleSellerId = req.user.id;
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { address: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { customer: { firstName: { contains: search, mode: 'insensitive' } } },
        { customer: { lastName: { contains: search, mode: 'insensitive' } } },
        { customer: { companyName: { contains: search, mode: 'insensitive' } } }
      ];
    }

    const [projects, total] = await Promise.all([
      prisma.crmPotentialProject.findMany({
        where,
        skip,
        take: limit,
        include: projectInclude,
        orderBy: { updatedAt: 'desc' }
      }),
      prisma.crmPotentialProject.count({ where })
    ]);

    res.json({
      success: true,
      data: projects,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      permissions: { canManage }
    });
  } catch (error) {
    console.error('Get CRM potential projects error:', error);
    res.status(500).json({ success: false, error: 'خطا در دریافت پروژه‌های احتمالی' });
  }
});

router.get('/potential-projects/:id', protect, requireWorkspaceAccess(WORKSPACES.CRM, WORKSPACE_PERMISSIONS.VIEW), requireFeatureAccess(FEATURES.CRM_POTENTIAL_PROJECTS_VIEW, FEATURE_PERMISSIONS.VIEW), async (req: any, res: Response): Promise<void> => {
  try {
    const project = await ensureProjectAccessOrDeny(req, res, req.params.id);
    if (!project) return;

    const [followUps, nextActions, timeline] = await Promise.all([
      prisma.crmFollowUpReport.findMany({
        where: { potentialProjectId: project.id },
        include: followUpInclude,
        orderBy: { happenedAt: 'desc' },
        take: 25
      }),
      prisma.crmNextAction.findMany({
        where: { potentialProjectId: project.id },
        include: nextActionInclude,
        orderBy: [{ status: 'asc' }, { dueAt: 'asc' }],
        take: 25
      }),
      prisma.crmTimelineEvent.findMany({
        where: { potentialProjectId: project.id },
        include: {
          actor: { select: { id: true, firstName: true, lastName: true, username: true } }
        },
        orderBy: { createdAt: 'desc' },
        take: 30
      })
    ]);

    res.json({ success: true, data: { project, followUps, nextActions, timeline } });
  } catch (error) {
    console.error('Get CRM potential project error:', error);
    res.status(500).json({ success: false, error: 'خطا در دریافت جزئیات پروژه احتمالی' });
  }
});

router.post('/potential-projects', protect, requireWorkspaceAccess(WORKSPACES.CRM, WORKSPACE_PERMISSIONS.EDIT), requireFeatureAccess(FEATURES.CRM_POTENTIAL_PROJECTS_CREATE, FEATURE_PERMISSIONS.EDIT), [
  body('customerId').notEmpty().withMessage('انتخاب مخاطب/مشتری الزامی است'),
  body('title').notEmpty().withMessage('عنوان پروژه الزامی است'),
  body('responsibleSellerId').notEmpty().withMessage('فروشنده مسئول الزامی است'),
  body('status').notEmpty().withMessage('وضعیت پروژه الزامی است'),
  body('workType').notEmpty().withMessage('نوع کار/معامله الزامی است')
], async (req: any, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ success: false, error: 'Validation failed', details: errors.array() });
      return;
    }

    const canManage = await canManageCrmPipeline(req);
    const responsibleSellerId = String(req.body.responsibleSellerId);
    if (responsibleSellerId !== req.user.id && req.user.role !== 'ADMIN' && !canManage) {
      res.status(403).json({ success: false, error: 'فقط مدیر CRM می‌تواند پروژه را برای فروشنده دیگری ثبت کند.' });
      return;
    }

    const customer = await prisma.crmCustomer.findUnique({ where: { id: req.body.customerId }, select: { id: true } });
    if (!customer) {
      res.status(404).json({ success: false, error: 'مخاطب/مشتری پیدا نشد.' });
      return;
    }

    const project = await prisma.$transaction(async (tx) => {
      const created = await tx.crmPotentialProject.create({
        data: {
          customerId: req.body.customerId,
          responsibleSellerId,
          createdBy: req.user.id,
          title: String(req.body.title).trim(),
          status: String(req.body.status || 'جدید'),
          workType: String(req.body.workType),
          address: normalizeNullableText(req.body.address),
          estimatedValue: parseOptionalDecimal(req.body.estimatedValue),
          probability: parseOptionalInt(req.body.probability),
          expectedCloseDate: parseOptionalDate(req.body.expectedCloseDate),
          description: normalizeNullableText(req.body.description),
          source: normalizeNullableText(req.body.source)
        },
        include: projectInclude
      });

      await tx.crmTimelineEvent.create({
        data: {
          customerId: created.customerId,
          potentialProjectId: created.id,
          actorId: req.user.id,
          eventType: 'created',
          title: 'ایجاد پروژه احتمالی',
          description: created.title
        }
      });

      return created;
    });

    res.status(201).json({ success: true, data: project });
  } catch (error) {
    console.error('Create CRM potential project error:', error);
    res.status(500).json({ success: false, error: 'خطا در ایجاد پروژه احتمالی' });
  }
});

router.put('/potential-projects/:id', protect, requireWorkspaceAccess(WORKSPACES.CRM, WORKSPACE_PERMISSIONS.EDIT), requireFeatureAccess(FEATURES.CRM_POTENTIAL_PROJECTS_EDIT, FEATURE_PERMISSIONS.EDIT), async (req: any, res: Response): Promise<void> => {
  try {
    const project = await ensureProjectAccessOrDeny(req, res, req.params.id);
    if (!project) return;

    const data: any = {
      title: req.body.title !== undefined ? String(req.body.title).trim() : undefined,
      status: req.body.status !== undefined ? String(req.body.status) : undefined,
      workType: req.body.workType !== undefined ? String(req.body.workType) : undefined,
      address: req.body.address !== undefined ? normalizeNullableText(req.body.address) : undefined,
      estimatedValue: req.body.estimatedValue !== undefined ? parseOptionalDecimal(req.body.estimatedValue) : undefined,
      probability: req.body.probability !== undefined ? parseOptionalInt(req.body.probability) : undefined,
      expectedCloseDate: req.body.expectedCloseDate !== undefined ? parseOptionalDate(req.body.expectedCloseDate) : undefined,
      description: req.body.description !== undefined ? normalizeNullableText(req.body.description) : undefined,
      source: req.body.source !== undefined ? normalizeNullableText(req.body.source) : undefined,
      lostReason: req.body.lostReason !== undefined ? normalizeNullableText(req.body.lostReason) : undefined,
      dormantReason: req.body.dormantReason !== undefined ? normalizeNullableText(req.body.dormantReason) : undefined,
      revisitDate: req.body.revisitDate !== undefined ? parseOptionalDate(req.body.revisitDate) : undefined,
      wonSalesContractId: req.body.wonSalesContractId !== undefined ? normalizeNullableText(req.body.wonSalesContractId) : undefined
    };

    if (data.status === 'از دست رفته' && !data.lostReason && !project.lostReason) {
      res.status(400).json({ success: false, error: 'ثبت دلیل از دست رفتن پروژه الزامی است.' });
      return;
    }
    if (data.status === 'راکد' && !data.dormantReason && !project.dormantReason) {
      res.status(400).json({ success: false, error: 'ثبت دلیل راکد شدن پروژه الزامی است.' });
      return;
    }
    if (data.status === 'برنده شده' && !data.wonSalesContractId && !project.wonSalesContractId) {
      res.status(400).json({ success: false, error: 'پروژه فقط با اتصال به قرارداد فروش می‌تواند برنده شده شود.' });
      return;
    }

    Object.keys(data).forEach((key) => data[key] === undefined && delete data[key]);

    const updated = await prisma.$transaction(async (tx) => {
      const next = await tx.crmPotentialProject.update({
        where: { id: project.id },
        data,
        include: projectInclude
      });

      await tx.crmTimelineEvent.create({
        data: {
          customerId: next.customerId,
          potentialProjectId: next.id,
          actorId: req.user.id,
          eventType: 'updated',
          title: 'به‌روزرسانی پروژه احتمالی',
          description: next.status !== project.status ? `تغییر وضعیت از ${project.status} به ${next.status}` : next.title
        }
      });

      return next;
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    console.error('Update CRM potential project error:', error);
    res.status(500).json({ success: false, error: 'خطا در به‌روزرسانی پروژه احتمالی' });
  }
});

router.put('/potential-projects/:id/reassign', protect, requireWorkspaceAccess(WORKSPACES.CRM, WORKSPACE_PERMISSIONS.EDIT), requireFeatureAccess(FEATURES.CRM_POTENTIAL_PROJECTS_REASSIGN, FEATURE_PERMISSIONS.EDIT), [
  body('responsibleSellerId').notEmpty().withMessage('فروشنده مسئول جدید الزامی است'),
  body('reason').notEmpty().withMessage('دلیل تغییر مسئول الزامی است')
], async (req: any, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ success: false, error: 'Validation failed', details: errors.array() });
      return;
    }

    const project = await ensureProjectAccessOrDeny(req, res, req.params.id);
    if (!project) return;

    const nextSeller = await prisma.user.findUnique({
      where: { id: req.body.responsibleSellerId },
      select: { id: true, firstName: true, lastName: true, username: true, isActive: true }
    });
    if (!nextSeller || !nextSeller.isActive) {
      res.status(404).json({ success: false, error: 'فروشنده جدید پیدا نشد یا غیرفعال است.' });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const next = await tx.crmPotentialProject.update({
        where: { id: project.id },
        data: { responsibleSellerId: nextSeller.id },
        include: projectInclude
      });
      await tx.crmTimelineEvent.create({
        data: {
          customerId: next.customerId,
          potentialProjectId: next.id,
          actorId: req.user.id,
          eventType: 'reassigned',
          title: 'تغییر فروشنده مسئول پروژه احتمالی',
          description: `از ${fullName(project.responsibleSeller)} به ${fullName(nextSeller)} - ${req.body.reason}`,
          metadata: {
            previousSellerId: project.responsibleSellerId,
            nextSellerId: nextSeller.id,
            reason: req.body.reason
          }
        }
      });
      return next;
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    console.error('Reassign CRM potential project error:', error);
    res.status(500).json({ success: false, error: 'خطا در تغییر مسئول پروژه احتمالی' });
  }
});

// ==================== CRM FOLLOW-UPS AND NEXT ACTIONS ====================

router.get('/follow-ups', protect, requireWorkspaceAccess(WORKSPACES.CRM, WORKSPACE_PERMISSIONS.VIEW), requireFeatureAccess(FEATURES.CRM_FOLLOW_UPS_VIEW, FEATURE_PERMISSIONS.VIEW), async (req: any, res: Response): Promise<void> => {
  try {
    const page = Math.max(parseInt(req.query.page as string) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 20, 1), 100);
    const skip = (page - 1) * limit;
    const canManage = await canManageCrmPipeline(req);
    const where: any = {};
    if (req.query.customerId) where.customerId = String(req.query.customerId);
    if (req.query.potentialProjectId) where.potentialProjectId = String(req.query.potentialProjectId);
    if (!canManage && req.user?.role !== 'ADMIN') where.sellerId = req.user.id;

    const [followUps, total] = await Promise.all([
      prisma.crmFollowUpReport.findMany({
        where,
        include: followUpInclude,
        skip,
        take: limit,
        orderBy: { happenedAt: 'desc' }
      }),
      prisma.crmFollowUpReport.count({ where })
    ]);

    res.json({ success: true, data: followUps, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (error) {
    console.error('Get CRM follow-ups error:', error);
    res.status(500).json({ success: false, error: 'خطا در دریافت گزارش‌های پیگیری' });
  }
});

router.post('/follow-ups', protect, requireWorkspaceAccess(WORKSPACES.CRM, WORKSPACE_PERMISSIONS.EDIT), requireFeatureAccess(FEATURES.CRM_FOLLOW_UPS_CREATE, FEATURE_PERMISSIONS.EDIT), [
  body('customerId').notEmpty().withMessage('انتخاب مخاطب/مشتری الزامی است'),
  body('communicationType').notEmpty().withMessage('نوع ارتباط الزامی است'),
  body('workType').notEmpty().withMessage('نوع کار/معامله الزامی است'),
  body('happenedAt').notEmpty().withMessage('زمان پیگیری الزامی است'),
  body('summary').notEmpty().withMessage('خلاصه اتفاقات الزامی است'),
  body('outcome').notEmpty().withMessage('نتیجه پیگیری الزامی است')
], async (req: any, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ success: false, error: 'Validation failed', details: errors.array() });
      return;
    }

    const hasNextAction = req.body.hasNextAction !== false;
    if (hasNextAction && (!req.body.nextAction?.title || !req.body.nextAction?.dueAt || !req.body.nextAction?.communicationType || !req.body.nextAction?.instructions)) {
      res.status(400).json({ success: false, error: 'اقدام بعدی برای پیگیری فعال الزامی است.' });
      return;
    }

    const customer = await prisma.crmCustomer.findUnique({ where: { id: req.body.customerId }, select: { id: true } });
    if (!customer) {
      res.status(404).json({ success: false, error: 'مخاطب/مشتری پیدا نشد.' });
      return;
    }

    let project: any = null;
    if (req.body.potentialProjectId) {
      project = await ensureProjectAccessOrDeny(req, res, String(req.body.potentialProjectId));
      if (!project) return;
      if (project.customerId !== customer.id) {
        res.status(400).json({ success: false, error: 'پروژه احتمالی به مخاطب انتخاب‌شده تعلق ندارد.' });
        return;
      }
    }

    const report = await prisma.$transaction(async (tx) => {
      const created = await tx.crmFollowUpReport.create({
        data: {
          customerId: customer.id,
          potentialProjectId: project?.id || null,
          sellerId: req.user.id,
          communicationType: String(req.body.communicationType),
          workType: String(req.body.workType),
          happenedAt: parseOptionalDate(req.body.happenedAt) || new Date(),
          summary: String(req.body.summary).trim(),
          outcome: String(req.body.outcome).trim(),
          hasNextAction,
          noNextActionReason: hasNextAction ? null : normalizeNullableText(req.body.noNextActionReason)
        },
        include: followUpInclude
      });

      if (hasNextAction) {
        await tx.crmNextAction.create({
          data: {
            customerId: customer.id,
            potentialProjectId: project?.id || null,
            followUpReportId: created.id,
            assignedToId: project?.responsibleSellerId || req.user.id,
            title: String(req.body.nextAction.title).trim(),
            communicationType: String(req.body.nextAction.communicationType),
            workType: normalizeNullableText(req.body.nextAction.workType || req.body.workType),
            dueAt: parseOptionalDate(req.body.nextAction.dueAt) || new Date(),
            instructions: String(req.body.nextAction.instructions).trim()
          }
        });
      }

      await tx.crmTimelineEvent.create({
        data: {
          customerId: customer.id,
          potentialProjectId: project?.id || null,
          actorId: req.user.id,
          eventType: 'follow_up',
          title: 'ثبت گزارش پیگیری',
          description: created.outcome
        }
      });

      return created;
    });

    const fullReport = await prisma.crmFollowUpReport.findUnique({
      where: { id: report.id },
      include: followUpInclude
    });

    res.status(201).json({ success: true, data: fullReport });
  } catch (error) {
    console.error('Create CRM follow-up error:', error);
    res.status(500).json({ success: false, error: 'خطا در ثبت گزارش پیگیری' });
  }
});

router.get('/next-actions', protect, requireWorkspaceAccess(WORKSPACES.CRM, WORKSPACE_PERMISSIONS.VIEW), requireFeatureAccess(FEATURES.CRM_NEXT_ACTIONS_VIEW, FEATURE_PERMISSIONS.VIEW), async (req: any, res: Response): Promise<void> => {
  try {
    const canManage = await canManageCrmPipeline(req);
    const where: any = {};
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.customerId) where.customerId = String(req.query.customerId);
    if (req.query.potentialProjectId) where.potentialProjectId = String(req.query.potentialProjectId);
    if (!canManage && req.user?.role !== 'ADMIN') where.assignedToId = req.user.id;

    const actions = await prisma.crmNextAction.findMany({
      where,
      include: nextActionInclude,
      orderBy: [{ status: 'asc' }, { dueAt: 'asc' }],
      take: 100
    });

    res.json({ success: true, data: actions });
  } catch (error) {
    console.error('Get CRM next actions error:', error);
    res.status(500).json({ success: false, error: 'خطا در دریافت اقدام‌های بعدی' });
  }
});

router.put('/next-actions/:id/complete', protect, requireWorkspaceAccess(WORKSPACES.CRM, WORKSPACE_PERMISSIONS.EDIT), requireFeatureAccess(FEATURES.CRM_NEXT_ACTIONS_EDIT, FEATURE_PERMISSIONS.EDIT), async (req: any, res: Response): Promise<void> => {
  try {
    const action = await prisma.crmNextAction.findUnique({ where: { id: req.params.id }, include: nextActionInclude });
    if (!action) {
      res.status(404).json({ success: false, error: 'اقدام بعدی پیدا نشد.' });
      return;
    }
    if (req.user?.role !== 'ADMIN' && action.assignedToId !== req.user.id && !(await canManageCrmPipeline(req))) {
      res.status(403).json({ success: false, error: 'فقط مسئول اقدام، مدیر CRM یا مدیر سیستم می‌تواند آن را تکمیل کند.' });
      return;
    }

    const updated = await prisma.crmNextAction.update({
      where: { id: action.id },
      data: { status: 'انجام شده', completedAt: new Date(), completedBy: req.user.id },
      include: nextActionInclude
    });

    await prisma.crmTimelineEvent.create({
      data: {
        customerId: action.customerId,
        potentialProjectId: action.potentialProjectId,
        actorId: req.user.id,
        eventType: 'next_action_completed',
        title: 'تکمیل اقدام بعدی',
        description: action.title
      }
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    console.error('Complete CRM next action error:', error);
    res.status(500).json({ success: false, error: 'خطا در تکمیل اقدام بعدی' });
  }
});

// ==================== CRM DASHBOARD ====================

// @desc    Get CRM dashboard statistics
// @route   GET /api/crm/dashboard
// @access  Private/CRM Workspace
router.get('/dashboard', protect, requireWorkspaceAccess(WORKSPACES.CRM, WORKSPACE_PERMISSIONS.VIEW), requireFeatureAccess(FEATURES.CRM_DASHBOARD_VIEW, FEATURE_PERMISSIONS.VIEW), async (req: any, res: Response) => {
  try {
    const canManage = await canManageCrmPipeline(req);
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);
    const projectScope: any = canManage || req.user?.role === 'ADMIN' ? {} : { responsibleSellerId: req.user.id };
    const actionScope: any = canManage || req.user?.role === 'ADMIN' ? {} : { assignedToId: req.user.id };

    const [
      totalCustomers,
      activeCustomers,
      totalProjects,
      overdueActions,
      todayActions,
      upcomingActions,
      recentCustomers,
      recentProjects,
      projectsByStatus,
      projectsBySeller,
      wonProjects,
      lostProjects,
      dormantProjects,
      pipelineValue,
      recentTimeline
    ] = await Promise.all([
      prisma.crmCustomer.count(),
      prisma.crmCustomer.count({ where: { status: 'Active' } }),
      prisma.crmPotentialProject.count({ where: { isActive: true, ...projectScope } }),
      prisma.crmNextAction.findMany({
        where: { status: 'باز', dueAt: { lt: startOfToday }, ...actionScope },
        include: nextActionInclude,
        orderBy: { dueAt: 'asc' },
        take: 20
      }),
      prisma.crmNextAction.findMany({
        where: { status: 'باز', dueAt: { gte: startOfToday, lte: endOfToday }, ...actionScope },
        include: nextActionInclude,
        orderBy: { dueAt: 'asc' },
        take: 20
      }),
      prisma.crmNextAction.findMany({
        where: { status: 'باز', dueAt: { gt: endOfToday }, ...actionScope },
        include: nextActionInclude,
        orderBy: { dueAt: 'asc' },
        take: 20
      }),
      prisma.crmCustomer.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: {
          primaryContact: {
            select: {
              firstName: true,
              lastName: true
            }
          }
        }
      }),
      prisma.crmPotentialProject.findMany({
        where: { isActive: true, ...projectScope },
        take: 5,
        orderBy: { updatedAt: 'desc' },
        include: projectInclude
      }),
      prisma.crmPotentialProject.groupBy({
        by: ['status'],
        where: { isActive: true, ...projectScope },
        _count: { _all: true }
      }),
      prisma.crmPotentialProject.groupBy({
        by: ['responsibleSellerId'],
        where: { isActive: true, ...projectScope },
        _count: { _all: true }
      }),
      prisma.crmPotentialProject.count({ where: { isActive: true, status: 'برنده شده', ...projectScope } }),
      prisma.crmPotentialProject.count({ where: { isActive: true, status: 'از دست رفته', ...projectScope } }),
      prisma.crmPotentialProject.count({ where: { isActive: true, status: 'راکد', ...projectScope } }),
      prisma.crmPotentialProject.aggregate({
        where: { isActive: true, status: { notIn: ['برنده شده', 'از دست رفته'] }, ...projectScope },
        _sum: { estimatedValue: true }
      }),
      prisma.crmTimelineEvent.findMany({
        where: projectScope.responsibleSellerId
          ? { potentialProject: { responsibleSellerId: projectScope.responsibleSellerId } }
          : {},
        include: {
          actor: { select: { id: true, firstName: true, lastName: true, username: true } },
          customer: { select: { id: true, firstName: true, lastName: true, companyName: true } },
          potentialProject: { select: { id: true, title: true, status: true } }
        },
        orderBy: { createdAt: 'desc' },
        take: 10
      })
    ]);

    const sellerIds = projectsBySeller.map((row) => row.responsibleSellerId).filter(Boolean);
    const sellers = sellerIds.length
      ? await prisma.user.findMany({
          where: { id: { in: sellerIds } },
          select: { id: true, firstName: true, lastName: true, username: true }
        })
      : [];
    const sellerMap = new Map(sellers.map((seller) => [seller.id, fullName(seller)]));

    res.json({
      success: true,
      data: {
        permissions: { canManage },
        customers: {
          total: totalCustomers,
          active: activeCustomers
        },
        projects: {
          total: totalProjects,
          byStatus: projectsByStatus.map((row) => ({ status: row.status, count: row._count._all })),
          bySeller: projectsBySeller.map((row) => ({
            sellerId: row.responsibleSellerId,
            sellerName: sellerMap.get(row.responsibleSellerId) || 'نامشخص',
            count: row._count._all
          })),
          won: wonProjects,
          lost: lostProjects,
          dormant: dormantProjects,
          estimatedPipelineValue: pipelineValue._sum.estimatedValue || 0
        },
        nextActions: {
          overdue: overdueActions,
          today: todayActions,
          upcoming: upcomingActions
        },
        recentCustomers,
        recentProjects,
        recentTimeline
      }
    });
  } catch (error) {
    console.error('Get CRM dashboard error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

export default router;
