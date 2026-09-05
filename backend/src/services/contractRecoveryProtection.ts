/** A server-owned record in the existing recovery column, never a browser
 * journal. All versions (including unknown/malformed ones) remain private. */
export const PARTNER_TECHNICAL_RECOVERY_KIND = 'partner-technical-recovery' as const;

export function isProtectedContractRecovery(value: unknown): boolean {
  return value !== null && typeof value === 'object' &&
    (value as { kind?: unknown }).kind === PARTNER_TECHNICAL_RECOVERY_KIND;
}

export function publicContractRecovery(value: unknown): unknown {
  return isProtectedContractRecovery(value) ? null : value;
}
