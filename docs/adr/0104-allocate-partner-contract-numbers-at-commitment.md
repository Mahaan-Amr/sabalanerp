# Allocate Partner Contract numbers at commitment

## Status

Accepted

## Context

A Partner Seller needs a stable reference while Sabalan price inquiries, rejection corrections and retries are still in progress. A numbered pricing Case is not yet a committed customer Contract or an Accounting-eligible Sabalan sale. ADR-0060 instead assigned all three identities on first save, which conflicts with the current Case boundary and would make provisional numbers appear to represent final commercial records.

## Decision

The first save of a pricing Case assigns one stable, unique, short numeric human-facing tracking code from a Case-only sequence that never reuses an allocated value. This sequence is independent of Customer Contract numbering because a Case can exist without ever becoming a Contract. Only the Partner Seller's explicit finalization, after valid price acceptance and completion of the delivery and payment plan, atomically assigns the numeric Partner-to-Customer Contract number and the separate `PI-` Sabalan internal-record number. The tracking code remains searchable; technical Case identity and internal-record number remain available to authorized support and financial users respectively. This supersedes ADR-0060 where it assigns customer-Contract and internal-record numbers or creates the linked pair before commercial commitment.

## Consequences

Pre-commit pricing Cases remain outside Sabalan Accounting and customer output. Existing numbered Cases receive a stable numeric tracking code as well; their former display codes remain searchable aliases, and historical identifiers and audit evidence retain their persisted meaning. Display labels do not rewrite old evidence. Retries and corrections keep the same tracking code and cannot allocate a second customer or internal number.
