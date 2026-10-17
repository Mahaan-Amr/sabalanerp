# Preserve open forms through session continuation — 2026-10-17

Frozen application increment: `5f033c1c..03c1f931` (implementation `b17fc4f3`, race/transient repair `1d5f3089`, viewport repairs `38f0a697`, `03c1f931`). Subsequent private cross-container fixture work is outside this frontend candidate. This is session continuation, **not** certification of 24-hour retained runtimes or persistent versioned draft handoff.

## Behavior

The browser's established account constrains every shared private API operation to fresh authoritative account/session identity. Internal hiring uses this same client. Native Accounting document JSON/blob reads preserve denial constraints through body completion and reject foreign origins. Public applicant and contract verification transports remain separate.

An authoritative 401/account change hides private background content and opens a canonical non-dismissible login dialog while retaining the underlying React tree. Valid credentials for another account are rejected by the server before session creation/cookie emission. Same-owner login resumes the page; it never automatically replays a failed business mutation. Parallel obsolete responses, late bootstrap/login success after explicit logout, and late failed logins cannot reclaim or invalidate newer ownership. Transient probe/network/503 errors deny that operation without forcing password reauthentication. Sockets disconnect while blocked and reconnect on same-owner continuation.

The canonical overlay now follows the visible viewport's dimensions and offsets, including CSS zoom, and retains desktop side-sheet height. Internal vertical scrolling keeps the continuation action reachable at 390px/200% zoom. Controlled visual-viewport geometry covers a shortened/offset viewport with a focused password field; this does not certify a physical mobile OS keyboard.

## Evidence

- Backend TypeScript/cutover compilation and final frontend production build: passed. Browser identity `erp_session_continuation_20261017`, compiled from frozen application source `03c1f931`.
- Pure continuation plus actual Axios/native-fetch adapter cases: **7 passed**, zero skips. Includes no replay, stale success/failure ordering, internal hiring, public transport independence, foreign-origin rejection and a delayed native body completing after ownership invalidation.
- Actual existing PostgreSQL/HTTP/auth-router/Socket.IO acceptance: **passed, 79.177 seconds**, zero skips. Wrong-account valid credentials returned409 with no Set-Cookie and no new session; incorrect password and malformed owner were rejected; correct owner created exactly one session. The wider delivery/revocation tests also passed. Only an isolated temporary database in `sabalanerp-local` was used.
- Existing notification pure suite: **8 passed**. Accounting dispatch-document adapter regressions: **5 passed**, retaining ordered artifacts, money and row identity.
- Design-system check, foundation **25**, adoption **14**, browser infrastructure **4**, and architecture check: passed. No enforcement baseline was regenerated.
- Final controlled compiled-browser suite: **7 passed in18.5seconds**, zero retries. Preserved unsaved preference/device text through a denied other-account login and successful original-account login; no business mutation replay. Confirmed private background hidden, no navigation, focus, 390px/200% light/dark readability, no horizontal overflow or serious/critical Axe violations, offset/shortened visual geometry, and full-height desktop sheets.
- Final light/dark continuation screenshots were visually inspected. The dialog scrolls internally; the continuation action was clicked successfully after zooming. Artifacts are under `test-results/design-system/notification-catchup-sessi-91432-s-only-its-original-account-desktop-chromium/`.
- Independent Standards and Spec reviews passed after repairing late failed-login generation, transient-probe handling, desktop sheet height and visible-viewport positioning findings.

The initial browser run exposed the real zoomed-dialog reachability defect and was not acceptance. Its obsolete remaining UI-only run was explicitly stopped after preserving failure evidence. Subsequent six-case acceptance passed; final seven-case acceptance includes the desktop/offset geometry regressions. Pre-existing unrelated frontend hook warnings remain in build output.

Canonical backend/frontend/Inquiry/PostgreSQL services were not restarted. Only the owned diagnostic frontend candidate was stopped/restarted around builds, with reviewed compiled output mounted read-only.

## Remaining program work

This preserves in-memory forms through authentication changes. Forced-refresh draft durability/version handoff, the unowned legacy contract draft fallback, immutable 24-hour browser slots/action overlap, continuous coherent recovery, runtime/controller integration and the other Issue405 gates remain required before online production activation. No production application update, schema mutation or traffic switch was performed.
