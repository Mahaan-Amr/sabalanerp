# Production-origin laptop scanner health — 2026-09-29

Scope: first laptop workstation, device health and connection only. No fingerprint capture, enrollment or matching was performed. Production enrollment mode was not enabled.

## Completed

- Built and validated the production connector package without a code-signing certificate.
- Installed the connector through elevated `install-connector.ps1` as workstation `SABALAN-LAPTOP-BIOMINI`, using ERP origin `https://sabalanerp.com`.
- Installer reported successful creation and startup of the SYSTEM scheduled task `SabalanERP Biometric Connector`.
- Confirmed listening address `127.0.0.1:47631`.
- `GET /v1/status` with Origin `https://sabalanerp.com` returned `AVAILABLE`, model `BioMini SLIM 2`, connector version `1.0.0`, SDK version `3.11.1.595`, at `2026-09-29T07:15:42.445Z`.
- An unapproved Origin received HTTP 403.
- Unelevated access to connector configuration was denied. Credentials were not printed or copied into the repository report.
- Package validation tests passed eight cases; the host suite passed sixteen tests.
- Fixed installer JSON output to use UTF-8 without a BOM so the Node host can read Windows PowerShell-generated configuration.

## Pending production registration

The earlier production inspection found a healthy backend with mode `unconfigured` and zero registered workstations. The laptop's new credentials have not been transferred or merged into production configuration.

Subsequent SSH attempts to the production host initially timed out during banner exchange. A retry at `2026-09-29T07:22:12Z` succeeded; production Compose inspection confirmed all six services healthy and the tracked checkout clean on `main` at `e521bee8`. A follow-up found an already-running canonical deployment (`deploy/scripts/deploy.sh`, PID `340328`), so biometric configuration changes and a second deployment were deferred to preserve single-deployment ownership. No production services or configuration were changed by this biometric setup. Registration still requires the active deployment to finish and a fresh release-state check.

After SSH access is restored, establish the exact current release and deployment state, then register the workstation using the protected deployment workflow in `docs/operations/zero-data-loss-deployment.md`. The canonical deployment script currently has no configuration-only mode and fetches/builds its deployment branch, so candidate scope must be checked before invocation. Do not directly recreate the backend outside that workflow.

Completion requires an authenticated production diagnostics command, execution by this connector, and verification of its signed result by the production ERP. This end-to-end check is still pending; local health alone does not prove server registration.
