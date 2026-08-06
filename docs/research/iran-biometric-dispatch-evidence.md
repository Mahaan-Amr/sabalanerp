# Iranian biometric and electronic-evidence obligations for dispatch confirmation

Research for [GitHub issue #200](https://github.com/Mahaan-Amr/sabalanerp/issues/200), checked on 2026-08-06.

> This note is product and architecture research, not legal advice. The unresolved items in the counsel checklist are release gates for production biometric enrollment and dispatch confirmation.

## Resolution

SabalanERP can design a strong transaction-bound dispatch-confirmation record, but it should not claim that a fingerprint match alone is a legally “secure electronic signature.” The production baseline should:

1. obtain and record explicit, purpose-specific consent before enrolling an internal driver;
2. retain only an encrypted fingerprint template, never a raw fingerprint image;
3. require an explicit confirmation of the exact dispatch immediately before a live fingerprint verification;
4. bind the confirmation, verification result, dispatch snapshot, and later gate exit into a tamper-evident audit chain;
5. treat OTP and offline confirmation as visibly weaker exception evidence, with dual approval and complete reasons; and
6. obtain written advice from qualified Iranian counsel on applicability, consent in employment, retention, signature status, incident notification, and the offline form before production use.

The raw-image rule is a conservative product decision derived from purpose limitation and minimization. **No reviewed Iranian text expressly prohibits storing a raw fingerprint image.** Counsel must confirm the classification and rule, but a legal-evidence objective does not by itself justify retaining a reusable biometric image: the stronger evidence is a fresh verification event cryptographically bound to one immutable dispatch.

## Source limits

The primary enacted text used for electronic evidence is Iran's Electronic Commerce Act as reproduced by [WIPO Lex](https://www.wipo.int/wipolex/en/text/495385), with the [Persian enacted text](https://nezamat.ir/post-34221/) used to check terminology. The criminal-law text is cross-checked against the [UNODC SHERLOC reproduction of Iran's Computer Crimes Act](https://www.unodc.org/cld/uploads/res/document/computer-crimes-act_html/Computer_Crimes_Act.pdf) and the [Persian enacted text](https://nezamat.ir/post-37592/).

The 1402 privacy directive was promulgated as circular 107198 on 1402/10/27 by the Secretary of the Supreme Council of Cyberspace. The official `majazi.ir` page found during research no longer served the circular at the time of checking, so this note links the [published Persian transcription and promulgation metadata](https://nezamat.ir/post-44947/). Counsel should obtain the official gazette copy, all amendments, and any sectoral implementation rules before relying on it.

No reviewed source established a comprehensive Iranian biometric-employment statute, a private-sector biometric breach-notification deadline, or a fixed retention period specifically for employee fingerprint templates. Those are not findings that no such rule exists; they are questions for counsel and the relevant regulator.

## Verified legal rules and their product significance

| Verified rule | Source | Product significance (inference, not a legal conclusion) |
| --- | --- | --- |
| A `data message` is broadly defined; a signature may be any sign logically attached to it that identifies the signer. An electronic signature can satisfy a legal signature requirement. | Electronic Commerce Act, Articles 2(j) and 7, [WIPO Lex](https://www.wipo.int/wipolex/en/text/495385) | A deliberate biometric confirmation can form part of an electronic-signature process, but the match by itself does not establish all requirements for a secure signature. |
| A secure electronic signature must be unique to and identify the signer, be created by or under the signer's sole intention, and be attached so that changes to the signed data are detectable. | Electronic Commerce Act, Article 10, [WIPO Lex](https://www.wipo.int/wipolex/en/text/495385) | Display the exact dispatch, require an explicit driver action, use a single-use challenge, and cryptographically bind the final canonical snapshot to the verification event. Do not reuse a free-standing “fingerprint approved” flag. |
| A secure electronic record must be kept in a reasonably protected, appropriately accessible and administered system, remain accessible and understandable, and use methods that authenticate correctness, origin, destination and date and detect later error or modification. | Electronic Commerce Act, Articles 2(h)-(i) and 11, [WIPO Lex](https://www.wipo.int/wipolex/en/text/495385) | Security controls, reproducibility, trusted time, attribution, append-only corrections, and detectable tampering are part of evidential design, not optional infrastructure details. |
| Electronic evidence cannot be rejected solely because it is a data message; its weight depends on the security method. Securely generated and stored data messages receive stronger evidential treatment. | Electronic Commerce Act, Articles 12-16, [WIPO Lex](https://www.wipo.int/wipolex/en/text/495385) | OTP and offline reconciliation may still be evidence, but should not be represented as equivalent to the primary biometric path. Record the actual method and safeguards. |
| If information must be retained as an original, it must remain accessible, accurately represent what was generated/sent/received, and retain origin, destination, date and time information. | Electronic Commerce Act, Article 8, [WIPO Lex](https://www.wipo.int/wipolex/en/text/495385) | Preserve the exact accepted dispatch version and a human-readable evidence export, not only current database rows whose meaning can change. |
| A data message may be attributed to the originator when sent by the originator, an authorized person, or an automated system acting for them. Acknowledgment of receipt does not by itself prove content. | Electronic Commerce Act, Articles 18 and 22-24, [WIPO Lex](https://www.wipo.int/wipolex/en/text/495385) | Identity, authorization, content acceptance and receipt are separate facts. A delivered OTP or successful device call is not proof that the driver accepted the dispatch content. |
| Storing, processing or distributing personal data that reveals physical condition without explicit consent is unlawful. With consent, purposes must be clear, collection must be necessary and proportionate, use must remain within the stated purposes, data must be accurate/current, and the person has access/correction and qualified deletion rights. | Electronic Commerce Act, Articles 58-59, [WIPO Lex](https://www.wipo.int/wipolex/en/text/495385); [Persian text](https://nezamat.ir/post-34221/) | A fingerprint template is likely to be treated as personal data concerning physical condition, but that classification is an inference for counsel. Obtain separate explicit consent and collect the minimum representation needed for matching. |
| The 1402 privacy directive tells covered private legal entities and public bodies providing services through cyberspace systems/platforms to publish transparent privacy terms, obtain explicit consent, distinguish required and optional data, limit collection to legal/business necessity, honor qualified deletion requests, and store identity/personal data that identifies users only in encrypted form. | 1402 privacy directive, clauses 1.1-1.4 and its stated scope, [published Persian transcription](https://nezamat.ir/post-44947/) | Treat the directive as applicable in the baseline: encrypt templates and identifying evidence, version the notice/consent, minimize fields, and implement deletion/legal-hold workflows. Counsel must confirm whether an internal employee ERP and its drivers are within the directive's definitions and whether amendments change the text. |
| Unauthorized access to protected systems/data and unauthorized manipulation, deletion or fabrication of evidential data are criminalized; unauthorized publication or disclosure of another person's private images or secrets can also be criminal where the statutory harm conditions are met. | Computer Crimes Act, Articles 1, 6 and 17, [Persian enacted text](https://nezamat.ir/post-37592/); [UNODC reproduction](https://www.unodc.org/cld/uploads/res/document/computer-crimes-act_html/Computer_Crimes_Act.pdf) | Strict access control and tamper detection reduce both evidential and security risk. This statute criminalizes conduct; it is not, by itself, a complete security-control or breach-notification standard for Sabalan. |
| Access and domestic hosting providers have specified traffic/user/content retention duties. Separately, a judicial authority may order **any person controlling stored computer data** to preserve it; preservation is not authorization to disclose it, normally lasts up to three months and may be extended, and protected data may be ordered produced. | Criminal Procedure Code, Articles 667-670, [Persian consolidated text](https://nezamat.ir/post-39473/) | Do not apply the provider retention periods mechanically to fingerprint templates. Do implement legal hold, confidentiality, controlled production and suspension of deletion when a valid preservation order covers the data. Counsel must determine which provider duties, if any, apply to Sabalan's deployment. |
| Holders of data messages should maintain appropriate copies so another survives if one is endangered. | Electronic Commerce Act, Article 81, [WIPO Lex](https://www.wipo.int/wipolex/en/text/495385) | Keep encrypted, tested backups and evidence exports while still honoring deletion, legal-hold and key-destruction rules. |

## Required biometric lifecycle

### Enrollment and consent

- HR may initiate enrollment only for an active person designated as an internal driver.
- Before the first scan, show a separate Persian notice stating: exact purpose (dispatch receipt/exit authorization), required data, method of capture, users of the result, retention/deletion rules, fallback route, incident contact, and consequences of refusal or withdrawal. Store the notice version, driver acknowledgment, time, HR operator and enrollment device.
- Consent must be an affirmative act; employment or silence is not recorded as biometric consent. Re-consent when the purpose or policy materially changes, consistent with the purpose and explicit-consent rules in Articles 58-59 and clause 1.1 of the 1402 directive.
- Enroll at least two fingers for operational recovery, but only if counsel agrees this remains proportionate. Capture enough samples to create a reliable template, generate it within the controlled connector/device boundary, and discard transient images immediately.
- Store an encrypted, versioned template in a dedicated biometric vault. Ordinary HR pages, exports, backups and analytics must never expose template bytes. HR can see enrollment status and dates, not biometric content.
- Enrollment, replacement, disablement, consent withdrawal, failed administrative access and key operations must be auditable. Re-enrollment creates a new version and retires the old one; it must not rewrite past confirmation evidence.

### Raw images

The product baseline is **no persisted raw fingerprint images**: not in HR, the application database, object storage, logs, support bundles, backups or vendor telemetry. The device/connector may hold an image only in volatile memory long enough to assess quality and generate a template, then must zero/discard it.

This is not presented as an express statutory ban. It follows from the verified purpose-limitation and necessity rules: Sabalan needs repeatable matching, while legal prosecution needs proof that a fresh verification was bound to a particular dispatch. A reusable image adds breach and impersonation impact without establishing that transaction link. Any proposal to retain images must return to counsel and security review as a separate architecture decision with a specific legal basis, purpose, retention period and access model.

### Access and protection

- Encrypt template and identifying evidence at rest and in transit. Separate biometric-vault keys from the main database; restrict decryption to the verification service and support key rotation and crypto-erasure.
- Separate duties: HR enrolls/replaces; Accounting starts a dispatch confirmation; the connector verifies; Guard consumes authorization and approves fallback; security administrators cannot create business confirmations.
- Deny template search, download, bulk export and cross-person matching. The verification request must name one expected driver (one-to-one verification), not search the workforce (one-to-many identification).
- Authenticate connector, workstation and scanner; allow-list device identities; sign connector updates; reject replayed challenges; and log every administrative and verification request.
- Keep encrypted backups under the same retention/access rules. Restoration tests must prove that retired templates are not accidentally reactivated.
- Vendor SDKs must operate without cloud upload or vendor telemetry unless counsel and security separately approve the transfer, purpose, location and contract.

### Retention and deletion

Do not use one retention period for every record:

| Record | Baseline before counsel sets the period |
| --- | --- |
| Active fingerprint template | Keep only while the driver's internal-driver eligibility and biometric consent are active. Disable matching immediately on suspension, termination or withdrawal; delete/crypto-erase after the approved deprovisioning/legal-hold check. |
| Raw fingerprint image | Never persist. |
| Enrollment/consent history | Keep a non-biometric record sufficient to prove notice, affirmative consent, template version lifecycle and operators for the counsel-approved employment/claims period. |
| Dispatch confirmation evidence | Keep independently of the template for the counsel-approved accounting, transport, contract, insurance, limitation and litigation periods. It contains a verification result and template version identifier, never the template or raw image. |
| OTP/fallback/offline evidence | Keep for the same transaction-evidence period, visibly labeled with the actual method and exception facts. Never retain the OTP itself. |
| Security/access logs | Keep for the counsel/security-approved investigation period, with minimization and legal-hold support. |

A deletion request must trigger a documented decision across these categories. Data subject to a valid legal hold moves to a restricted purpose and cannot be used for matching. Once all applicable periods and holds end, deletion must include replicas, search indexes, connector caches and backup expiry; record a non-sensitive deletion certificate.

## Transaction-bound evidence package

A successful scan is evidence of a match at a moment; it is not enough to prove acceptance of a dispatch. The primary path should create one canonical, immutable confirmation payload containing at least:

- dispatch/waybill identifier, version and canonical hash;
- full customer, contract, product, quantity, driver-allocation and vehicle snapshots shown to the driver;
- external official-waybill reference when present;
- exact Persian confirmation statement and UI/policy version;
- driver identity snapshot, internal-driver status, and active vehicle assignment at confirmation;
- unique single-use challenge/nonce and authorization expiry;
- driver-confirmation action, server receipt time and local time zone;
- verification method, result, template version identifier, algorithm/threshold version, capture quality and liveness result where supported;
- scanner, connector and workstation identities and software versions;
- Accounting operator and location;
- current authorization status plus later revocation/reissue events; and
- Guard's final gate-exit event referencing the same payload hash.

Immediately before scanning, show the dispatch number, vehicle plate and the exact action being authorized and require the driver to actively continue. The connector returns its verification response only against the single-use challenge. Sabalan then signs or MACs the canonical evidence envelope with a protected server key. Append each lifecycle event; never update the original. Corrections, voids, reissues, expiration and gate exit are new events referencing the prior event/hash.

For stronger audit integrity, use append-only storage, sequence numbers, prior-event hashes, protected trusted timestamps, periodic signed audit roots written to independent/WORM storage, access logs, encrypted backups, and a deterministic human-readable evidence export. These controls are architectural inferences from Articles 8 and 10-15; counsel must decide whether the resulting process qualifies as a secure electronic signature/record and whether an accredited certification-service provider is required for the desired presumption.

## OTP biometric fallback

The accepted emergency path is suitable only as explicitly weaker exception evidence:

1. attempt biometric verification first and preserve failure reason/quality result without retaining an image;
2. allow Accounting to start fallback only after configured repeated failures or a recorded device outage;
3. show the same immutable dispatch and require explicit driver acceptance;
4. send a single-use, short-lived OTP to the current HR-registered phone; store masked destination, provider message/delivery IDs, challenge hash, attempts and result, never the OTP plaintext;
5. require a separately authenticated Guard shift supervisor to verify identity and approve; the Accounting initiator cannot provide the second approval;
6. record structured reason, device/connector status, operators, times and manager alert; and
7. label the authorization and all exports `BIOMETRIC_FALLBACK_OTP`, never “fingerprint verified.”

Article 12 allows data messages as evidence and Article 13 makes weight depend on security, but this research does not establish that SMS OTP meets Article 10's uniqueness/sole-intention standard. SIM ownership, shared phones, delivery-log availability and the evidential role of the second approver require counsel confirmation.

## ERP outage and offline evidence

When SabalanERP itself is unavailable, use a controlled paper exception rather than manufacturing a retrospective “online confirmation”:

- pre-numbered form with the exact dispatch/waybill version and all material snapshot fields;
- outage start, dispatch time, vehicle, identity-document check and reason;
- driver's handwritten acceptance plus two authorized staff signatures, including Guard supervision;
- contemporaneous void/reissue controls and custody of the original paper; and
- after recovery, an `OFFLINE_RECONCILED` event linked to a scan of the complete form and entered by one user, independently reviewed by another. Preserve original creation time, reconciliation time and operators.

The reconciled record must remain labeled offline and must not claim a secure biometric confirmation. If a driver cannot sign, counsel must prescribe whether a wet fingerprint mark, witness form or another method is legally appropriate and how the resulting physical biometric is stored. Do not place a scanned wet fingerprint into the HR biometric vault.

## Incident response baseline

The reviewed laws criminalize unauthorized access/manipulation and impose privacy/security duties, but this research did not verify a generally applicable private-sector biometric breach-notification clock. Sabalan still needs a biometric incident runbook:

1. isolate affected connector/vault accounts without destroying evidence;
2. preserve immutable logs, binaries, configuration, device identifiers and relevant data under chain of custody;
3. disable affected template versions and authorization challenges; rotate vault/signing keys and re-enroll drivers when compromise could permit matching or replay;
4. assess scope, affected people, raw-image exposure (which should be impossible), transaction-integrity impact and whether dispatch authorizations must be revoked;
5. engage Iranian counsel immediately to determine notices to drivers, authorities, insurers, customers or regulators and any preservation order;
6. notify management and record decisions/times; and
7. complete root-cause remediation, independent verification and a non-sensitive post-incident record.

Never delete evidence subject to a judicial preservation order, and do not disclose preserved data merely because it is held; Article 669 expressly distinguishes preservation from disclosure.

## Written Iranian-counsel checklist (production release gate)

Obtain a signed memorandum addressing each item against the then-current official texts and Sabalan's legal entity, location and deployment:

1. Does the Electronic Commerce Act apply to this internal employment/dispatch flow, and are a fingerprint template, match score and quality/liveness data within “physical condition” personal data under Articles 58-59?
2. What makes employee consent “explicit” and valid? May fingerprint verification be mandatory for the driver role? What non-biometric route is required for refusal or withdrawal, and may role eligibility be affected?
3. Does the 1402 privacy directive cover Sabalan's private internal ERP, Accounting users and drivers? Supply the official gazette text, amendments, regulator guidance and enforcement authority.
4. Confirm or change the no-raw-image baseline; define whether transient scanner memory, debug dumps, paper thumbprints and evidence scans count as storage/processing.
5. Does the proposed biometric-plus-cryptographic envelope satisfy Article 10, or is an accredited certificate/registration service or another formal signature process required to obtain secure-signature/record treatment?
6. Approve the exact Persian consent, dispatch-acceptance, fallback and offline wording and the evidence required to show sole intention, attribution and receipt.
7. Is SMS OTP plus Guard supervisor approval legally sufficient for emergency confirmation? What mobile-subscriber and telecom delivery evidence must be retained?
8. Approve the manual outage form, witnesses, identity checks, original-paper custody, reconciliation and the method for drivers who cannot provide a handwritten signature.
9. Set separate retention periods for templates, consent/enrollment history, waybills/dispatch evidence, accounting/contract records, audit logs, OTP provider evidence, paper originals and backups, considering labor, tax, commercial, transport, insurance, limitation and litigation rules.
10. Define withdrawal, access, correction, deletion, employee departure and legal-hold procedures, including what evidence may remain after the reusable template is destroyed.
11. Identify all breach/security-incident notification duties, recipients and deadlines; identify the competent regulator and required law-enforcement cooperation.
12. Define lawful judicial/police disclosure, preservation-order validation, confidentiality, export format and chain of custody.
13. Approve domestic/cross-border hosting, vendor SDK telemetry, subprocessors, support access and biometric/security contract clauses.
14. Determine whether scanner import/use, liveness technology, cryptography, SMS service or the local connector needs certification, licensing or sector approval.
15. Confirm obligations for external drivers and customers whose personal data appears in the same evidence envelope even though they do not enroll biometrics.

## Implementation acceptance gates

Production biometric use is blocked until:

- counsel resolves all checklist items and approves the policy/forms;
- Security threat-models the scanner, connector, vault, keys, replay resistance, audit chain, fallback and recovery;
- a privacy/data inventory proves that raw images cannot reach persistence, logs, telemetry or backups;
- retention/deletion/legal-hold schedules are configured and tested;
- evidence exports can independently verify payload hashes, event order, method and revocation status;
- incident, device-outage and ERP-outage drills pass; and
- a small internal-driver pilot confirms notice, consent, verification, fallback, Guard exit and later evidence retrieval end to end.
