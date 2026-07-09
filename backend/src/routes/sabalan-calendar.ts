import express, { Response } from 'express';
import { body, validationResult } from 'express-validator';
import { PrismaClient, SabalanCalendarEventType } from '@prisma/client';
import { protect, authorize, AuthRequest } from '../middleware/auth';

const router = express.Router();
const prisma = new PrismaClient();

const startOfDay = (date: Date) => {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
};

const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const parseDate = (value: unknown, fallback = new Date()) => {
  const parsed = value ? new Date(String(value)) : fallback;
  return startOfDay(Number.isNaN(parsed.getTime()) ? fallback : parsed);
};

const parseBoolean = (value: unknown, fallback = false) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value === 'true';
  return fallback;
};

router.get('/', protect, authorize('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const from = parseDate(req.query.from);
    const to = req.query.to ? addDays(parseDate(req.query.to), 1) : addDays(from, 370);
    const entries = await prisma.sabalanCalendarEntry.findMany({
      where: {
        date: { gte: from, lt: to },
        ...(req.query.includeInactive === 'true' ? {} : { isActive: true })
      },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }]
    });
    res.json({ success: true, data: entries });
  } catch (error) {
    console.error('List Sabalan calendar entries error:', error);
    res.status(500).json({ success: false, error: 'دریافت تقویم سالیانه ناموفق بود.' });
  }
});

router.post('/', protect, authorize('ADMIN'), [
  body('date').isISO8601(),
  body('title').isString().trim().notEmpty(),
  body('description').optional({ values: 'falsy' }).isString(),
  body('eventType').isIn(Object.values(SabalanCalendarEventType)),
  body('isHoliday').isBoolean(),
  body('isActive').optional().isBoolean()
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'اطلاعات رویداد تقویم کامل نیست.', details: errors.array() });
    const entry = await prisma.sabalanCalendarEntry.create({
      data: {
        date: parseDate(req.body.date),
        title: req.body.title.trim(),
        description: String(req.body.description || '').trim() || null,
        eventType: req.body.eventType,
        isHoliday: parseBoolean(req.body.isHoliday),
        isActive: parseBoolean(req.body.isActive, true),
        createdBy: req.user!.id
      }
    });
    res.status(201).json({ success: true, data: entry });
  } catch (error) {
    console.error('Create Sabalan calendar entry error:', error);
    res.status(500).json({ success: false, error: 'ثبت رویداد تقویم ناموفق بود.' });
  }
});

router.put('/:id', protect, authorize('ADMIN'), [
  body('date').isISO8601(),
  body('title').isString().trim().notEmpty(),
  body('description').optional({ values: 'falsy' }).isString(),
  body('eventType').isIn(Object.values(SabalanCalendarEventType)),
  body('isHoliday').isBoolean(),
  body('isActive').isBoolean()
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'اطلاعات رویداد تقویم کامل نیست.', details: errors.array() });
    const entry = await prisma.sabalanCalendarEntry.update({
      where: { id: req.params.id },
      data: {
        date: parseDate(req.body.date),
        title: req.body.title.trim(),
        description: String(req.body.description || '').trim() || null,
        eventType: req.body.eventType,
        isHoliday: parseBoolean(req.body.isHoliday),
        isActive: parseBoolean(req.body.isActive)
      }
    });
    res.json({ success: true, data: entry });
  } catch (error) {
    console.error('Update Sabalan calendar entry error:', error);
    res.status(500).json({ success: false, error: 'ویرایش رویداد تقویم ناموفق بود.' });
  }
});

export default router;
