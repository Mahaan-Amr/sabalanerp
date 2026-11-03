/**
 * Phase-one audit state machine. Dependency-injected only: this module exports
 * no CLI and supplies no adapter to real processes, files, leases or databases.
 * It never transfers or settles a historic owner's obligations.
 */
import assert from 'node:assert/strict';

export async function runReadOnlyReconciliationAudit(ports) {
  // This module has no independently verified source of acquisition authority.
  // Caller-supplied booleans below are suitable only for injected unit tests.
  // This marker is NOT a security boundary or production capability verifier.
  if (process.env.NODE_ENV !== 'test' || ports?.testOnly !== true) {
    throw Error('PHASE1_OPERATIONAL_ADAPTER_UNAVAILABLE');
  }
  const census = await ports.freshCensus();
  assert.equal(census.freshIdentityBound, true, 'FRESH_CENSUS_REQUIRED');
  assert.equal(census.noParallelOperationalOwner, true, 'PARALLEL_OWNER_UNPROVEN');
  assert.equal(census.canonicalFileAlreadyPresentAndBound, true, 'LEASE_FILE_IDENTITY_UNPROVEN');
  assert.equal(census.reviewedAuthority, true, 'AUDIT_AUTHORITY_UNPROVEN');
  const lease = await ports.acquireOriginalCanonicalLease(census);
  let result;
  try {
    await lease.assertHeld();
    const audit = await ports.auditReadOnly({census, lease});
    assert.equal(audit.readersAndChildrenClosed, true, 'AUDIT_CLOSURE_UNPROVEN');
    assert.equal(audit.newOutstandingObligations, 0, 'NEW_OBLIGATIONS_REMAIN');
    await lease.assertHeld();
    result = Object.freeze({
      oldObligation: 'RETAINED_UNRESOLVED', historicalEof: 'UNKNOWN',
      safeState: 'UNKNOWN', scopeReuse: false, qualification: false,
      auditEvidence: audit.evidence,
    });
    await ports.writeDurableAuditRecord(result);
    await lease.assertHeld();
    await lease.release();
    return result;
  } catch (error) {
    // Never release an owned lease on an incomplete audit or uncertain closure.
    // Its custody is returned to the caller by explicit port handoff; if that
    // fails, the adapter must retain custody rather than exit or release.
    try { await ports.retainUnresolvedLease({lease, error}); }
    catch (handoffError) { throw new AggregateError([error, handoffError], 'AUDIT_CUSTODY_UNRESOLVED'); }
    throw error;
  }
}
