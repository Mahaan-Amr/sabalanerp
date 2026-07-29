import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import express, { type Response } from 'express';
import multer from 'multer';
import { body, validationResult } from 'express-validator';
import { Prisma, PrismaClient } from '@prisma/client';
import { authorize, protect, type AuthRequest } from '../middleware/auth';
import { enforceMutationIdempotency } from '../middleware/idempotency';
import { getUserWorkspaces } from '../middleware/workspace';
import { FEATURES, FEATURE_LABELS, getUserFeatures } from '../middleware/feature';
import {
  canAccessTicket,
  canAccessSensitiveEvidence,
  canMutateTicket,
  canTransitionTicket,
  deriveSuggestedPriority,
  sanitizeDiagnosticSnapshot,
  sanitizeSensitiveEvidenceSnapshot,
  type TicketImpact,
  type TicketParticipantRole,
} from '../services/supportTicketPolicy';
import { publishNotificationEvent } from '../services/notificationService';
import { resolveWorkspaceRecipientIds } from '../services/domainNotificationRecipients';
import { buildSupportDiagnosticBundle } from '../services/supportDiagnosticBundle';
import { scanHiringFile } from '../services/hrHiringFileStorage';
import {
  addSupportMinutes,
  elapsedSupportMinutes,
  latestSupportSlaPolicy,
  parseSupportCalendar,
  parseSupportTargets,
  supportDeadlines,
} from '../services/supportSlaPolicy';

const router = express.Router();
const execFileAsync = promisify(execFile);
const prisma = new PrismaClient();
const ticketTypes = ['TECHNICAL_ERROR', 'INCORRECT_DATA', 'ACCESS_PROBLEM', 'GUIDANCE', 'IMPROVEMENT', 'SECURITY_PRIVACY', 'OTHER'];
const impacts: TicketImpact[] = ['MINOR', 'SINGLE_TASK', 'BLOCKED', 'WIDESPREAD'];
const ticketStorageDir = path.resolve(process.env.SUPPORT_TICKET_STORAGE_DIR || path.join(process.cwd(), 'storage', 'support-tickets'));
fs.mkdirSync(ticketStorageDir, { recursive: true });
const attachmentUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, ticketStorageDir),
    filename: (_req, file, callback) => callback(
      null,
      `${Date.now()}-${crypto.randomBytes(16).toString('hex')}${path.extname(file.originalname).toLowerCase().slice(0, 12)}`,
    ),
  }),
  limits: { files: 1, fileSize: 25 * 1024 * 1024 },
});
const stagedAttachmentUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, ticketStorageDir),
    filename: (_req, file, callback) => callback(
      null,
      `staged-${Date.now()}-${crypto.randomBytes(16).toString('hex')}${path.extname(file.originalname).toLowerCase().slice(0, 12)}`,
    ),
  }),
  limits: { files: 1, fileSize: 25 * 1024 * 1024 },
});
const allowedAttachmentTypes: Record<string, { kind: 'IMAGE' | 'AUDIO' | 'DOCUMENT'; maxSize: number }> = {
  'image/jpeg': { kind: 'IMAGE', maxSize: 10 * 1024 * 1024 },
  'image/png': { kind: 'IMAGE', maxSize: 10 * 1024 * 1024 },
  'image/webp': { kind: 'IMAGE', maxSize: 10 * 1024 * 1024 },
  'audio/webm': { kind: 'AUDIO', maxSize: 20 * 1024 * 1024 },
  'audio/ogg': { kind: 'AUDIO', maxSize: 20 * 1024 * 1024 },
  'audio/mpeg': { kind: 'AUDIO', maxSize: 20 * 1024 * 1024 },
  'audio/mp4': { kind: 'AUDIO', maxSize: 20 * 1024 * 1024 },
  'audio/wav': { kind: 'AUDIO', maxSize: 20 * 1024 * 1024 },
  'application/pdf': { kind: 'DOCUMENT', maxSize: 25 * 1024 * 1024 },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { kind: 'DOCUMENT', maxSize: 25 * 1024 * 1024 },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { kind: 'DOCUMENT', maxSize: 25 * 1024 * 1024 },
  'text/plain': { kind: 'DOCUMENT', maxSize: 2 * 1024 * 1024 },
};

const hasSafeFileSignature = (filePath: string, mimeType: string) => {
  const bytes = Buffer.alloc(16);
  const descriptor = fs.openSync(filePath, 'r');
  try {
    fs.readSync(descriptor, bytes, 0, bytes.length, 0);
  } finally {
    fs.closeSync(descriptor);
  }
  if (mimeType === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mimeType === 'image/webp') return bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (mimeType === 'application/pdf') return bytes.toString('ascii', 0, 5) === '%PDF-';
  if (mimeType.includes('officedocument')) return bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (mimeType === 'audio/webm') return bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  if (mimeType === 'audio/ogg') return bytes.toString('ascii', 0, 4) === 'OggS';
  if (mimeType === 'audio/mpeg') return bytes.toString('ascii', 0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
  if (mimeType === 'audio/mp4') return bytes.toString('ascii', 4, 8) === 'ftyp';
  if (mimeType === 'audio/wav') return bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE';
  return mimeType === 'text/plain' && !bytes.includes(0);
};
const audioDurationSeconds = async (filePath: string) => {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    filePath,
  ], { timeout: 15_000, windowsHide: true });
  const duration = Number(String(stdout).trim());
  return Number.isFinite(duration) ? Math.ceil(duration) : 0;
};

const removeUploadedFile = (filePath?: string) => {
  if (!filePath) return;
  try { fs.unlinkSync(filePath); } catch {}
};

type StagedAttachment = {
  userId: string;
  storageName: string;
  originalName: string;
  mimeType: string;
  size: number;
  sha256: string;
  kind: 'IMAGE' | 'AUDIO' | 'DOCUMENT';
  durationSeconds: number | null;
  sensitive: boolean;
  transcript: string;
  malwareScanStatus: string;
  expiresAt: number;
};

const stagedAttachmentSecret = () => process.env.JWT_SECRET || 'local-support-staging-key';
const signStagedAttachment = (value: StagedAttachment) => {
  const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
  const signature = crypto.createHmac('sha256', stagedAttachmentSecret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
};
const verifyStagedAttachment = (token: string, userId: string): StagedAttachment | null => {
  const [payload, signature] = token.split('.', 2);
  if (!payload || !signature) return null;
  const expected = crypto.createHmac('sha256', stagedAttachmentSecret()).update(payload).digest('base64url');
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as StagedAttachment;
    if (value.userId !== userId || value.expiresAt < Date.now() || path.basename(value.storageName) !== value.storageName) return null;
    if (!fs.existsSync(path.join(ticketStorageDir, value.storageName))) return null;
    return value;
  } catch {
    return null;
  }
};
const supportMutationWindows = new Map<string, number[]>();
const consumeSupportRate = (key: string, limit: number, windowMs: number) => {
  const cutoff = Date.now() - windowMs;
  const recent = (supportMutationWindows.get(key) || []).filter((time) => time > cutoff);
  if (recent.length >= limit) return false;
  supportMutationWindows.set(key, [...recent, Date.now()]);
  return true;
};

const designatedIncidentHandlerIds = async (database: PrismaClient | Prisma.TransactionClient) => {
  const rows = await database.featurePermission.findMany({
    where: {
      feature: FEATURES.SUPPORT_SECURITY_INCIDENT_HANDLE,
      isActive: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      user: { isActive: true },
    },
    select: { userId: true },
  });
  return rows.map((row) => row.userId);
};

const isDesignatedIncidentHandler = async (database: PrismaClient | Prisma.TransactionClient, userId: string) => (
  (await database.featurePermission.count({
    where: {
      userId,
      feature: FEATURES.SUPPORT_SECURITY_INCIDENT_HANDLE,
      isActive: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
  })) > 0
);

router.use(protect);
router.use(enforceMutationIdempotency);

const workspaceAccess = async (userId: string, role: string) => {
  const rows = await getUserWorkspaces(userId, role);
  return {
    accessible: rows.map((row) => row.workspace),
    managed: rows.filter((row) => ['edit', 'admin'].includes(row.permission)).map((row) => row.workspace),
  };
};

const featureAccess = async (userId: string, role: string) => (
  await getUserFeatures(userId, role)
).map((row) => `${row.workspace}:${row.feature}`);
const managedFeatureAccess = async (userId: string, role: string) => (
  await getUserFeatures(userId, role)
).filter((row) => ['edit', 'admin'].includes(row.permission)).map((row) => `${row.workspace}:${row.feature}`);

const accessSubject = (ticket: any) => ({
  reporterId: ticket.reporterId,
  workspace: ticket.reportedWorkspace,
  feature: ticket.reportedFeature,
  restrictedIncident: ticket.restrictedIncident,
  participants: (ticket.participants || [])
    .filter((participant: any) => !participant.removedAt)
    .map((participant: any) => ({ userId: participant.userId, role: participant.role })),
});

const ensureAccess = async (req: AuthRequest, res: Response, ticket: any): Promise<boolean> => {
  const workspaces = await workspaceAccess(req.user!.id, req.user!.role);
  const accessibleFeatures = await featureAccess(req.user!.id, req.user!.role);
  const managedFeatures = await managedFeatureAccess(req.user!.id, req.user!.role);
  const participant = (ticket.participants || []).find(
    (item: any) => item.userId === req.user!.id && !item.removedAt,
  );
  const designatedIncidentHandler = ticket.restrictedIncident
    ? await isDesignatedIncidentHandler(prisma, req.user!.id)
    : false;
  const allowed = canAccessTicket({
    id: req.user!.id,
    role: req.user!.role,
    managedWorkspaces: workspaces.managed,
    accessibleWorkspaces: workspaces.accessible,
    accessibleFeatures,
    managedFeatures,
    securityIncidentHandler: ticket.restrictedIncident
      && (designatedIncidentHandler || ['HANDLER', 'COLLABORATOR'].includes(participant?.role)),
  }, accessSubject(ticket));
  if (!allowed) res.status(404).json({ success: false, error: 'تیکت پیدا نشد.' });
  return allowed;
};

const handlerContext = async (req: AuthRequest, ticket: any) => {
  const workspaces = await workspaceAccess(req.user!.id, req.user!.role);
  const managedFeatures = await managedFeatureAccess(req.user!.id, req.user!.role);
  const participant = (ticket.participants || []).find(
    (item: any) => item.userId === req.user!.id && !item.removedAt,
  );
  const designatedIncidentHandler = ticket.restrictedIncident
    ? await isDesignatedIncidentHandler(prisma, req.user!.id)
    : false;
  const workspaceHandler = req.user!.role === 'ADMIN'
    || designatedIncidentHandler
    || (req.user!.role === 'MANAGER'
      && !ticket.restrictedIncident
      && ticket.reportedWorkspace
      && workspaces.managed.includes(ticket.reportedWorkspace)
      && (!ticket.reportedFeature || managedFeatures.includes(`${ticket.reportedWorkspace}:${ticket.reportedFeature}`)));
  return {
    participantRole: (participant?.role || null) as TicketParticipantRole | null,
    workspaceHandler,
    canMutate: canMutateTicket(
      (participant?.role || null) as TicketParticipantRole | null,
      workspaceHandler,
      ticket.restrictedIncident,
    ),
  };
};

const loadTicketForMutation = async (req: AuthRequest, res: Response) => {
  const ticket = await prisma.supportTicket.findUnique({
    where: { id: req.params.id },
    include: { participants: true },
  });
  if (!ticket || !(await ensureAccess(req, res, ticket))) return null;
  return ticket;
};

router.get('/context', async (req: AuthRequest, res) => {
  const workspaces = await workspaceAccess(req.user!.id, req.user!.role);
  const features = await getUserFeatures(req.user!.id, req.user!.role);
  res.json({
    success: true,
    data: {
      workspaces: workspaces.accessible,
      features: features.map((feature) => ({
        ...feature,
        label: FEATURE_LABELS[feature.feature],
      })),
    },
  });
});

router.get('/admin/sla-policies', authorize('ADMIN'), async (_req, res) => {
  const rows = await prisma.supportSlaPolicyVersion.findMany({
    orderBy: { version: 'desc' },
    include: { createdBy: { select: { id: true, firstName: true, lastName: true, username: true } } },
  });
  if (!rows.length) await latestSupportSlaPolicy(prisma);
  const data = rows.length ? rows : await prisma.supportSlaPolicyVersion.findMany({ orderBy: { version: 'desc' } });
  res.json({ success: true, data });
});

router.post(
  '/admin/sla-policies',
  authorize('ADMIN'),
  [
    body('calendar').isObject(),
    body('targets').isObject(),
    body('changeReason').isString().trim().isLength({ min: 5, max: 1_000 }),
  ],
  async (req: AuthRequest, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'سیاست زمان پاسخ معتبر نیست.' });
    try {
      parseSupportCalendar(req.body.calendar);
      parseSupportTargets(req.body.targets);
    } catch (error) {
      return res.status(400).json({ success: false, error: error instanceof Error ? error.message : 'سیاست معتبر نیست.' });
    }
    const created = await prisma.$transaction(async (tx) => {
      const latest = await tx.supportSlaPolicyVersion.findFirst({ orderBy: { version: 'desc' }, select: { version: true } });
      return tx.supportSlaPolicyVersion.create({
        data: {
          version: (latest?.version || 0) + 1,
          calendar: req.body.calendar,
          targets: req.body.targets,
          changeReason: req.body.changeReason.trim(),
          createdById: req.user!.id,
        },
      });
    });
    res.status(201).json({ success: true, data: created });
  },
);

router.get('/', async (req: AuthRequest, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
  const workspaces = await workspaceAccess(req.user!.id, req.user!.role);
  const accessibleFeatures = await managedFeatureAccess(req.user!.id, req.user!.role);
  const filters: Prisma.SupportTicketWhereInput = {
    ...(typeof req.query.status === 'string' ? { status: req.query.status } : {}),
    ...(typeof req.query.workspace === 'string' ? { reportedWorkspace: req.query.workspace } : {}),
    ...(typeof req.query.feature === 'string' ? { reportedFeature: req.query.feature } : {}),
    ...(typeof req.query.type === 'string' ? { type: req.query.type } : {}),
    ...(typeof req.query.reporter === 'string' ? { reporterId: req.query.reporter } : {}),
    ...(typeof req.query.assignee === 'string'
      ? { participants: { some: { userId: req.query.assignee, removedAt: null } } }
      : {}),
    ...(typeof req.query.priority === 'string'
      ? {
          OR: [
            { confirmedPriority: req.query.priority },
            { confirmedPriority: null, suggestedPriority: req.query.priority },
          ],
        }
      : {}),
    ...(Number(req.query.ageDays) > 0
      ? { createdAt: { lte: new Date(Date.now() - Number(req.query.ageDays) * 86_400_000) } }
      : {}),
  };
  let scope: Prisma.SupportTicketWhereInput = {};
  const designatedIncidentHandler = req.user!.role !== 'ADMIN'
    ? await isDesignatedIncidentHandler(prisma, req.user!.id)
    : false;
  if (req.user!.role === 'MANAGER') {
    scope = {
      OR: [
        ...(designatedIncidentHandler ? [{ restrictedIncident: true }] : []),
        { reporterId: req.user!.id },
        { participants: { some: { userId: req.user!.id, removedAt: null } } },
        {
          restrictedIncident: false,
          OR: [
            { reportedWorkspace: { in: workspaces.managed }, reportedFeature: null },
            ...accessibleFeatures.map((value) => {
              const [workspace, feature] = value.split(':', 2);
              return { reportedWorkspace: workspace, reportedFeature: feature };
            }),
          ],
        },
      ],
    };
  } else if (req.user!.role !== 'ADMIN') {
    scope = {
      OR: [
        ...(designatedIncidentHandler ? [{ restrictedIncident: true }] : []),
        { reporterId: req.user!.id },
        { participants: { some: { userId: req.user!.id, removedAt: null } } },
      ],
    };
  }
  const rows = await prisma.supportTicket.findMany({
    where: { AND: [scope, filters] },
    take: limit,
    orderBy: { createdAt: 'desc' },
    include: {
      reporter: { select: { id: true, firstName: true, lastName: true, username: true } },
      participants: {
        where: { removedAt: null },
        include: { user: { select: { id: true, firstName: true, lastName: true, username: true } } },
      },
      _count: { select: { entries: true, attachments: true, duplicateTickets: true } },
    },
  });
  const now = Date.now();
  res.json({
    success: true,
    data: rows.map((ticket) => ({
      id: ticket.id,
      referenceCode: ticket.referenceCode,
      title: ticket.title,
      type: ticket.type,
      impact: ticket.impact,
      status: ticket.status,
      suggestedPriority: ticket.suggestedPriority,
      confirmedPriority: ticket.confirmedPriority,
      reportedWorkspace: ticket.reportedWorkspace,
      reportedFeature: ticket.reportedFeature,
      restrictedIncident: ticket.restrictedIncident,
      createdAt: ticket.createdAt,
      updatedAt: ticket.updatedAt,
      resolutionDueAt: ticket.resolutionDueAt,
      reporter: ticket.restrictedIncident && req.user!.role !== 'ADMIN' && req.user!.id !== ticket.reporterId
        ? { id: 'protected-reporter', firstName: 'گزارشگر', lastName: 'حفاظت‌شده', username: 'protected' }
        : ticket.reporter,
      participants: ticket.participants,
      _count: ticket._count,
      operationalTargetState: ticket.resolutionDueAt
        ? ticket.resolutionDueAt.getTime() < now
          ? 'OVERDUE'
          : ticket.resolutionDueAt.getTime() - now <= 60 * 60 * 1_000
            ? 'NEAR_BREACH'
            : 'ON_TRACK'
        : null,
    })),
  });
});

router.post('/attachments/stage', stagedAttachmentUpload.single('file'), async (req: AuthRequest, res) => {
  try {
    if (!consumeSupportRate(`stage:${req.user!.id}`, 30, 10 * 60 * 1_000)) {
      removeUploadedFile(req.file?.path);
      return res.status(429).json({ success: false, error: 'تعداد بارگذاری‌ها بیش از حد مجاز است؛ کمی بعد دوباره تلاش کنید.' });
    }
    if (!req.file) return res.status(400).json({ success: false, error: 'فایل انتخاب نشده است.' });
    const policy = allowedAttachmentTypes[req.file.mimetype];
    if (!policy || req.file.size > policy.maxSize || !hasSafeFileSignature(req.file.path, req.file.mimetype)) {
      removeUploadedFile(req.file.path);
      return res.status(400).json({ success: false, error: 'نوع، اندازه یا محتوای فایل مجاز نیست.' });
    }
    const durationSeconds = policy.kind === 'AUDIO' ? await audioDurationSeconds(req.file.path) : null;
    const sensitive = policy.kind === 'AUDIO' || String(req.body.sensitive) === 'true';
    if (sensitive && String(req.body.sensitiveEvidenceConsent) !== 'true') {
      removeUploadedFile(req.file.path);
      return res.status(409).json({ success: false, error: 'برای بارگذاری شاهد حساس باید رضایت مربوطه فعال باشد.' });
    }
    if (policy.kind === 'AUDIO' && (!Number.isFinite(durationSeconds) || durationSeconds! <= 0 || durationSeconds! > 600)) {
      removeUploadedFile(req.file.path);
      return res.status(400).json({ success: false, error: 'مدت پیام صوتی باید حداکثر ۱۰ دقیقه باشد.' });
    }
    const staged: StagedAttachment = {
      userId: req.user!.id,
      storageName: path.basename(req.file.path),
      originalName: path.basename(req.file.originalname).slice(0, 255),
      mimeType: req.file.mimetype,
      size: req.file.size,
      sha256: crypto.createHash('sha256').update(fs.readFileSync(req.file.path)).digest('hex'),
      kind: policy.kind,
      durationSeconds: durationSeconds ? Math.round(durationSeconds) : null,
      sensitive,
      transcript: policy.kind === 'AUDIO' ? String(req.body.transcript || '').trim().slice(0, 10_000) : '',
      malwareScanStatus: await scanHiringFile(req.file.path),
      expiresAt: Date.now() + 30 * 60 * 1_000,
    };
    res.status(201).json({ success: true, data: { token: signStagedAttachment(staged) } });
  } catch (error) {
    removeUploadedFile(req.file?.path);
    throw error;
  }
});

router.post(
  '/',
  [
    body('title').isString().trim().isLength({ min: 3, max: 180 }),
    body('type').isIn(ticketTypes),
    body('impact').isIn(impacts),
    body('workaroundExists').isBoolean(),
    body('originRoute').isString().trim().isLength({ min: 1, max: 500 }),
    body('description').optional({ nullable: true }).isString().trim().isLength({ max: 10_000 }),
    body('reportedWorkspace').optional({ nullable: true }).isString().isLength({ max: 80 }),
    body('reportedFeature').optional({ nullable: true }).isString().isLength({ max: 160 }),
    body('steps').optional({ nullable: true }).isString().isLength({ max: 5_000 }),
    body('expectedResult').optional({ nullable: true }).isString().isLength({ max: 5_000 }),
    body('stagedAttachmentTokens').optional().isArray({ max: 5 }),
    body('stagedAttachmentTokens.*').isString().isLength({ min: 20, max: 20_000 }),
    body('sensitiveEvidenceConsent').optional().isBoolean(),
    body('sensitiveEvidenceSnapshot').optional({ nullable: true }).isObject(),
  ],
  async (req: AuthRequest, res) => {
    const requestedIdempotencyKey = String(req.header('x-idempotency-key') || '').trim();
    if (!/^[a-zA-Z0-9._:-]{16,160}$/.test(requestedIdempotencyKey)) {
      return res.status(400).json({ success: false, error: 'کلید جلوگیری از ثبت تکراری معتبر نیست.' });
    }
    const idempotencyKey = `${req.user!.id}:${requestedIdempotencyKey}`;
    const existingTicket = await prisma.supportTicket.findUnique({ where: { idempotencyKey } });
    if (existingTicket) return res.json({ success: true, data: existingTicket, idempotentReplay: true });
    if (!consumeSupportRate(`create:${req.user!.id}`, 10, 10 * 60 * 1_000)) {
      return res.status(429).json({ success: false, error: 'تعداد تیکت‌های ثبت‌شده بیش از حد مجاز است؛ کمی بعد دوباره تلاش کنید.' });
    }
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'اطلاعات تیکت معتبر نیست.', details: errors.array() });
    const description = String(req.body.description || '').trim();
    const stagedAttachments = (Array.isArray(req.body.stagedAttachmentTokens) ? req.body.stagedAttachmentTokens : [])
      .map((token: string) => verifyStagedAttachment(token, req.user!.id));
    if (stagedAttachments.some((attachment) => !attachment)) {
      return res.status(400).json({ success: false, error: 'یکی از پیوست‌های موقت معتبر نیست یا منقضی شده است.' });
    }
    const validStagedAttachments = stagedAttachments.filter((attachment): attachment is StagedAttachment => Boolean(attachment));
    if (!description && !validStagedAttachments.length) {
      return res.status(400).json({ success: false, error: 'حداقل یک توضیح، تصویر یا پیام صوتی لازم است.' });
    }
    if (validStagedAttachments.some((attachment) => attachment.sensitive) && !req.body.sensitiveEvidenceConsent) {
      return res.status(409).json({ success: false, error: 'برای ارسال شاهد حساس باید رضایت مربوطه فعال باشد.' });
    }
    const workspaces = await workspaceAccess(req.user!.id, req.user!.role);
    const accessibleFeatures = await featureAccess(req.user!.id, req.user!.role);
    const reportedWorkspace = req.body.reportedWorkspace || null;
    const reportedFeature = req.body.reportedFeature || null;
    if (reportedWorkspace && !workspaces.accessible.includes(reportedWorkspace) && req.user!.role !== 'ADMIN') {
      return res.status(403).json({ success: false, error: 'فضای کاری انتخاب‌شده در دسترس شما نیست.' });
    }
    if (
      reportedFeature
      && req.user!.role !== 'ADMIN'
      && !accessibleFeatures.includes(`${reportedWorkspace || ''}:${reportedFeature}`)
    ) {
      return res.status(403).json({ success: false, error: 'قابلیت انتخاب‌شده در دسترس شما نیست.' });
    }
    const restrictedIncident = req.body.type === 'SECURITY_PRIVACY';
    const diagnosticSnapshot = sanitizeDiagnosticSnapshot(req.body.diagnosticSnapshot);
    const sensitiveEvidenceSnapshot = req.body.sensitiveEvidenceConsent
      ? sanitizeSensitiveEvidenceSnapshot(req.body.sensitiveEvidenceSnapshot)
      : null;
    const suggestedPriority = deriveSuggestedPriority({
      impact: req.body.impact,
      workaroundExists: req.body.workaroundExists,
      restrictedIncident,
      workspace: reportedWorkspace,
    });
    const referenceCode = `SUP-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const ticket = await prisma.$transaction(async (tx) => {
      const created = await tx.supportTicket.create({
        data: {
          referenceCode,
          idempotencyKey,
          reporterId: req.user!.id,
          title: req.body.title.trim(),
          type: req.body.type,
          impact: req.body.impact,
          workaroundExists: req.body.workaroundExists,
          reportedWorkspace,
          reportedFeature,
          originRoute: diagnosticSnapshot.route || String(req.body.originRoute).split(/[?#]/, 1)[0],
          diagnosticSnapshot: diagnosticSnapshot as Prisma.InputJsonValue,
          releaseBuild: diagnosticSnapshot.buildCommit || null,
          effectiveAccessSnapshot: { role: req.user!.role, workspaces: workspaces.accessible, capturedAt: new Date().toISOString() },
          sensitiveEvidenceConsent: Boolean(req.body.sensitiveEvidenceConsent),
          sensitiveEvidenceSnapshot: sensitiveEvidenceSnapshot
            ? sensitiveEvidenceSnapshot as Prisma.InputJsonValue
            : undefined,
          restrictedIncident,
          suggestedPriority,
          entries: description ? { create: { authorId: req.user!.id, kind: 'REPORT', body: description } } : undefined,
          auditEvents: {
            create: {
              actorId: req.user!.id,
              action: 'CREATED',
              afterData: { steps: req.body.steps || null, expectedResult: req.body.expectedResult || null, suggestedPriority },
            },
          },
        },
        include: { reporter: true, participants: true, entries: true },
      });
      for (const attachment of validStagedAttachments) {
        const entry = await tx.supportTicketEntry.create({
          data: {
            ticketId: created.id,
            authorId: req.user!.id,
            kind: 'ATTACHMENT',
            body: attachment.kind === 'AUDIO' ? 'پیام صوتی' : attachment.originalName,
            transcriptOriginal: attachment.transcript || null,
            transcriptCurrent: attachment.transcript || null,
            transcriptVersion: attachment.transcript ? 1 : 0,
          },
        });
        const saved = await tx.supportTicketAttachment.create({
          data: {
            ticketId: created.id,
            entryId: entry.id,
            kind: attachment.kind,
            storageName: attachment.storageName,
            originalName: attachment.originalName,
            mimeType: attachment.mimeType,
            size: attachment.size,
            sha256: attachment.sha256,
            durationSeconds: attachment.durationSeconds,
            sensitive: attachment.sensitive,
            malwareScanStatus: attachment.malwareScanStatus,
            retentionClass: restrictedIncident
              ? 'SECURITY_INCIDENT_ONE_YEAR'
              : attachment.sensitive ? 'SENSITIVE_90_DAYS' : 'ORDINARY_ONE_YEAR',
          },
        });
        await tx.supportTicketAuditEvent.create({
          data: {
            ticketId: created.id,
            actorId: req.user!.id,
            action: 'ATTACHMENT_ADDED',
            afterData: { attachmentId: saved.id, kind: saved.kind, sensitive: saved.sensitive, sha256: saved.sha256 },
          },
        });
      }
      const authorizedWorkspaceUsers = !restrictedIncident && reportedWorkspace
        ? await resolveWorkspaceRecipientIds(tx, reportedWorkspace, 'edit')
        : [];
      const incidentHandlers = restrictedIncident ? await designatedIncidentHandlerIds(tx) : [];
      const recipients = await tx.user.findMany({
        where: {
          isActive: true,
          ...(restrictedIncident
            ? { OR: [{ role: 'ADMIN' }, { id: { in: incidentHandlers } }] }
            : {
                role: { in: ['ADMIN', 'MANAGER'] },
                ...(reportedWorkspace
                  ? { OR: [{ role: 'ADMIN' }, { id: { in: authorizedWorkspaceUsers } }] }
                  : { role: 'ADMIN' }),
              }),
        },
        select: { id: true, role: true },
      });
      await publishNotificationEvent(tx, {
        type: 'SUPPORT_TICKET_CREATED',
        deduplicationKey: `support-ticket-created:${created.id}`,
        recipientIds: recipients.map((user) => user.id),
        recipientGroups: {
          ACTIVE_ADMINS: recipients.filter((user) => user.role === 'ADMIN').map((user) => user.id),
          SECURITY_INCIDENT_HANDLERS: restrictedIncident
            ? recipients.filter((user) => incidentHandlers.includes(user.id)).map((user) => user.id)
            : [],
          WORKSPACE_MANAGERS: recipients.filter((user) => user.role === 'MANAGER').map((user) => user.id),
        },
        actorId: req.user!.id,
        workspace: reportedWorkspace,
        feature: req.body.reportedFeature || null,
        resourceType: 'support-ticket',
        resourceId: created.id,
        referenceId: created.referenceCode,
        actionUrl: `/dashboard/support/tickets/${created.id}`,
        payload: {
          referenceCode: created.referenceCode,
          reporterName: restrictedIncident ? 'گزارشگر حفاظت‌شده' : `${created.reporter.firstName} ${created.reporter.lastName}`,
        },
      });
      return created;
    });
    res.status(201).json({ success: true, data: ticket });
  },
);

router.post(
  '/:id/entries',
  [body('body').isString().trim().isLength({ min: 1, max: 10_000 })],
  async (req: AuthRequest, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'متن پاسخ معتبر نیست.' });
    const ticket = await loadTicketForMutation(req, res);
    if (!ticket) return;
    const handler = await handlerContext(req, ticket);
    const isReporter = ticket.reporterId === req.user!.id;
    if (!isReporter && !handler.canMutate) {
      return res.status(403).json({ success: false, error: 'ناظر فقط اجازه مشاهده دارد.' });
    }
    if (ticket.status === 'CLOSED') {
      return res.status(409).json({ success: false, error: 'برای پاسخ، ابتدا تیکت را بازگشایی کنید.' });
    }
    const result = await prisma.$transaction(async (tx) => {
      const entry = await tx.supportTicketEntry.create({
        data: { ticketId: ticket.id, authorId: req.user!.id, kind: 'COMMENT', body: req.body.body.trim() },
        include: { author: { select: { id: true, firstName: true, lastName: true, username: true } } },
      });
      const status = isReporter && ticket.status === 'WAITING_REPORTER' ? 'IN_PROGRESS' : ticket.status;
      let resolutionDueAt = ticket.resolutionDueAt;
      if (
        status === 'IN_PROGRESS'
        && ticket.status === 'WAITING_REPORTER'
        && ticket.waitingForReporterAt
        && ticket.resolutionDueAt
        && ticket.slaPolicyVersion
      ) {
        const policy = await tx.supportSlaPolicyVersion.findUnique({ where: { version: ticket.slaPolicyVersion } });
        if (policy) {
          const calendar = parseSupportCalendar(policy.calendar);
          const pausedMinutes = elapsedSupportMinutes(ticket.waitingForReporterAt, new Date(), calendar);
          resolutionDueAt = addSupportMinutes(ticket.resolutionDueAt, pausedMinutes, calendar);
        }
      }
      await tx.supportTicket.update({
        where: { id: ticket.id },
        data: {
          status,
          waitingForReporterAt: status === 'IN_PROGRESS' ? null : ticket.waitingForReporterAt,
          resolutionDueAt,
        },
      });
      await tx.supportTicketAuditEvent.create({
        data: { ticketId: ticket.id, actorId: req.user!.id, action: 'ENTRY_ADDED', afterData: { entryId: entry.id, kind: entry.kind } },
      });
      const recipientIds = [...new Set([
        ticket.reporterId,
        ...ticket.participants.filter((item) => !item.removedAt).map((item) => item.userId),
      ])];
      await publishNotificationEvent(tx, {
        type: 'SUPPORT_TICKET_RESPONSE',
        deduplicationKey: `support-ticket-response:${entry.id}`,
        recipientIds,
        recipientGroups: {
          DIRECT_USER: recipientIds,
          EXPLICIT_WATCHERS: ticket.participants
            .filter((item) => !item.removedAt && item.role === 'WATCHER')
            .map((item) => item.userId),
        },
        actorId: req.user!.id,
        workspace: ticket.reportedWorkspace,
        feature: ticket.reportedFeature,
        resourceType: 'support-ticket',
        resourceId: ticket.id,
        referenceId: ticket.referenceCode,
        actionUrl: `/dashboard/support/tickets/${ticket.id}`,
        payload: { referenceCode: ticket.referenceCode },
      });
      return entry;
    });
    res.status(201).json({ success: true, data: result });
  },
);

router.post(
  '/:id/participants',
  [
    body('userId').isString().trim().isLength({ min: 1 }),
    body('role').isIn(['HANDLER', 'COLLABORATOR', 'WATCHER']),
    body('reason').isString().trim().isLength({ min: 3, max: 500 }),
  ],
  async (req: AuthRequest, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'اطلاعات ارجاع معتبر نیست.' });
    const ticket = await loadTicketForMutation(req, res);
    if (!ticket) return;
    const handler = await handlerContext(req, ticket);
    if (!handler.canMutate || (ticket.restrictedIncident && req.user!.role !== 'ADMIN')) {
      return res.status(403).json({ success: false, error: 'اجازه ارجاع این تیکت را ندارید.' });
    }
    const target = await prisma.user.findFirst({ where: { id: req.body.userId, isActive: true }, select: { id: true } });
    if (!target) return res.status(404).json({ success: false, error: 'کاربر مقصد پیدا نشد.' });
    const participant = await prisma.$transaction(async (tx) => {
      const saved = await tx.supportTicketParticipant.upsert({
        where: { ticketId_userId: { ticketId: ticket.id, userId: target.id } },
        create: { ticketId: ticket.id, userId: target.id, role: req.body.role },
        update: { role: req.body.role, removedAt: null, assignedAt: new Date() },
      });
      await tx.supportTicketAuditEvent.create({
        data: {
          ticketId: ticket.id,
          actorId: req.user!.id,
          action: 'PARTICIPANT_ASSIGNED',
          reason: req.body.reason.trim(),
          afterData: { userId: target.id, role: req.body.role },
        },
      });
      await publishNotificationEvent(tx, {
        type: 'SUPPORT_TICKET_ASSIGNED',
        deduplicationKey: `support-ticket-assigned:${ticket.id}:${target.id}:${saved.assignedAt.toISOString()}`,
        recipientIds: [target.id],
        actorId: req.user!.id,
        workspace: ticket.reportedWorkspace,
        feature: ticket.reportedFeature,
        resourceType: 'support-ticket',
        resourceId: ticket.id,
        referenceId: ticket.referenceCode,
        actionUrl: `/dashboard/support/tickets/${ticket.id}`,
        payload: { referenceCode: ticket.referenceCode },
      });
      return saved;
    });
    res.status(201).json({ success: true, data: participant });
  },
);

router.put(
  '/:id/priority',
  [
    body('priority').isIn(['LOW', 'NORMAL', 'HIGH', 'URGENT']),
    body('reason').isString().trim().isLength({ min: 3, max: 500 }),
  ],
  async (req: AuthRequest, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'اولویت یا دلیل معتبر نیست.' });
    const ticket = await loadTicketForMutation(req, res);
    if (!ticket) return;
    const handler = await handlerContext(req, ticket);
    if (!handler.canMutate) return res.status(403).json({ success: false, error: 'اجازه تغییر اولویت را ندارید.' });
    const updated = await prisma.$transaction(async (tx) => {
      let deadlineData = {};
      if (ticket.slaPolicyVersion && ticket.acknowledgedAt) {
        const policy = await tx.supportSlaPolicyVersion.findUnique({ where: { version: ticket.slaPolicyVersion } });
        if (policy) {
          deadlineData = supportDeadlines({
            triagedAt: ticket.acknowledgedAt,
            priority: req.body.priority,
            calendar: parseSupportCalendar(policy.calendar),
            targets: parseSupportTargets(policy.targets),
          });
        }
      }
      const row = await tx.supportTicket.update({
        where: { id: ticket.id },
        data: { confirmedPriority: req.body.priority, priorityReason: req.body.reason.trim(), ...deadlineData },
      });
      await tx.supportTicketAuditEvent.create({
        data: {
          ticketId: ticket.id,
          actorId: req.user!.id,
          action: 'PRIORITY_CONFIRMED',
          reason: req.body.reason.trim(),
          beforeData: { priority: ticket.confirmedPriority || ticket.suggestedPriority },
          afterData: { priority: req.body.priority },
        },
      });
      return row;
    });
    res.json({ success: true, data: updated });
  },
);

router.put(
  '/:id/status',
  [
    body('status').isIn(['TRIAGED', 'IN_PROGRESS', 'WAITING_REPORTER', 'RESOLVED', 'CLOSED']),
    body('reason').isString().trim().isLength({ min: 3, max: 2_000 }),
  ],
  async (req: AuthRequest, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'وضعیت یا دلیل معتبر نیست.' });
    const ticket = await loadTicketForMutation(req, res);
    if (!ticket) return;
    const handler = await handlerContext(req, ticket);
    const reporterConfirmingClosure = !ticket.restrictedIncident
      && ticket.reporterId === req.user!.id
      && ticket.status === 'RESOLVED'
      && req.body.status === 'CLOSED';
    if (!handler.canMutate && !reporterConfirmingClosure) {
      return res.status(403).json({ success: false, error: 'اجازه تغییر وضعیت را ندارید.' });
    }
    if (!canTransitionTicket(ticket.status, req.body.status)) {
      return res.status(409).json({ success: false, error: 'این تغییر وضعیت مجاز نیست.' });
    }
    if (ticket.restrictedIncident && req.body.status === 'CLOSED' && req.user!.role !== 'ADMIN') {
      return res.status(403).json({ success: false, error: 'بستن رخداد حفاظت‌شده نیازمند ADMIN است.' });
    }
    const now = new Date();
    const updated = await prisma.$transaction(async (tx) => {
      const storedPolicy = ticket.slaPolicyVersion
        ? await tx.supportSlaPolicyVersion.findUnique({ where: { version: ticket.slaPolicyVersion } })
        : null;
      const policy = storedPolicy || await latestSupportSlaPolicy(tx);
      const deadlineData = !ticket.slaPolicyVersion && req.body.status !== 'CLOSED'
        ? supportDeadlines({
            triagedAt: now,
            priority: (ticket.confirmedPriority || ticket.suggestedPriority) as any,
            calendar: parseSupportCalendar(policy.calendar),
            targets: parseSupportTargets(policy.targets),
          })
        : {};
      const entry = req.body.status === 'RESOLVED'
        ? await tx.supportTicketEntry.create({
            data: { ticketId: ticket.id, authorId: req.user!.id, kind: 'RESOLUTION', body: req.body.reason.trim() },
          })
        : null;
      const row = await tx.supportTicket.update({
        where: { id: ticket.id },
        data: {
          status: req.body.status,
          acknowledgedAt: ticket.acknowledgedAt || (req.body.status !== 'NEW' ? now : null),
          waitingForReporterAt: req.body.status === 'WAITING_REPORTER' ? now : null,
          resolvedAt: req.body.status === 'RESOLVED' ? now : ticket.resolvedAt,
          closedAt: req.body.status === 'CLOSED' ? now : null,
          reopenUntil: req.body.status === 'CLOSED' ? new Date(now.getTime() + 30 * 86_400_000) : null,
          slaPolicyVersion: ticket.slaPolicyVersion || policy.version,
          ...deadlineData,
        },
      });
      await tx.supportTicketAuditEvent.create({
        data: {
          ticketId: ticket.id,
          actorId: req.user!.id,
          action: req.body.status === 'RESOLVED' ? 'RESOLVED' : 'STATUS_CHANGED',
          reason: req.body.reason.trim(),
          beforeData: { status: ticket.status },
          afterData: { status: req.body.status, resolutionEntryId: entry?.id || null },
        },
      });
      if (['WAITING_REPORTER', 'RESOLVED', 'CLOSED'].includes(req.body.status)) {
        await publishNotificationEvent(tx, {
          type: 'SUPPORT_TICKET_RESPONSE',
          deduplicationKey: `support-ticket-status:${ticket.id}:${req.body.status}:${row.updatedAt.toISOString()}`,
          recipientIds: [ticket.reporterId],
          recipientGroups: { DIRECT_USER: [ticket.reporterId] },
          actorId: req.user!.id,
          workspace: ticket.reportedWorkspace,
          feature: ticket.reportedFeature,
          resourceType: 'support-ticket',
          resourceId: ticket.id,
          referenceId: ticket.referenceCode,
          actionUrl: `/dashboard/support/tickets/${ticket.id}`,
          payload: { referenceCode: ticket.referenceCode },
        });
      }
      return row;
    });
    res.json({ success: true, data: updated });
  },
);

router.post(
  '/:id/duplicate',
  [
    body('canonicalTicketId').isString().trim().isLength({ min: 1 }),
    body('reason').isString().trim().isLength({ min: 3, max: 500 }),
  ],
  async (req: AuthRequest, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'تیکت مرجع یا دلیل معتبر نیست.' });
    const ticket = await loadTicketForMutation(req, res);
    if (!ticket) return;
    const handler = await handlerContext(req, ticket);
    if (!handler.canMutate) return res.status(403).json({ success: false, error: 'اجازه ثبت تکراری را ندارید.' });
    const canonical = await prisma.supportTicket.findUnique({ where: { id: req.body.canonicalTicketId }, include: { participants: true } });
    if (!canonical || canonical.id === ticket.id || !(await ensureAccess(req, res, canonical))) return;
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.supportTicket.update({
        where: { id: ticket.id },
        data: { canonicalTicketId: canonical.id, status: 'DUPLICATE' },
      });
      await tx.supportTicketAuditEvent.create({
        data: {
          ticketId: ticket.id,
          actorId: req.user!.id,
          action: 'MARKED_DUPLICATE',
          reason: req.body.reason.trim(),
          afterData: { canonicalTicketId: canonical.id },
        },
      });
      return row;
    });
    res.json({ success: true, data: updated });
  },
);

router.post('/:id/reopen', [body('reason').isString().trim().isLength({ min: 3, max: 2_000 })], async (req: AuthRequest, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'دلیل بازگشایی معتبر نیست.' });
  const ticket = await loadTicketForMutation(req, res);
  if (!ticket) return;
  if (ticket.reporterId !== req.user!.id || ticket.status !== 'CLOSED') {
    return res.status(403).json({ success: false, error: 'این تیکت قابل بازگشایی نیست.' });
  }
  if (!ticket.reopenUntil || ticket.reopenUntil < new Date()) {
    const existingFollowUp = await prisma.supportTicket.findUnique({ where: { previousTicketId: ticket.id } });
    if (existingFollowUp) {
      return res.json({ success: true, data: existingFollowUp, createdFollowUp: true, idempotentReplay: true });
    }
    const workspaces = await workspaceAccess(req.user!.id, req.user!.role);
    const referenceCode = `SUP-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const successor = await prisma.$transaction(async (tx) => {
      const created = await tx.supportTicket.create({
        data: {
          referenceCode,
          reporterId: req.user!.id,
          title: `پیگیری: ${ticket.title}`.slice(0, 180),
          type: ticket.type,
          impact: ticket.impact,
          workaroundExists: ticket.workaroundExists,
          reportedWorkspace: ticket.reportedWorkspace,
          reportedFeature: ticket.reportedFeature,
          originRoute: `/dashboard/support/tickets/${ticket.id}`,
          diagnosticSnapshot: {
            route: `/dashboard/support/tickets/${ticket.id}`,
            pageTitle: 'پیگیری تیکت قبلی',
            buildCommit: process.env.APP_COMMIT || 'local',
          },
          releaseBuild: process.env.APP_COMMIT || 'local',
          effectiveAccessSnapshot: { role: req.user!.role, workspaces: workspaces.accessible, capturedAt: new Date().toISOString() },
          restrictedIncident: ticket.restrictedIncident,
          suggestedPriority: ticket.suggestedPriority,
          previousTicketId: ticket.id,
          entries: { create: { authorId: req.user!.id, kind: 'REPORT', body: req.body.reason.trim() } },
          auditEvents: { create: { actorId: req.user!.id, action: 'CREATED_AS_FOLLOW_UP', afterData: { previousTicketId: ticket.id } } },
        },
      });
      await tx.supportTicketAuditEvent.create({
        data: { ticketId: ticket.id, actorId: req.user!.id, action: 'FOLLOW_UP_CREATED', afterData: { followUpTicketId: created.id } },
      });
      const workspaceManagers = !ticket.restrictedIncident && ticket.reportedWorkspace
        ? await resolveWorkspaceRecipientIds(tx, ticket.reportedWorkspace, 'edit')
        : [];
      const incidentHandlers = ticket.restrictedIncident ? await designatedIncidentHandlerIds(tx) : [];
      const recipients = await tx.user.findMany({
        where: {
          isActive: true,
          OR: [
            { role: 'ADMIN' },
            ...(ticket.restrictedIncident && incidentHandlers.length
              ? [{ id: { in: incidentHandlers } }]
              : []),
            ...(!ticket.restrictedIncident && workspaceManagers.length
              ? [{ role: 'MANAGER' as const, id: { in: workspaceManagers } }]
              : []),
          ],
        },
        select: { id: true, role: true },
      });
      await publishNotificationEvent(tx, {
        type: 'SUPPORT_TICKET_CREATED',
        deduplicationKey: `support-ticket-created:${created.id}`,
        recipientIds: recipients.map((user) => user.id),
        recipientGroups: {
          ACTIVE_ADMINS: recipients.filter((user) => user.role === 'ADMIN').map((user) => user.id),
          SECURITY_INCIDENT_HANDLERS: ticket.restrictedIncident
            ? recipients.filter((user) => incidentHandlers.includes(user.id)).map((user) => user.id)
            : [],
          WORKSPACE_MANAGERS: recipients.filter((user) => user.role === 'MANAGER').map((user) => user.id),
        },
        actorId: req.user!.id,
        workspace: ticket.reportedWorkspace,
        feature: ticket.reportedFeature,
        resourceType: 'support-ticket',
        resourceId: created.id,
        referenceId: created.referenceCode,
        actionUrl: `/dashboard/support/tickets/${created.id}`,
        payload: {
          referenceCode: created.referenceCode,
          reporterName: ticket.restrictedIncident ? 'گزارشگر حفاظت‌شده' : req.user!.username,
        },
      });
      return created;
    });
    return res.status(201).json({ success: true, data: successor, createdFollowUp: true });
  }
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.supportTicket.update({ where: { id: ticket.id }, data: { status: 'IN_PROGRESS', closedAt: null, reopenUntil: null } });
    await tx.supportTicketEntry.create({ data: { ticketId: ticket.id, authorId: req.user!.id, kind: 'REOPEN', body: req.body.reason.trim() } });
    await tx.supportTicketAuditEvent.create({ data: { ticketId: ticket.id, actorId: req.user!.id, action: 'REOPENED', reason: req.body.reason.trim() } });
    return row;
  });
  res.json({ success: true, data: updated });
});

router.post('/:id/attachments', attachmentUpload.single('file'), async (req: AuthRequest, res) => {
  try {
    if (!consumeSupportRate(`attachment:${req.user!.id}`, 30, 10 * 60 * 1_000)) {
      removeUploadedFile(req.file?.path);
      return res.status(429).json({ success: false, error: 'تعداد پیوست‌ها بیش از حد مجاز است؛ کمی بعد دوباره تلاش کنید.' });
    }
    const ticket = await loadTicketForMutation(req, res);
    if (!ticket) {
      removeUploadedFile(req.file?.path);
      return;
    }
    const handler = await handlerContext(req, ticket);
    const isReporter = ticket.reporterId === req.user!.id;
    if ((!isReporter && !handler.canMutate) || handler.participantRole === 'WATCHER') {
      removeUploadedFile(req.file?.path);
      return res.status(403).json({ success: false, error: 'اجازه افزودن پیوست را ندارید.' });
    }
    if (!req.file) return res.status(400).json({ success: false, error: 'فایل انتخاب نشده است.' });
    const attachmentCount = await prisma.supportTicketAttachment.count({ where: { ticketId: ticket.id, deletedAt: null } });
    if (attachmentCount >= 20) {
      removeUploadedFile(req.file.path);
      return res.status(409).json({ success: false, error: 'حداکثر ۲۰ پیوست برای هر تیکت مجاز است.' });
    }
    const policy = allowedAttachmentTypes[req.file.mimetype];
    if (!policy || req.file.size > policy.maxSize || !hasSafeFileSignature(req.file.path, req.file.mimetype)) {
      removeUploadedFile(req.file.path);
      return res.status(400).json({ success: false, error: 'نوع، اندازه یا محتوای فایل مجاز نیست.' });
    }
    const durationSeconds = policy.kind === 'AUDIO' ? await audioDurationSeconds(req.file.path) : null;
    if (policy.kind === 'AUDIO' && (!Number.isFinite(durationSeconds) || durationSeconds! <= 0 || durationSeconds! > 600)) {
      removeUploadedFile(req.file.path);
      return res.status(400).json({ success: false, error: 'مدت پیام صوتی باید حداکثر ۱۰ دقیقه باشد.' });
    }
    const sensitive = policy.kind === 'AUDIO' || String(req.body.sensitive) === 'true';
    if (sensitive && !ticket.sensitiveEvidenceConsent) {
      removeUploadedFile(req.file.path);
      return res.status(409).json({ success: false, error: 'برای افزودن شاهد حساس، رضایت مربوطه باید هنگام ثبت تیکت فعال باشد.' });
    }
    const sha256 = crypto.createHash('sha256').update(fs.readFileSync(req.file.path)).digest('hex');
    const malwareScanStatus = await scanHiringFile(req.file.path);
    const transcript = policy.kind === 'AUDIO' ? String(req.body.transcript || '').trim().slice(0, 10_000) : '';
    const attachment = await prisma.$transaction(async (tx) => {
      const entry = await tx.supportTicketEntry.create({
        data: {
          ticketId: ticket.id,
          authorId: req.user!.id,
          kind: 'ATTACHMENT',
          body: policy.kind === 'AUDIO' ? 'پیام صوتی' : req.file!.originalname.slice(0, 255),
          transcriptOriginal: transcript || null,
          transcriptCurrent: transcript || null,
          transcriptVersion: transcript ? 1 : 0,
        },
      });
      const saved = await tx.supportTicketAttachment.create({
        data: {
          ticketId: ticket.id,
          entryId: entry.id,
          kind: policy.kind,
          storageName: path.basename(req.file!.path),
          originalName: path.basename(req.file!.originalname).slice(0, 255),
          mimeType: req.file!.mimetype,
          size: req.file!.size,
          sha256,
          durationSeconds: durationSeconds ? Math.round(durationSeconds) : null,
          sensitive,
          malwareScanStatus,
          retentionClass: ticket.restrictedIncident
            ? 'SECURITY_INCIDENT_ONE_YEAR'
            : sensitive ? 'SENSITIVE_90_DAYS' : 'ORDINARY_ONE_YEAR',
        },
      });
      await tx.supportTicketAuditEvent.create({
        data: {
          ticketId: ticket.id,
          actorId: req.user!.id,
          action: 'ATTACHMENT_ADDED',
          afterData: { attachmentId: saved.id, kind: saved.kind, sensitive: saved.sensitive, sha256: saved.sha256 },
        },
      });
      return saved;
    });
    res.status(201).json({ success: true, data: attachment });
  } catch (error) {
    removeUploadedFile(req.file?.path);
    throw error;
  }
});

router.put(
  '/:id/entries/:entryId/transcript',
  [body('transcript').isString().trim().isLength({ min: 1, max: 10_000 })],
  async (req: AuthRequest, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'متن پیاده‌سازی معتبر نیست.' });
    const ticket = await loadTicketForMutation(req, res);
    if (!ticket) return;
    const handler = await handlerContext(req, ticket);
    const isReporter = ticket.reporterId === req.user!.id;
    if (!isReporter && !handler.canMutate) return res.status(403).json({ success: false, error: 'اجازه ویرایش پیاده‌سازی را ندارید.' });
    const entry = await prisma.supportTicketEntry.findFirst({
      where: { id: req.params.entryId, ticketId: ticket.id, attachments: { some: { kind: 'AUDIO' } } },
    });
    if (!entry) return res.status(404).json({ success: false, error: 'پیام صوتی پیدا نشد.' });
    const transcript = req.body.transcript.trim();
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.supportTicketEntry.update({
        where: { id: entry.id },
        data: {
          transcriptOriginal: entry.transcriptOriginal || transcript,
          transcriptCurrent: transcript,
          transcriptVersion: { increment: 1 },
        },
      });
      await tx.supportTicketAuditEvent.create({
        data: {
          ticketId: ticket.id,
          actorId: req.user!.id,
          action: 'TRANSCRIPT_CORRECTED',
          beforeData: { entryId: entry.id, version: entry.transcriptVersion, transcript: entry.transcriptCurrent },
          afterData: { entryId: entry.id, version: row.transcriptVersion, transcript },
        },
      });
      return row;
    });
    res.json({ success: true, data: updated });
  },
);

router.get('/attachments/:attachmentId/download', async (req: AuthRequest, res) => {
  const attachment = await prisma.supportTicketAttachment.findUnique({
    where: { id: req.params.attachmentId },
    include: { ticket: { include: { participants: true } } },
  });
  if (!attachment || attachment.deletedAt || attachment.redactedAt || !attachment.storageName) {
    return res.status(404).json({ success: false, error: 'پیوست پیدا نشد.' });
  }
  if (!(await ensureAccess(req, res, attachment.ticket))) return;
  const workspaces = await workspaceAccess(req.user!.id, req.user!.role);
  const accessibleFeatures = await featureAccess(req.user!.id, req.user!.role);
  const participant = attachment.ticket.participants.find((item) => item.userId === req.user!.id && !item.removedAt);
  const designatedIncidentHandler = attachment.ticket.restrictedIncident
    ? await isDesignatedIncidentHandler(prisma, req.user!.id)
    : false;
  const evidenceAllowed = canAccessSensitiveEvidence({
    id: req.user!.id,
    role: req.user!.role,
    managedWorkspaces: workspaces.managed,
    accessibleWorkspaces: workspaces.accessible,
    accessibleFeatures,
    securityIncidentHandler: attachment.ticket.restrictedIncident
      && (designatedIncidentHandler || ['HANDLER', 'COLLABORATOR'].includes(participant?.role || '')),
  }, accessSubject(attachment.ticket));
  if ((attachment.sensitive && !evidenceAllowed) || (attachment.kind === 'AUDIO' && participant?.role === 'WATCHER')) {
    return res.status(404).json({ success: false, error: 'پیوست پیدا نشد.' });
  }
  const filePath = path.join(ticketStorageDir, attachment.storageName);
  if (!fs.existsSync(filePath)) return res.status(410).json({ success: false, error: 'فایل مطابق سیاست نگهداری حذف شده است.' });
  const inline = req.query.inline === 'true' && ['IMAGE', 'AUDIO'].includes(attachment.kind);
  await prisma.supportTicketAttachmentAccess.create({
    data: {
      attachmentId: attachment.id,
      userId: req.user!.id,
      action: inline ? 'PLAYED_OR_VIEWED' : 'DOWNLOADED',
    },
  });
  res.setHeader('Content-Type', attachment.mimeType);
  res.setHeader('Content-Length', String(attachment.size));
  res.setHeader(
    'Content-Disposition',
    `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(attachment.originalName)}`,
  );
  res.sendFile(filePath);
});

router.post(
  '/:id/attachments/:attachmentId/redact',
  [body('reason').isString().trim().isLength({ min: 5, max: 1_000 })],
  async (req: AuthRequest, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'دلیل پوشاندن معتبر نیست.' });
    if (req.user!.role !== 'ADMIN') return res.status(403).json({ success: false, error: 'فقط ADMIN می‌تواند شاهد را بپوشاند.' });
    const ticket = await loadTicketForMutation(req, res);
    if (!ticket) return;
    const attachment = await prisma.supportTicketAttachment.findFirst({
      where: { id: req.params.attachmentId, ticketId: ticket.id, deletedAt: null },
    });
    if (!attachment) return res.status(404).json({ success: false, error: 'پیوست پیدا نشد.' });
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.supportTicketAttachment.update({
        where: { id: attachment.id },
        data: { redactedAt: new Date(), redactionReason: req.body.reason.trim(), redactedById: req.user!.id },
      });
      await tx.supportTicketAuditEvent.create({
        data: {
          ticketId: ticket.id,
          actorId: req.user!.id,
          action: 'ATTACHMENT_REDACTED',
          reason: req.body.reason.trim(),
          afterData: { attachmentId: attachment.id, sha256: attachment.sha256 },
        },
      });
      return row;
    });
    res.json({ success: true, data: updated });
  },
);

router.post('/:id/diagnostic-bundles/preview', async (req: AuthRequest, res) => {
  const ticket = await prisma.supportTicket.findUnique({
    where: { id: req.params.id },
    include: { participants: true, entries: true, auditEvents: true, attachments: true },
  });
  if (!ticket || !(await ensureAccess(req, res, ticket))) return;
  const handler = await handlerContext(req, ticket);
  if (!handler.canMutate || handler.participantRole === 'WATCHER') {
    return res.status(403).json({ success: false, error: 'اجازه تولید بسته تشخیصی را ندارید.' });
  }
  const workspaces = await workspaceAccess(req.user!.id, req.user!.role);
  const accessibleFeatures = await featureAccess(req.user!.id, req.user!.role);
  const designatedIncidentHandler = ticket.restrictedIncident
    ? await isDesignatedIncidentHandler(prisma, req.user!.id)
    : false;
  const sensitiveEvidenceAllowed = canAccessSensitiveEvidence({
    id: req.user!.id,
    role: req.user!.role,
    managedWorkspaces: workspaces.managed,
    accessibleWorkspaces: workspaces.accessible,
    accessibleFeatures,
    securityIncidentHandler: ticket.restrictedIncident
      && (designatedIncidentHandler || ['HANDLER', 'COLLABORATOR'].includes(handler.participantRole || '')),
  }, accessSubject(ticket));
  const bundleContent = buildSupportDiagnosticBundle(ticket);
  const bundle = await prisma.$transaction(async (tx) => {
    const created = await tx.supportTicketDiagnosticBundle.create({
      data: {
        ticketId: ticket.id,
        generatedById: req.user!.id,
        status: 'PREVIEW',
        markdown: bundleContent.markdown,
        json: bundleContent.data as Prisma.InputJsonValue,
        selectedSensitiveAttachmentIds: [],
      },
    });
    await tx.supportTicketAuditEvent.create({
      data: {
        ticketId: ticket.id,
        actorId: req.user!.id,
        action: 'DIAGNOSTIC_BUNDLE_PREVIEWED',
        afterData: { bundleId: created.id, sensitiveEvidenceIncluded: false },
      },
    });
    return created;
  });
  res.status(201).json({
    success: true,
    data: {
      id: bundle.id,
      markdown: bundle.markdown,
      json: bundle.json,
      availableSensitiveEvidence: ticket.attachments
        .filter((attachment) => sensitiveEvidenceAllowed && attachment.sensitive && !attachment.deletedAt && !attachment.redactedAt)
        .map((attachment) => ({
          id: attachment.id,
          kind: attachment.kind,
          originalName: attachment.originalName,
          size: attachment.size,
          sha256: attachment.sha256,
        })),
    },
  });
});

router.post(
  '/:id/diagnostic-bundles/:bundleId/confirm',
  [
    body('sensitiveAttachmentIds').isArray(),
    body('sensitiveAttachmentIds.*').isString(),
    body('reason').isString().trim().isLength({ min: 5, max: 1_000 }),
  ],
  async (req: AuthRequest, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'تأیید بسته تشخیصی معتبر نیست.' });
    const ticket = await prisma.supportTicket.findUnique({
      where: { id: req.params.id },
      include: { participants: true, entries: true, auditEvents: true, attachments: true },
    });
    if (!ticket || !(await ensureAccess(req, res, ticket))) return;
    const handler = await handlerContext(req, ticket);
    if (!handler.canMutate || handler.participantRole === 'WATCHER') {
      return res.status(403).json({ success: false, error: 'اجازه تولید بسته تشخیصی را ندارید.' });
    }
    const bundle = await prisma.supportTicketDiagnosticBundle.findFirst({
      where: { id: req.params.bundleId, ticketId: ticket.id, generatedById: req.user!.id, status: 'PREVIEW' },
    });
    if (!bundle) return res.status(404).json({ success: false, error: 'پیش‌نمایش بسته پیدا نشد.' });
    const selectedIds = [...new Set(req.body.sensitiveAttachmentIds as string[])];
    const selected = ticket.attachments.filter((attachment) => selectedIds.includes(attachment.id));
    if (selected.length !== selectedIds.length || selected.some((attachment) => !attachment.sensitive || attachment.deletedAt || attachment.redactedAt)) {
      return res.status(400).json({ success: false, error: 'یکی از شواهد حساس انتخاب‌شده معتبر نیست.' });
    }
    if (selected.length) {
      const workspaces = await workspaceAccess(req.user!.id, req.user!.role);
      const accessibleFeatures = await featureAccess(req.user!.id, req.user!.role);
      const designatedIncidentHandler = ticket.restrictedIncident
        ? await isDesignatedIncidentHandler(prisma, req.user!.id)
        : false;
      const allowed = canAccessSensitiveEvidence({
        id: req.user!.id,
        role: req.user!.role,
        managedWorkspaces: workspaces.managed,
        accessibleWorkspaces: workspaces.accessible,
        accessibleFeatures,
        securityIncidentHandler: ticket.restrictedIncident
          && (designatedIncidentHandler || ['HANDLER', 'COLLABORATOR'].includes(handler.participantRole || '')),
      }, accessSubject(ticket));
      if (!allowed) return res.status(403).json({ success: false, error: 'اجازه استفاده از شاهد حساس را ندارید.' });
    }
    const selectedMetadata = selected.map((attachment) => ({
      id: attachment.id,
      kind: attachment.kind,
      name: attachment.originalName,
      mimeType: attachment.mimeType,
      size: attachment.size,
      sha256: attachment.sha256,
      note: 'Binary content is not embedded; attach separately only through an authorized workflow.',
    }));
    const content = buildSupportDiagnosticBundle(ticket, selectedMetadata);
    const confirmed = await prisma.$transaction(async (tx) => {
      const updated = await tx.supportTicketDiagnosticBundle.update({
        where: { id: bundle.id },
        data: {
          status: 'READY',
          markdown: content.markdown,
          json: content.data as Prisma.InputJsonValue,
          selectedSensitiveAttachmentIds: selectedIds,
          confirmationReason: req.body.reason.trim(),
          confirmedAt: new Date(),
        },
      });
      await tx.supportTicketAuditEvent.create({
        data: {
          ticketId: ticket.id,
          actorId: req.user!.id,
          action: 'DIAGNOSTIC_BUNDLE_GENERATED',
          reason: req.body.reason.trim(),
          afterData: { bundleId: updated.id, sensitiveAttachmentIds: selectedIds },
        },
      });
      return updated;
    });
    res.json({ success: true, data: { id: confirmed.id, status: confirmed.status } });
  },
);

router.get('/:id/diagnostic-bundles/:bundleId/download', async (req: AuthRequest, res) => {
  const ticket = await prisma.supportTicket.findUnique({ where: { id: req.params.id }, include: { participants: true } });
  if (!ticket || !(await ensureAccess(req, res, ticket))) return;
  const handler = await handlerContext(req, ticket);
  if (!handler.canMutate || handler.participantRole === 'WATCHER') {
    return res.status(403).json({ success: false, error: 'اجازه دانلود بسته تشخیصی را ندارید.' });
  }
  const bundle = await prisma.supportTicketDiagnosticBundle.findFirst({
    where: { id: req.params.bundleId, ticketId: ticket.id, status: 'READY' },
  });
  if (!bundle) return res.status(404).json({ success: false, error: 'بسته تشخیصی آماده پیدا نشد.' });
  const format = req.query.format === 'json' ? 'json' : 'markdown';
  await prisma.supportTicketAuditEvent.create({
    data: {
      ticketId: ticket.id,
      actorId: req.user!.id,
      action: 'DIAGNOSTIC_BUNDLE_DOWNLOADED',
      afterData: { bundleId: bundle.id, format },
    },
  });
  res.setHeader('Content-Type', format === 'json' ? 'application/json; charset=utf-8' : 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${ticket.referenceCode}-codex.${format === 'json' ? 'json' : 'md'}"`);
  res.send(format === 'json' ? JSON.stringify(bundle.json, null, 2) : bundle.markdown);
});

router.post(
  '/:id/entries/:entryId/redact',
  [body('reason').isString().trim().isLength({ min: 5, max: 1_000 })],
  async (req: AuthRequest, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'دلیل پوشاندن معتبر نیست.' });
    if (req.user!.role !== 'ADMIN') return res.status(403).json({ success: false, error: 'فقط ADMIN می‌تواند محتوا را بپوشاند.' });
    const ticket = await loadTicketForMutation(req, res);
    if (!ticket) return;
    const entry = await prisma.supportTicketEntry.findFirst({ where: { id: req.params.entryId, ticketId: ticket.id, redactedAt: null } });
    if (!entry) return res.status(404).json({ success: false, error: 'محتوا پیدا نشد.' });
    await prisma.$transaction([
      prisma.supportTicketEntry.update({
        where: { id: entry.id },
        data: { redactedAt: new Date(), redactionReason: req.body.reason.trim() },
      }),
      prisma.supportTicketAuditEvent.create({
        data: {
          ticketId: ticket.id,
          actorId: req.user!.id,
          action: 'ENTRY_REDACTED',
          reason: req.body.reason.trim(),
          afterData: { entryId: entry.id },
        },
      }),
    ]);
    res.json({ success: true });
  },
);

router.post(
  '/:id/legal-holds',
  [body('reason').isString().trim().isLength({ min: 5, max: 1_000 })],
  async (req: AuthRequest, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'دلیل توقف نگهداری معتبر نیست.' });
    if (req.user!.role !== 'ADMIN') return res.status(403).json({ success: false, error: 'فقط ADMIN می‌تواند توقف قانونی ثبت کند.' });
    const ticket = await loadTicketForMutation(req, res);
    if (!ticket) return;
    const hold = await prisma.$transaction(async (tx) => {
      const created = await tx.supportTicketLegalHold.create({
        data: { ticketId: ticket.id, actorId: req.user!.id, reason: req.body.reason.trim() },
      });
      await tx.supportTicketAuditEvent.create({
        data: { ticketId: ticket.id, actorId: req.user!.id, action: 'LEGAL_HOLD_PLACED', reason: req.body.reason.trim(), afterData: { holdId: created.id } },
      });
      return created;
    });
    res.status(201).json({ success: true, data: hold });
  },
);

router.post(
  '/:id/legal-holds/:holdId/release',
  [body('reason').isString().trim().isLength({ min: 5, max: 1_000 })],
  async (req: AuthRequest, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'دلیل آزادسازی معتبر نیست.' });
    if (req.user!.role !== 'ADMIN') return res.status(403).json({ success: false, error: 'فقط ADMIN می‌تواند توقف قانونی را آزاد کند.' });
    const ticket = await loadTicketForMutation(req, res);
    if (!ticket) return;
    const hold = await prisma.supportTicketLegalHold.findFirst({ where: { id: req.params.holdId, ticketId: ticket.id, releasedAt: null } });
    if (!hold) return res.status(404).json({ success: false, error: 'توقف قانونی فعال پیدا نشد.' });
    await prisma.$transaction([
      prisma.supportTicketLegalHold.update({ where: { id: hold.id }, data: { releasedAt: new Date() } }),
      prisma.supportTicketAuditEvent.create({
        data: { ticketId: ticket.id, actorId: req.user!.id, action: 'LEGAL_HOLD_RELEASED', reason: req.body.reason.trim(), afterData: { holdId: hold.id } },
      }),
    ]);
    res.json({ success: true });
  },
);

router.get('/:id', async (req: AuthRequest, res) => {
  const ticket = await prisma.supportTicket.findUnique({
    where: { id: req.params.id },
    include: {
      reporter: { select: { id: true, firstName: true, lastName: true, username: true } },
      participants: {
        where: { removedAt: null },
        include: { user: { select: { id: true, firstName: true, lastName: true, username: true } } },
      },
      entries: {
        orderBy: { createdAt: 'asc' },
        include: { author: { select: { id: true, firstName: true, lastName: true, username: true } }, attachments: true },
      },
      auditEvents: { orderBy: { createdAt: 'asc' } },
      attachments: true,
      legalHolds: { orderBy: { createdAt: 'desc' } },
    },
  });
  if (!ticket || !(await ensureAccess(req, res, ticket))) return;
  const workspaces = await workspaceAccess(req.user!.id, req.user!.role);
  const accessibleFeatures = await featureAccess(req.user!.id, req.user!.role);
  const evidenceAllowed = canAccessSensitiveEvidence({
    id: req.user!.id,
    role: req.user!.role,
    managedWorkspaces: workspaces.managed,
    accessibleWorkspaces: workspaces.accessible,
    accessibleFeatures,
    securityIncidentHandler: ticket.restrictedIncident && (
      await isDesignatedIncidentHandler(prisma, req.user!.id)
      || ticket.participants.some(
        (participant) => participant.userId === req.user!.id && ['HANDLER', 'COLLABORATOR'].includes(participant.role),
      )
    ),
  }, accessSubject(ticket));
  const visibleAttachments = ticket.attachments
    .filter((attachment) => !attachment.sensitive || evidenceAllowed)
    .map((attachment) => attachment.redactedAt
      ? { ...attachment, originalName: 'پیوست پوشانده‌شده', storageName: null, sha256: '' }
      : attachment);
  const visibleAttachmentIds = new Set(visibleAttachments.map((attachment) => attachment.id));
  const entries = ticket.entries.map((entry) => ({
    ...entry,
    body: entry.redactedAt ? null : entry.body,
    transcriptCurrent: entry.redactedAt ? null : entry.transcriptCurrent,
    transcriptOriginal: undefined,
    attachments: entry.attachments.filter((attachment) => visibleAttachmentIds.has(attachment.id)),
  }));
  const hideDiagnostics = req.user!.id === ticket.reporterId && req.user!.role !== 'ADMIN';
  const hideIncidentReporter = ticket.restrictedIncident
    && req.user!.role !== 'ADMIN'
    && req.user!.id !== ticket.reporterId;
  const safeEntries = hideIncidentReporter
    ? entries.map((entry) => entry.authorId === ticket.reporterId
      ? { ...entry, author: { id: 'protected-reporter', firstName: 'گزارشگر', lastName: 'حفاظت‌شده', username: 'protected' } }
      : entry)
    : entries;
  if (ticket.restrictedIncident) {
    await prisma.supportTicketAuditEvent.create({
      data: {
        ticketId: ticket.id,
        actorId: req.user!.id,
        action: 'INCIDENT_VIEWED',
        afterData: { evidenceMetadataVisible: evidenceAllowed },
      },
    });
  }
  res.json({
    success: true,
    data: {
      ...ticket,
      attachments: visibleAttachments,
      entries: safeEntries,
      auditEvents: ticket.auditEvents.map((event) => ({
        id: event.id,
        action: event.action,
        createdAt: event.createdAt,
        reason: req.user!.id === ticket.reporterId && req.user!.role !== 'ADMIN' ? null : event.reason,
      })),
      reporter: hideIncidentReporter
        ? { id: 'protected-reporter', firstName: 'گزارشگر', lastName: 'حفاظت‌شده', username: 'protected' }
        : ticket.reporter,
      sensitiveEvidenceSnapshot: evidenceAllowed && req.user!.id !== ticket.reporterId
        ? ticket.sensitiveEvidenceSnapshot
        : undefined,
      ...(hideDiagnostics ? { originRoute: undefined, diagnosticSnapshot: undefined, effectiveAccessSnapshot: undefined, releaseBuild: undefined } : {}),
    },
  });
});

export default router;
