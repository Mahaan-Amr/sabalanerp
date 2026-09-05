import { randomUUID } from 'node:crypto';
import * as contracts from '@sabalanerp/partner-sales-contracts';
import type { Result } from '@sabalanerp/partner-sales-contracts';
import { Router, type Request } from 'express';
import { prisma } from '../lib/prisma';
import { protect, type AuthRequest } from '../middleware/auth';
import { createPrismaRetailCollectionRepository } from '../services/partnerSales/retailCollections/prismaRepository';
import { createPartnerRetailCollectionsService } from '../services/partnerSales/retailCollections/service';

export type CollectionRequest = { query: unknown; body: unknown; params: Record<string, string> };
export type CollectionResponse = {
  status(code: number): CollectionResponse;
  json(body: unknown): unknown;
  setHeader(name: string, value: string): unknown;
};
export type CollectionHandler = (request: CollectionRequest, response: CollectionResponse) => Promise<void>;
export interface CollectionRouter {
  post(path: string, handler: CollectionHandler): unknown;
}

export interface RequestBoundRetailCollectionService {
  execute(command: unknown): Promise<Result<unknown>>;
  read?(expected: contracts.RevisionRef): Promise<Result<unknown>>;
}

export function registerPartnerRetailCollectionRoutes(router: CollectionRouter, dependencies: {
  /** #334 supplies a newly authenticated, request-bound service. Never reuse a
   * service whose authorization source belongs to a different request actor. */
  serviceFor(request: CollectionRequest): Promise<RequestBoundRetailCollectionService>;
}) {
  const handle = (action: (service: RequestBoundRetailCollectionService, request: CollectionRequest) => Promise<Result<unknown>>): CollectionHandler => async (request, response) => {
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      const result = await action(await dependencies.serviceFor(request), request);
      if (!result.ok) {
        const safe = contracts.publicError(result.error, randomUUID());
        response.status(safe.status).json({ success: false, ...safe });
        return;
      }
      response.json({ success: true, data: result.value });
    } catch (error) {
      const candidate = error && typeof error === 'object' && 'code' in error
        && contracts.PartnerErrorSchema.safeParse(error).success ? error as contracts.PartnerError : contracts.partnerError('INVALID_PAYLOAD');
      const safe = contracts.publicError(candidate, randomUUID());
      response.status(safe.status).json({ success: false, ...safe });
    }
  };

  router.post('/commands', handle((service, request) => service.execute(request.body)));
  router.post('/query', handle((service, request) => {
    const expected = contracts.RevisionRefSchema.safeParse(request.body);
    return expected.success && service.read ? service.read(expected.data)
      : Promise.resolve({ ok: false, error: contracts.partnerError('INVALID_PAYLOAD') });
  }));
  return router;
}

function correlation(request: Request) {
  const supplied = request.get('X-Correlation-Id');
  return supplied && /^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$/.test(supplied) ? supplied : randomUUID();
}

export function createPartnerRetailCollectionRouter() {
  const router = Router();
  router.use(protect);
  registerPartnerRetailCollectionRoutes(router, { serviceFor: async (request: CollectionRequest) => {
    const authenticated = request as AuthRequest;
    if (!authenticated.user) throw contracts.partnerError('FORBIDDEN');
    const repository = createPrismaRetailCollectionRepository({ database: prisma, actorId: authenticated.user.id,
      correlationId: correlation(authenticated) });
    return createPartnerRetailCollectionsService(repository);
  } });
  return router;
}

export default createPartnerRetailCollectionRouter();
