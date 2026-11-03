import { ContractRuntime } from './contracts';

export const readinessGates = [
  'exactPairConstraints', 'immutableIdentity', 'stableRowIdentity', 'centralAuthorization',
  'profileActivation', 'inquiry', 'atomicCase', 'oneTimeCommitment', 'allowlistedCustomerOutput',
  'partnerOnlyAccounting', 'deliveryLineage', 'retailCollections', 'correctionAndVoiding',
  'reporting', 'internalSalesPreserved', 'integrationAccepted', 'combinedQaAccepted',
  'recoveryDrill', 'telemetryConnected', 'noOpenReleaseDefects',
] as const;
export const acceptanceResponsibilities = ['RELEASE_OWNER', 'SALES', 'ACCOUNTING', 'TECH_SECURITY', 'HR', 'LOGISTICS'] as const;

/** Resolved and authenticated from release evidence by #334, NEVER a request DTO.
 * The source tag is provenance, not proof: the adapter must verify signatures,
 * evidence ownership and actual schema constraints, not trust a stored boolean.
 */
export interface ReadinessEvidence {
  source: 'DATABASE_VERIFIED' | 'FIXTURE';
  evidenceId: string;
  releaseId: string;
  schemaId: string;
  checkedAt: string;
  expiresAt: string;
  gates: Record<string, boolean>;
  acceptedBy: Record<string, string>;
}
export interface ReadinessCheck {
  evidence: ReadinessEvidence | null;
  current: { now: string; releaseId: string; schemaId: string };
}

export function assessReadiness(contract: ContractRuntime, evidence: ReadinessEvidence | null, current: ReadinessCheck['current']): boolean {
  if (!evidence || evidence.source !== 'DATABASE_VERIFIED') return false;
  if (![evidence.checkedAt, evidence.expiresAt, current.now].every(value => contract.InstantSchema.safeParse(value).success)) return false;
  if (![evidence.evidenceId, evidence.releaseId, evidence.schemaId].every(value => contract.IdSchema.safeParse(value).success)) return false;
  return evidence.releaseId === current.releaseId && evidence.schemaId === current.schemaId &&
    evidence.checkedAt <= current.now && current.now < evidence.expiresAt &&
    readinessGates.every(gate => evidence.gates[gate] === true) &&
    acceptanceResponsibilities.every(role => contract.IdSchema.safeParse(evidence.acceptedBy[role]).success);
}
