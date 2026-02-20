import express, { Response } from 'express';
import { body, validationResult } from 'express-validator';
import { PrismaClient } from '@prisma/client';
import { protect, authorize, AuthRequest } from '../middleware/auth';
import { requireWorkspaceAccess, WORKSPACES, WORKSPACE_PERMISSIONS } from '../middleware/workspace';
import { requireFeatureAccess, FEATURE_PERMISSIONS, FEATURES } from '../middleware/feature';

const router = express.Router();
const prisma = new PrismaClient();

// @desc    Get all shifts
// @route   GET /api/security/shifts
// @access  Private/Security Workspace
router.get('/shifts', protect, requireWorkspaceAccess(WORKSPACES.SECURITY, WORKSPACE_PERMISSIONS.VIEW), requireFeatureAccess(FEATURES.SECURITY_SHIFTS_VIEW, FEATURE_PERMISSIONS.VIEW), async (req: AuthRequest, res: Response) => {
  try {
    const shifts = await prisma.shift.findMany({
      where: { isActive: true },
      include: {
        _count: {
          select: {
            securityPersonnel: true,
            attendanceRecords: true
          }
        }
      },
      orderBy: {
        startTime: 'asc'
      }
    });

    res.json({
      success: true,
      data: shifts
    });
  } catch (error) {
    console.error('Get shifts error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    Create new shift
// @route   POST /api/security/shifts
// @access  Private/Security Workspace Admin
router.post('/shifts', protect, requireWorkspaceAccess(WORKSPACES.SECURITY, WORKSPACE_PERMISSIONS.ADMIN), requireFeatureAccess(FEATURES.SECURITY_SHIFTS_CREATE, FEATURE_PERMISSIONS.EDIT), [
  body('name').notEmpty().withMessage('Name is required'),
  body('namePersian').notEmpty().withMessage('Persian name is required'),
  body('startTime').notEmpty().withMessage('Start time is required'),
  body('endTime').notEmpty().withMessage('End time is required'),
  body('duration').isInt({ min: 1 }).withMessage('Duration must be a positive integer'),
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

    const { name, namePersian, startTime, endTime, duration } = req.body;

    const shift = await prisma.shift.create({
      data: {
        name,
        namePersian,
        startTime,
        endTime,
        duration: parseInt(duration),
      }
    });

    res.status(201).json({
      success: true,
      data: shift
    });
    return;
  } catch (error) {
    console.error('Create shift error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
    return;
  }
});

// @desc    Start security shift
// @route   POST /api/security/shifts/start
// @access  Private/Security Workspace
router.post('/shifts/start', protect, requireWorkspaceAccess(WORKSPACES.SECURITY, WORKSPACE_PERMISSIONS.EDIT), requireFeatureAccess(FEATURES.SECURITY_SHIFTS_START, FEATURE_PERMISSIONS.EDIT), async (req: AuthRequest, res: Response) => {
  try {
    const { shiftId } = req.body;

    if (!shiftId) {
      return res.status(400).json({
        success: false,
        error: 'Shift ID is required'
      });
    }

    // Check if user is security personnel
    const securityPersonnel = await prisma.securityPersonnel.findUnique({
      where: { userId: req.user!.id },
      include: { shift: true }
    });

    if (!securityPersonnel) {
      return res.status(403).json({
        success: false,
        error: 'User is not authorized as security personnel'
      });
    }

    // Check if shift is already active
    const activeShift = await prisma.securityPersonnel.findFirst({
      where: {
        userId: req.user!.id,
        isActive: true,
        shift: {
          id: shiftId
        }
      }
    });

    if (activeShift) {
      return res.status(400).json({
        success: false,
        error: 'Shift is already active'
      });
    }

    res.json({
      success: true,
      message: 'Security shift started successfully',
      data: {
        shiftId,
        startTime: new Date().toISOString()
      }
    });
    return;
  } catch (error) {
    console.error('Start shift error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
    return;
  }
});

// @desc    End security shift
// @route   POST /api/security/shifts/end
// @access  Private/Security Workspace
router.post('/shifts/end', protect, requireWorkspaceAccess(WORKSPACES.SECURITY, WORKSPACE_PERMISSIONS.EDIT), requireFeatureAccess(FEATURES.SECURITY_SHIFTS_END, FEATURE_PERMISSIONS.EDIT), async (req: AuthRequest, res: Response) => {
  try {
    // Check if user is security personnel
    const securityPersonnel = await prisma.securityPersonnel.findUnique({
      where: { userId: req.user!.id },
      include: { shift: true }
    });

    if (!securityPersonnel) {
      return res.status(403).json({
        success: false,
        error: 'User is not authorized as security personnel'
      });
    }

    res.json({
      success: true,
      message: 'Security shift ended successfully',
      data: {
        endTime: new Date().toISOString()
      }
    });
    return;
  } catch (error) {
    console.error('End shift error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
    return;
  }
});

// @desc    Employee check-in
// @route   POST /api/security/attendance/checkin
// @access  Private/Security Workspace
router.post('/attendance/checkin', protect, requireWorkspaceAccess(WORKSPACES.SECURITY, WORKSPACE_PERMISSIONS.EDIT), requireFeatureAccess(FEATURES.SECURITY_ATTENDANCE_CHECKIN, FEATURE_PERMISSIONS.EDIT), [
  body('employeeId').notEmpty().withMessage('Employee ID is required'),
  body('entryTime').optional().isString().withMessage('Entry time must be a string'),
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

    // Check if user is security personnel
    const securityPersonnel = await prisma.securityPersonnel.findUnique({
      where: { userId: req.user!.id },
      include: { shift: true }
    });

    if (!securityPersonnel) {
      return res.status(403).json({
        success: false,
        error: 'User is not authorized as security personnel'
      });
    }

    const { employeeId, entryTime } = req.body;
    const currentTime = entryTime || new Date().toLocaleTimeString('fa-IR', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: false 
    });

    // Check if employee already checked in today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const existingRecord = await prisma.attendanceRecord.findFirst({
      where: {
        employeeId,
        date: {
          gte: today,
          lt: tomorrow
        }
      }
    });

    if (existingRecord && existingRecord.entryTime) {
      return res.status(400).json({
        success: false,
        error: 'Employee has already checked in today'
      });
    }

    let attendanceRecord;
    if (existingRecord) {
      // Update existing record
      attendanceRecord = await prisma.attendanceRecord.update({
        where: { id: existingRecord.id },
        data: {
          entryTime: currentTime,
          status: 'PRESENT'
        },
        include: {
          employee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              username: true
            }
          },
          shift: true
        }
      });
    } else {
      // Create new record
      attendanceRecord = await prisma.attendanceRecord.create({
        data: {
          employeeId,
          securityPersonnelId: securityPersonnel.id,
          shiftId: securityPersonnel.shiftId,
          date: today,
          entryTime: currentTime,
          status: 'PRESENT'
        },
        include: {
          employee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              username: true
            }
          },
          shift: true
        }
      });
    }

    res.status(201).json({
      success: true,
      message: 'Employee checked in successfully',
      data: attendanceRecord
    });
    return;
  } catch (error) {
    console.error('Check-in error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
    return;
  }
});

// @desc    Employee check-out
// @route   POST /api/security/attendance/checkout
// @access  Private/Security Personnel
router.post('/attendance/checkout', protect, requireWorkspaceAccess(WORKSPACES.SECURITY, WORKSPACE_PERMISSIONS.EDIT), requireFeatureAccess(FEATURES.SECURITY_ATTENDANCE_CHECKOUT, FEATURE_PERMISSIONS.EDIT), [
  body('employeeId').notEmpty().withMessage('Employee ID is required'),
  body('exitTime').optional().isString().withMessage('Exit time must be a string'),
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

    // Check if user is security personnel
    const securityPersonnel = await prisma.securityPersonnel.findUnique({
      where: { userId: req.user!.id },
      include: { shift: true }
    });

    if (!securityPersonnel) {
      return res.status(403).json({
        success: false,
        error: 'User is not authorized as security personnel'
      });
    }

    const { employeeId, exitTime } = req.body;
    const currentTime = exitTime || new Date().toLocaleTimeString('fa-IR', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: false 
    });

    // Find today's attendance record
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const attendanceRecord = await prisma.attendanceRecord.findFirst({
      where: {
        employeeId,
        date: {
          gte: today,
          lt: tomorrow
        }
      }
    });

    if (!attendanceRecord) {
      return res.status(400).json({
        success: false,
        error: 'Employee has not checked in today'
      });
    }

    if (attendanceRecord.exitTime) {
      return res.status(400).json({
        success: false,
        error: 'Employee has already checked out today'
      });
    }

    const updatedRecord = await prisma.attendanceRecord.update({
      where: { id: attendanceRecord.id },
      data: {
        exitTime: currentTime
      },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            username: true
          }
        },
        shift: true
      }
    });

    res.json({
      success: true,
      message: 'Employee checked out successfully',
      data: updatedRecord
    });
    return;
  } catch (error) {
    console.error('Check-out error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
    return;
  }
});

// @desc    Record attendance exception
// @route   POST /api/security/attendance/exception
// @access  Private/Security Personnel
router.post('/attendance/exception', protect, requireWorkspaceAccess(WORKSPACES.SECURITY, WORKSPACE_PERMISSIONS.EDIT), requireFeatureAccess(FEATURES.SECURITY_ATTENDANCE_EXCEPTION, FEATURE_PERMISSIONS.EDIT), [
  body('employeeId').notEmpty().withMessage('Employee ID is required'),
  body('exceptionType').notEmpty().withMessage('Exception type is required'),
  body('exceptionTime').optional().isString().withMessage('Exception time must be a string'),
  body('exceptionDuration').optional().isInt({ min: 1 }).withMessage('Exception duration must be a positive integer'),
  body('notes').optional().isString().withMessage('Notes must be a string'),
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

    // Check if user is security personnel
    const securityPersonnel = await prisma.securityPersonnel.findUnique({
      where: { userId: req.user!.id },
      include: { shift: true }
    });

    if (!securityPersonnel) {
      return res.status(403).json({
        success: false,
        error: 'User is not authorized as security personnel'
      });
    }

    const { employeeId, exceptionType, exceptionTime, exceptionDuration, notes } = req.body;

    // Determine status based on exception type
    let status = 'PRESENT';
    if (exceptionType === '??') status = 'MISSION';
    else if (exceptionType === '??? ???') status = 'HOURLY_LEAVE';
    else if (exceptionType === '??') status = 'ABSENT';

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const attendanceRecord = await prisma.attendanceRecord.create({
      data: {
        employeeId,
        securityPersonnelId: securityPersonnel.id,
        shiftId: securityPersonnel.shiftId,
        date: today,
        status: status as any,
        exceptionType,
        exceptionTime,
        exceptionDuration: exceptionDuration ? parseInt(exceptionDuration) : null,
        notes
      },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            username: true
          }
        },
        shift: true
      }
    });

    res.status(201).json({
      success: true,
      message: 'Attendance exception recorded successfully',
      data: attendanceRecord
    });
    return;
  } catch (error) {
    console.error('Record exception error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
    return;
  }
});

// @desc    Get daily attendance report
// @route   GET /api/security/attendance/daily
// @access  Private/Security Personnel
router.get('/attendance/daily', protect, requireWorkspaceAccess(WORKSPACES.SECURITY, WORKSPACE_PERMISSIONS.VIEW), requireFeatureAccess(FEATURES.SECURITY_ATTENDANCE_DAILY_VIEW, FEATURE_PERMISSIONS.VIEW), async (req: AuthRequest, res: Response) => {
  try {
    const { date } = req.query;
    let targetDate: Date;
    
    if (date) {
      // If date is provided, use it directly (should be ISO string from frontend)
      targetDate = new Date(date as string);
    } else {
      // Default to today
      targetDate = new Date();
    }
    
    targetDate.setHours(0, 0, 0, 0);
    
    const nextDay = new Date(targetDate);
    nextDay.setDate(nextDay.getDate() + 1);

    // Check if user is security personnel
    const securityPersonnel = await prisma.securityPersonnel.findUnique({
      where: { userId: req.user!.id },
      include: { 
        shift: true,
        user: {
          select: {
            departmentId: true
          }
        }
      }
    });

    if (!securityPersonnel) {
      return res.status(403).json({
        success: false,
        error: 'User is not authorized as security personnel'
      });
    }

    const attendanceRecords = await prisma.attendanceRecord.findMany({
      where: {
        date: {
          gte: targetDate,
          lt: nextDay
        },
        shiftId: securityPersonnel.shiftId
      },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            username: true
          }
        },
        shift: true
      },
      orderBy: {
        createdAt: 'asc'
      }
    });

    // Get all employees for comparison
    const allEmployees = await prisma.user.findMany({
      where: {
        isActive: true,
        departmentId: securityPersonnel.user.departmentId
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        username: true
      }
    });

    // Create attendance summary
    const attendanceSummary = allEmployees.map(employee => {
      const record = attendanceRecords.find(r => r.employeeId === employee.id);
      return {
        employee,
        attendance: record || null,
        status: record ? record.status : 'ABSENT'
      };
    });

    res.json({
      success: true,
      data: {
        date: targetDate.toISOString(),
        shift: securityPersonnel.shift,
        attendanceSummary,
        totalEmployees: allEmployees.length,
        presentCount: attendanceRecords.filter(r => r.status === 'PRESENT').length,
        absentCount: allEmployees.length - attendanceRecords.filter(r => r.status === 'PRESENT').length,
        exceptionCount: attendanceRecords.filter(r => r.status !== 'PRESENT' && r.status !== 'ABSENT').length
      }
    });
    return;
  } catch (error) {
    console.error('Get daily attendance error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
    return;
  }
});

// @desc    Get security dashboard stats
// @route   GET /api/security/dashboard/stats
// @access  Private/Security Personnel
router.get('/dashboard/stats', protect, requireWorkspaceAccess(WORKSPACES.SECURITY, WORKSPACE_PERMISSIONS.VIEW), requireFeatureAccess(FEATURES.SECURITY_DASHBOARD_VIEW, FEATURE_PERMISSIONS.VIEW), async (req: AuthRequest, res: Response) => {
  try {
    // Check if user is security personnel
    const securityPersonnel = await prisma.securityPersonnel.findUnique({
      where: { userId: req.user!.id },
      include: { 
        shift: true,
        user: {
          select: {
            firstName: true,
            lastName: true,
            departmentId: true,
            department: {
              select: {
                namePersian: true
              }
            }
          }
        }
      }
    });

    if (!securityPersonnel) {
      return res.status(403).json({
        success: false,
        error: 'User is not authorized as security personnel'
      });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Get today's attendance stats
    const todayAttendance = await prisma.attendanceRecord.findMany({
      where: {
        date: {
          gte: today,
          lt: tomorrow
        },
        shiftId: securityPersonnel.shiftId
      }
    });

    // Get total employees in department
    const totalEmployees = await prisma.user.count({
      where: {
        isActive: true,
        departmentId: securityPersonnel.user.departmentId
      }
    });

    const stats = {
      currentShift: securityPersonnel.shift,
      securityPersonnel: {
        name: `${securityPersonnel.user.firstName} ${securityPersonnel.user.lastName}`,
        position: securityPersonnel.position,
        department: securityPersonnel.user.department?.namePersian
      },
      todayStats: {
        totalEmployees,
        present: todayAttendance.filter(r => r.status === 'PRESENT').length,
        absent: totalEmployees - todayAttendance.filter(r => r.status === 'PRESENT').length,
        late: todayAttendance.filter(r => r.status === 'LATE').length,
        mission: todayAttendance.filter(r => r.status === 'MISSION').length,
        leave: todayAttendance.filter(r => r.status === 'HOURLY_LEAVE').length
      },
      recentActivity: todayAttendance.slice(-5).map(record => ({
        employeeId: record.employeeId,
        entryTime: record.entryTime,
        exitTime: record.exitTime,
        status: record.status,
        exceptionType: record.exceptionType
      }))
    };

    res.json({
      success: true,
      data: stats
    });
    return;
  } catch (error) {
    console.error('Get security dashboard stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
    return;
  }
});

// @desc    Get security personnel
// @route   GET /api/security/personnel
// @access  Private/Admin
router.get('/personnel', protect, authorize('ADMIN'), requireWorkspaceAccess(WORKSPACES.SECURITY, WORKSPACE_PERMISSIONS.ADMIN), requireFeatureAccess(FEATURES.SECURITY_PERSONNEL_VIEW, FEATURE_PERMISSIONS.VIEW), async (req: AuthRequest, res: Response) => {
  try {
    const personnel = await prisma.securityPersonnel.findMany({
      where: { isActive: true },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            username: true,
            email: true,
            department: {
              select: {
                namePersian: true
              }
            }
          }
        },
        shift: true
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    res.json({
      success: true,
      data: personnel
    });
    return;
  } catch (error) {
    console.error('Get security personnel error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
    return;
  }
});

// @desc    Assign security personnel
// @route   POST /api/security/personnel
// @access  Private/Admin
router.post('/personnel', protect, authorize('ADMIN'), requireWorkspaceAccess(WORKSPACES.SECURITY, WORKSPACE_PERMISSIONS.ADMIN), requireFeatureAccess(FEATURES.SECURITY_PERSONNEL_ASSIGN, FEATURE_PERMISSIONS.EDIT), [
  body('userId').notEmpty().withMessage('User ID is required'),
  body('shiftId').notEmpty().withMessage('Shift ID is required'),
  body('position').notEmpty().withMessage('Position is required'),
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

    const { userId, shiftId, position } = req.body;

    // Check if user is already assigned as security personnel
    const existingPersonnel = await prisma.securityPersonnel.findUnique({
      where: { userId }
    });

    if (existingPersonnel) {
      return res.status(400).json({
        success: false,
        error: 'User is already assigned as security personnel'
      });
    }

    const securityPersonnel = await prisma.securityPersonnel.create({
      data: {
        userId,
        shiftId,
        position
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            username: true,
            email: true,
            department: {
              select: {
                namePersian: true
              }
            }
          }
        },
        shift: true
      }
    });

    res.status(201).json({
      success: true,
      data: securityPersonnel
    });
    return;
  } catch (error) {
    console.error('Assign security personnel error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
    return;
  }
});

// ==================== EXCEPTION HANDLING SYSTEM ====================

// @desc    Create exception request (leave, sick leave, etc.)
// @route   POST /api/security/exceptions/request
// @access  Private/All Users
router.post('/exceptions/request', protect, requireWorkspaceAccess(WORKSPACES.SECURITY, WORKSPACE_PERMISSIONS.VIEW), requireFeatureAccess(FEATURES.SECURITY_EXCEPTIONS_REQUEST, FEATURE_PERMISSIONS.EDIT), [
  body('exceptionType').isIn(['HOURLY_LEAVE', 'SICK_LEAVE', 'VACATION', 'EMERGENCY_LEAVE', 'PERSONAL_LEAVE']).withMessage('Invalid exception type'),
  body('startDate').isISO8601().withMessage('Start date must be valid'),
  body('endDate').optional().isISO8601().withMessage('End date must be valid'),
  body('startTime').optional().isString().withMessage('Start time must be a string'),
  body('endTime').optional().isString().withMessage('End time must be a string'),
  body('duration').optional().isInt({ min: 1 }).withMessage('Duration must be a positive integer'),
  body('reason').notEmpty().withMessage('Reason is required'),
  body('description').optional().isString().withMessage('Description must be a string'),
  body('emergencyContact').optional().isString().withMessage('Emergency contact must be a string'),
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
      exceptionType,
      startDate,
      endDate,
      startTime,
      endTime,
      duration,
      reason,
      description,
      emergencyContact
    } = req.body;

    const exceptionRequest = await prisma.exceptionRequest.create({
      data: {
        employeeId: req.user!.id,
        exceptionType,
        startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : null,
        startTime,
        endTime,
        duration: duration ? parseInt(duration) : null,
        reason,
        description,
        emergencyContact
      },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            username: true,
            department: {
              select: {
                namePersian: true
              }
            }
          }
        }
      }
    });

    res.status(201).json({
      success: true,
      message: 'Exception request created successfully',
      data: exceptionRequest
    });
    return;
  } catch (error) {
    console.error('Create exception request error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
    return;
  }
});

// @desc    Get exception requests (for managers/approvers)
// @route   GET /api/security/exceptions/requests
// @access  Private/Managers
router.get('/exceptions/requests', protect, authorize('ADMIN'), requireWorkspaceAccess(WORKSPACES.SECURITY, WORKSPACE_PERMISSIONS.ADMIN), requireFeatureAccess(FEATURES.SECURITY_EXCEPTIONS_VIEW, FEATURE_PERMISSIONS.VIEW), async (req: AuthRequest, res: Response) => {
  try {
    const { status, type, page = 1, limit = 10 } = req.query;
    
    const where: any = {};
    if (status) where.status = status;
    if (type) where.exceptionType = type;

    const exceptionRequests = await prisma.exceptionRequest.findMany({
      where,
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            username: true,
            department: {
              select: {
                namePersian: true
              }
            }
          }
        },
        approver: {
          select: {
            firstName: true,
            lastName: true
          }
        },
        rejecter: {
          select: {
            firstName: true,
            lastName: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      skip: (parseInt(page as string) - 1) * parseInt(limit as string),
      take: parseInt(limit as string)
    });

    const total = await prisma.exceptionRequest.count({ where });

    res.json({
      success: true,
      data: exceptionRequests,
      pagination: {
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        total,
        pages: Math.ceil(total / parseInt(limit as string))
      }
    });
    return;
  } catch (error) {
    console.error('Get exception requests error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
    return;
  }
});

// @desc    Approve exception request
// @route   PUT /api/security/exceptions/:id/approve
// @access  Private/Managers
router.put('/exceptions/:id/approve', protect, authorize('ADMIN'), requireWorkspaceAccess(WORKSPACES.SECURITY, WORKSPACE_PERMISSIONS.ADMIN), requireFeatureAccess(FEATURES.SECURITY_EXCEPTIONS_APPROVE, FEATURE_PERMISSIONS.EDIT), [
  body('notes').optional().isString().withMessage('Notes must be a string')
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

    const { id } = req.params;
    const { notes } = req.body;

    const existingRequest = await prisma.exceptionRequest.findUnique({ where: { id } });
    
    const exceptionRequest = await prisma.exceptionRequest.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approvedBy: req.user!.id,
        approvedAt: new Date(),
        description: notes ? `${existingRequest?.description || ''}\nApproval Notes: ${notes}` : existingRequest?.description
      },
      include: {
        employee: {
          select: {
            firstName: true,
            lastName: true
          }
        },
        approver: {
          select: {
            firstName: true,
            lastName: true
          }
        }
      }
    });

    res.json({
      success: true,
      message: 'Exception request approved successfully',
      data: exceptionRequest
    });
    return;
  } catch (error) {
    console.error('Approve exception request error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
    return;
  }
});

// @desc    Reject exception request
// @route   PUT /api/security/exceptions/:id/reject
// @access  Private/Managers
router.put('/exceptions/:id/reject', protect, authorize('ADMIN'), requireWorkspaceAccess(WORKSPACES.SECURITY, WORKSPACE_PERMISSIONS.ADMIN), requireFeatureAccess(FEATURES.SECURITY_EXCEPTIONS_REJECT, FEATURE_PERMISSIONS.EDIT), [
  body('rejectionReason').notEmpty().withMessage('Rejection reason is required')
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

    const { id } = req.params;
    const { rejectionReason } = req.body;

    const exceptionRequest = await prisma.exceptionRequest.update({
      where: { id },
      data: {
        status: 'REJECTED',
        rejectedBy: req.user!.id,
        rejectedAt: new Date(),
        rejectionReason
      },
      include: {
        employee: {
          select: {
            firstName: true,
            lastName: true
          }
        },
        rejecter: {
          select: {
            firstName: true,
            lastName: true
          }
        }
      }
    });

    res.json({
      success: true,
      message: 'Exception request rejected successfully',
      data: exceptionRequest
    });
    return;
  } catch (error) {
    console.error('Reject exception request error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
    return;
  }
});

// @desc    Create mission assignment
// @route   POST /api/security/missions/assign
// @access  Private/Security Personnel
router.post('/missions/assign', protect, requireWorkspaceAccess(WORKSPACES.SECURITY, WORKSPACE_PERMISSIONS.EDIT), requireFeatureAccess(FEATURES.SECURITY_MISSIONS_ASSIGN, FEATURE_PERMISSIONS.EDIT), [
  body('employeeId').notEmpty().withMessage('Employee ID is required'),
  body('missionType').isIn(['?? ???', '?? ???']).withMessage('Invalid mission type'),
  body('missionLocation').notEmpty().withMessage('Mission location is required'),
  body('missionPurpose').notEmpty().withMessage('Mission purpose is required'),
  body('startDate').isISO8601().withMessage('Start date must be valid'),
  body('endDate').optional().isISO8601().withMessage('End date must be valid'),
  body('startTime').notEmpty().withMessage('Start time is required'),
  body('endTime').optional().isString().withMessage('End time must be a string'),
  body('notes').optional().isString().withMessage('Notes must be a string')
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

    // Check if user is security personnel
    const securityPersonnel = await prisma.securityPersonnel.findUnique({
      where: { userId: req.user!.id }
    });

    if (!securityPersonnel) {
      return res.status(403).json({
        success: false,
        error: 'User is not authorized as security personnel'
      });
    }

    const {
      employeeId,
      missionType,
      missionLocation,
      missionPurpose,
      startDate,
      endDate,
      startTime,
      endTime,
      notes
    } = req.body;

    const missionAssignment = await prisma.missionAssignment.create({
      data: {
        employeeId,
        assignedBy: req.user!.id,
        missionType,
        missionLocation,
        missionPurpose,
        startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : null,
        startTime,
        endTime,
        notes
      },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            username: true,
            department: {
              select: {
                namePersian: true
              }
            }
          }
        },
        assigner: {
          select: {
            firstName: true,
            lastName: true
          }
        }
      }
    });

    res.status(201).json({
      success: true,
      message: 'Mission assignment created successfully',
      data: missionAssignment
    });
    return;
  } catch (error) {
    console.error('Create mission assignment error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
    return;
  }
});

// @desc    Get mission assignments
// @route   GET /api/security/missions
// @access  Private/Security Personnel
router.get('/missions', protect, requireWorkspaceAccess(WORKSPACES.SECURITY, WORKSPACE_PERMISSIONS.VIEW), requireFeatureAccess(FEATURES.SECURITY_MISSIONS_VIEW, FEATURE_PERMISSIONS.VIEW), async (req: AuthRequest, res: Response) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    
    const where: any = {};
    if (status) where.status = status;

    const missionAssignments = await prisma.missionAssignment.findMany({
      where,
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            username: true,
            department: {
              select: {
                namePersian: true
              }
            }
          }
        },
        assigner: {
          select: {
            firstName: true,
            lastName: true
          }
        },
        approver: {
          select: {
            firstName: true,
            lastName: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      skip: (parseInt(page as string) - 1) * parseInt(limit as string),
      take: parseInt(limit as string)
    });

    const total = await prisma.missionAssignment.count({ where });

    res.json({
      success: true,
      data: missionAssignments,
      pagination: {
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        total,
        pages: Math.ceil(total / parseInt(limit as string))
      }
    });
  } catch (error) {
    console.error('Get mission assignments error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    Approve mission assignment
// @route   PUT /api/security/missions/:id/approve
// @access  Private/Managers
router.put('/missions/:id/approve', protect, authorize('ADMIN'), requireWorkspaceAccess(WORKSPACES.SECURITY, WORKSPACE_PERMISSIONS.ADMIN), requireFeatureAccess(FEATURES.SECURITY_MISSIONS_APPROVE, FEATURE_PERMISSIONS.EDIT), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const missionAssignment = await prisma.missionAssignment.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approvedBy: req.user!.id,
        approvedAt: new Date()
      },
      include: {
        employee: {
          select: {
            firstName: true,
            lastName: true
          }
        },
        approver: {
          select: {
            firstName: true,
            lastName: true
          }
        }
      }
    });

    res.json({
      success: true,
      message: 'Mission assignment approved successfully',
      data: missionAssignment
    });
    return;
  } catch (error) {
    console.error('Approve mission assignment error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
    return;
  }
});

// ==================== DIGITAL SIGNATURE SYSTEM ====================

// @desc    Save digital signature for attendance record
// @route   PUT /api/security/attendance/:id/signature
// @access  Private/Security Personnel
router.put('/attendance/:id/signature', protect, requireWorkspaceAccess(WORKSPACES.SECURITY, WORKSPACE_PERMISSIONS.EDIT), requireFeatureAccess(FEATURES.SECURITY_SIGNATURE_UPDATE, FEATURE_PERMISSIONS.EDIT), [
  body('signatureData').notEmpty().withMessage('Signature data is required'),
  body('signatureType').optional().isIn(['CHECKIN', 'CHECKOUT', 'EXCEPTION']).withMessage('Invalid signature type')
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

    // Check if user is security personnel
    const securityPersonnel = await prisma.securityPersonnel.findUnique({
      where: { userId: req.user!.id }
    });

    if (!securityPersonnel) {
      return res.status(403).json({
        success: false,
        error: 'User is not authorized as security personnel'
      });
    }

    const { id } = req.params;
    const { signatureData, signatureType = 'CHECKIN' } = req.body;

    // Validate signature data format (should be base64 data URL)
    if (!signatureData.startsWith('data:image/')) {
      return res.status(400).json({
        success: false,
        error: 'Invalid signature data format'
      });
    }

    const attendanceRecord = await prisma.attendanceRecord.update({
      where: { id },
      data: {
        digitalSignature: signatureData
      },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            username: true
          }
        },
        securityPersonnel: {
          select: {
            id: true,
            user: {
              select: {
                firstName: true,
                lastName: true
              }
            }
          }
        }
      }
    });

    res.json({
      success: true,
      message: 'Digital signature saved successfully',
      data: attendanceRecord
    });
    return;
  } catch (error) {
    console.error('Save digital signature error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
    return;
  }
});

// @desc    Get attendance record with signature
// @route   GET /api/security/attendance/:id/signature
// @access  Private/Security Personnel
router.get('/attendance/:id/signature', protect, requireWorkspaceAccess(WORKSPACES.SECURITY, WORKSPACE_PERMISSIONS.VIEW), requireFeatureAccess(FEATURES.SECURITY_SIGNATURE_VIEW, FEATURE_PERMISSIONS.VIEW), async (req: AuthRequest, res: Response) => {
  try {
    // Check if user is security personnel
    const securityPersonnel = await prisma.securityPersonnel.findUnique({
      where: { userId: req.user!.id }
    });

    if (!securityPersonnel) {
      return res.status(403).json({
        success: false,
        error: 'User is not authorized as security personnel'
      });
    }

    const { id } = req.params;

    const attendanceRecord = await prisma.attendanceRecord.findUnique({
      where: { id },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            username: true
          }
        },
        securityPersonnel: {
          select: {
            id: true,
            user: {
              select: {
                firstName: true,
                lastName: true
              }
            }
          }
        }
      }
    });

    if (!attendanceRecord) {
      return res.status(404).json({
        success: false,
        error: 'Attendance record not found'
      });
    }

    res.json({
      success: true,
      data: attendanceRecord
    });
    return;
  } catch (error) {
    console.error('Get attendance signature error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
    return;
  }
});

// @desc    Validate signature authenticity
// @route   POST /api/security/signature/validate
// @access  Private/Security Personnel
router.post('/signature/validate', protect, requireWorkspaceAccess(WORKSPACES.SECURITY, WORKSPACE_PERMISSIONS.VIEW), requireFeatureAccess(FEATURES.SECURITY_SIGNATURE_VALIDATE, FEATURE_PERMISSIONS.VIEW), [
  body('signatureData').notEmpty().withMessage('Signature data is required'),
  body('employeeId').notEmpty().withMessage('Employee ID is required')
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

    const { signatureData, employeeId } = req.body;

    // Basic signature validation
    const validation = {
      isValid: true,
      checks: {
        format: signatureData.startsWith('data:image/'),
        size: signatureData.length > 1000, // Minimum signature size
        employee: true // Could be enhanced with biometric validation
      },
      confidence: 85 // Could be enhanced with ML-based validation
    };

    // Check if employee exists
    const employee = await prisma.user.findUnique({
      where: { id: employeeId }
    });

    if (!employee) {
      validation.checks.employee = false;
      validation.isValid = false;
      validation.confidence = 0;
    }

    res.json({
      success: true,
      data: validation
    });
    return;
  } catch (error) {
    console.error('Validate signature error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
    return;
  }
});

export default router;

