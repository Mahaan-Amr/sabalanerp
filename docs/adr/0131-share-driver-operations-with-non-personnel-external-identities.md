# Share driver operations with non-personnel external identities

## Status

Accepted on 2026-10-15 in the requirements interview. Local implementation only; no production rollout authorized. Supersedes the external ownership, visit-only pairing, and ordinary OTP confirmation portions of ADR-0036 and extends ADR-0130 to external identities.

## Context

Recurring external carriers need the same assignment, identity verification, biometric confirmation, and dispatch controls as Sabalan drivers without becoming employees. Separate external access levels and independent management copies would produce conflicting operational authority.

## Decision

Keep independent external driver and external vehicle identities, shared by HR Vehicle Operations and Guard. Use the existing internal operation-specific permissions for both sources; external identity is not an extra permission or access level. Workspace entry remains authorized, and access to one operation does not grant another.

External assignments follow the same one-to-one effective periods, confirmed transfers, independent ending, future scheduling, conflict disposition, open-operation blockers, and attention-required execution rules as internal assignments. Only internal/company and external/external pairings are admitted. Driver and vehicle identities remain separate; a visit uses the current assignment rather than creating a permanent combined identity or freely selecting an unrelated vehicle.

External driving authorization belongs to the independent external dossier. Authorized operators in either workspace can suspend it immediately; subsequent dependent dispatch steps must revalidate it, while assignments and open cases remain intact. All ordinary management commands omit manual reasons and retain automatic actor, time, and actual-change evidence. The controlled biometric failure fallback keeps its mandatory exception reason.

Use the same enrollment, two-finger capture, encrypted templates and images, live matching, and qualifying-failure fallback workflow for both driver sources. External enrollment references the external identity directly, never synthetic Personnel. Existing internal biometric identity bindings and encrypted material remain readable without relabelling or re-encryption. Newly started external sessions require biometrics; obsolete OTP-only sessions cannot grant new exit authority.

Retain existing external records, documents, and historical snapshots. Do not infer assignments from prior visits. Show missing requirements and require explicit current assignment, valid driving authority/documents, and active biometric enrollment before a new admission. Do not cancel open operations automatically; inconsistent cases require explicit operational resolution.

## Consequences

Assignment and confirmation behavior share implementations, with source-specific identity repositories. External records previously usable through visit-only pairing may need preparation before their next admission. The additional biometric enrollment does not create an employment relationship or HR Personnel eligibility period.
