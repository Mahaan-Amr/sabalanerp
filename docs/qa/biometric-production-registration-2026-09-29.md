# Biometric production registration — 2026-09-29

## Scope

Register `SABALAN-LAPTOP-BIOMINI` for signed scanner-health diagnostics against production ERP. Enrollment and fingerprint capture remain disabled. The scanner stays attached to the laptop; the ERP backend runs on production.

## Confirmed diagnosis

- Laptop loopback connector reports `AVAILABLE`, BioMini SLIM 2, connector `1.0.0`, SDK `3.11.1.595`, for the approved ERP origin.
- Production originally runs release `196f4de63b68639a1165c0d64f1dcf6e8f8cf585` with no registered workstations. The page loads, but issuing the health command returns HTTP 409.
- The fix is additive workstation configuration, preserving immutable application images and the measured running code identity.

## Implementation and validation

- Implementation commit: `3023af1e`, branch `codex/biometric-configuration-release`.
- Full `backend` `test:deployment-control` suite passes, including 11 configuration tests: immutable identity, protected snapshot, exact environment recovery, integrity/concurrency failures, session binding, traffic-open interruption marker, preflight/checkpoint/migration failure recovery, and successful canonical execution without source fetch or image build.
- Shell syntax, database-client ownership, and existing commit-hook design-system checks pass.
- Reviewed runner bundle SHA-256 manifest identity: `f79f38ae72e66b744358404f0c87e039276dcc7f1dfdd831cf9562740eb57de6`. All four transferred files pass remote checksum verification.
- Private workstation provisioning was transferred directly from the protected Windows installation to a root-only server directory. The remote file is mode `0600`. No key values belong in this report.

## Production execution status

Registration has not yet been applied. A separate existing release for commit `6a7a79266bcd4e1ccc4a762f85872b42284432b7` owns the host deployment lock. It completed its image builds and entered the coordinated checkpoint stage under maintenance.

A bounded waiting wrapper was prepared to start only after that release succeeded, the lock became available, and no active deployment session remained. The concurrent release continued slow remote-archive integrity checks for local-capacity recovery. The biometric wrapper was stopped while its log was still empty and no biometric configuration state existed; the other release was untouched. Its temporary remote provisioning export was removed. No biometric configuration release ran.

To resume, privately transfer the installed workstation's provisioning export again after the concurrent release has completed and its journal/lock are clear. Reverify the immutable runner bundle, acquire the canonical lock through the runner, and measure the then-running image identity. Do not presume that the release is still `196f`.

Final acceptance requires a successful production configuration release and the browser's signed health-command round trip. Remove the temporary remote provisioning export after verification. Retain protected recovery state if any release requires recovery; never delete locks or bypass checkpoint/drill gates.
