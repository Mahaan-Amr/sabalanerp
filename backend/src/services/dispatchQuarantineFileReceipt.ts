export type DispatchQuarantineFileReceipt = Readonly<{
  format: 'sabalan-dispatch-quarantine/v1'; operationId: string; versionSha256: string; moveReceiptSha256: string;
}>;

/** Legacy audit rows deliberately return null. Current file bytes cannot supply
 * missing historical authorization or inherit an older safety window. */
export function parseDispatchQuarantineFileReceipt(value: unknown): DispatchQuarantineFileReceipt | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = ['format', 'operationId', 'versionSha256', 'moveReceiptSha256'];
  if (Object.keys(record).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(record, key))
    || record.format !== 'sabalan-dispatch-quarantine/v1'
    || !['operationId', 'versionSha256', 'moveReceiptSha256'].every(key => typeof record[key] === 'string' && /^[a-f0-9]{64}$/.test(record[key]))) return null;
  return Object.freeze({ format: 'sabalan-dispatch-quarantine/v1', operationId: record.operationId as string,
    versionSha256: record.versionSha256 as string, moveReceiptSha256: record.moveReceiptSha256 as string });
}
