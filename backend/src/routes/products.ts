import express, { Response } from 'express';
import { body, query, validationResult } from 'express-validator';
import { PrismaClient } from '@prisma/client';
import { protect } from '../middleware/auth';
import { requireWorkspaceAccess, WORKSPACE_PERMISSIONS, WORKSPACES } from '../middleware/workspace';
import { requireFeatureAccess, FEATURES, FEATURE_PERMISSIONS } from '../middleware/feature';
import multer from 'multer';
import XLSX from 'xlsx';
import path from 'path';

const router = express.Router();
const prisma = new PrismaClient();

// Log all requests to products router
router.use((req: any, res: any, next: any) => {
  console.log('🔍 Products router request:', {
    method: req.method,
    url: req.originalUrl,
    path: req.path,
    headers: req.headers.authorization ? 'Has auth header' : 'No auth header'
  });
  next();
});

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'products-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.xlsx', '.xls'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files (.xlsx, .xls) are allowed'));
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// ==================== PRODUCT CATALOG ====================

// @desc    Get all products with filtering and search
// @route   GET /api/products
// @access  Private/Sales Workspace
router.get('/', protect, requireWorkspaceAccess(WORKSPACES.SALES, WORKSPACE_PERMISSIONS.VIEW), [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 1000 }).withMessage('Limit must be between 1 and 1000'),
  query('search').optional().isString().withMessage('Search must be a string'),
  query('stoneType').optional().isInt().withMessage('Stone type must be an integer'),
  query('color').optional().isInt().withMessage('Color must be an integer'),
  query('finish').optional().isInt().withMessage('Finish must be an integer'),
  query('mine').optional().isString().withMessage('Mine must be a string'),
  query('quality').optional().isInt().withMessage('Quality must be an integer'),
  query('isAvailable').optional().isBoolean().withMessage('isAvailable must be a boolean'),
  query('isActive').optional().isBoolean().withMessage('isActive must be a boolean'),
  query('includeDeleted').optional().isBoolean().withMessage('includeDeleted must be a boolean'),
  query('contractType').optional().isIn(['longitudinal', 'stair', 'slab', 'volumetric']).withMessage('contractType must be one of longitudinal, stair, slab, volumetric'),
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

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    // Build where clause for filtering
    let whereClause: any = {
      deletedAt: null  // Only show non-deleted products by default
    };
    
    // Only filter by isActive if explicitly requested
    if (req.query.isActive !== undefined) {
      whereClause.isActive = req.query.isActive === 'true';
    }
    
    // Show deleted products if explicitly requested (for admin users)
    if (req.query.includeDeleted === 'true') {
      delete whereClause.deletedAt;
    }

    // Search functionality
    if (req.query.search) {
      const searchTerm = req.query.search as string;
      whereClause.OR = [
        { code: { contains: searchTerm, mode: 'insensitive' } },
        { name: { contains: searchTerm, mode: 'insensitive' } },
        { namePersian: { contains: searchTerm, mode: 'insensitive' } },
        { stoneTypeName: { contains: searchTerm, mode: 'insensitive' } },
        { stoneTypeNamePersian: { contains: searchTerm, mode: 'insensitive' } },
        { colorName: { contains: searchTerm, mode: 'insensitive' } },
        { colorNamePersian: { contains: searchTerm, mode: 'insensitive' } },
        { mineName: { contains: searchTerm, mode: 'insensitive' } },
        { mineNamePersian: { contains: searchTerm, mode: 'insensitive' } }
      ];
    }

    // Filter by attributes
    if (req.query.stoneType) {
      const stoneTypeValue = req.query.stoneType as string;
      // Check if it's a code (numeric) or name (text)
      if (/^\d+$/.test(stoneTypeValue)) {
        whereClause.stoneTypeCode = stoneTypeValue;
      } else {
        whereClause.stoneTypeNamePersian = { contains: stoneTypeValue, mode: 'insensitive' };
      }
    }
    if (req.query.color) {
      const colorValue = req.query.color as string;
      if (/^\d+$/.test(colorValue)) {
        whereClause.colorCode = colorValue;
      } else {
        whereClause.colorNamePersian = { contains: colorValue, mode: 'insensitive' };
      }
    }
    if (req.query.finish) {
      const finishValue = req.query.finish as string;
      if (/^\d+$/.test(finishValue)) {
        whereClause.finishCode = finishValue;
      } else {
        whereClause.finishNamePersian = { contains: finishValue, mode: 'insensitive' };
      }
    }
    if (req.query.mine) {
      const mineValue = req.query.mine as string;
      if (/^\d+$/.test(mineValue)) {
        whereClause.mineCode = mineValue;
      } else {
        whereClause.mineNamePersian = { contains: mineValue, mode: 'insensitive' };
      }
    }
    if (req.query.quality) {
      whereClause.qualityCode = parseInt(req.query.quality as string);
    }
    if (req.query.isAvailable !== undefined) {
      whereClause.isAvailable = req.query.isAvailable === 'true';
    }
    if (req.query.contractType) {
      const contractTypeFieldMap: Record<string, string> = {
        longitudinal: 'availableInLongitudinalContracts',
        stair: 'availableInStairContracts',
        slab: 'availableInSlabContracts',
        volumetric: 'availableInVolumetricContracts'
      };
      const fieldName = contractTypeFieldMap[req.query.contractType as string];
      if (fieldName) {
        whereClause[fieldName] = true;
      }
    }

    console.log('Products query whereClause:', whereClause);
    
    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where: whereClause,
        skip,
        take: limit,
        orderBy: [
          { createdAt: 'desc' }
        ]
      }),
      prisma.product.count({ where: whereClause })
    ]);

    console.log('Products found:', products.length, 'Total:', total);
    console.log('Sample product isActive values:', products.slice(0, 3).map(p => ({ id: p.id, name: p.namePersian, isActive: p.isActive })));

    return res.json({
      success: true,
      data: products,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get products error:', error);
    return res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    Generate Excel template for product import
// @route   GET /api/products/template
// @access  Private/Sales Products Import
router.get('/template', async (req: any, res: Response) => {
  console.log('📄 Template route called:', req.originalUrl);
  console.log('📄 Request headers:', req.headers);
  console.log('📄 Request method:', req.method);
  try {
    console.log('📄 Starting template generation...');
    // Get all active master data for dropdowns
    const [
      cutTypes,
      stoneMaterials,
      cutWidths,
      thicknesses,
      mines,
      finishTypes,
      colors
    ] = await Promise.all([
      prisma.cutType.findMany({ where: { isActive: true }, orderBy: { namePersian: 'asc' } }),
      prisma.stoneMaterial.findMany({ where: { isActive: true }, orderBy: { namePersian: 'asc' } }),
      prisma.cutWidth.findMany({ where: { isActive: true }, orderBy: { value: 'asc' } }),
      prisma.thickness.findMany({ where: { isActive: true }, orderBy: { value: 'asc' } }),
      prisma.mine.findMany({ where: { isActive: true }, orderBy: { namePersian: 'asc' } }),
      prisma.finishType.findMany({ where: { isActive: true }, orderBy: { namePersian: 'asc' } }),
      prisma.color.findMany({ where: { isActive: true }, orderBy: { namePersian: 'asc' } })
    ]);
    
    console.log('📄 Master data fetched:', {
      cutTypes: cutTypes.length,
      stoneMaterials: stoneMaterials.length,
      cutWidths: cutWidths.length,
      thicknesses: thicknesses.length,
      mines: mines.length,
      finishTypes: finishTypes.length,
      colors: colors.length
    });

    // Create workbook
    const workbook = XLSX.utils.book_new();

    // Create main data sheet
    const headers = [
      'کد محصول',
      'نام محصول (انگلیسی)',
      'نام محصول (فارسی)',
      'کد نوع برش',
      'نام نوع برش',
      'نام نوع برش (فارسی)',
      'کد جنس سنگ',
      'نام جنس سنگ',
      'نام جنس سنگ (فارسی)',
      'کد عرض',
      'مقدار عرض',
      'نام عرض',
      'کد ضخامت',
      'مقدار ضخامت',
      'نام ضخامت',
      'کد معدن',
      'نام معدن',
      'نام معدن (فارسی)',
      'کد نوع پرداخت',
      'نام نوع پرداخت',
      'نام نوع پرداخت (فارسی)',
      'کد رنگ',
      'نام رنگ',
      'نام رنگ (فارسی)',
      'کد کیفیت',
      'نام کیفیت',
      'نام کیفیت (فارسی)',
      'قیمت پایه',
      'ارز',
      'موجود',
      'زمان تحویل',
      'توضیحات',
      'فعال'
    ];

    // Add sample data
    const sampleData = [
      [
        'CT001-SM001-CW001-TH001-MN001-FT001-CL001',
        'Travertine 10cm x 2cm - Abbas Abad - Polished',
        'تراورتن 10 سانتی‌متر × 2 سانتی‌متر - عباس آباد - صیقلی',
        cutTypes[0]?.code || 'CT001',
        cutTypes[0]?.name || 'Longitudinal',
        cutTypes[0]?.namePersian || 'طولی',
        stoneMaterials[0]?.code || 'SM001',
        stoneMaterials[0]?.name || 'Travertine',
        stoneMaterials[0]?.namePersian || 'تراورتن',
        cutWidths[0]?.code || 'CW001',
        cutWidths[0]?.value || 10,
        cutWidths[0]?.namePersian || 'عرض 10',
        thicknesses[0]?.code || 'TH001',
        thicknesses[0]?.value || 2,
        thicknesses[0]?.namePersian || 'ضخامت 2',
        mines[0]?.code || 'MN001',
        mines[0]?.name || 'Abbas Abad',
        mines[0]?.namePersian || 'عباس آباد',
        finishTypes[0]?.code || 'FT001',
        finishTypes[0]?.name || 'Polished',
        finishTypes[0]?.namePersian || 'صیقلی',
        colors[0]?.code || 'CL001',
        colors[0]?.name || 'White',
        colors[0]?.namePersian || 'سفید',
        'QUALITY-001',
        'Standard',
        'استاندارد',
        500000,
        'ریال',
        true,
        7,
        'محصول نمونه',
        true
      ]
    ];

    const worksheetData = [headers, ...sampleData];
    const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);

    // Set column widths
    const colWidths = [
      { wch: 25 }, // کد محصول
      { wch: 40 }, // نام محصول (انگلیسی)
      { wch: 40 }, // نام محصول (فارسی)
      { wch: 15 }, // کد نوع برش
      { wch: 20 }, // نام نوع برش
      { wch: 20 }, // نام نوع برش (فارسی)
      { wch: 15 }, // کد جنس سنگ
      { wch: 20 }, // نام جنس سنگ
      { wch: 20 }, // نام جنس سنگ (فارسی)
      { wch: 15 }, // کد عرض
      { wch: 12 }, // مقدار عرض
      { wch: 15 }, // نام عرض
      { wch: 15 }, // کد ضخامت
      { wch: 12 }, // مقدار ضخامت
      { wch: 15 }, // نام ضخامت
      { wch: 15 }, // کد معدن
      { wch: 20 }, // نام معدن
      { wch: 20 }, // نام معدن (فارسی)
      { wch: 15 }, // کد نوع پرداخت
      { wch: 20 }, // نام نوع پرداخت
      { wch: 20 }, // نام نوع پرداخت (فارسی)
      { wch: 15 }, // کد رنگ
      { wch: 15 }, // نام رنگ
      { wch: 15 }, // نام رنگ (فارسی)
      { wch: 15 }, // کد کیفیت
      { wch: 15 }, // نام کیفیت
      { wch: 15 }, // نام کیفیت (فارسی)
      { wch: 15 }, // قیمت پایه
      { wch: 10 }, // ارز
      { wch: 10 }, // موجود
      { wch: 12 }, // زمان تحویل
      { wch: 30 }, // توضیحات
      { wch: 10 }  // فعال
    ];

    worksheet['!cols'] = colWidths;

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, 'محصولات');

    // Create master data reference sheet
    const masterDataSheet = XLSX.utils.aoa_to_sheet([
      ['نوع برش', 'کد', 'نام فارسی', 'نام انگلیسی'],
      ...cutTypes.map(item => [item.namePersian, item.code, item.namePersian, item.name || '']),
      ['', '', '', ''],
      ['جنس سنگ', 'کد', 'نام فارسی', 'نام انگلیسی'],
      ...stoneMaterials.map(item => [item.namePersian, item.code, item.namePersian, item.name || '']),
      ['', '', '', ''],
      ['عرض', 'کد', 'مقدار', 'واحد'],
      ...cutWidths.map(item => [item.namePersian, item.code, item.value, item.unit]),
      ['', '', '', ''],
      ['ضخامت', 'کد', 'مقدار', 'واحد'],
      ...thicknesses.map(item => [item.namePersian, item.code, item.value, item.unit]),
      ['', '', '', ''],
      ['معدن', 'کد', 'نام فارسی', 'نام انگلیسی'],
      ...mines.map(item => [item.namePersian, item.code, item.namePersian, item.name || '']),
      ['', '', '', ''],
      ['نوع پرداخت', 'کد', 'نام فارسی', 'نام انگلیسی'],
      ...finishTypes.map(item => [item.namePersian, item.code, item.namePersian, item.name || '']),
      ['', '', '', ''],
      ['رنگ', 'کد', 'نام فارسی', 'نام انگلیسی'],
      ...colors.map(item => [item.namePersian, item.code, item.namePersian, item.name || ''])
    ]);

    XLSX.utils.book_append_sheet(workbook, masterDataSheet, 'مرجع داده‌ها');

    // Generate Excel file buffer
    console.log('📄 Generating Excel buffer...');
    const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    console.log('📄 Excel buffer generated, size:', excelBuffer.length);

    // Set response headers
    console.log('📄 Setting response headers...');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="product-import-template.xlsx"');
    res.setHeader('Content-Length', excelBuffer.length);

    console.log('📄 Sending Excel file...');
    return res.send(excelBuffer);
    console.log('📄 Excel file sent successfully');

  } catch (error) {
    console.error('Template generation error:', error);
    return res.status(500).json({
      success: false,
      error: 'خطا در تولید قالب Excel'
    });
  }
});

// @desc    Get product by ID
// @route   GET /api/products/:id
// @access  Private/Sales Workspace
router.get('/:id', protect, requireWorkspaceAccess(WORKSPACES.SALES, WORKSPACE_PERMISSIONS.VIEW), async (req: any, res: Response) => {
  try {
    const product = await prisma.product.findUnique({
      where: { id: req.params.id }
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        error: 'Product not found'
      });
    }

    return res.json({
      success: true,
      data: product
    });
  } catch (error) {
    console.error('Get product error:', error);
    return res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    Get product by code
// @route   GET /api/products/code/:code
// @access  Private/Sales Workspace
router.get('/code/:code', protect, requireWorkspaceAccess(WORKSPACES.SALES, WORKSPACE_PERMISSIONS.VIEW), async (req: any, res: Response) => {
  try {
    const product = await prisma.product.findUnique({
      where: { code: req.params.code }
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        error: 'Product not found'
      });
    }

    return res.json({
      success: true,
      data: product
    });
  } catch (error) {
    console.error('Get product by code error:', error);
    return res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    Create new product
// @route   POST /api/products
// @access  Private/Sales Workspace
router.post('/', protect, requireWorkspaceAccess(WORKSPACES.SALES, WORKSPACE_PERMISSIONS.EDIT), [
  body('code').notEmpty().withMessage('Product code is required'),
  body('name').notEmpty().withMessage('Product name is required'),
  body('namePersian').notEmpty().withMessage('Product Persian name is required'),
  body('cuttingDimensionCode').notEmpty().withMessage('Cutting dimension code is required'),
  body('cuttingDimensionName').notEmpty().withMessage('Cutting dimension name is required'),
  body('cuttingDimensionNamePersian').notEmpty().withMessage('Cutting dimension Persian name is required'),
  body('stoneTypeCode').notEmpty().withMessage('Stone type code is required'),
  body('stoneTypeName').notEmpty().withMessage('Stone type name is required'),
  body('stoneTypeNamePersian').notEmpty().withMessage('Stone type Persian name is required'),
  body('widthCode').notEmpty().withMessage('Width code is required'),
  body('widthValue').isNumeric().withMessage('Width value must be a number'),
  body('widthName').notEmpty().withMessage('Width name is required'),
  body('thicknessCode').notEmpty().withMessage('Thickness code is required'),
  body('thicknessValue').isNumeric().withMessage('Thickness value must be a number'),
  body('thicknessName').notEmpty().withMessage('Thickness name is required'),
  body('mineCode').notEmpty().withMessage('Mine code is required'),
  body('mineName').notEmpty().withMessage('Mine name is required'),
  body('mineNamePersian').notEmpty().withMessage('Mine Persian name is required'),
  body('finishCode').notEmpty().withMessage('Finish code is required'),
  body('finishName').notEmpty().withMessage('Finish name is required'),
  body('finishNamePersian').notEmpty().withMessage('Finish Persian name is required'),
  body('colorCode').notEmpty().withMessage('Color code is required'),
  body('colorName').notEmpty().withMessage('Color name is required'),
  body('colorNamePersian').notEmpty().withMessage('Color Persian name is required'),
  body('qualityCode').notEmpty().withMessage('Quality code is required'),
  body('qualityName').notEmpty().withMessage('Quality name is required'),
  body('qualityNamePersian').notEmpty().withMessage('Quality Persian name is required'),
  body('basePrice').optional({ nullable: true }).isNumeric().withMessage('Base price must be a number'),
  body('currency').optional().isString().withMessage('Currency must be a string'),
  body('isAvailable').optional().isBoolean().withMessage('isAvailable must be a boolean'),
  body('leadTime').optional({ nullable: true }).isInt({ min: 0 }).withMessage('Lead time must be a non-negative integer'),
  body('description').optional().isString().withMessage('Description must be a string'),
  body('images').optional().isArray().withMessage('Images must be an array'),
  body('isActive').optional().isBoolean().withMessage('isActive must be a boolean'),
  body('availableInLongitudinalContracts').optional().isBoolean().withMessage('availableInLongitudinalContracts must be a boolean').toBoolean(),
  body('availableInStairContracts').optional().isBoolean().withMessage('availableInStairContracts must be a boolean').toBoolean(),
  body('availableInSlabContracts').optional().isBoolean().withMessage('availableInSlabContracts must be a boolean').toBoolean(),
  body('availableInVolumetricContracts').optional().isBoolean().withMessage('availableInVolumetricContracts must be a boolean').toBoolean(),
], async (req: any, res: Response) => {
  try {
    console.log('Received product data:', JSON.stringify(req.body, null, 2));
    
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.log('Validation errors:', errors.array());
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    // Check if product code already exists
    const existingProduct = await prisma.product.findUnique({
      where: { code: req.body.code }
    });

    if (existingProduct) {
      return res.status(400).json({
        success: false,
        error: 'Product with this code already exists'
      });
    }

    const product = await prisma.product.create({
      data: {
        code: req.body.code,
        name: req.body.name,
        namePersian: req.body.namePersian,
        cuttingDimensionCode: req.body.cuttingDimensionCode,
        cuttingDimensionName: req.body.cuttingDimensionName,
        cuttingDimensionNamePersian: req.body.cuttingDimensionNamePersian,
        stoneTypeCode: req.body.stoneTypeCode,
        stoneTypeName: req.body.stoneTypeName,
        stoneTypeNamePersian: req.body.stoneTypeNamePersian,
        widthCode: req.body.widthCode,
        widthValue: parseFloat(req.body.widthValue),
        widthName: req.body.widthName,
        thicknessCode: req.body.thicknessCode,
        thicknessValue: parseFloat(req.body.thicknessValue),
        thicknessName: req.body.thicknessName,
        mineCode: req.body.mineCode,
        mineName: req.body.mineName,
        mineNamePersian: req.body.mineNamePersian,
        finishCode: req.body.finishCode,
        finishName: req.body.finishName,
        finishNamePersian: req.body.finishNamePersian,
        colorCode: req.body.colorCode,
        colorName: req.body.colorName,
        colorNamePersian: req.body.colorNamePersian,
        qualityCode: req.body.qualityCode,
        qualityName: req.body.qualityName,
        qualityNamePersian: req.body.qualityNamePersian,
        basePrice: req.body.basePrice ? parseFloat(req.body.basePrice) : null,
        currency: req.body.currency || 'ریال',
        isAvailable: req.body.isAvailable !== undefined ? req.body.isAvailable : true,
        leadTime: req.body.leadTime ? parseInt(req.body.leadTime) : null,
        description: req.body.description || null,
        images: req.body.images || [],
        isActive: req.body.isActive !== undefined ? req.body.isActive : true,
        availableInLongitudinalContracts: req.body.availableInLongitudinalContracts !== undefined ? req.body.availableInLongitudinalContracts : true,
        availableInStairContracts: req.body.availableInStairContracts !== undefined ? req.body.availableInStairContracts : true,
        availableInSlabContracts: req.body.availableInSlabContracts !== undefined ? req.body.availableInSlabContracts : true,
        availableInVolumetricContracts: req.body.availableInVolumetricContracts !== undefined ? req.body.availableInVolumetricContracts : true,
      }
    });

    return res.status(201).json({
      success: true,
      data: product
    });
  } catch (error) {
    console.error('Create product error:', error);
    return res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    Update product (Edit permission required)
// @route   PUT /api/products/:id
// @access  Private/Sales Workspace Edit
router.put('/:id', protect, requireWorkspaceAccess(WORKSPACES.SALES, WORKSPACE_PERMISSIONS.EDIT), [
  body('basePrice').optional().isNumeric().withMessage('Base price must be a number'),
  body('isAvailable').optional().isBoolean().withMessage('isAvailable must be a boolean'),
  body('isActive').optional().isBoolean().withMessage('isActive must be a boolean'),
  body('leadTime').optional().isInt({ min: 0 }).withMessage('Lead time must be a non-negative integer'),
  body('description').optional().isString().withMessage('Description must be a string'),
  body('images').optional().isArray().withMessage('Images must be an array'),
  body('availableInLongitudinalContracts').optional().isBoolean().withMessage('availableInLongitudinalContracts must be a boolean').toBoolean(),
  body('availableInStairContracts').optional().isBoolean().withMessage('availableInStairContracts must be a boolean').toBoolean(),
  body('availableInSlabContracts').optional().isBoolean().withMessage('availableInSlabContracts must be a boolean').toBoolean(),
  body('availableInVolumetricContracts').optional().isBoolean().withMessage('availableInVolumetricContracts must be a boolean').toBoolean(),
], async (req: any, res: Response) => {
  try {
    console.log('Product update request:', {
      id: req.params.id,
      body: req.body,
      user: req.user?.id,
      userRole: req.user?.role
    });
    
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.log('Validation errors:', errors.array());
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const product = await prisma.product.findUnique({
      where: { id: req.params.id }
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        error: 'Product not found'
      });
    }

    const updateData = {
      basePrice: req.body.basePrice ? parseFloat(req.body.basePrice) : product.basePrice,
      isAvailable: req.body.isAvailable !== undefined ? req.body.isAvailable : product.isAvailable,
      isActive: req.body.isActive !== undefined ? req.body.isActive : product.isActive,
      leadTime: req.body.leadTime !== undefined ? parseInt(req.body.leadTime) : product.leadTime,
      description: req.body.description !== undefined ? req.body.description : product.description,
      images: req.body.images !== undefined ? req.body.images : product.images,
      availableInLongitudinalContracts: req.body.availableInLongitudinalContracts !== undefined ? req.body.availableInLongitudinalContracts : product.availableInLongitudinalContracts,
      availableInStairContracts: req.body.availableInStairContracts !== undefined ? req.body.availableInStairContracts : product.availableInStairContracts,
      availableInSlabContracts: req.body.availableInSlabContracts !== undefined ? req.body.availableInSlabContracts : product.availableInSlabContracts,
      availableInVolumetricContracts: req.body.availableInVolumetricContracts !== undefined ? req.body.availableInVolumetricContracts : product.availableInVolumetricContracts,
    };
    
    console.log('Updating product with data:', updateData);
    
    const updatedProduct = await prisma.product.update({
      where: { id: req.params.id },
      data: updateData
    });
    
    console.log('Product updated successfully:', updatedProduct);

    return res.json({
      success: true,
      data: updatedProduct
    });
  } catch (error) {
    console.error('Update product error:', error);
    return res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    Get product attributes for filtering
// @route   GET /api/products/attributes
// @access  Private/Sales Workspace
router.get('/attributes', protect, requireWorkspaceAccess(WORKSPACES.SALES, WORKSPACE_PERMISSIONS.VIEW), async (req: any, res: Response) => {
  try {
    // Get unique values for each attribute
    const [
      stoneTypes,
      colors,
      finishes,
      mines,
      qualities,
      cuttingDimensions
    ] = await Promise.all([
      prisma.product.findMany({
        select: { stoneTypeCode: true, stoneTypeName: true, stoneTypeNamePersian: true },
        distinct: ['stoneTypeCode'],
        orderBy: { stoneTypeName: 'asc' }
      }),
      prisma.product.findMany({
        select: { colorCode: true, colorName: true, colorNamePersian: true },
        distinct: ['colorCode'],
        orderBy: { colorName: 'asc' }
      }),
      prisma.product.findMany({
        select: { finishCode: true, finishName: true, finishNamePersian: true },
        distinct: ['finishCode'],
        orderBy: { finishName: 'asc' }
      }),
      prisma.product.findMany({
        select: { mineCode: true, mineName: true, mineNamePersian: true },
        distinct: ['mineCode'],
        orderBy: { mineName: 'asc' }
      }),
      prisma.product.findMany({
        select: { qualityCode: true, qualityName: true, qualityNamePersian: true },
        distinct: ['qualityCode'],
        orderBy: { qualityCode: 'asc' }
      }),
      prisma.product.findMany({
        select: { cuttingDimensionCode: true, cuttingDimensionName: true, cuttingDimensionNamePersian: true },
        distinct: ['cuttingDimensionCode'],
        orderBy: { cuttingDimensionCode: 'asc' }
      })
    ]);

    return res.json({
      success: true,
      data: {
        stoneTypes,
        colors,
        finishes,
        mines,
        qualities,
        cuttingDimensions
      }
    });
  } catch (error) {
    console.error('Get product attributes error:', error);
    return res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    Delete product (Edit permission required)
// @route   DELETE /api/products/:id
// @access  Private/Sales Workspace Edit
router.delete('/:id', protect, requireWorkspaceAccess(WORKSPACES.SALES, WORKSPACE_PERMISSIONS.EDIT), async (req: any, res: Response) => {
  try {
    const product = await prisma.product.findUnique({
      where: { id: req.params.id },
      include: {
        _count: {
          select: {
            contractItems: true,
            deliveryProducts: true
          }
        }
      }
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        error: 'Product not found'
      });
    }

    // Check if product is used in contracts or deliveries
    if (product._count.contractItems > 0 || product._count.deliveryProducts > 0) {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete product that is used in contracts or deliveries. Consider deactivating it instead.'
      });
    }

    // Perform soft delete by setting deletedAt timestamp
    console.log('Soft deleting product:', req.params.id);
    const deletedProduct = await prisma.product.update({
      where: { id: req.params.id },
      data: { 
        deletedAt: new Date(),
        isActive: false  // Also set isActive to false for consistency
      }
    });
    console.log('Product soft deleted:', deletedProduct.id, 'deletedAt:', deletedProduct.deletedAt);

    return res.json({
      success: true,
      message: 'Product deleted successfully'
    });
  } catch (error) {
    console.error('Delete product error:', error);
    return res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    Get product statistics
// @route   GET /api/products/stats
// @access  Private/Sales Workspace
router.get('/stats', protect, requireWorkspaceAccess(WORKSPACES.SALES, WORKSPACE_PERMISSIONS.VIEW), async (req: any, res: Response) => {
  try {
    const [
      totalProducts,
      availableProducts,
      unavailableProducts,
      productsWithPrice,
      productsWithoutPrice
    ] = await Promise.all([
      prisma.product.count({ where: { isActive: true } }),
      prisma.product.count({ where: { isActive: true, isAvailable: true } }),
      prisma.product.count({ where: { isActive: true, isAvailable: false } }),
      prisma.product.count({ where: { isActive: true, basePrice: { not: null } } }),
      prisma.product.count({ where: { isActive: true, basePrice: null } })
    ]);

    return res.json({
      success: true,
      data: {
        totalProducts,
        availableProducts,
        unavailableProducts,
        productsWithPrice,
        productsWithoutPrice
      }
    });
  } catch (error) {
    console.error('Get product stats error:', error);
    return res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// ==================== EXCEL IMPORT/EXPORT ====================

// @desc    Import products from Excel file
// @route   POST /api/products/import
// @access  Private/Sales Products Import
router.post('/import', protect, upload.single('file'), async (req: any, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'فایل Excel انتخاب نشده است'
      });
    }

    console.log('Processing Excel file:', req.file.filename);

    // Read Excel file
    const workbook = XLSX.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

    if (data.length < 2) {
      return res.status(400).json({
        success: false,
        error: 'فایل Excel خالی است یا فرمت صحیح ندارد'
      });
    }

    // Skip header row
    const productRows = data.slice(1);
    
    const results = {
      total: productRows.length,
      success: 0,
      failed: 0,
      errors: [] as any[]
    };

    // Get all master data for validation
    const [
      cutTypes,
      stoneMaterials,
      cutWidths,
      thicknesses,
      mines,
      finishTypes,
      colors
    ] = await Promise.all([
      prisma.cutType.findMany({ where: { isActive: true } }),
      prisma.stoneMaterial.findMany({ where: { isActive: true } }),
      prisma.cutWidth.findMany({ where: { isActive: true } }),
      prisma.thickness.findMany({ where: { isActive: true } }),
      prisma.mine.findMany({ where: { isActive: true } }),
      prisma.finishType.findMany({ where: { isActive: true } }),
      prisma.color.findMany({ where: { isActive: true } })
    ]);

    // Create lookup maps
    const cutTypeMap = new Map(cutTypes.map(item => [item.code, item]));
    const stoneMaterialMap = new Map(stoneMaterials.map(item => [item.code, item]));
    const cutWidthMap = new Map(cutWidths.map(item => [item.code, item]));
    const thicknessMap = new Map(thicknesses.map(item => [item.code, item]));
    const mineMap = new Map(mines.map(item => [item.code, item]));
    const finishTypeMap = new Map(finishTypes.map(item => [item.code, item]));
    const colorMap = new Map(colors.map(item => [item.code, item]));

    // Process each row
    for (let i = 0; i < productRows.length; i++) {
      const row = productRows[i] as any[];
      const rowNumber = i + 2; // +2 because we skipped header and arrays are 0-indexed

      try {
        // Validate required fields
        if (!row[0] || !row[1] || !row[2] || !row[3] || !row[6] || !row[9] || !row[12] || !row[15] || !row[18] || !row[21]) {
          results.errors.push({
            row: rowNumber,
            error: 'فیلدهای اجباری خالی هستند',
            data: row
          });
          results.failed++;
          continue;
        }

        const [
          code,
          name,
          namePersian,
          cuttingDimensionCode,
          cuttingDimensionName,
          cuttingDimensionNamePersian,
          stoneTypeCode,
          stoneTypeName,
          stoneTypeNamePersian,
          widthCode,
          widthValue,
          widthName,
          thicknessCode,
          thicknessValue,
          thicknessName,
          mineCode,
          mineName,
          mineNamePersian,
          finishCode,
          finishName,
          finishNamePersian,
          colorCode,
          colorName,
          colorNamePersian,
          qualityCode,
          qualityName,
          qualityNamePersian,
          basePrice,
          currency,
          isAvailable,
          leadTime,
          description,
          isActive
        ] = row;

        // Validate master data references
        const cutType = cutTypeMap.get(cuttingDimensionCode);
        const stoneMaterial = stoneMaterialMap.get(stoneTypeCode);
        const cutWidth = cutWidthMap.get(widthCode);
        const thickness = thicknessMap.get(thicknessCode);
        const mine = mineMap.get(mineCode);
        const finishType = finishTypeMap.get(finishCode);
        const color = colorMap.get(colorCode);

        if (!cutType || !stoneMaterial || !cutWidth || !thickness || !mine || !finishType || !color) {
          results.errors.push({
            row: rowNumber,
            error: 'کدهای مرجع داده‌ها نامعتبر هستند',
            data: { cuttingDimensionCode, stoneTypeCode, widthCode, thicknessCode, mineCode, finishCode, colorCode }
          });
          results.failed++;
          continue;
        }

        // Check if product already exists
        const existingProduct = await prisma.product.findUnique({
          where: { code: code }
        });

        if (existingProduct) {
          results.errors.push({
            row: rowNumber,
            error: 'محصول با این کد قبلاً وجود دارد',
            data: { code }
          });
          results.failed++;
          continue;
        }

        // Create product
        await prisma.product.create({
          data: {
            code: code,
            name: name,
            namePersian: namePersian,
            cuttingDimensionCode: cuttingDimensionCode,
            cuttingDimensionName: cuttingDimensionName || cutType.name || '',
            cuttingDimensionNamePersian: cuttingDimensionNamePersian || cutType.namePersian,
            stoneTypeCode: stoneTypeCode,
            stoneTypeName: stoneTypeName || stoneMaterial.name || '',
            stoneTypeNamePersian: stoneTypeNamePersian || stoneMaterial.namePersian,
            widthCode: widthCode,
            widthValue: parseFloat(widthValue) || cutWidth.value,
            widthName: widthName || `${cutWidth.value} ${cutWidth.unit}`,
            thicknessCode: thicknessCode,
            thicknessValue: parseFloat(thicknessValue) || thickness.value,
            thicknessName: thicknessName || `${thickness.value} ${thickness.unit}`,
            mineCode: mineCode,
            mineName: mineName || mine.name || '',
            mineNamePersian: mineNamePersian || mine.namePersian,
            finishCode: finishCode,
            finishName: finishName || finishType.name || '',
            finishNamePersian: finishNamePersian || finishType.namePersian,
            colorCode: colorCode,
            colorName: colorName || color.name || '',
            colorNamePersian: colorNamePersian || color.namePersian,
            qualityCode: qualityCode || 'QUALITY-001',
            qualityName: qualityName || 'Standard',
            qualityNamePersian: qualityNamePersian || 'استاندارد',
            basePrice: basePrice ? parseFloat(basePrice) : null,
            currency: currency || 'ریال',
            isAvailable: isAvailable !== undefined ? Boolean(isAvailable) : true,
            leadTime: leadTime ? parseInt(leadTime) : null,
            description: description || null,
            images: [],
            isActive: isActive !== undefined ? Boolean(isActive) : true,
            availableInLongitudinalContracts: true,
            availableInStairContracts: true,
            availableInSlabContracts: true,
            availableInVolumetricContracts: true
          }
        });

        results.success++;
        console.log(`✅ Imported product ${code}: ${namePersian}`);

      } catch (error: any) {
        console.error(`❌ Error importing row ${rowNumber}:`, error.message);
        results.errors.push({
          row: rowNumber,
          error: error.message,
          data: row
        });
        results.failed++;
      }
    }

    // Clean up uploaded file
    const fs = require('fs');
    fs.unlinkSync(req.file.path);

    return res.json({
      success: true,
      message: 'وارد کردن محصولات تکمیل شد',
      data: results
    });

  } catch (error) {
    console.error('Import error:', error);
    return res.status(500).json({
      success: false,
      error: 'خطا در وارد کردن فایل Excel'
    });
  }
});

// @desc    Export products to Excel
// @route   GET /api/products/export
// @access  Private/Sales Products Export
router.get('/export', protect, async (req: any, res: Response) => {
  try {
    // Get filter parameters
    const {
      search,
      stoneType,
      color,
      finish,
      mine,
      quality,
      isAvailable,
      isActive,
      includeDeleted
    } = req.query;

    // Build where clause
    let whereClause: any = {
      deletedAt: null
    };

    if (includeDeleted !== 'true') {
      whereClause.deletedAt = null;
    }

    if (search) {
      whereClause.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { namePersian: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } }
      ];
    }

    if (stoneType) whereClause.stoneTypeCode = stoneType;
    if (color) whereClause.colorCode = color;
    if (finish) whereClause.finishCode = finish;
    if (mine) whereClause.mineCode = mine;
    if (quality) whereClause.qualityCode = quality;
    if (isAvailable !== undefined) whereClause.isAvailable = isAvailable === 'true';
    if (isActive !== undefined) whereClause.isActive = isActive === 'true';

    // Get products
    const products = await prisma.product.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' }
    });

    // Create workbook
    const workbook = XLSX.utils.book_new();

    // Prepare data
    const headers = [
      'کد محصول',
      'نام محصول (انگلیسی)',
      'نام محصول (فارسی)',
      'نوع برش',
      'جنس سنگ',
      'عرض',
      'ضخامت',
      'معدن',
      'نوع پرداخت',
      'رنگ',
      'کیفیت',
      'قیمت پایه',
      'ارز',
      'موجود',
      'زمان تحویل',
      'توضیحات',
      'فعال',
      'تاریخ ایجاد'
    ];

    const exportData = products.map(product => [
      product.code,
      product.name,
      product.namePersian,
      product.cuttingDimensionNamePersian,
      product.stoneTypeNamePersian,
      product.widthName,
      product.thicknessName,
      product.mineNamePersian,
      product.finishNamePersian,
      product.colorNamePersian,
      product.qualityNamePersian,
      product.basePrice,
      product.currency,
      product.isAvailable ? 'بله' : 'خیر',
      product.leadTime,
      product.description,
      product.isActive ? 'بله' : 'خیر',
      new Date(product.createdAt).toLocaleDateString('fa-IR')
    ]);

    const worksheetData = [headers, ...exportData];
    const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);

    // Set column widths
    worksheet['!cols'] = [
      { wch: 25 }, { wch: 40 }, { wch: 40 }, { wch: 20 }, { wch: 20 },
      { wch: 15 }, { wch: 15 }, { wch: 20 }, { wch: 20 }, { wch: 15 },
      { wch: 15 }, { wch: 15 }, { wch: 10 }, { wch: 10 }, { wch: 12 },
      { wch: 30 }, { wch: 10 }, { wch: 15 }
    ];

    XLSX.utils.book_append_sheet(workbook, worksheet, 'محصولات');

    // Generate Excel file buffer
    const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    // Set response headers
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="products-export-${new Date().toISOString().split('T')[0]}.xlsx"`);
    res.setHeader('Content-Length', excelBuffer.length);

    return res.send(excelBuffer);

  } catch (error) {
    console.error('Export error:', error);
    return res.status(500).json({
      success: false,
      error: 'خطا در صادر کردن محصولات'
    });
  }
});

export default router;
