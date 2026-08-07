# Sabalan biometric connector contract

The connector is a narrow, device-neutral boundary between SabalanERP and a future workstation-local fingerprint adapter. Ticket #217 ships only the deterministic simulator, protected template primitives, and read-only diagnostics. It does not enable production capture or enrollment.

## Boundary

The ERP signs a command for one configured workstation. A command contains a unique command ID and nonce, an issuance and expiry time, the operation, and transaction references. The validity window may not exceed 60 seconds. The connector authenticates the HMAC signature before inspecting the command, rejects another workstation, rejects nonce replay, and returns the prior result when the same command is safely retried.

The durable command journal stores only hashes and safe normalized results. It atomically reserves a command as `IN_FLIGHT` before the device operation begins. A concurrent duplicate is rejected as already in progress. Atomic replacement allows a process restart without repeating a completed capture; an orphaned `IN_FLIGHT` reservation becomes `INTERRUPTED`, reports that its outcome is unknown, and is never automatically replayed. An operator must reconcile that transaction before creating a fresh command. The journal must be kept in a connector-owned directory readable only by the service identity.

Supported operations are `HEALTH`, `CAPTURE`, `VERIFY`, and `CANCEL`. Results normalize:

- availability and stable device identity;
- capture quality and optional score;
- liveness and optional score;
- one-to-one match and optional score; and
- stable error category and retryability.

Vendor-native values remain inside the future adapter. A real adapter must implement the same `BiometricConnector` interface and pass the simulator contract suite.

## Simulator

The deterministic scenarios are success, poor quality, liveness failure, non-match, wrong driver, disconnect, timeout, retry, recovery, and SDK licensing failure. Retry succeeds only when the caller advances to attempt two; repeating an identical signed command remains idempotent. Fallback eligibility is stateful per challenge and becomes true only after three good-quality, live non-matches. Poor-quality captures and liveness failures never increment that count.

Authenticated commands are operation-specific. Unknown fields, missing required identifiers, unsupported simulation values, nested arrays, raw-image/sample/blob/probe/template-material fields, and base64-like material are rejected before reservation or device execution. The simulator itself also fails closed when called directly with an unsupported scenario.

The simulator is the only diagnostics source in this ticket. The Accounting diagnostics page explicitly reports simulator mode and `liveEnrollmentEnabled: false`.

## Protected templates

`ProtectedTemplateVault` seals template bytes with AES-256-GCM. Authenticated context binds ciphertext to the Personnel identity, finger, and versioned template format, preventing substitution across people or fingers. Key IDs support rotation; keys must come from deployment secret management and never from business data.

Raw fingerprint images have no field in the contract and must never reach the ERP, journal, logs, diagnostics, exports, or backups. Connector responses also exclude reusable probe templates, OTP values, command secrets, signatures, and nonces.

## Production adapter gate

Do not replace simulator mode or activate enrollment until the BioMini Slim 2 procurement, licensing, offline operation, liveness, real-driver accuracy, latency, restart, and security proof of concept in `docs/research/fingerprint-scanner-selection.md` has passed. That research note currently lives on the research branch until integrated into the implementation baseline.
