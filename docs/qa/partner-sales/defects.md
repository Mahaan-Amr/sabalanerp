# Baseline observations outside #314 ownership

## LEGACY-314-01 — duplicate anonymous redirects cancel login requests

- **Status:** open; owner: shared authentication/dashboard-shell maintainer, triage through #335. No application fix is included in #314.
- **Runtime:** existing `sabalanerp-local`, development frontend, observed 2026-08-27. Checkout reference `c3d8a9922b99201d094e5e2bbd0562903a786442`; runtime identity is independently recorded in the run manifest.
- **Actor/path:** fresh unauthenticated browser → `/dashboard/sales/contracts/create` → `/login`.
- **Reproduce:** `node scripts/run-partner-sales-tests.mjs browser`; inspect `known-legacy-observations` attachments and traces in each viewport/theme project.
- **Expected:** authentication rejection leads to one usable login navigation without router fallback errors.
- **Observed:** the login eventually renders, but multiple 401 handlers request navigation, cancelling `/login` document and RSC requests with `net::ERR_ABORTED`. Next.js can log `Failed to fetch RSC payload ... Falling back to browser navigation.` Dashboard layout also logs the expected 401 `Auth check error`. Browser HTTP 401s themselves are correct rejection behavior.
- **Source evidence:** `frontend/src/lib/api.ts` assigns `window.location.href = '/login'` for 401s; `frontend/src/app/dashboard/layout.tsx` also calls `router.push('/login')` after its auth check. This is a source-based explanation of the observed duplicate navigation, not a verified fix.
- **Impact:** diagnostic noise/redundant navigation during anonymous entry. Navigation, RTL, visible controls and keyboard focus passed separately. The clean-console/network subflow is **fail**, not silently promoted to pass.
- **Original diagnostic run:** `partner-qa-d12f6280-3130-4eb0-bb05-846075e2a53a`; all four projects correctly failed when the stricter observer first exposed this condition.
- **Evidence handling:** the harness records only this exact known failure separately. Other console errors, uncaught exceptions, HTTP failures and failed resources remain test failures. It does not intercept a response, fake a successful navigation, or change application behavior. Final #335 acceptance must resolve or explicitly triage this observation; #314's green functional checks do not close it.

## Harness execution notes (not product defects)

- Run `partner-qa-9be38a1c-50d7-4d0f-9cc5-42d810d33ddf` passed all real-schema/API tests but one browser assertion exceeded the default five-second wait under local load; its failure screenshot captured the rendered heading immediately afterward. The harness now uses a bounded 15-second assertion timeout, 45-second test timeout and zero retries. Failed evidence is retained.
- Run `partner-qa-80022cd7-a049-42b7-8c42-c5a377c12598` refused runtime execution while another task replaced the shared frontend container. No replacement stack was created; the harness waited for the existing project to become healthy.
- Run `partner-qa-1d75aaaa-b6bc-4846-bd0f-f47ad4f6b6c7` recorded a changed CRM Customer fingerprint and a temporary HTTP failure during shared runtime QA. Other measured table fingerprints matched, and the alternate-key cleanup refusal regression passed. This failed preservation observation is not proof of a harness write; coordinate the other task and rerun without mutating real data to make hashes match.
