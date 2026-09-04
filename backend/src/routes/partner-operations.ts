import { Router, Request } from 'express';
import { ContractRuntime, Result } from '../services/partnerSales/operations/contracts';
import { createOperationsHttpHandlers } from '../services/partnerSales/operations/http';
import { OperationsService } from '../services/partnerSales/operations/service';
import * as runtime from '@sabalanerp/partner-sales-contracts';
import { prisma } from '../lib/prisma';
import { protect, type AuthRequest } from '../middleware/auth';
import { createOperationsService } from '../services/partnerSales/operations/service';
import { createPrismaPartnerOperationsStore } from '../services/partnerSales/operations/prismaStore';
import { randomUUID } from 'node:crypto';

/** Unmounted #333 adapter. #334 owns registration, the standard JSON parser and
 * the session authentication resolver. No fixture/default service is supplied. */
export function createPartnerOperationsRouter(contract: ContractRuntime,
  resolveAuthenticated: (request: Request) => Promise<Result<OperationsService>>) {
  const router = Router();
  const handlers = createOperationsHttpHandlers(contract, resolveAuthenticated);
  router.get('/', handlers.status);
  router.get('/incidents', handlers.incidents);
  router.post('/pause', handlers.pause);
  router.post('/cohort', handlers.defineCohort);
  router.post('/cohort/enroll', handlers.enroll);
  router.post('/incidents/resolve', handlers.resolveIncident);
  return router;
}

export function createPrismaPartnerOperationsRouter() {
  const router = Router();
  router.use(protect);
  const composed = createPartnerOperationsRouter(runtime, async request => {
    const authenticated = request as AuthRequest;
    if (!authenticated.user) return { ok: false, error: runtime.partnerError('FORBIDDEN') };
    const supplied = authenticated.get('X-Correlation-Id');
    const correlationId = supplied && /^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$/.test(supplied) ? supplied : randomUUID();
    return { ok: true, value: createOperationsService(runtime,
      createPrismaPartnerOperationsStore({ database: prisma, actorId: authenticated.user.id, correlationId })) };
  });
  router.use(composed);
  return router;
}

export default createPrismaPartnerOperationsRouter();
