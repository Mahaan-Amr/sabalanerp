# Separate dispatch driver and vehicle master data

## Status

Accepted; supersedes the reusable combined-pair decision in ADR-0006 and the former `ثبت راننده و خودرو` glossary term for new operational use.

## Context

The earlier Guard workflow used one mutable `SecurityVehiclePair` as both driver identity and vehicle identity. That prevented HR-owned internal eligibility, Vehicle Operations-owned licence and fleet facts, truthful reassignment and plate history, and workspace-scoped evidence access.

## Decision

Use separate canonical identities for Personnel-linked internal drivers, company vehicles, external drivers, and external vehicles. HR alone owns effective internal eligibility. A separately permissioned Vehicle Operations feature group owns the internal driving profile, licence facts, company-vehicle lifecycle, effective plate periods, and effective assignments. Guard owns external identities and their lifecycle evidence. Guard combines a currently ready driver and vehicle only when recording physical admission, and that admission freezes a snapshot.

Canonical records use draft-first activation. Company vehicles transition among DRAFT, ACTIVE, OUT_OF_SERVICE, and ARCHIVED. External drivers and vehicles transition among DRAFT, ACTIVE, RESTRICTED, and ARCHIVED with actor, reason, and effective time. Only dependency-free unused drafts may be permanently deleted. Audit reads are authorized by the workspace that owns the evidence, not by a generic subject route.

`SecurityVehiclePair` and its existing queue turns remain readable historical evidence. All pair, photo, queue, and loading-assignment mutations that would create new operational reliance on that model are retired. The legacy write path is not restored during rollout or incident recovery.

## Consequences

Callers must use the canonical master-data commands and, when admission is implemented, the canonical Guard admission interface. Historical views keep the former records and photos without presenting them as selectable or ready. Branch integration may conflict with concurrent edits to root `CONTEXT.md`; resolution must retain this superseding definition rather than restoring the combined-pair term.
