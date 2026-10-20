import { archiveBrowserDraft, type BrowserDraftSnapshot } from './browserDraftArchive';
import type { BrowserSessionLease } from './browserSessionContinuation';

type DraftRegistration = Omit<BrowserDraftSnapshot, 'buildId' | 'payloadJson'> & {
  capturePayloadJson(capturedAt: number): string;
  /** Domain adapter must commit and independently read back every binary
   * reference in this exact captured payload. Failure keeps the form mounted. */
  verifyArchiveEvidence?(payloadJson: string, assertCurrent: () => void): Promise<void>;
};
export type BrowserBuildHandoffResult = { status: 'PRESERVED' | 'BLOCKED'; code: string; archives: { id: string; sha256: string }[] };

export class BrowserBuildHandoff {
  private readonly registrations = new Map<symbol, Readonly<DraftRegistration>>();
  private readonly blockers = new Map<symbol, () => boolean>();
  /** Denial preview only; false never certifies archival or permits navigation. */
  hasLiveBlocker = (): boolean => {
    try { return Array.from(this.blockers.values()).some(isBlocked => isBlocked()); }
    catch { return true; }
  };
  constructor(private readonly buildId: string | null, private readonly archive: typeof archiveBrowserDraft = archiveBrowserDraft) {}
  /** Denial only. A live local buffer can prevent preservation but never certify it. */
  registerBlocker(isBlocked: () => boolean): () => void {
    if (typeof isBlocked !== 'function') throw Error('BROWSER_BUILD_HANDOFF_BLOCKER_INVALID');
    const token = Symbol(); this.blockers.set(token, isBlocked);
    return () => { this.blockers.delete(token); };
  }
  register(input: DraftRegistration): () => void {
    if (!input || !/^[a-zA-Z0-9_-]{1,128}$/.test(input.userId) || !/^[a-z][a-z0-9-]{1,63}$/.test(input.workflow)
      || typeof input.draftId !== 'string' || !input.draftId || input.draftId.length > 256
      || !Number.isSafeInteger(input.schemaVersion) || input.schemaVersion < 1
      || !Number.isSafeInteger(input.baseRevision) || input.baseRevision < 0
      || typeof input.capturePayloadJson !== 'function'
      || (input.verifyArchiveEvidence !== undefined && typeof input.verifyArchiveEvidence !== 'function')) throw Error('BROWSER_BUILD_HANDOFF_REGISTRATION_INVALID');
    const token = Symbol(); this.registrations.set(token, Object.freeze({ ...input }));
    return () => { this.registrations.delete(token); };
  }
  /** Local preservation only. Never probes, grants authentication, navigates,
   * clears a draft or replays the original business request. */
  async preserve(lease: BrowserSessionLease, assertCurrent: () => void): Promise<BrowserBuildHandoffResult> {
    const archives: BrowserBuildHandoffResult['archives'] = [];
    const blocked = (code: string): BrowserBuildHandoffResult => ({ status: 'BLOCKED', code, archives });
    try {
      assertCurrent();
      const hasUnarchivedBuffer = this.hasLiveBlocker;
      if (hasUnarchivedBuffer()) return blocked('BROWSER_BUILD_HANDOFF_UNARCHIVED_LOCAL_MODEL');
      if (!this.buildId || !/^erp_[a-z0-9_-]{8,90}$/.test(this.buildId)) return blocked('BROWSER_BUILD_HANDOFF_BUILD_UNPROVEN');
      const entries = Array.from(this.registrations.entries());
      if (!entries.length) return blocked('BROWSER_BUILD_HANDOFF_UNREGISTERED');
      if (entries.some(([, value]) => value.userId !== lease.userId)) return blocked('BROWSER_BUILD_HANDOFF_OWNER_CHANGED');
      const capturedAt = Date.now();
      // Serialize every domain-owned draft before the first asynchronous write.
      const snapshots = entries.map(([, value]): BrowserDraftSnapshot => {
        const payloadJson = value.capturePayloadJson(capturedAt);
        if (typeof payloadJson !== 'string' || new TextEncoder().encode(payloadJson).length > 16 * 1024 * 1024) throw Error('INVALID_DRAFT');
        JSON.parse(payloadJson);
        return { userId: value.userId, buildId: this.buildId!, workflow: value.workflow, draftId: value.draftId,
          schemaVersion: value.schemaVersion, baseRevision: value.baseRevision, payloadJson };
      });
      assertCurrent();
      for (let index = 0; index < entries.length; index++) {
        await entries[index][1].verifyArchiveEvidence?.(snapshots[index].payloadJson, assertCurrent);
        assertCurrent();
      }
      const unchanged = () => !hasUnarchivedBuffer() && entries.length === this.registrations.size && entries.every(([token, value], index) =>
        this.registrations.get(token) === value && value.capturePayloadJson(capturedAt) === snapshots[index].payloadJson);
      if (!unchanged()) return blocked('BROWSER_BUILD_HANDOFF_DRAFT_CHANGED');
      for (const snapshot of snapshots) {
        const saved = await this.archive(snapshot, assertCurrent); assertCurrent();
        archives.push({ id: saved.id, sha256: saved.sha256 });
      }
      assertCurrent();
      if (!unchanged()) {
        return blocked('BROWSER_BUILD_HANDOFF_DRAFT_CHANGED');
      }
      return { status: 'PRESERVED', code: 'BROWSER_BUILD_HANDOFF_PRESERVED', archives };
    } catch { return blocked('BROWSER_BUILD_HANDOFF_UNVERIFIED'); }
  }
}
export const browserBuildHandoff = new BrowserBuildHandoff(process.env.NEXT_PUBLIC_BROWSER_BUILD_ID || null);
