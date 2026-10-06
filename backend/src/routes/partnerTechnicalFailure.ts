/** Log only recognized infrastructure identifiers. Exception text may contain
 * SQL parameters, private evidence or credentials and must never be emitted. */
export type TechnicalFailureDiagnostic = {
  supportReference: string;
  code: 'TEMPORARY_FAILURE' | 'INTERNAL_ERROR';
  databaseCode?: string;
};

const transient = new Set(['P1001', 'P1002', 'P1008', 'P1017', 'P2024', 'P2028', 'P2034', '40P01', '40001', '55P03']);

export function technicalTransportFailure(failure: unknown, supportReference: string): TechnicalFailureDiagnostic {
  const object = failure && typeof failure === 'object' ? failure as { code?: unknown; message?: unknown } : undefined;
  const direct = typeof object?.code === 'string' && transient.has(object.code) ? object.code : undefined;
  // Prisma's unknown connector error carries the PostgreSQL SQLSTATE in its
  // message. Extract only the fixed allowlist; never retain the raw message.
  const sqlState = typeof object?.message === 'string'
    ? object.message.match(/\b(?:40P01|40001|55P03)\b/)?.[0] : undefined;
  const databaseCode = direct ?? sqlState;
  return { supportReference, code: databaseCode ? 'TEMPORARY_FAILURE' : 'INTERNAL_ERROR',
    ...(databaseCode ? { databaseCode } : {}) };
}
