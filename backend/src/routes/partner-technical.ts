import { randomUUID } from 'node:crypto';
import { partnerError, type PartnerTechnicalCatalogPort, type PartnerTechnicalRecoveryPort,
  type PartnerTechnicalSavePort, type Result } from '@sabalanerp/partner-sales-contracts';
import type { PrismaClient } from '@prisma/client';
import { createPartnerTechnicalCatalogReader } from '../services/partnerSales/crm/technicalCatalogReader';
import { createPrismaPartnerTechnicalRecoveryService } from '../services/partnerSales/cases/technicalRecovery';
import { createPrismaPartnerTechnicalSaveService, type PartnerTechnicalSaveDependencies } from '../services/partnerSales/cases/technicalSave';
import { createPartnerTechnicalRecoveryAuthority } from '../services/partnerSales/authorization/technicalRecovery';

export type TechnicalRequest = { body: unknown };
export type TechnicalResponse = {
  status(code: number): TechnicalResponse;
  json(body: unknown): unknown;
  setHeader(name: string, value: string): unknown;
};
type Handler = (request: TechnicalRequest, response: TechnicalResponse) => Promise<void>;
export interface TechnicalRouter {
  post(path: string, handler: Handler): unknown;
  put(path: string, handler: Handler): unknown;
}
export interface PartnerTechnicalServices {
  catalog: PartnerTechnicalCatalogPort;
  recovery: PartnerTechnicalRecoveryPort;
  saved: PartnerTechnicalSavePort;
}

/** Real request-scoped composition over the application's shared client. The
 * caller must first authenticate actorId and provide the owner-side private
 * evidence resolver; no browser field or fixture can satisfy that resolver. */
export function createPartnerTechnicalRequestServices(input: {
  database: PrismaClient;
  actorId: string;
  correlationId: string;
  resolveEvidence: PartnerTechnicalSaveDependencies['resolveEvidence'];
}): PartnerTechnicalServices {
  const binding = { actorId: input.actorId, correlationId: input.correlationId };
  const authorize = createPartnerTechnicalRecoveryAuthority(binding);
  return {
    catalog: { read: query => input.database.$transaction(tx =>
      createPartnerTechnicalCatalogReader(tx, binding).read(query)) },
    recovery: createPrismaPartnerTechnicalRecoveryService({ database: input.database,
      actorId: input.actorId, authorize }),
    saved: createPrismaPartnerTechnicalSaveService({ database: input.database,
      actorId: input.actorId, authorize, resolveEvidence: input.resolveEvidence }),
  };
}

/** Closed transport composition. #334 supplies one freshly authenticated,
 * request-bound set of real ports. Merely registering this factory does not
 * activate Partner navigation, cohorts or a pricing-evidence producer. */
export function registerPartnerTechnicalRoutes(router: TechnicalRouter, dependencies: {
  servicesFor(request: TechnicalRequest): Promise<PartnerTechnicalServices>;
}) {
  const handle = (action: (services: PartnerTechnicalServices, body: unknown) => Promise<Result<unknown>>): Handler =>
    async (request, response) => {
      response.setHeader('Cache-Control', 'private, no-store');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      try {
        const result = await action(await dependencies.servicesFor(request), request.body);
        if (result.ok) { response.json({ success: true, data: result.value }); return; }
        response.status(result.error.status).json({ success: false, code: result.error.code,
          error: result.error.message, supportReference: randomUUID() });
      } catch {
        const error = partnerError('INTEGRITY_CONFLICT');
        response.status(error.status).json({ success: false, code: error.code,
          error: error.message, supportReference: randomUUID() });
      }
    };
  router.post('/catalog/query', handle((ports, body) => ports.catalog.read(body as never)));
  router.post('/recoveries/read', handle((ports, body) => ports.recovery.read(body as never)));
  router.put('/recoveries/checkpoint', handle((ports, body) => ports.recovery.checkpoint(body as never)));
  router.post('/recoveries/save', handle((ports, body) => ports.saved.save(body as never)));
  router.post('/recoveries/read-saved', handle((ports, body) => ports.saved.readSaved(body as never)));
  return router;
}
