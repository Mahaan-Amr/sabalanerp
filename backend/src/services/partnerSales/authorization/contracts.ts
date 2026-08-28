import type { PartnerAction, PermissionContext } from '@sabalanerp/partner-sales-contracts';

export type AuthorizationRoot = PermissionContext['root'];
export type AuthorizationBinding = Pick<PermissionContext, 'actorId' | 'purpose' | 'channel'>;
/** Trusted current facts, never an HTTP DTO or a persisted PermissionContext. */
export interface AuthorizationEvidence {
  evaluatedAt: string;
  authorizationRevision: number;
  actor: { id: string; active: boolean; role: string; departmentId?: string;
    partnerProfile?: { state: PermissionContext['partnerStatus']; revision: number } };
  resource: { root: AuthorizationRoot; partnerSellerId: string;
    partnerStatus: PermissionContext['partnerStatus']; lifecycleRevision: number; departmentId?: string;
    assignment?: PermissionContext['assignment']; requesterId?: string } | null;
  grants: Array<{ action: PartnerAction; rootKind: AuthorizationRoot['kind']; purpose: PermissionContext['purpose'];
    scope: PermissionContext['scope']; expiresAt?: string; boundRootId?: string }>;
}

/** #296 supplies resolved explicit action/scope evidence; no workspace fallback.
 * Implementations read current state on EVERY invocation in the owning transaction. */
export interface AuthorizationSource {
  read(actorId: string, root: AuthorizationRoot): Promise<AuthorizationEvidence>;
}
