import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { accountingReadTiming, type AccountingReadTimings } from '../services/accountingReadTiming';

const accountingRoutes = [
  [/^\/api\/accounting\/dashboard(?:\/(?:change|workspace))?$/, '/api/accounting/dashboard'],
  [/^\/api\/accounting\/financial-trend$/, '/api/accounting/financial-trend'],
  [/^\/api\/accounting\/contracts$/, '/api/accounting/contracts'],
  [/^\/api\/accounting\/contracts\/.+$/, '/api/accounting/contracts/:path'],
  [/^\/api\/accounting\/dispatch-candidates$/, '/api/accounting/dispatch-candidates'],
  [/^\/api\/accounting\/dispatch-candidates\/[^/]+\/decision$/, '/api/accounting/dispatch-candidates/:id/decision'],
  [/^\/api\/accounting\/dispatch-candidates\/[^/]+\/document-read-model$/, '/api/accounting/dispatch-candidates/:id/document-read-model'],
  [/^\/api\/accounting\/dispatch-candidates\/.+$/, '/api/accounting/dispatch-candidates/:path'],
  [/^\/api\/accounting\/dispatch-waybills(?:\/.*)?$/, '/api/accounting/dispatch-waybills/:path'],
  [/^\/api\/accounting\/loadings\/[^/]+\/sepidar-reference$/, '/api/accounting/loadings/:id/sepidar-reference'],
  [/^\/api\/dispatch-confirmation(?:\/.*)?$/, '/api/dispatch-confirmation/:path'],
  [/^\/api\/accounting(?:\/.*)?$/, '/api/accounting/:path'],
] as const;

export function accountingOperationalRoute(url: string | undefined) {
  const path = (url ?? '').split('?', 1)[0].replace(/\/$/, '').toLowerCase();
  return accountingRoutes.find(([pattern]) => pattern.test(path))?.[1];
}

type DatabaseFailure = 'P2024' | 'P2028' | 'P2034' | '40P01' | '40001';

function databaseFailure(error: unknown): DatabaseFailure | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return;
  if (error.code === 'P2010' && 'meta' in error && error.meta && typeof error.meta === 'object' && 'code' in error.meta) {
    if (error.meta.code === '40P01' || error.meta.code === '40001') return error.meta.code;
  }
  switch (error.code) {
    case 'P2024':
    case 'P2028':
    case 'P2034':
    case '40P01':
    case '40001':
      return error.code;
  }
}

type Outcome = 'success' | 'client_abort' | 'contention' | 'pool_timeout' | 'transaction_expired'
  | 'unavailable' | 'internal_error' | 'rejected';

function outcomeFor(status: number, failure?: DatabaseFailure, reported = false): Outcome {
  if (failure === 'P2024') return 'pool_timeout';
  if (failure === 'P2028') return 'transaction_expired';
  if (failure === 'P2034' || failure === '40P01' || failure === '40001') return 'contention';
  if (status === 503) return 'unavailable';
  if (status >= 400 && status < 500) return 'rejected';
  if (status >= 500 || reported) return 'internal_error';
  return 'success';
}

type AccountingApiRecord = {
  kind: 'accounting_api_request';
  at: string;
  route: NonNullable<ReturnType<typeof accountingOperationalRoute>>;
  requestId: string;
  commit: string;
  method: string;
  durationMs: number;
  status: number | null;
  outcome: Outcome;
  code?: DatabaseFailure;
  trackingId?: string;
  stagesMs?: AccountingReadTimings;
};

const requestFailures = new WeakMap<ServerResponse, Pick<AccountingApiRecord, 'code' | 'trackingId'> | undefined>();
const methods = new Set(['GET', 'HEAD', 'OPTIONS', 'POST', 'PATCH', 'PUT', 'DELETE']);

export function reportAccountingRequestFailure(response: ServerResponse, error: unknown, trackingId?: string) {
  if (!requestFailures.has(response)) return;
  const previous = requestFailures.get(response);
  const code = databaseFailure(error) ?? previous?.code;
  if (!response.headersSent) response.setHeader('X-Accounting-Outcome', outcomeFor(500, code));
  const safeTrackingId = trackingId && /^ACC-[0-9A-Z]+$/.test(trackingId) ? trackingId : previous?.trackingId;
  requestFailures.set(response, { code, trackingId: safeTrackingId });
}

export function accountingMeasurementCommit(sourceCommit: string | undefined) {
  return sourceCommit && /^(?:[a-f0-9]{40}|local)$/.test(sourceCommit) ? sourceCommit : 'unattested';
}

export function createAccountingRequestObserver(
  sourceCommit: string | undefined,
  log: (record: AccountingApiRecord) => void = record => console.info(JSON.stringify(record)),
) {
  const commit = accountingMeasurementCommit(sourceCommit);
  return (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    const route = accountingOperationalRoute(request.url);
    if (!route) return next();

    requestFailures.set(response, undefined);
    const requestId = randomUUID();
    const started = performance.now();
    const timings: AccountingReadTimings = {};
    const method = request.method && methods.has(request.method) ? request.method : 'OTHER';
    response.setHeader('X-Accounting-Request-Id', requestId);
    response.setHeader('X-Accounting-Commit', commit);

    const finish = (completed: boolean) => {
      response.off('finish', onFinish);
      response.off('close', onClose);
      const failure = requestFailures.get(response);
      const stages = Object.entries(timings);
      log({
        kind: 'accounting_api_request',
        at: new Date().toISOString(),
        route,
        requestId,
        commit,
        method,
        durationMs: Math.round((performance.now() - started) * 100) / 100,
        status: completed ? response.statusCode : null,
        outcome: completed ? outcomeFor(response.statusCode, failure?.code, Boolean(failure)) : 'client_abort',
        ...(stages.length ? { stagesMs: Object.fromEntries(stages.map(([name, ms]) => [name, Math.round(ms * 100) / 100])) } : {}),
        ...failure,
      });
    };
    const onFinish = () => finish(true);
    const onClose = () => finish(false);
    response.once('finish', onFinish);
    response.once('close', onClose);
    accountingReadTiming.run(timings, next);
  };
}
