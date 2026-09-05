import { ActionAvailabilityV2Schema, type ActionAvailabilityV2, type PartnerAction, type PartnerActionV2,
  type PartnerAuthorizationPort, type PartnerAuthorizationV2Port, type PermissionContext, type Result } from '@sabalanerp/partner-sales-contracts';

/** Advisory UI projection only. Every command must authorize again at write time. */
export async function projectActionAvailability(port: PartnerAuthorizationPort, root: PermissionContext['root'],
  actions: readonly PartnerAction[]): Promise<ActionAvailabilityV2[]> {
  return projectAvailability(port, root, actions);
}

export async function projectActionAvailabilityV2(port: PartnerAuthorizationV2Port, root: PermissionContext['root'],
  actions: readonly PartnerActionV2[]): Promise<ActionAvailabilityV2[]> {
  return projectAvailability(port, root, actions);
}

async function projectAvailability<Action extends PartnerActionV2>(port: {
  authorize(action: Action, root: PermissionContext['root']): Promise<Result<PermissionContext>>;
}, root: PermissionContext['root'], actions: readonly Action[]): Promise<ActionAvailabilityV2[]> {
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
