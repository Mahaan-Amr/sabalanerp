# Inquiry runtime authority and native forms

This is an Issue #405 implementation record, not online production admission.

Inquiry source is published at submodule commit
`a1196ba` on `codex/online-inquiry-guards`; the parent gitlink pins that source.

Inquiry mutations now reject missing, unreadable, malformed, linked or oversized
recovery authority. A deployment maintenance marker, including a malformed or
dangling marker, also rejects mutation. Ordinary reads do not initialize or
repair authority. These are admission checks; independently registered work
completion and distributed fencing are still required.

Both session readers, including the existing Next proxy caller, verify the
current SQLite account before authorizing access. Deleted accounts, changed
identifiers and changed credentials cannot retain access through a signed token.
New tokens bind the role, ID, password hash and account update identity through
a keyed digest; no password hash enters the token. Signing rechecks the exact
hash whose password the login action verified, so a concurrent credential change
cannot mint a token for the replacement credential. An unchanged legacy token
is accepted only when its issuance strictly follows its account update time;
equality is ambiguous and requires fresh login. HS256, roles, types, required
claims and the seven-day lifetime are checked. Database failure closes access.

This does not introduce authoritative per-session logout revocation and cannot
change authentication in an unmodified old runtime. Those remain required for
overlapping release admission. No SQLite schema or administrator seed changed.

Validation:

- Inquiry behavior tests: five passed, one Linux-only filesystem case skipped on
  Windows. Both roles cover exact legacy timestamp equality and password changes
  at unchanged database timestamps. An independent review found the equality
  ambiguity; the strict comparison and its regression resolve it.
- Actual Linux filesystem tests: two passed, zero skipped, in the existing local
  backend. Symlinks, hardlinks, dangling maintenance markers and over-limit
  authority cannot reopen admission or alter the authority file.
- Actual Prisma 6.19.3 / SQLite / signed-token test: passed inside the canonical
  Inquiry service with an owned temporary database and finally-disconnected
  client. Account changes, deletion, stale signing credentials and equal SQLite
  timestamps were exercised. Canonical application data was not replaced.
- TypeScript and complete Next 16.2.6 builds passed on Windows and Linux. The
  initial dependency junction was rejected by Turbopack; own dependencies fixed
  the Windows build. Windows-generated external-module junctions cannot serve
  as a Linux release artifact; the HTTP candidate was rebuilt on Linux instead.
- Real headless Edge, JavaScript disabled: passed in 18.33 seconds against the
  diagnostic `inquiry-candidate` in `sabalanerp-local`. Native login and a real
  native product action committed once. Native form submission during maintenance
  and after credential revocation left the committed data unchanged. A protected
  page rejected the revoked token before rendering. The maintenance action uses
  the existing generic server-action error surface; friendly draft-preserving
  expiry/maintenance UX remains unfinished.

The diagnostic Linux image is
`sha256:2bf480979d39598b97f53567488ea10274b28b539a98392018bb10a47b45bfc5`.
Its base was independently verified as local Inquiry dependencies, Next 16.2.6
and Prisma 6.19.3. Only isolated fixture data was writable; coordination and the
root filesystem were read-only. This is not an attested production build. The
first attempted candidate could not load Windows external-module junctions and
was stopped; its failure was not accepted as runtime evidence.
The successful diagnostic container was stopped and removed by its inspected
immutable container ID after the browser test; canonical services were retained.

Standards and Spec reviewers report no remaining actionable narrow guard finding.
Backend database client ownership passed. Real 24-hour multi-build routing,
draft handoff, session revocation, continuous coherent recovery, domain migration
acceptance and production switching are not certified by these tests.
