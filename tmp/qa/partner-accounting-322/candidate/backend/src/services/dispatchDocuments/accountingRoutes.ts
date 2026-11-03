import { randomUUID } from 'node:crypto';
import express, { type RequestHandler, type Response } from 'express';
import type { AuthRequest } from '../../middleware/auth';
import type { DispatchDocumentKind } from './contracts';
import { PilotSafetyPauseError } from '../dispatchCutover';
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
export const dispatchDocumentHttpStatus = (error: unknown): 400 | 404 | 409 | null => {
  if (error instanceof DispatchDocumentNotAvailableError) return 404;
  if (error instanceof DispatchDocumentValidationError) return 400;
  if (error instanceof DispatchDocumentConflictError || error instanceof DispatchDocumentIntegrityError
    || error instanceof PilotSafetyPauseError) return 409;
  return null;
};
const sendError = (res: Response, error: unknown) => {
  const status = dispatchDocumentHttpStatus(error);
  if (status) return res.status(status).json({ success: false, error: (error as Error).message });
  console.error('Accounting dispatch document error:', error);
  return res.status(500).json({ success: false, error: 'Accounting dispatch document operation failed.' });
};
export const parseDispatchDocumentKinds = (value: unknown): DispatchDocumentKind[] => {
  if (!Array.isArray(value)) return [];
  const parsed = value.map(item => String(item));
  if (parsed.some(item => !['WAYBILL', 'STATEMENT', 'STATEMENT_ADJUSTMENT'].includes(item))) {
    throw new DispatchDocumentValidationError('Every requested dispatch document kind must be supported.');
  }
  return parsed as DispatchDocumentKind[];
};

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
export const bindPrintHandoffCompletion = (response: Pick<Response, 'once'>, complete: {
  succeeded(): Promise<void>;
  failed(code?: string): Promise<void>;
}) => {
  let responseFinished = false;
  response.once('finish', () => { responseFinished = true;
    void complete.succeeded().catch(error => console.error('Print handoff completion audit failed:', error)); });
  response.once('close', () => { if (!responseFinished) {
    void complete.failed('RESPONSE_CLOSED').catch(error => console.error('Print handoff failure audit failed:', error));
  } });
  response.once('error', () => {
    void complete.failed('RESPONSE_ERROR').catch(error => console.error('Print handoff failure audit failed:', error));
  });
};

/** Mount under `/api/accounting`; caller owns the canonical Accounting auth middleware. */
export const createAccountingDispatchDocumentRouter = (input: {
  service: DispatchDocuments;
  view: Middleware;
}) => {
  const router = express.Router();
  router.get('/dispatch-waybills/:waybillId/artifacts/:artifactId', input.view, async (req: AuthRequest, res) => {
    try {
      const result = await input.service.retrieveArtifact({ artifactId: req.params.artifactId, waybillId: req.params.waybillId,
        actorId: req.user!.id, correlationId: correlationId(req) });
      bindPrintHandoffCompletion(res, result.complete);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Length', String(result.bytes.byteLength));
      res.setHeader('Cache-Control', 'private, no-store');
      return res.send(Buffer.from(result.bytes));
    } catch (error) { return sendError(res, error); }
  });
  router.post('/dispatch-waybills/:waybillId/print-handoffs', input.view, async (req: AuthRequest, res) => {
    try {
      const result = await input.service.printHandoff({ waybillId: req.params.waybillId, kinds: parseDispatchDocumentKinds(req.body.kinds),
        idempotencyKey: idempotencyKey(req), actorId: req.user!.id, correlationId: correlationId(req) });
      const boundary = `dispatch-${randomUUID()}`;
      const body = multipart(result.documents, boundary);
      bindPrintHandoffCompletion(res, result.complete);
      res.setHeader('Content-Type', `multipart/mixed; boundary=${boundary}`);
      res.setHeader('Content-Length', String(body.byteLength));
      res.setHeader('Cache-Control', 'private, no-store');
      return res.send(body);
    } catch (error) { return sendError(res, error); }
  });
  router.get('/dispatch-candidates/:candidateId/document-read-model', input.view, async (req: AuthRequest, res) => {
    try { return res.json({ success: true, data: await input.service.getCombinedReadModel({ candidateId: req.params.candidateId,
      waybillId: req.query.waybillId ? String(req.query.waybillId) : undefined, actorId: req.user!.id }) }); } catch (error) { return sendError(res, error); }
  });
  return router;
};
