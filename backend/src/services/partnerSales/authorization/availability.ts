import { ActionAvailabilityV2Schema, type ActionAvailabilityV2, type PartnerAction,
  type PartnerAuthorizationPort, type PermissionContext } from '@sabalanerp/partner-sales-contracts';

/** Advisory UI projection only. Every command must authorize again at write time. */
export async function projectActionAvailability(port: PartnerAuthorizationPort, root: PermissionContext['root'],
  actions: readonly PartnerAction[]): Promise<ActionAvailabilityV2[]> {
  const output: ActionAvailabilityV2[] = [];
  for (const action of new Set(actions)) {
    const decision = await port.authorize(action, root);
    if (!decision.ok && decision.error.status === 404) continue;
    output.push(ActionAvailabilityV2Schema.parse(decision.ok
      ? { action, enabled: true, ...(decision.value.grantExpiresAt ? { expiresAt: decision.value.grantExpiresAt } : {}) }
      : { action, enabled: false, disabledReason: decision.error }));
  }
  return output;
}
