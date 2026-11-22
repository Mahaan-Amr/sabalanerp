# Inquiry in the owned global census

Issue #405, follow-on to `c0dfe554`. The existing exhaustive census rejected
the distinct Inquiry native v2 format. Actual private Next runtime RED evidence
is `inquiry-fleet-10dcb89effc65eb99cdf3577ca32df6a.json`; the read-only diagnostic
child returned normally and retained its original observation.

The census now validates Inquiry separately from PostgreSQL ownership. It
requires its immutable shared scope, native lock state, original ACTIVE hash,
SQLite file/header/owner/inode and QUIESCENT work claim. A native closure does
not settle orphan work. Inquiry's audit namespace must have zero PostgreSQL
sessions. All original directory inventories, claim bytes and locks remain
subject to final rechecks, including a fresh SQLite identity check. Unknown
native formats remain refused. A coherent component cannot substitute another
SQLite source for the registered file.

Actual existing-project Next acceptance:

- Serving/idle native Inquiry: `inquiry-fleet-e7d05678c9d6eab38c0a96b0fa9475e1.json`.
- Naturally retired native Inquiry: `inquiry-fleet-a4265d951e4af64367d22eedae7fc327.json`.
- Both runs reject nine private negative cases: old claim format, PostgreSQL
  closure substitution, malformed URL hash, wrong inode, wrong grant, wrong
  lock declaration, wrong kernel-lock state, substituted snapshot source and
  a synthetic orphan ACTIVE work journal. Real authority and records were
  never altered by these negative checks.
- Backend v2 census/component/restore regression:
  `online-native-ef7a2f9ef8c21bc3d5e0e2c75473bf3e.json`. Actual queued HTTP,
  interrupted capture hold and orphan refusal passed. The ordinary scoped
  regression also passed (`online-native-0a5ee0b39a2706d00cfed9d7dbafc4b6.json`).
- Backend Docker packaging initially omitted the new adjacent helper; Spec
  review caught it. The real COPY clause now includes it. Build evidence
  `backend-boundary-image-4f61eecc50f56e94b1f4e4be80363265.json` verifies the
  copied bytes and Python syntax within a derived diagnostic image, without
  starting an application. This is deliberately not a full production build.

Architecture check passed. Independent read-only Standards and Spec reviews
both passed all eight source hashes in `inquiry-fleet-review-r2-20261018.json`.
Canonical local service identities and start times were preserved. No remote
server was modified by this slice.

This proves registered native/work boundaries only. It does not prove host or
image admission, a coherent Inquiry snapshot, continuous recovery, browser
handoff or a production recovery point. Those flags remain false and Issue
#405 remains open. The separate evolving browser-pause harness is outside this
frozen core review.
