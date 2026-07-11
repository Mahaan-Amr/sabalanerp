import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { body, validationResult } from 'express-validator';
import { PrismaClient } from '@prisma/client';
import { protect } from '../middleware/auth';

const router = express.Router();
const prisma = new PrismaClient();

// Generate JWT Token
const generateToken = (id: string) => {
  return jwt.sign({ id }, process.env.JWT_SECRET!, {
    expiresIn: '7d',
  });
};

const normalizeLoginPhone = (value: string) =>
  value
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[\s\-().]/g, '');

// @desc    Register user
// @route   POST /api/auth/register
// @access  Public
router.post('/register', [
  body('email').isEmail().normalizeEmail(),
  body('username').isLength({ min: 3 }).trim().escape(),
  body('password').isLength({ min: 6 }),
  body('firstName').trim().escape(),
  body('lastName').trim().escape(),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { email, username, password, firstName, lastName } = req.body;

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

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create user and linked organizational personnel
    const user = await prisma.$transaction(async (tx) => {
      const personnel = await tx.personnel.create({
        data: {
          firstName,
          lastName,
          departmentId: null,
          isActive: true
        },
        select: { id: true }
      });

      return tx.user.create({
        data: {
          email,
          username,
          password: hashedPassword,
          firstName,
          lastName,
          personnelId: personnel.id
        },
        select: {
          id: true,
          email: true,
          username: true,
          firstName: true,
          lastName: true,
          role: true,
          createdAt: true,
        }
      });
    });

    // Generate token
    const token = generateToken(user.id);

    res.status(201).json({
      success: true,
      data: {
        user,
        token
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error during registration'
    });
  }
});

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
router.post('/login', [
  body('identifier').optional().isString().trim(),
  body('email').optional().isString().trim(),
  body('password').exists(),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const identifier = String(req.body.identifier || req.body.email || '').trim();
    const password = req.body.password;

    if (!identifier) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: [{ msg: 'Login identifier is required', path: 'identifier' }]
      });
    }

    const normalizedEmail = identifier.includes('@') ? identifier.toLowerCase() : identifier;
    const normalizedPhone = normalizeLoginPhone(identifier);
    const phoneCandidates = Array.from(new Set([identifier, normalizedPhone].filter(Boolean)));

    // Check for user
    const users = await prisma.user.findMany({
      where: {
        OR: [
          { email: normalizedEmail },
          { username: identifier },
          ...phoneCandidates.map((phone) => ({ profile: { is: { phone } } }))
        ]
      },
      take: 2,
      select: {
        id: true,
        email: true,
        username: true,
        password: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
      }
    });
    const user = users.length === 1 ? users[0] : null;

    if (!user || !user.isActive || users.length > 1) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
    }

    // Check password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
    }

    // Generate token
    const token = generateToken(user.id);

    // Remove password from response
    const { password: _, ...userWithoutPassword } = user;

    res.json({
      success: true,
      data: {
        user: userWithoutPassword,
        token
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error during login'
    });
  }
});

// @desc    Get current user
// @route   GET /api/auth/me
// @access  Private
router.get('/me', protect, async (req: any, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
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
        profile: true,
        personnel: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            isActive: true,
            department: { select: { id: true, name: true, namePersian: true } }
          }
        },
      }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
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

export default router;
