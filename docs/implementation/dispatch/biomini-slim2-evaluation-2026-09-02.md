# BioMini Slim 2 evaluation evidence - 2026-09-02

Issue: #224

## Purchased unit

- SDK-reported model: `BioMini SLIM 2` (`SFR700`)
- Stable SDK serial: `SBBM-SLIM22024060000000873053007`
- USB identity: `USB\\VID_16D1&PID_0408`
- Windows driver: Xperix `3.0.3.0`, service `SFR500`, published as `oem56.inf`
- BioMini SDK package: `3.11.1.595`

The device initially enumerated with Windows problem code 28 because no matching driver was installed. The reseller's outer SDK installer and nested driver installer were unsigned, so neither wrapper was executed. The nested driver payload was extracted and inspected instead. Its `SFR.inf` explicitly supports `VID_16D1&PID_0408`; its catalog has a valid Microsoft Windows Hardware Compatibility Publisher signature; and its x64 driver binaries have valid Suprema signatures. Installing that INF changed the device to status `OK` and problem code `0`.

## Live technical check

The unpacked Xperix C# demo initialized one scanner and reported the exact model and serial above. A temporary live preview captured a clear fingerprint. Capture was then aborted, the scanner was uninitialized, and the demo was closed.

No enroll command, template extraction command, save-image command, or save-template command was used. No fingerprint image or reusable template was intentionally persisted by the test.

The new Sabalan evaluation adapter then passed its own allowlisted physical checks:

- health returned one clean JSON result for the approved model, serial and SDK `3.11.1.595`;
- missing serial configuration failed with `CONFIGURATION_ERROR`;
- a substituted serial failed with `DEVICE_IDENTITY_INVALID`;
- allowlisted capture passed with extraction quality `86` and SDK live-finger score `999`;
- ISO/IEC 19794-2 extraction completed in memory; and
- the command returned neither template material nor a raw image and cleared its probe buffer on disposal.

## What this proves

- the purchased unit is a BioMini Slim 2, not merely a powered USB device;
- the inspected driver supports the exact USB identity and works on this workstation;
- SDK 3.11.1.595 can initialize the unit and acquire a live image; and
- the repository can now build a vendor adapter against the observed SDK interface.

## What this does not prove

This is not the Physical Biometric Device Gate and does not authorize real-driver enrollment or production dispatch confirmation. The following remain open:

- written production SDK, redistribution, offline use and matching rights;
- supplier warranty, replacement turnaround and spare-unit terms;
- organization-owned signed connector release;
- approved legal/consent/retention/deletion policies;
- numeric quality and liveness threshold calibration;
- wrong-driver and approved spoof tests;
- reconnect, restart, USB suspend, clock, replay and license-failure tests;
- representative-driver accuracy and p95 latency evidence; and
- 500-cycle soak, operational monitoring, training and staged-pilot acceptance.
