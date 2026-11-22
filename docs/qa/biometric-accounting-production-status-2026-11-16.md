# Accounting biometric registration status — 2026-11-16

## Scope

Read-only investigation of the Accounting PC scanner and the diagnostics label shown in production. No production configuration or biometric record was changed.

## Verified production facts

- The backend runs with `BIOMETRIC_CONNECTOR_MODE=unconfigured`. The diagnostics route reports `liveEnrollmentEnabled: false` unless that value is `physical` (`backend/src/routes/biometric-connector.ts`). This produces the page's “ثبت واقعی: غیرفعال” label.
- `SABALAN-ACCOUNTING-PC02` completed a signed HEALTH check with `AVAILABLE` at 2026-11-16 07:17:09 UTC.
- At 2026-11-16 07:32:56 UTC, an ACTIVE driver biometric enrollment was saved through that workstation. Its RIGHT_INDEX and LEFT_INDEX CAPTURE challenges were both consumed; the final record contains two protected templates and metadata for two encrypted capture images. No driver identity or biometric material was included in this investigation record.
- The enrollment routes do not use `BIOMETRIC_CONNECTOR_MODE=physical` as their admission condition (`backend/src/routes/dispatch-confirmation.ts`). The diagnostics label therefore does not describe the observed enrollment capability.

## Unresolved acceptance evidence

`CONTEXT.md` defines a Physical Biometric Device Gate, and `docs/implementation/dispatch/biometric-pilot-runbook.md` requires it before setting the mode to `physical`. The reviewed repository documents do not establish that all supplier rights, accuracy, spoof, latency, soak, resilience, and operator prerequisites have passed. The observed successful enrollment does not by itself satisfy that gate.

## Owner decisions

- Today's Accounting PC enrollment was an intended production test with an informed, consenting driver.
- New enrollments may continue while the acceptance evidence is reviewed.
- Diagnostics should show scanner health and the timestamp of the last completed enrollment for the current workstation separately; the misleading “ثبت واقعی: غیرفعال” field should be removed.
- The present rollout scope is the Accounting PC scanner. Other workstations may be handled separately.

## Local correction

The diagnostics result now looks up the latest consumed enrollment capture for the workstation that completed the signed health command. The page displays its completion time separately from scanner health. This change does not alter enrollment admission or the production connector mode.

The exact read-only production query returned `2026-11-16T07:32:56.062Z` for `SABALAN-ACCOUNTING-PC02`. The backend and frontend builds, database-client ownership check, biometric workflow and simulator tests, and Sabalan Design System checks passed locally. Production still serves the previous page until a protected release deploys this correction.
