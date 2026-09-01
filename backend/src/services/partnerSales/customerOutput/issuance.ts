import { ContractRuntime, CustomerOutputError, Output, OutputPort, Result, Snapshot, requireValue } from './contracts';
import { createCustomerOutputSnapshots } from './snapshots';

type Mode = Parameters<OutputPort['issue']>[1];
type Artifact = { artifactId: string; outputHash: string };

/** Bound to an authenticated principal by the composition root, never by request
 * body actor IDs. Every method authorizes its specific purpose at consumption. */
export interface CustomerIssuanceStore {
  resolveAuthorized(view: Output, mode: Mode): Promise<Result<Snapshot>>;
  findIssued(snapshot: Snapshot): Promise<Artifact | null>;
  /** Locks the Case and rechecks effective revision/hash, actor, pause, correction
   * freeze and snapshot inside one transaction. Returns existing issuance on a
   * concurrent replay; otherwise appends PRINTED via the shared Case commitment
   * port and publishes the private artifact reference atomically with its audit.
   * SIGNED and PRINTED share the Case's one-time realization constraint. */
  publishFinal(snapshot: Snapshot, prepared: Artifact): Promise<Result<Artifact>>;
}

export interface PrivateCustomerArtifacts {
  /** Receives ONLY validated retail content. Must finish rendering and durable
   * private storage before returning. Never writes under a static public mount.
   * Unpublished artifacts are reconciled by the storage owner, not deleted by a
   * losing concurrent caller that could race a winning publication. */
  prepare(content: Output, mode: 'PREVIEW' | 'FINAL'): Promise<Artifact>;
}

export function createCustomerOutputIssuer(
  contract: ContractRuntime, store: CustomerIssuanceStore, artifacts: PrivateCustomerArtifacts,
): OutputPort {
  const snapshots = createCustomerOutputSnapshots(contract);
  return {
    async issue(input, mode) {
      try {
        if (!['PREVIEW', 'FINAL', 'DOWNLOAD_EXISTING'].includes(mode)) throw new CustomerOutputError('INVALID_PAYLOAD');
        const view = await snapshots.content(input);
        const snapshot = await snapshots.read(requireValue(await store.resolveAuthorized(view, mode)));
        if (contract.canonicalJson(snapshot.content) !== contract.canonicalJson(view)) throw new CustomerOutputError('INTEGRITY_CONFLICT');
        const checkArtifact = (artifact: Artifact): Artifact => {
          contract.IdSchema.parse(artifact.artifactId);
          if (artifact.outputHash !== view.outputHash) throw new CustomerOutputError('INTEGRITY_CONFLICT');
          // Explicit result allowlist: private paths and URLs never leave here.
          return { artifactId: artifact.artifactId, outputHash: artifact.outputHash };
        };
        if (mode !== 'PREVIEW') {
          const issued = await store.findIssued(snapshot);
          if (issued) return { ok: true, value: checkArtifact(issued) };
          if (mode === 'DOWNLOAD_EXISTING') throw new CustomerOutputError('NOT_FOUND');
        }
        // Rendering is outside the Case transaction. A render/storage failure
        // cannot create PRINTED, commitment or debt.
        const prepared = checkArtifact(await artifacts.prepare(view, mode));
        const result = mode === 'FINAL'
          ? checkArtifact(requireValue(await store.publishFinal(snapshot, prepared)))
          : prepared;
        return { ok: true, value: result };
      } catch (error) {
        return { ok: false, error: contract.partnerError(error instanceof CustomerOutputError ? error.code : 'INTEGRITY_CONFLICT') };
      }
    },
  };
}
