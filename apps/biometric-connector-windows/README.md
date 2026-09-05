# Sabalan BioMini workstation adapter

This Windows-only package is the Xperix/Suprema implementation behind SabalanERP's device-neutral biometric connector seam. Its software path is implemented, but it remains **pilot-gated** until the signed distribution, vendor rights, counsel approval, and physical acceptance evidence are supplied.

It deliberately:

- accepts only a connected `BioMini SLIM 2` (`SFR700`);
- reports stable model, serial, SDK and adapter versions;
- performs capture, ISO/IEC 19794-2 extraction, liveness and 1:1 matching in process memory;
- returns only normalized evidence and never returns or writes a raw fingerprint image;
- clears probe-template buffers after each command; and
- fails closed when liveness is unavailable, the device is substituted, or the SDK reports an error.

The proprietary BioMini SDK is not part of this repository. Obtain it and the required development, production, redistribution, offline-activation and matching rights directly from Xperix or an authorized supplier.

## Build an evaluation executable

Open PowerShell on a Windows x64 workstation and point the build script to the SDK's x64 `bin` directory:

```powershell
.\build-evaluation.ps1 -BioMiniSdkDirectory 'C:\approved\BioMiniSDK\bin\x64'
```

The script validates the required SDK files and builds `artifacts\Sabalan.BioMini.Evaluation.exe`. Vendor DLLs are copied only into the ignored local artifacts directory.

## Commands

Device health does not capture biometric material:

```powershell
$env:SABALAN_BIOMETRIC_ALLOWED_SERIAL = 'SBBM-SLIM22024060000000873053007'
.\artifacts\Sabalan.BioMini.Evaluation.exe health
```

Capture proves image acquisition, liveness, ISO-template extraction and quality without outputting or saving the image or template:

```powershell
.\artifacts\Sabalan.BioMini.Evaluation.exe capture
```

Exit code `0` means the requested check passed. Any non-zero exit is fail-closed and emits normalized JSON to standard output. Do not use this evaluation executable for real-driver enrollment or dispatch confirmation.

The serial environment variable is mandatory and must come from the approved-device inventory. A different Slim 2 is rejected rather than silently accepted. The evaluation quality floor is `40`, matching the vendor sample's default; it remains provisional until the representative-driver study predeclares the production threshold.

## Authenticated workstation host

`host/` is the production-facing loopback service. It binds only to `127.0.0.1:47631`, accepts one exact ERP origin, verifies 32-byte HMAC command credentials, durably reserves hashed command identities, serializes device operations, and signs safe results. Enrollment and verification templates use command-bound AES-256-GCM envelopes and are zeroed after use. Ciphertext is relayed by the browser but is never journaled locally.

Build and test it with:

```powershell
npm --prefix .\host ci
npm --prefix .\host test
npm --prefix .\host run build
```

`package-production.ps1` assembles an external distribution from an approved SDK directory and a portable Node executable. Proprietary Xperix files stay outside Git. A Sabalan code-signing certificate is mandatory. `install-connector.ps1` pins the trusted signer thumbprint, rejects unsigned, modified, missing, duplicate, escaping, or unmanifested package files, installs into a manifest-addressed release directory, restricts configuration/journal ACLs to SYSTEM and Administrators, generates per-workstation credentials, and registers a SYSTEM startup task. HTTPS and signature verification cannot be disabled.

The production packager uses `build-production.ps1` and emits `adapter\Sabalan.BioMini.Adapter.exe` with production version metadata. The evaluation executable remains limited to the local hardware-evaluation commands and is excluded from production packages.

The installer creates `erp-provisioning.json`. Transfer its object into the ERP secret named `BIOMETRIC_WORKSTATIONS_JSON`, verify the workstation, and then securely remove that export from the workstation.

## External activation gates still required

Before this adapter may be hosted by the authenticated loopback connector:

1. written production SDK and redistribution/matching terms;
2. an organization-owned code-signing certificate and signed release pipeline;
3. counsel-approved biometric consent, retention, deletion, incident and legal-hold configuration;
4. production workstation installation and configuration reconciliation;
5. the accuracy, latency, spoof, reconnect, restart and 500-cycle tests in issue #224; and
6. completed operator competency and support coverage records.
