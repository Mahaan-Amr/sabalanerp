import { randomUUID } from 'node:crypto';
import express, { type RequestHandler, type Response } from 'express';
import type { AuthRequest } from '../../middleware/auth';
import type { DispatchDocumentKind } from './contracts';
import {
  DispatchDocumentConflictError,
  DispatchDocumentIntegrityError,
  DispatchDocumentNotAvailableError,
  DispatchDocumentValidationError,
  createDispatchDocuments,
} from './service';

type DispatchDocuments = ReturnType<typeof createDispatchDocuments>;
type Middleware = RequestHandler | RequestHandler[];

const correlationId = (req: AuthRequest) => String(req.get('X-Correlation-Id') || randomUUID());
const idempotencyKey = (req: AuthRequest) => String(req.get('Idempotency-Key') || req.body?.idempotencyKey || '');
const sendError = (res: Response, error: unknown) => {
  if (error instanceof DispatchDocumentNotAvailableError) return res.status(404).json({ success: false, error: error.message });
  if (error instanceof DispatchDocumentValidationError) return res.status(400).json({ success: false, error: error.message });
  if (error instanceof DispatchDocumentConflictError || error instanceof DispatchDocumentIntegrityError) {
    return res.status(409).json({ success: false, error: error.message });
  }
  console.error('Accounting dispatch document error:', error);
  return res.status(500).json({ success: false, error: 'Accounting dispatch document operation failed.' });
};
const kinds = (value: unknown): DispatchDocumentKind[] => Array.isArray(value)
  ? value.filter((item): item is DispatchDocumentKind => ['WAYBILL', 'STATEMENT', 'STATEMENT_ADJUSTMENT'].includes(String(item)))
  : [];

const multipart = (documents: Array<{ artifact: { id: string; kind: DispatchDocumentKind }; bytes: Uint8Array }>, boundary: string) => {
  const chunks: Buffer[] = [];
  for (const document of documents) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Type: application/pdf\r\nContent-Disposition: inline; filename="${document.artifact.kind.toLowerCase()}-${document.artifact.id}.pdf"\r\n\r\n`));
    chunks.push(Buffer.from(document.bytes));
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(chunks);
};

/** Mount under `/api/accounting`; caller owns the canonical Accounting auth middleware. */
export const createAccountingDispatchDocumentRouter = (input: {
  service: DispatchDocuments;
  view: Middleware;
  edit: Middleware;
}) => {
  const router = express.Router();
  router.post('/dispatch-candidates/:id/decision', input.edit, async (req: AuthRequest, res) => {
    try { return res.json({ success: true, data: await input.service.decideCandidate({ candidateId: req.params.id,
      action: req.body.action, reason: req.body.reason, idempotencyKey: idempotencyKey(req), actorId: req.user!.id,
      correlationId: correlationId(req) }) }); } catch (error) { return sendError(res, error); }
  });
  router.post('/dispatch-waybills/:id/void', input.edit, async (req: AuthRequest, res) => {
    try { return res.json({ success: true, data: await input.service.voidWaybill({ waybillId: req.params.id,
      reason: req.body.reason, idempotencyKey: idempotencyKey(req), actorId: req.user!.id, correlationId: correlationId(req) }) }); }
    catch (error) { return sendError(res, error); }
  });
  router.post('/dispatch-waybills/:id/replace', input.edit, async (req: AuthRequest, res) => {
    try { return res.json({ success: true, data: await input.service.replaceWaybill({ waybillId: req.params.id,
      reason: req.body.reason, idempotencyKey: idempotencyKey(req), actorId: req.user!.id, correlationId: correlationId(req) }) }); }
    catch (error) { return sendError(res, error); }
  });
  router.get('/dispatch-waybills/:waybillId/artifacts/:artifactId', input.view, async (req: AuthRequest, res) => {
    try {
      const result = await input.service.retrieveArtifact({ artifactId: req.params.artifactId, waybillId: req.params.waybillId,
        actorId: req.user!.id, correlationId: correlationId(req) });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Length', String(result.bytes.byteLength));
      res.setHeader('Cache-Control', 'private, no-store');
      return res.send(Buffer.from(result.bytes));
    } catch (error) { return sendError(res, error); }
  });
  router.post('/dispatch-waybills/:waybillId/print-handoffs', input.view, async (req: AuthRequest, res) => {
    try {
      const result = await input.service.printHandoff({ waybillId: req.params.waybillId, kinds: kinds(req.body.kinds),
        idempotencyKey: idempotencyKey(req), actorId: req.user!.id, correlationId: correlationId(req) });
      const boundary = `dispatch-${randomUUID()}`;
      const body = multipart(result.documents, boundary);
      res.setHeader('Content-Type', `multipart/mixed; boundary=${boundary}`);
      res.setHeader('Content-Length', String(body.byteLength));
      res.setHeader('Cache-Control', 'private, no-store');
      return res.send(body);
    } catch (error) { return sendError(res, error); }
  });
  router.get('/dispatch-candidates/:candidateId/document-read-model', input.view, async (req: AuthRequest, res) => {
    try { return res.json({ success: true, data: await input.service.getCombinedReadModel({ candidateId: req.params.candidateId,
      waybillId: String(req.query.waybillId || ''), actorId: req.user!.id }) }); } catch (error) { return sendError(res, error); }
  });
  return router;
};
