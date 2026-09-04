import { randomUUID } from 'node:crypto';
import { ContractRuntime, Query, ReportingError } from '../services/partnerSales/reporting/contracts';
import { PartnerReportingService } from '../services/partnerSales/reporting/service';
import { Router } from 'express';
import * as runtime from '@sabalanerp/partner-sales-contracts';
import { prisma } from '../lib/prisma';
import { protect, type AuthRequest } from '../middleware/auth';
import { createPrismaPartnerReportExportStore, createPrismaPartnerReportingSource } from '../services/partnerSales/reporting/prisma';

// Structural Express-compatible boundary. #334 supplies Router and authenticated
// request-bound service; importing this module neither registers nor activates it.
export type ReportRequest = { query: unknown; body: unknown; params: Record<string, string> };
export type ReportResponse = {
  status(code: number): ReportResponse;
  json(body: unknown): unknown;
  setHeader(name: string, value: string): unknown;
};
export type ReportHandler = (request: ReportRequest, response: ReportResponse) => Promise<void>;
export interface ReportRouter {
  get(path: string, handler: ReportHandler): unknown;
  post(path: string, handler: ReportHandler): unknown;
}

function queryInput(value: unknown): Query {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ReportingError('INVALID_PAYLOAD');
  const input = value as Record<string, unknown>;
  // Query strings may carry pagination as decimal text; arrays/objects fail closed.
  const output = { ...input };
  for (const key of ['offset', 'limit']) {
    if (typeof output[key] === 'string' && /^\d+$/.test(output[key] as string)) output[key] = Number(output[key]);
  }
  return output as Query;
}

export function registerPartnerReportRoutes(router: ReportRouter, dependencies: {
  runtime: ContractRuntime;
  /** MUST authenticate each request (including downloads); never reuse a service
   * whose source is bound to a different actor. This is an injected #319/#334 seam. */
  serviceFor(request: ReportRequest): Promise<PartnerReportingService>;
}) {
  const handle = (action: (service: PartnerReportingService, request: ReportRequest, response: ReportResponse) => Promise<unknown>): ReportHandler => async (request, response) => {
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      const service = await dependencies.serviceFor(request);
      response.json({ success: true, data: await action(service, request, response) });
    } catch (error) {
      const safe = dependencies.runtime.partnerError(error instanceof ReportingError ? error.code : 'INTEGRITY_CONFLICT');
      const supportReference = randomUUID();
      console.error('Partner report request failed', { supportReference, code: safe.code,
        cause: error instanceof Error ? error.message : 'Unknown reporting failure' });
      response.status(safe.status).json({ success: false, error: safe.message, code: safe.code, supportReference });
    }
  };
  router.get('/', handle((service, request) => service.query(queryInput(request.query))));
  router.get('/count', handle((service, request) => service.count(queryInput(request.query))));
  router.get('/cases/:caseId', handle((service, request) => service.detail({ ...queryInput(request.query), caseId: request.params.caseId })));
  router.post('/exports', handle((service, request) => service.createExport(queryInput(request.body))));
  router.get('/exports/:id', handle(async (service, request, response) => {
    const report = await service.downloadExport(request.params.id);
    response.setHeader('Content-Disposition', `attachment; filename="partner-report-${request.params.id}.json"`);
    return report;
  }));
  return router;
}

export function createPartnerReportRouter() {
  const router = Router();
  router.use(protect);
  registerPartnerReportRoutes(router, { runtime, serviceFor: async request => {
    const authenticated = request as AuthRequest;
    if (!authenticated.user) throw new ReportingError('FORBIDDEN');
    const supplied = authenticated.get('X-Correlation-Id');
    const correlationId = supplied && /^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$/.test(supplied) ? supplied : randomUUID();
    return new PartnerReportingService(runtime,
      createPrismaPartnerReportingSource({ database: prisma, actorId: authenticated.user.id, correlationId }),
      createPrismaPartnerReportExportStore(prisma));
  } });
  return router;
}

export default createPartnerReportRouter();
