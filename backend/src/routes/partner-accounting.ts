import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response, type RequestHandler } from 'express';
import { PartnerEventSchema, RevisionRefSchema, SabalanInternalRecordViewSchema, partnerError, type Result } from '@sabalanerp/partner-sales-contracts';
import { prisma } from '../lib/prisma';
import { protect, type AuthRequest } from '../middleware/auth';
import { createPartnerAccountingAdapter } from '../services/partnerSales/accounting/adapter';
import { createPrismaPartnerAccountingRepository } from '../services/partnerSales/accounting/prismaRepository';
import { PartnerAccountingTechnicalError } from '../services/partnerSales/accounting/errors';

const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const correlation = (request: Request) => {
  const supplied = request.get('X-Correlation-Id');
  return supplied && /^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$/.test(supplied) ? supplied : randomUUID();
};
function respond(response: Response, result: Result<unknown>) {
  response.setHeader('Cache-Control', 'private, no-store');
  if (result.ok) { response.json({ success: true, data: result.value }); return; }
  response.status(result.error.status).json({ success: false, code: result.error.code,
    error: result.error.message, supportReference: randomUUID() });
}
const serviceFor = (request: AuthRequest) => createPartnerAccountingAdapter(createPrismaPartnerAccountingRepository({
  database: prisma, actorId: request.user!.id, correlationId: correlation(request),
}));

// Express 4 does not forward rejected handler promises. Every adapter/transport
// failure must finish the response without reclassifying an outage as bad data.
const guarded = (handler: (request: AuthRequest, response: Response) => Promise<void>): RequestHandler =>
  (request, response) => {
    response.setHeader('Cache-Control', 'private, no-store');
    void handler(request as AuthRequest, response).catch(error => {
      const supportReference = randomUUID();
      const cause = error instanceof PartnerAccountingTechnicalError ? error.diagnostic : error;
      console.error('Partner Accounting request failed', { supportReference,
        category: cause instanceof Error ? cause.name : 'UnknownError' });
      response.status(500).json({ success: false, code: 'TECHNICAL_FAILURE', supportReference,
        error: 'دسترسی به حساب موقتاً ممکن نیست؛ دوباره تلاش کنید و در صورت تکرار، کد پیگیری را به پشتیبانی بدهید.' });
    });
  };

const router = Router();
router.use(protect);
router.get('/account', guarded(async (request, response) => {
  if (!request.user) { respond(response, { ok: false, error: partnerError('FORBIDDEN') }); return; }
  respond(response, await serviceFor(request).readOwnAccount(request.user.id));
}));
router.post('/prepare', guarded(async (request, response) => {
  if (!request.user) { respond(response, { ok: false, error: partnerError('FORBIDDEN') }); return; }
  const expected = RevisionRefSchema.safeParse(request.body);
  respond(response, expected.success ? await serviceFor(request).prepareFinancialRecord(expected.data)
    : { ok: false, error: partnerError('INVALID_PAYLOAD') });
}));
router.post('/enqueue', guarded(async (request, response) => {
  if (!request.user) { respond(response, { ok: false, error: partnerError('FORBIDDEN') }); return; }
  const expected = RevisionRefSchema.safeParse(request.body);
  if (!expected.success) { respond(response, { ok: false, error: partnerError('INVALID_PAYLOAD') }); return; }
  const source = await prisma.partnerSaleCase.findUnique({ where: { id: expected.data.caseId }, select: {
    state: true,
    head: { select: { internalProjection: true } }, events: { where: { type: 'CASE_COMMITTED' },
      orderBy: { sequence: 'asc' }, take: 1, select: { evidence: true } },
  } });
  const view = SabalanInternalRecordViewSchema.safeParse(object(source?.head.internalProjection)?.accounting);
  const event = PartnerEventSchema.safeParse(object(source?.events[0]?.evidence)?.publicEvent);
  if (!source || !view.success || !event.success || event.data.type !== 'CASE_COMMITTED') {
    respond(response, { ok: false, error: partnerError('INTEGRITY_CONFLICT') }); return;
  }
  respond(response, await serviceFor(request).enqueueCommitted({ ...view.data, state: source.state }, event.data));
}));
router.post('/approve', guarded(async (request, response) => {
  if (!request.user) { respond(response, { ok: false, error: partnerError('FORBIDDEN') }); return; }
  const body = request.body as Record<string, unknown>;
  const expected = RevisionRefSchema.safeParse(body?.expected);
  respond(response, body && !Array.isArray(body) && Object.keys(body).every(key => ['expected', 'invoiceRecordId'].includes(key))
    && expected.success && typeof body.invoiceRecordId === 'string'
    ? await serviceFor(request).acceptFinancialApproval(expected.data, body.invoiceRecordId)
    : { ok: false, error: partnerError('INVALID_PAYLOAD') });
}));
router.post('/facts/:factId/publish', guarded(async (request, response) => {
  if (!request.user) { respond(response, { ok: false, error: partnerError('FORBIDDEN') }); return; }
  const expected = RevisionRefSchema.safeParse(request.body);
  respond(response, expected.success ? await serviceFor(request).publishAccountingFact(expected.data, request.params.factId)
    : { ok: false, error: partnerError('INVALID_PAYLOAD') });
}));
export default router;
