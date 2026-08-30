import { z } from 'zod';

// Keep runtime decoding on the backend's single Zod instance. The public
// package is consumed for wire types, but composing schemas from two physical
// Zod installations makes otherwise identical schemas nominally incompatible.
const IdSchema = z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9:_-]*$/);
const TextSchema = z.string().trim().min(1).max(4000);
const PersianReasonSchema = TextSchema.refine(reason => /[\u0600-\u06ff]/u.test(reason),
  'Persian business reason required');
const InstantSchema = z.string().datetime({ precision: 3 });
const RevisionSchema = z.number().int().positive().safe();
export const PartnerProjectStatusSchema = z.enum(['جدید', 'در حال پیگیری', 'نیازمند پیشنهاد', 'آماده قرارداد',
  'برنده شده', 'از دست رفته', 'راکد']);
export const PartnerCrmCommunicationTypeSchema = z.enum(['تماس تلفنی', 'پیامک / پیام‌رسان',
  'مراجعه حضوری به دفتر سبلان', 'بازدید از پروژه', 'جلسه حضوری', 'ارسال پیش‌فاکتور / پیشنهاد',
  'پیگیری مالی', 'سایر']);
export const PartnerCrmWorkTypeSchema = z.enum(['فروش سنگ پروژه ساختمانی', 'فروش همکاری',
  'خدمات / ابزار / فرآوری', 'بارگیری یا تحویل مرتبط با فروش قبلی', 'استعلام قیمت', 'سایر']);

const optionalText = TextSchema.max(500).optional();
export const PartnerCustomerCreateSchema = z.object({ schemaVersion: z.literal(1), commandId: IdSchema,
  correlationId: IdSchema, firstName: TextSchema.max(120), lastName: TextSchema.max(120),
  companyName: optionalText, customerType: z.enum(['Individual', 'Company']), city: optionalText,
  address: TextSchema.max(1000).optional(), nationalCode: z.string().trim().min(5).max(30).optional(),
  phone: z.string().trim().min(7).max(30), reason: PersianReasonSchema,
  idempotencyKey: IdSchema, payloadHash: z.string().regex(/^sha256-v1:[a-f0-9]{64}$/),
}).strict();
export type PartnerCustomerCreate = z.infer<typeof PartnerCustomerCreateSchema>;

export const PartnerCustomerUpdateSchema = z.object({ schemaVersion: z.literal(1), commandId: IdSchema,
  correlationId: IdSchema, customerId: IdSchema, expectedRevision: RevisionSchema,
  firstName: TextSchema.max(120), lastName: TextSchema.max(120), companyName: optionalText,
  customerType: z.enum(['Individual', 'Company']), city: optionalText, address: TextSchema.max(1000).optional(),
  nationalCode: z.string().trim().min(5).max(30).optional(), phone: z.string().trim().min(7).max(30),
  reason: PersianReasonSchema, idempotencyKey: IdSchema,
  payloadHash: z.string().regex(/^sha256-v1:[a-f0-9]{64}$/),
}).strict();
export type PartnerCustomerUpdate = z.infer<typeof PartnerCustomerUpdateSchema>;

export const PartnerProjectCreateSchema = z.object({ schemaVersion: z.literal(1), commandId: IdSchema,
  correlationId: IdSchema, customerId: IdSchema, title: TextSchema.max(300), workType: PartnerCrmWorkTypeSchema,
  status: PartnerProjectStatusSchema, address: TextSchema.max(1000).optional(), probability: z.number().int().min(0).max(100).optional(),
  expectedCloseDate: InstantSchema.optional(), description: TextSchema.max(2000).optional(),
  lostReason: TextSchema.max(1000).optional(), dormantReason: TextSchema.max(1000).optional(),
  revisitDate: InstantSchema.optional(), reason: PersianReasonSchema,
  idempotencyKey: IdSchema, payloadHash: z.string().regex(/^sha256-v1:[a-f0-9]{64}$/),
}).strict();
export type PartnerProjectCreate = z.infer<typeof PartnerProjectCreateSchema>;

export const PartnerProjectUpdateSchema = PartnerProjectCreateSchema.omit({ commandId: true, idempotencyKey: true,
  payloadHash: true }).extend({ commandId: IdSchema, projectId: IdSchema, expectedRevision: RevisionSchema,
  idempotencyKey: IdSchema, payloadHash: z.string().regex(/^sha256-v1:[a-f0-9]{64}$/) }).strict();
export type PartnerProjectUpdate = z.infer<typeof PartnerProjectUpdateSchema>;

export const PartnerFollowUpCreateSchema = z.object({ schemaVersion: z.literal(1), commandId: IdSchema,
  correlationId: IdSchema, customerId: IdSchema, projectId: IdSchema.optional(), communicationType: PartnerCrmCommunicationTypeSchema,
  workType: PartnerCrmWorkTypeSchema, happenedAt: InstantSchema, summary: TextSchema.max(2000), outcome: TextSchema.max(1000),
  nextAction: z.object({ title: TextSchema.max(300), communicationType: PartnerCrmCommunicationTypeSchema,
    workType: PartnerCrmWorkTypeSchema.optional(), dueAt: InstantSchema, instructions: TextSchema.max(2000) }).strict().optional(),
  reason: PersianReasonSchema, idempotencyKey: IdSchema,
  payloadHash: z.string().regex(/^sha256-v1:[a-f0-9]{64}$/),
}).strict();
export type PartnerFollowUpCreate = z.infer<typeof PartnerFollowUpCreateSchema>;

export const PartnerNextActionCompleteSchema = z.object({ schemaVersion: z.literal(1), commandId: IdSchema,
  correlationId: IdSchema, customerId: IdSchema, actionId: IdSchema, expectedRevision: RevisionSchema,
  reason: PersianReasonSchema, idempotencyKey: IdSchema,
  payloadHash: z.string().regex(/^sha256-v1:[a-f0-9]{64}$/),
}).strict();
export type PartnerNextActionComplete = z.infer<typeof PartnerNextActionCompleteSchema>;

export const PartnerDuplicateSearchSchema = z.object({ schemaVersion: z.literal(1), correlationId: IdSchema,
  phone: z.string().trim().min(7).max(30).optional(), nationalCode: z.string().trim().min(5).max(30).optional(),
}).strict().refine(value => Boolean(value.phone || value.nationalCode), 'Phone or national code required');
export type PartnerDuplicateSearch = z.infer<typeof PartnerDuplicateSearchSchema>;

export const PartnerTransferRequestSchema = z.object({ schemaVersion: z.literal(1), commandId: IdSchema,
  correlationId: IdSchema, matchReference: IdSchema, reason: PersianReasonSchema,
  idempotencyKey: IdSchema, payloadHash: z.string().regex(/^sha256-v1:[a-f0-9]{64}$/),
}).strict();
export type PartnerTransferRequest = z.infer<typeof PartnerTransferRequestSchema>;

export type PartnerCustomerSummary = { schemaVersion: 1; purpose: 'PARTNER_CRM_CUSTOMER'; customerId: string;
  revision: number; displayName: string; personType: 'NATURAL' | 'LEGAL'; city?: string; phone: string };
export type PartnerProjectView = { projectId: string; revision: number; title: string; status: string; workType: string;
  address?: string; probability?: number; expectedCloseDate?: string; description?: string; lostReason?: string;
  dormantReason?: string; revisitDate?: string };
export type PartnerFollowUpView = { followUpId: string; projectId?: string; communicationType: string; workType: string;
  happenedAt: string; summary: string; outcome: string; hasNextAction: boolean; noNextActionReason?: string };
export type PartnerNextActionView = { actionId: string; projectId?: string; revision: number; title: string;
  communicationType: string; workType?: string; dueAt: string; instructions: string; status: string; completedAt?: string };
export type PartnerCustomerDetail = PartnerCustomerSummary & { address?: string; projects: PartnerProjectView[];
  followUps: PartnerFollowUpView[]; nextActions: PartnerNextActionView[] };
