# Issue exit authorization on Accounting driver OTP confirmation

Accounting issues the exit authorization when it verifies the enrolled phone's one-time code after a qualifying biometric failure for an internal or external driver. OTP verification, fallback evidence, and authorization issuance commit together. The fallback evidence retains the biometric failure and Accounting actor, and previous Guard approvals remain available in dispatch history.

Guard records physical exit through the ordinary authorized-exit desk. This supersedes the separate fallback approval and manual reason in ADR-0131. Driver readiness, waybill validity, authorization revocation, and physical-exit checks continue to apply.
