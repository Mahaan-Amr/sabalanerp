# Sabalan BioMini workstation adapter

This Windows-only adapter is the Xperix/Suprema implementation behind SabalanERP's device-neutral biometric connector seam. It is currently an **evaluation executable**, not an approved production connector.

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

## Production gates still required

Before this adapter may be hosted by the authenticated loopback connector:

1. written production SDK and redistribution/matching terms;
2. an organization-owned code-signing certificate and signed release pipeline;
3. counsel-approved biometric consent, retention, deletion, incident and legal-hold configuration;
4. encrypted one-use transfer of the expected enrollment template to the connector, with no local cache;
5. connector authentication, strict ERP-origin checks, nonce journal and signed result envelope;
6. the accuracy, latency, spoof, reconnect, restart and 500-cycle tests in issue #224.
