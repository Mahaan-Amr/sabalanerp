import { Router, Request } from 'express';
import { ContractRuntime, Result } from '../services/partnerSales/operations/contracts';
import { createOperationsHttpHandlers } from '../services/partnerSales/operations/http';
import { OperationsService } from '../services/partnerSales/operations/service';

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
