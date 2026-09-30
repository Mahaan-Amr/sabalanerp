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

The initial concurrent deployment for `6a7a7926` aborted before mutation because checkpoint capacity was insufficient; the unchanged `196f` release passed gates and reopened. A new build attempt then acquired the lock again. The user explicitly chose to stop that build and prioritize biometric registration.

The candidate build client was cancelled while its deployment runner was paused, after proving that no deployment session had started. The canonical runner exited `130` and released its own lock. All six production services remained healthy. No lock was deleted and no public service was stopped by the cancellation.

The installed workstation provisioning export was transferred again through the private channel, validated without printing keys, and restricted to mode `0600`. The reviewed configuration runner started release `deploy-20260929T092026Z-196f4de63b68-configuration`. Preflight passed. The encrypted checkpoint is `764215624` bytes, checksum `3afb7481d11f446501302cd4ce2dfcde8eb16607390cdee854aff46215d5b376`; both local and remote verification passed, including full remote read-back. Workstation configuration was applied inside maintenance.

The mandatory financial-evidence reconciliation then blocked promotion: contract `100579`, row `contract-row-e109c806-4ed7-4162-b39f-22865ac90229`, has missing discount-eligibility evidence. The canonical runner performed its single automatic rollback, restored the checkpoint and original workstation configuration, passed rollback gates, and reopened the verified previous release. Exit status is `1`, result `ROLLED_BACK`; no active deployment session remains. All six production services are healthy on their original immutable image identities. Runtime workstation count is again `0`, so the original HTTP 409 is not fixed.

The canonical workflow created a durable referral for the unresolved financial evidence: review case `e65e159f-f16b-42eb-81a5-80796402c3b9`, support ticket `cmum7nsm40fp9wgd2m7a2bc2y`. No pricing fact was guessed and no release gate was bypassed.

A separate connection prerequisite was found: the production clock was approximately 183 seconds ahead. The connector rejects commands issued more than 30 seconds in its future. After rollback completed and its lease ended, time synchronization was enabled under the host deployment lock. Both Ubuntu and Windows NTP destinations timed out from production (packet count zero). Windows sampled `time.windows.com` at `+0.1089086s`; production time was then corrected under the host lock using that verified laptop UTC reference. Production reported `2026-09-29T09:55:44Z` and the independent clock reported `09:55:45 UTC`. NTP remains enabled, but `NTPSynchronized=no`; automatic time-source reachability still needs investigation.

The browser reload confirms production is open and redirects the expired session to the login page. No signed health round trip was attempted after rollback because the workstation registration is absent. The temporary root-only provisioning export was removed; the installed protected laptop configuration remains intact. Enrollment and capture remain disabled.

Final scanner acceptance is blocked by missing financial evidence. Resolve the existing contract review through its documented evidence workflow, then retry the full verified configuration release and the browser health round trip. Do not invent financial evidence, bypass reconciliation, delete locks, or promote a partial release.
