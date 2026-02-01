import express, { Response } from 'express';
import { body, validationResult } from 'express-validator';
import { PrismaClient } from '@prisma/client';
import { protect } from '../middleware/auth';
import { requireWorkspaceAccess, WORKSPACE_PERMISSIONS, WORKSPACES } from '../middleware/workspace';
import { requireFeatureAccess, FEATURE_PERMISSIONS, FEATURES } from '../middleware/feature';

const router = express.Router();
const prisma = new PrismaClient();

// ==================== CRM CUSTOMERS ====================

// @desc    Get all CRM customers
// @route   GET /api/crm/customers
// @access  Private/CRM Feature Access
router.get('/customers', protect, requireFeatureAccess(FEATURES.CRM_CUSTOMERS_VIEW, FEATURE_PERMISSIONS.VIEW), async (req: any, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;
    const search = req.query.search as string;
    const status = req.query.status as string;
    const customerType = req.query.customerType as string;

    // Build where clause
    let whereClause: any = {};
    
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
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            position: true,
            isPrimary: true
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
            projectManagerNumber: true
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
// @access  Private/CRM Workspace
router.get('/customers/:id', protect, requireWorkspaceAccess(WORKSPACES.CRM, WORKSPACE_PERMISSIONS.VIEW), async (req: any, res: Response): Promise<void> => {
  try {
    const customer = await prisma.crmCustomer.findUnique({
      where: { id: req.params.id },
      include: {
        primaryContact: true,
        contacts: true,
        projectAddresses: {
          where: { isActive: true },
          select: {
            id: true,
            address: true,
            city: true,
            projectName: true,
            projectType: true,
            projectManagerName: true,
            projectManagerNumber: true
          }
        },
        phoneNumbers: true,
        leads: {
          orderBy: { createdAt: 'desc' }
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
router.post('/customers', protect, requireFeatureAccess(FEATURES.CRM_CUSTOMERS_CREATE, FEATURE_PERMISSIONS.EDIT), [
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
    console.log('Received customer data:', JSON.stringify(req.body, null, 2));
    
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.log('Validation errors:', errors.array());
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

    // Create customer with all related data
    console.log('Creating customer with data:', {
      firstName,
      lastName,
      companyName,
      customerType,
      industry,
      status,
      nationalCode,
      homeAddress,
      homeNumber,
      workAddress,
      workNumber,
      projectManagerName,
      projectManagerNumber,
      brandName,
      brandNameDescription,
      isBlacklisted,
      isLocked,
      projectAddresses: projectAddresses?.length || 0,
      phoneNumbers: phoneNumbers?.length || 0
    });
    
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
        nationalCode,
        homeAddress,
        homeNumber,
        workAddress,
        workNumber,
        
        // Project Management
        projectManagerName,
        projectManagerNumber,
        
        // Brand Information
        brandName,
        brandNameDescription,
        
        // Security & Access Control
        isBlacklisted: isBlacklisted || false,
        isLocked: isLocked || false,
        
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
            projectManagerNumber: addr.projectManagerNumber || null,
            isActive: true
          }))
        } : undefined,
        
        phoneNumbers: phoneNumbers && phoneNumbers.length > 0 ? {
          create: phoneNumbers.map((phone: any) => ({
            number: phone.number,
            type: phone.type,
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
        phoneNumbers: true
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
router.put('/customers/:id', protect, requireWorkspaceAccess(WORKSPACES.CRM, WORKSPACE_PERMISSIONS.EDIT), [
  body('companyName').optional().notEmpty().withMessage('Company name cannot be empty'),
  body('customerType').optional().notEmpty().withMessage('Customer type cannot be empty'),
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
      where: { id: req.params.id }
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
      data: req.body,
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

// ==================== PROJECT ADDRESSES ====================

// @desc    Add project address to customer
// @route   POST /api/crm/customers/:customerId/project-addresses
// @access  Private/CRM Workspace
router.post('/customers/:customerId/project-addresses', protect, requireWorkspaceAccess(WORKSPACES.CRM, WORKSPACE_PERMISSIONS.EDIT), [
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
    const { address, city, postalCode, projectName, projectType, projectManagerName, projectManagerNumber } = req.body;

    // Check if customer exists
    const customer = await prisma.crmCustomer.findUnique({
      where: { id: customerId }
    });

    if (!customer) {
      res.status(404).json({
        success: false,
        error: 'Customer not found'
      });
      return;
    }

    const projectAddress = await prisma.projectAddress.create({
      data: {
        customerId,
        address,
        city,
        postalCode,
        projectName,
        projectType,
        projectManagerName,
        projectManagerNumber,
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
router.put('/customers/:customerId/project-addresses/:projectId', protect, requireWorkspaceAccess(WORKSPACES.CRM, WORKSPACE_PERMISSIONS.EDIT), [
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
    const { address, city, postalCode, projectName, projectType, projectManagerName, projectManagerNumber } = req.body;

    // Check if customer exists
    const customer = await prisma.crmCustomer.findUnique({
      where: { id: customerId }
    });

    if (!customer) {
      res.status(404).json({
        success: false,
        error: 'Customer not found'
      });
      return;
    }

    // Check if project exists
    const existingProject = await prisma.projectAddress.findUnique({
      where: { id: projectId }
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
        projectManagerNumber
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

// ==================== PHONE NUMBERS ====================

// @desc    Add phone number to customer
// @route   POST /api/crm/customers/:customerId/phone-numbers
// @access  Private/CRM Workspace
router.post('/customers/:customerId/phone-numbers', protect, requireWorkspaceAccess(WORKSPACES.CRM, WORKSPACE_PERMISSIONS.EDIT), [
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

    // Check if customer exists
    const customer = await prisma.crmCustomer.findUnique({
      where: { id: customerId }
    });

    if (!customer) {
      res.status(404).json({
        success: false,
        error: 'Customer not found'
      });
      return;
    }

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
        number,
        type,
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

// ==================== BLACKLIST/LOCK MANAGEMENT ====================

// @desc    Toggle customer blacklist status
// @route   PUT /api/crm/customers/:id/blacklist
// @access  Private/CRM Workspace (Manager/Admin only)
router.put('/customers/:id/blacklist', protect, requireWorkspaceAccess(WORKSPACES.CRM, WORKSPACE_PERMISSIONS.ADMIN), async (req: any, res: Response): Promise<void> => {
  try {
    const customer = await prisma.crmCustomer.findUnique({
      where: { id: req.params.id }
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
        isBlacklisted: !customer.isBlacklisted
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
router.put('/customers/:id/lock', protect, requireWorkspaceAccess(WORKSPACES.CRM, WORKSPACE_PERMISSIONS.ADMIN), async (req: any, res: Response): Promise<void> => {
  try {
    const customer = await prisma.crmCustomer.findUnique({
      where: { id: req.params.id }
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
        isLocked: !customer.isLocked
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
router.post('/customers/:customerId/contacts', protect, requireWorkspaceAccess(WORKSPACES.CRM, WORKSPACE_PERMISSIONS.EDIT), [
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
      where: { id: customerId }
    });

    if (!customer) {
      res.status(404).json({
        success: false,
        error: 'Customer not found'
      });
      return;
    }

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

// ==================== CRM LEADS ====================

// @desc    Get all CRM leads
// @route   GET /api/crm/leads
// @access  Private/CRM Workspace
router.get('/leads', protect, requireWorkspaceAccess(WORKSPACES.CRM, WORKSPACE_PERMISSIONS.VIEW), async (req: any, res: Response) => {
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
router.post('/leads', protect, requireWorkspaceAccess(WORKSPACES.CRM, WORKSPACE_PERMISSIONS.EDIT), [
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

// ==================== CRM DASHBOARD ====================

// @desc    Get CRM dashboard statistics
// @route   GET /api/crm/dashboard
// @access  Private/CRM Workspace
router.get('/dashboard', protect, requireWorkspaceAccess(WORKSPACES.CRM, WORKSPACE_PERMISSIONS.VIEW), async (req: any, res: Response) => {
  try {
    const [
      totalCustomers,
      activeCustomers,
      totalLeads,
      newLeads,
      recentCustomers,
      recentLeads
    ] = await Promise.all([
      prisma.crmCustomer.count(),
      prisma.crmCustomer.count({ where: { status: 'Active' } }),
      prisma.crmLead.count(),
      prisma.crmLead.count({ where: { status: 'New' } }),
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
      prisma.crmLead.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' }
      })
    ]);

    res.json({
      success: true,
      data: {
        totalCustomers,
        activeCustomers,
        totalLeads,
        newLeads,
        recentCustomers,
        recentLeads
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
