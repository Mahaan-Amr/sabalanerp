import { randomUUID } from 'node:crypto';
import { ContractRuntime, OperationsError, Result } from './contracts';
import { OperationsService } from './service';

interface HttpRequest { body?: unknown }
interface HttpResponse {
  status(code: number): HttpResponse;
  json(body: unknown): unknown;
  setHeader(name: string, value: string): unknown;
}

/** Authentication resolver is required and bound by #334 to the session principal.
 * It must never build a service from body/header actor or permission claims. */
export function createOperationsHttpHandlers<Request extends HttpRequest = HttpRequest>(contract: ContractRuntime,
  resolveAuthenticated: (request: Request) => Promise<Result<OperationsService>>) {
  function body<T>(input: unknown, fields: string[]): T {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== fields.length ||
      Object.keys(input).some(key => !fields.includes(key))) throw new OperationsError('INVALID_PAYLOAD');
    return input as T;
  }
  function handle(action: (service: OperationsService, request: Request) => Promise<Result<unknown>>) {
    return async (request: Request, response: HttpResponse) => {
      const supportReference = randomUUID();
      response.setHeader('Cache-Control', 'no-store');
      try {
        const session = await resolveAuthenticated(request);
        const result = session.ok ? await action(session.value, request) : session;
        if (result.ok) response.status(200).json({ ok: true, value: result.value });
        else {
          const error = contract.publicError(result.error, supportReference);
          response.status(error.status).json({ ok: false, error });
        }
      } catch (error) {
        const known = error instanceof OperationsError;
        const safe = contract.publicError(contract.partnerError(known ? error.code : 'INTEGRITY_CONFLICT'), supportReference);
        response.status(known ? safe.status : 503).json({ ok: false, error: safe });
      }
    };
  }
  return {
    status: handle(service => service.status()),
    incidents: handle(service => service.incidents()),
    pause: handle((service, request) => service.pause(request.body)),
    defineCohort: handle((service, request) => service.defineCohort(body(request.body, ['id', 'name', 'expectedRevision', 'reason']))),
    enroll: handle((service, request) => service.enroll(body(request.body, ['sellerId', 'expectedRevision', 'reason']))),
    resolveIncident: handle((service, request) => {
      const input = body<{ incidentKey: string; reason: string }>(request.body, ['incidentKey', 'reason']);
      return service.resolveIncident(input.incidentKey, input.reason);
    }),
  };
}
