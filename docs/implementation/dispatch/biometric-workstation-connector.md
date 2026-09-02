# Biometric workstation connector design

## Status

This document fixes the production seam for issue #224. The checked-in BioMini implementation is an evaluation adapter only. Simulator mode remains the only ERP-integrated mode until every security, licensing and legal gate below is implemented and accepted.

## Deep module and seam

SabalanERP callers continue to know only the existing `BiometricConnector.execute(command)` interface. Device discovery, capture, liveness, quality, extraction, matching, SDK errors, reconnect and buffer clearing stay behind that interface. `DeterministicBiometricSimulator` and the Windows `BioMiniSdkAdapter` are the two real adapters at this seam.

The production topology is:

```text
SabalanERP browser
  -> requests a short-lived signed command from the ERP
  -> sends that command to a loopback-only workstation connector
  -> connector authenticates and journals it before execution
  -> BioMini adapter talks to the local Xperix SDK and USB scanner
  -> connector returns a command-bound signed result
  -> browser submits that result to the ERP for authoritative commit
```

The workstation connector never issues a waybill, confirmation or exit authorization. The ERP remains the only lifecycle authority.

## Template handling that must be added before live enrollment

The simulator contract currently carries only `templateReference`; that is intentionally insufficient for a real workstation to match against an ERP-held encrypted template. Production must add two one-use cryptographic envelopes without weakening the raw-material prohibition:

- **Enrollment:** the adapter extracts an ISO/IEC 19794-2 template in memory and encrypts it directly to an ERP enrollment public key. Only ciphertext leaves the connector. The ERP decrypts it in memory, seals it with `ProtectedTemplateVault`, and discards the transport plaintext.
- **Verification:** the ERP opens the selected enrollment template in memory and immediately encrypts it to the allowlisted connector instance, bound to command ID, driver, waybill hash, workstation, purpose and expiry. The connector decrypts it only after authenticating and reserving the command, performs 1:1 matching in memory, then zeroes both expected and probe buffers.

Neither envelope may be logged, journaled, placed in URLs, returned by diagnostics, retained after the command, or accepted for another command. The browser may relay ciphertext but cannot decrypt it. A connector restart loses all in-flight material and produces an interrupted/unknown result that requires reconciliation.

## Workstation connector interface

The loopback host exposes one command endpoint and one non-sensitive version endpoint. It must:

- bind only to `127.0.0.1` and `::1`;
- allow only configured SabalanERP HTTPS origins and reject requests without an `Origin` header;
- authenticate the ERP signature before parsing vendor-specific fields;
- enforce workstation, command, purpose, issued-at and expiry binding;
- durably reserve nonce and command hashes before touching the device;
- return the prior signed safe result for an identical completed retry;
- never automatically repeat an interrupted capture;
- accept exactly one allowlisted model and serial;
- serialize device operations and support explicit cancellation;
- sign the normalized result so browser code cannot alter evidence; and
- keep secrets and journals in ACL-restricted connector-owned storage.

## Activation gates

Production configuration remains fail-closed until all are true:

1. Xperix production, redistribution, offline and matching rights are recorded.
2. The connector installer and executable are signed by Sabalan's code-signing certificate.
3. The legal-readiness configuration is active and counsel-approved.
4. Enrollment and verification envelopes pass replay, substitution, expiry and restart tests.
5. Origin restrictions, loopback binding, journal ACLs and secret provisioning pass security review.
6. Issue #224's physical accuracy, liveness, latency, reconnect and 500-cycle gates pass.
