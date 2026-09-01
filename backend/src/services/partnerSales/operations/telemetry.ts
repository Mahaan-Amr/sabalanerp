import { createHmac } from 'node:crypto';
import { ContractRuntime, OperationsError } from './contracts';

export const metrics = ['PAIR_HEALTH', 'HASH_HEALTH', 'IDEMPOTENCY', 'FINANCIAL_RECONCILIATION', 'QUANTITY_RECONCILIATION',
  'PERMISSION_DENIAL', 'LEAKAGE', 'INQUIRY_STATE', 'ASSIGNMENT_STATE', 'WORKFLOW_LATENCY', 'STUCK_WORKFLOW',
  'JOB_RETRY', 'JOB_LATENCY', 'NOTIFICATION_BACKLOG', 'BACKEND_FAILURE', 'FRONTEND_FAILURE', 'CONNECTION_POOL', 'DOMAIN_EVENT'] as const;
export const incidentMetrics = {
  PAIR_INCOMPLETE: 'PAIR_HEALTH', PROJECTION_HASH_MISMATCH: 'HASH_HEALTH', DUPLICATE_COMMITMENT: 'IDEMPOTENCY',
  FINANCIAL_DIVERGENCE: 'FINANCIAL_RECONCILIATION', QUANTITY_DIVERGENCE: 'QUANTITY_RECONCILIATION',
  CROSS_OWNER_DISCLOSURE: 'LEAKAGE', WHOLESALE_DISCLOSURE: 'LEAKAGE',
} as const;
export type IncidentCategory = keyof typeof incidentMetrics;
export interface Observation {
  metric: typeof metrics[number];
  outcome: 'HEALTHY' | 'DELAY' | 'DENIED' | 'CONFLICT' | 'RETRY' | 'FAILURE' | 'CONFIRMED_VIOLATION';
  correlationId: string;
  subjectId: string;
  evidenceId: string;
  category?: IncidentCategory;
  value?: number;
}
export interface TelemetryRecord extends Record<string, string | number> {
  metric: string;
  outcome: string;
  severity: 'INFO' | 'ALERT' | 'INCIDENT';
  correlationReference: string;
  subjectReference: string;
  evidenceReference: string;
}

/** The key is server-owned, stable across replicas and never read from HTTP.
 * Correlations are HMACs, not raw IDs or low-entropy unkeyed hashes. Metric label
 * dimensions are only metric/outcome/category; refs are structured log fields. */
export function createPartnerTelemetry(contract: ContractRuntime, correlationKey: string) {
  if (Buffer.byteLength(correlationKey, 'utf8') < 32) throw new OperationsError('INVALID_PAYLOAD');
  function reference(namespace: string, value: string) {
    if (typeof value !== 'string' || !value || value.length > 4000) throw new OperationsError('INVALID_PAYLOAD');
    return createHmac('sha256', correlationKey).update(JSON.stringify([namespace, value])).digest('hex');
  }
  function project(input: Observation): TelemetryRecord {
    if (!metrics.includes(input.metric) || !['HEALTHY', 'DELAY', 'DENIED', 'CONFLICT', 'RETRY', 'FAILURE', 'CONFIRMED_VIOLATION'].includes(input.outcome)) throw new OperationsError('INVALID_PAYLOAD');
    const confirmed = input.outcome === 'CONFIRMED_VIOLATION';
    if (confirmed && (!input.category || !Object.prototype.hasOwnProperty.call(incidentMetrics, input.category) || incidentMetrics[input.category] !== input.metric)) throw new OperationsError('INVALID_PAYLOAD');
    if (!confirmed && input.category !== undefined) throw new OperationsError('INVALID_PAYLOAD');
    // Financial/quantity values never enter telemetry, even as a numeric field.
    const numericMetrics: readonly string[] = ['WORKFLOW_LATENCY', 'JOB_RETRY', 'JOB_LATENCY', 'NOTIFICATION_BACKLOG', 'CONNECTION_POOL'];
    if (input.value !== undefined && (!Number.isSafeInteger(input.value) || input.value < 0 || !numericMetrics.includes(input.metric))) throw new OperationsError('INVALID_PAYLOAD');
    return { metric: input.metric, outcome: input.outcome, severity: confirmed ? 'INCIDENT' : input.outcome === 'HEALTHY' ? 'INFO' : 'ALERT',
      correlationReference: reference('correlation', input.correlationId), subjectReference: reference('subject', input.subjectId),
      evidenceReference: reference('evidence', input.evidenceId),
      ...(confirmed ? { category: input.category! } : {}), ...(input.value === undefined ? {} : { value: input.value }) };
  }
  return {
    project,
    event(input: unknown) {
      const event = contract.PartnerEventSchema.safeParse(input);
      if (!event.success) throw new OperationsError('INVALID_PAYLOAD');
      return { ...project({ metric: 'DOMAIN_EVENT', outcome: 'HEALTHY', correlationId: event.data.correlationId,
        subjectId: event.data.owner.caseId, evidenceId: event.data.eventId }), eventType: event.data.type };
    },
    incidentKey: (input: Observation) => reference('incident', JSON.stringify([input.category, input.subjectId, input.evidenceId])),
  };
}
export type PartnerTelemetry = ReturnType<typeof createPartnerTelemetry>;
