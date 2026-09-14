# ADR-0058: Authorize Partner inquiry management from effective Sales access

## Status

Accepted — 2026-09-13

## Decision

Partner inquiry authority is integrated with Centralized User Access Administration. Effective Sales `VIEW` remains read-only, effective Sales `EDIT` makes an active internal User eligible for ordinary assigned inquiry response, and effective Sales `ADMIN` grants company-wide visibility and response authority for open inquiries. A global `ADMIN` has the same company-wide authority implicitly. A system `MANAGER` title alone grants nothing outside its effective workspace access.

When a global ADMIN or effective Sales workspace administrator answers an inquiry assigned to somebody else, the command atomically appends a reasoned assignment to the actual actor and then decides only the selected `PENDING` rows. Prior assignments and decided rows remain immutable. This replaces ADR-0046's narrower requirement that an Admin must be assigned in a separate operation before answering.

Partner-specific capabilities are displayed and managed in the existing central access page under the workspace that owns each decision. The backend maps effective feature levels to fixed Partner action, purpose, root, and scope combinations; clients cannot choose or widen resource scope. Identity verification disappears after the current identity evidence is verified. A later identity version must be a distinct, reasoned and audited operation based on newer valid evidence.

## Consequences

Responder candidates no longer depend on hidden Partner-only grants or a provisioned username. Sales access expiry and revocation immediately affect eligibility. Management response remains one user action while retaining explicit takeover evidence. Workspace administration can unblock an open queue without permitting edits to finalized rows or Partner-authored retail evidence.
