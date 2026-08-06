# Fingerprint scanner selection for SabalanERP

**Research date:** 2026-08-06  
**Decision ticket:** [#199](https://github.com/Mahaan-Amr/sabalanerp/issues/199)  
**Status:** implementation guidance; procurement remains conditional on the proof of concept below

## Decision

Buy **one Xperix/Suprema BioMini Slim 2 evaluation unit** for the pilot, preferably through an Iranian biometric specialist that will provide the device, SDK, license terms, and support as one written offer. Do **not** place a fleet order until the proof of concept passes.

BioMini Slim 2 is the best-balanced option because it is a purpose-built USB single-finger scanner, not an attendance terminal; it exposes standard templates; it has current Windows and Linux SDK support; and its manufacturer documents both image-quality checking and ISO/IEC 30107-3-compliant live-finger detection. It is also listed by multiple Iranian sellers and by an Iranian biometric integrator that offers a demo and support path.

The recommendation is conditional because the manufacturer marks the BioMini SDK as **purchase required**. Sabalan must obtain written terms for development, production deployment, redistribution, server-side matching if used, upgrades, and offline activation before committing to the device family.

If the BioMini Slim 2 cannot read the real driver population reliably, trial the **RealScan-G1** next because its FAP30 platen and capture controls are better suited to difficult or calloused fingers. If Xperix licensing or supply is unacceptable, trial the **SecuGen Hamster Pro 20 HU20-AL**. Use **Futronic FS88H** only after its older SDK surface and licensing pass the same proof of concept. Do not select HID DigitalPersona 4500 for this workflow because HID does not advertise liveness detection for it.

## Why this device fits

The current manufacturer page specifies:

- USB 2.0, 500 ppi single-finger optical capture, FAP20 certification, IP65 protection at the sensor surface, and operation in difficult lighting and with dry or wet fingers;
- Xperix, ISO/IEC 19794-2, and ANSI 378 template formats, plus RAW, BMP, ISO/IEC 19794-4, and WSQ image formats;
- AES-256 support in the SDK;
- Windows 10 or later, several Linux distributions, and Android support; and
- AI-based live-finger detection described as ISO/IEC 30107-3 compliant and PAD Level 1 and 2 certified.

The [BioMini Slim 2 product specification](https://www.xperix.com/products/biomini-slim-2) owns those technical claims. The [BioMini SDK page](https://www.xperix.com/products/developer/sdks) additionally documents C#, C++, and Java on Windows; C++ and Java on Linux; capture modes; minutiae extraction; image-quality checking; encryption/decryption; 1:1 and 1:N matching; standard formats; liveness detection; and the purchase requirement.

For Iranian procurement, [Sepid System lists BioMini Slim 2](https://sepidsystem.com/product/biomini-slim-2/), offers a pre-purchase demo, has a Tehran address and support system, and says it has represented Suprema in Iran since 1389 on its [Suprema page](https://sepidsystem.com/suprema/). That representation is the supplier's own claim and must be verified in the quotation. A separate Iranian retailer, [IT Pardaz](https://itpardaz.com/product/suprema-biomini-slim2/), exposed an add-to-cart price of **13,950,000 toman** when checked on 2026-08-06, while explicitly warning buyers to reconfirm price because of exchange-rate volatility. It also advertises authenticity, a seven-day return policy, and support; those are retailer policies, not a manufacturer warranty. [Sama Rayan](https://samarayanco.com/price/) separately lists BioMini Slim 2 under a named local warranty but publishes no duration or price. These sources establish an Iranian purchase path, not guaranteed stock or acceptable warranty terms.

## Candidate comparison

| Candidate | Technical fit from manufacturer sources | Iran procurement evidence checked 2026-08-06 | Decision |
|---|---|---|---|
| **Xperix/Suprema BioMini Slim 2** | Windows 10+, Linux, Android; C#/C++/Java; capture, quality check, template extraction, 1:1/1:N match; Xperix/ISO 19794-2/ANSI 378; AES-256; FAP20; ISO 30107-3 liveness; IP65 sensor surface. SDK purchase required. | Specialist listing and demo/support path at Sepid System; add-to-cart listing at IT Pardaz for 13.95m toman with price-reconfirmation warning; named local-warranty listing at Sama Rayan, terms unpublished. | **Recommended single-unit pilot**, conditional on SDK/license and PoC. |
| **Xperix/Suprema RealScan-G1** | FAP30 single-finger scanner with a 25.4 x 25.4 mm sensing area, hybrid liveness and capture-quality controls; Windows/Linux RealScan SDK. See the [manufacturer product page](https://www.suprema-id.com/en/contents/detail_code-020105.html) and [RealScan SDK](https://www.xperix.com/products/developer/sdks). | Sepid System lists the model on its Suprema page, but no reliable public price or stock confirmation was found. | Higher-assurance trial if calloused/difficult fingers fail on BioMini Slim 2; likely excessive for routine use. |
| **SecuGen Hamster Pro 20 HU20-AL** | Current FAP20 model; Windows 11/10, Linux, Android; free SDKs for enrollment and matching; ISO/IEC 19794-2/4 and INCITS 378; fake-finger and latent-print rejection; IP54; one-year manufacturer limited warranty. See [Hamster Pro 20](https://secugen.com/products/hamster-pro-20/) and [SecuGen SDKs](https://secugen.com/products/sdk/). | No credible specialist Iranian stock, price, and local-warranty combination was verified. | Best technical fallback if an Iranian supplier provides an evaluation unit and written support. |
| **Futronic FS88H** | FAP20/PIV image quality, USB, hardware-assisted liveness, unique USB serial, capture APIs for Windows/Linux/Android. The public FS88H API list is dated and stops at Windows 8; matching/template support and current licensing need direct confirmation. See the [FS88H manufacturer brochure](https://www.futronic-tech.com/download/FS88H_89H_brochure_v2.pdf). | [Edari Ara](https://edariara.com/product/futronic-fs88h/) exposed add-to-cart at 12m toman with a price-reconfirmation warning, but no product-specific warranty duration. | Procurement fallback only after a full current-Windows SDK PoC. |
| **HID DigitalPersona 4500** | Windows/Linux/Android SDK family; capture, extraction, 1:1/1:N, ISO/ANSI templates, and NFIQ/WSQ in the Linux SDK; HID's SDK page advertises royalty-free runtime distribution. HID maintains a Windows 11 driver. No manufacturer liveness claim was found. See [reader](https://www.hidglobal.com/products/4500-fingerprint-reader), [SDK](https://sdk.hidglobal.com/node/34864), and [current driver](https://www.hidglobal.com/drivers/49061). | [Kiyandaria](https://kiyandaria.com/pro/hid-digitalpersona-4500-fingerprint-reader-optical-usb-small-form-factor-excellent-image-quality-fas) listed about 20.47m toman, with delivery after receipt in the origin country rather than evidence of Iranian shelf stock. | Not preferred: weak anti-spoof evidence and an importer path rather than specialist support. |

Prices are snapshots, not quotations. No bulk purchase should rely on them.

## Connector topology

Keep the business workflow in SabalanERP, but bridge the USB reader with a small Sabalan-managed service on the Accounting workstation:

```text
SabalanERP browser
  -> short-lived, signed verification challenge
  -> loopback-only Sabalan biometric connector
  -> vendor adapter (Xperix first; device-neutral interface)
  -> vendor SDK/driver
  -> USB fingerprint scanner
```

The connector must expose a narrow adapter contract: device discovery and serial number, health, capture, quality result, liveness result, template extraction, 1:1 verification, cancel, and normalized error codes. Vendor-native values should be retained inside the adapter and normalized at its boundary. The ERP event records device model/serial, connector and SDK versions, quality/liveness outcome, match outcome and score where the SDK safely exposes it, timestamps, operator, and the signed waybill challenge. It must not record raw fingerprint images.

Prefer central 1:1 matching so enrollment templates stay encrypted in SabalanERP and are decrypted only inside the biometric service. If the purchased SDK cannot legally or technically match on the server, the PoC must document the alternative and its risk before local matching is accepted. A local match would require a short-lived encrypted template envelope sent only to an attested Accounting connector; it must never cache enrollment templates.

The scanner itself is not standalone and does not need to be. Xperix explicitly marks stand-alone mode unsupported. The expected operational mode is local USB capture through the connector while SabalanERP is online. No vendor cloud should participate. The PoC must prove that capture, liveness, extraction, and matching continue after vendor endpoints are blocked and after any one-time license activation. When SabalanERP is unavailable, the already-agreed two-person manual emergency process applies; the connector must never create an exit authorization by itself.

## Procurement gates

Require the Iranian supplier to provide all of the following in writing before payment:

1. Exact model and part number, new-device status, serial number, current local stock, lead time, and availability of a spare unit.
2. A loan/demo device or a returnable single evaluation unit.
3. Windows 11 x64 driver, BioMini SDK, API documentation, sample programs, and the exact SDK version before the PoC begins.
4. Perpetual development and production terms; runtime redistribution rights; server-side 1:1 matching rights; activation method; device/seat/server limits; upgrade entitlement; and confirmation of no recurring subscription or vendor-cloud dependency.
5. Warranty issuer, duration, exclusions, replacement turnaround, local repair/replacement process, and effect of using Sabalan's own connector.
6. Written confirmation that the APIs expose device serial, capture status, a usable numeric quality result, live/fake result, standard template generation, 1:1 match result, and normalized error details.
7. An invoice and acceptance clause tied to the PoC, not merely the scanner powering on.

## Proof-of-concept acceptance checklist

The PoC passes only when every mandatory item below succeeds on the exact Accounting workstation OS and the exact purchased model.

### SDK and deployment

- [ ] Install unattended under a standard Windows 11 x64 workstation build; reboot, lock/unlock, USB suspend/resume, and reconnect do not break capture.
- [ ] Enumerate the exact model and stable device serial; reject unsupported or substituted devices.
- [ ] Run the connector as a least-privilege signed service, bound only to loopback, with strict origin checks and an authenticated, short-lived request nonce.
- [ ] Confirm written runtime redistribution, server-matching, and activation rights; deliberately reproduce and normalize a license-expired/invalid error.
- [ ] Block vendor internet endpoints after any documented activation and prove capture, extraction, liveness, quality, and 1:1 matching still work.

### Enrollment and verification

- [ ] Enroll at least two fingers per driver using repeated samples and store only encrypted templates; prove no raw image reaches logs, temporary files, telemetry, database, or backups.
- [ ] Export the chosen versioned template format (prefer ISO/IEC 19794-2) and record the vendor algorithm/SDK version needed to interpret it.
- [ ] Expose a numeric or clearly ordered quality value; reject below a documented threshold and give the operator a useful retry reason.
- [ ] Verify the correct driver 1:1 across connector/server restarts and reject at least ten attempts from other enrolled drivers.
- [ ] If two scanners will be deployed, enroll on one and verify on the other; failure blocks multi-workstation rollout.
- [ ] Record genuine/live, fake/rejected, sensor-error, and unsupported-liveness states separately. Test approved safe spoof materials under a documented protocol; never translate unknown/error into `live`.
- [ ] Trial with a representative group of real drivers, including dry, wet, dusty, worn, scarred, and calloused fingers. Target at least 100 genuine attempts and document first-attempt and retry success rates rather than accepting a vendor demonstration.
- [ ] Measure end-to-end verification latency; the provisional target is p95 <= 3 seconds after finger placement under normal local-network conditions.

### Workflow and failure safety

- [ ] Bind each scan to a signed, single-use challenge containing the waybill/allocation ID, expected driver, workstation, nonce, and expiry; replay and cross-waybill attempts fail.
- [ ] Exercise disconnect, busy device, capture timeout, low quality, fake finger, no match, driver-template missing, revoked driver, SDK/license failure, connector unavailable, ERP timeout, and clock-skew paths.
- [ ] Prove that device or ERP failure cannot emit a successful confirmation or gate authorization and correctly offers the audited OTP/two-person fallback where allowed.
- [ ] Store a tamper-evident verification event with waybill hash, driver snapshot, method, outcome, device serial, SDK/connector versions, quality/liveness outcome, operator, and timestamps, but no raw image or reusable probe template.
- [ ] Revoke an enrollment template and prove subsequent verification fails while historical shipment evidence remains readable.
- [ ] Run a 500-cycle capture/verify soak test and a full workday pilot without resource leaks, frozen browser state, or connector restarts.

## Risks and follow-up

- **Commercial SDK ambiguity:** this is the largest blocker. A retail scanner without production SDK rights is unusable.
- **Supplier claims are not manufacturer guarantees:** verify representation, stock, price, warranty, and support directly in a signed quotation.
- **Interoperability is not automatic:** ISO template support reduces lock-in but does not guarantee equal cross-vendor match performance. Version the template and matcher metadata and test a replacement reader before switching vendors.
- **Liveness is probabilistic:** retain OTP plus second-person approval for genuine unreadable fingers and device failures; never market liveness as proof against every spoof.
- **Driver fingers may be difficult:** use real-driver trials before bulk purchase. Escalate to RealScan-G1 only if failure data justifies its larger platen and likely higher cost.
- **Evidence quality comes from the transaction binding:** the scanner is only one input. The signed waybill challenge, immutable shipment snapshot, operator identity, timestamps, device identity, and Guard exit record create the defensible evidence package.

## Final procurement instruction

Ask Sepid System and at least one independent seller for written quotes for **one BioMini Slim 2 plus the complete production SDK/license**, and require a demo against this checklist. Buy the pilot from the bidder that can prove the software rights and replacement support, even if the bare scanner price is higher. Keep SecuGen Hamster Pro 20 and Futronic FS88H as quote-and-test fallbacks; do not substitute an attendance clock or a reader without liveness and a documented integration SDK.
