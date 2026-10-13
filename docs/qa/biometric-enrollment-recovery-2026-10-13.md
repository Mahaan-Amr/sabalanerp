# Two-finger enrollment recovery — 2026-10-13

## Scope and agreed behavior

Local source changes and testing only. The owner prohibits Git push and production publication. Production was inspected read-only; no scanner enrollment or instrumented replay is run against production during this correction.

Each valid finger must be authenticated and accepted immediately after capture. Acceptance is provisional: it creates no active enrollment or dispatch authority. The owner selected five minutes to complete the same enrollment attempt; both distinct fingers are still required for final enrollment. A failed second capture must preserve the accepted first finger while that window remains valid. Failed final submission must preserve recoverable provisional captures and the entered phone. Expired provisional material must not be reusable or mixed with another attempt.

## Observed failure pattern

The production frontend collected both connector results before submitting either to the backend. A thirty-second command validity check at final submission therefore charged time spent on the second finger against the first command. A second observed attempt returned a signed `CONNECTOR_ERROR` result with quality and liveness `NOT_EVALUATED`; the UI nevertheless advanced and rendered fixed success badges. The backend converted the operational rejection to HTTP 500, which the frontend replaced with a generic service-unavailable message.

The Windows capture parser expected `SABALAN_TEMPLATE_RESULT:` even when the SDK worker returned its normalized `SABALAN_RESULT:` error. Nonzero exit or missing success framing caused specific failure categories to be discarded as `CONNECTOR_ERROR`. This explains loss of diagnostic detail; it does not identify the original error on the accounting computer without a fresh non-material device diagnostic.

## Accounting computer diagnostics

Use an elevated PowerShell on the installed workstation. Read the protected configuration into a variable; never print, attach, or export its contents. The public adapter commands `health` and `capture` return non-material diagnostics. Never use the private `capture-template --sdk-worker` command for a support transcript. Neither diagnostic records an ERP enrollment.

```powershell
$bioConfigPath = Join-Path $env:ProgramData 'SabalanERP\Biometric Connector\connector.json'
$bioConfig = Get-Content -LiteralPath $bioConfigPath -Raw | ConvertFrom-Json
$env:SABALAN_BIOMETRIC_ALLOWED_SERIAL = $bioConfig.allowedDeviceSerial
Get-Item -LiteralPath $bioConfig.adapterPath |
  Select-Object FullName, LastWriteTime,
    @{Name='FileVersion';Expression={$_.VersionInfo.FileVersion}}
& $bioConfig.adapterPath health
```

Only after health has been reviewed, close any vendor demo that may own the device, place one finger on the scanner, and invoke the public non-material capture command:

```powershell
& $bioConfig.adapterPath capture
```

Installing a new connector package, changing workstation provisioning, or publishing ERP changes is outside this diagnostic step.

## Acceptance evidence

Passed locally:

- `npm run architecture:check` and `npm run design-system:check`.
- Design-system foundation (25 tests) and adoption (14 tests).
- Windows connector host (25 tests), package typecheck and build.
- Frontend enrollment workflow (12 tests), including failed signed-result reporting, first-finger preservation, expiry, cancellation and exact acceptance retransmission after a lost response.
- Backend build and gateway/enrollment policy suites (4 tests).
- Actual existing local PostgreSQL verifier `backend/scripts/verify-biometric-staged-enrollment.ts`: signed capture acceptance after immediate receipt; delayed finalization beyond the scanner command deadline; first-anchored expiry; failed second capture and final rollback; same-attempt and distinct-attempt concurrency; signature/scope and encryption-context substitution; cancellation and expiry erasure.
- Final frontend build, rebuilt existing local backend/frontend, and `npm run docker:verify`.
- `npm run test:design-system:e2e -- tests/design-system-e2e/biometric-enrollment.spec.ts` (2 browser tests): failed right stops before left; accepted right is staged before left and survives second-finger and final-submit failures. First preflight stopped while the newly recreated frontend was still starting; the healthy-stack run passed.

Integration verification preserves immutable local enrollment/audit QA fixtures with Personnel inactive/archived and driver profiles archived, rather than disabling evidence triggers. Transient test commands are removed; no active test driver remains.

The accounting workstation owner confirmed that the diagnostic uses the same person as the failed enrollment. Public `health` returned `AVAILABLE`, BioMini SLIM 2, adapter `1.0.0`, SDK `3.11.1.595`, no error. A fresh public right-finger `capture` returned quality `ACCEPTED` (77), liveness `LIVE` (986), ISO extraction successful and `materialReturned: false`. This confirms this fresh diagnostic succeeded; the old masked worker error cannot be reconstructed from these successful results.

A fresh public left-finger `capture` from the same person also returned `AVAILABLE`, quality `ACCEPTED` (89), liveness `LIVE` (997), successful ISO extraction, `materialReturned: false`, and `errorCategory: NONE`. Both fresh non-material captures passed on the installed adapter. These are individual adapter diagnostics, not a browser-to-ERP two-finger enrollment test, and they cannot recover the original masked SDK error.

The corrected connector host has not been installed on the accounting computer. ERP production, workstation credentials and remote Git refs remain unchanged. A package test cannot prove that the corrected source is installed on the accounting computer.
