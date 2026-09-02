# BioMini controlled pilot runbook

Issue: #224

## Fail-closed prerequisites

Do not set `BIOMETRIC_CONNECTOR_MODE=physical` or `BIOMETRIC_LEGAL_READY=true` until all of these records exist:

- supplier invoice and unit serial;
- Xperix production SDK licence plus explicit development, production, redistribution, offline operation and 1:1 matching rights;
- warranty, replacement turnaround and spare-device terms;
- qualified Iranian counsel approval covering consent wording, retention, deletion, incident response, disclosure, vendor processing, evidence use, withdrawal and legal hold;
- Sabalan-owned code-signing certificate and a production package whose pinned signer and manifest pass `install-connector.ps1`;
- approved workstation hardening record: supported Windows release, patches, restricted local administration, USB power policy, endpoint protection and time synchronization; and
- named primary/backup HR, Accounting, Guard and IT operators who passed the competency checks below.

No manager can waive one of these gates. A missing gate keeps enrollment disabled.

## Installation and secret reconciliation

1. On a controlled build machine, run `package-production.ps1` with the approved SDK, portable Node runtime, empty output directory and Sabalan code-signing certificate thumbprint.
2. Verify the package on the pilot PC and run `install-connector.ps1` elevated, using the exact ERP HTTPS origin, approved device serial, assigned workstation ID and Sabalan signer thumbprint.
3. Move `erp-provisioning.json` through the approved secret-transfer channel. Merge it into `BIOMETRIC_WORKSTATIONS_JSON`; never paste it into an issue, chat, log or source file.
4. Securely remove the provisioning export after two authorized people compare workstation ID and key ID. Keep no second plaintext copy.
5. Confirm the scheduled task runs as SYSTEM, the port listens only on `127.0.0.1:47631`, the journal/config ACL contains only SYSTEM and Administrators, and an unapproved browser Origin receives HTTP 403.
6. Open Accounting > Settings > Biometric Connector. The signed health check must show the approved model, serial, SDK and connector versions.

## Operator competency

- HR: explain consent and withdrawal, confirm identity, capture two distinct fingers, recognize quality/liveness rejection, and never photograph or export a fingerprint.
- Accounting: bind the correct issued waybill and driver, position the finger, recognize success/non-match/device outage, and start fallback only after the system makes it eligible.
- Guard supervisor: reauthenticate independently, inspect the live authorization state, record an exception reason, and reject a printed document whose authorization is revoked.
- IT/support: reconnect and restart safely, verify signatures and ACLs, rotate one workstation without affecting another, preserve journal evidence, and escalate licence/spoof/unknown-result events.

Each operator must complete one supervised success, one poor-quality retry, one non-match, one unavailable-device fallback rehearsal and one revoked-authorization rehearsal. Record trainer, trainee, timestamp, result and remediation outside biometric material.

## Physical acceptance protocol

- Representative genuine-driver study: at least 100 genuine attempts; at least 95% first-attempt success; no driver below 90%; at least 99% within three attempts.
- Wrong-driver study: at least 100 attempts across enrolled/non-enrolled driver pairs; zero false matches.
- Spoof study: use only counsel and safety-approved presentation artifacts; every attempt must fail liveness or matching and must not expose reusable material.
- Latency: p95 from ERP command issuance through authoritative attempt commit must be at most three seconds on the actual pilot PC and network.
- Resilience: pass application restart, connector restart, USB unplug/replug, USB suspend/resume, workstation reboot, clock skew, licence failure, command replay, ciphertext substitution, revoked enrollment and cross-waybill substitution.
- Soak: 500 sequential cycles with no duplicate authoritative attempt, stale device handle, unbounded memory growth, local template retention or unreconciled interrupted command; then operate for one full business day.

Pause immediately on any false match, unapproved template disclosure, audit-chain exception, duplicate authorization, wrong-waybill binding, unreconciled command, repeated SDK crash or monitoring blind spot.

## Daily pilot reconciliation

Two different people compare exact counts for issued connector challenges, completed/failed/expired commands, biometric attempts, fallback alerts, exit authorizations, physical exits, shipment projections and buyer SMS states. Every challenge must have one terminal disposition; every successful biometric attempt must bind to one confirmation session; every consumed authorization must bind to one physical exit; every exit must have one SMS intent whose state is visible.

Open discrepancies become `DispatchEvidenceException` records and block expansion. Resume after a safety pause requires root cause, deployed correction, exact reconciliation, repeated acceptance checks and the existing independent pilot-resume approvals.

Run `BIOMETRIC_RECONCILIATION_ACTOR_ID=<erp-user-id> npm run reconcile:biometric-connector` from the backend runtime each business day. It atomically fails expired in-flight commands, creates one open evidence exception per unreconciled command and emits a hashed status-count report for the retained pilot evidence.

## Staged expansion

Start with named internal drivers and one Accounting workstation. Expand only after the full acceptance window has zero critical discrepancies and the owner signs the evidence. Add workstations one at a time with unique secrets. External drivers remain on the approved OTP plus Guard flow; a later external biometric pilot is a separate decision and is not implied by this rollout.
