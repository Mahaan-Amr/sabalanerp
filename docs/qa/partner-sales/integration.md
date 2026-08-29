# Partner integration status (issue 334)

Activation remains closed. This is an implementation checkpoint, not combined
acceptance or permission to deploy.

## Technical product transport

`registerPartnerTechnicalRoutes` defines five private/no-store endpoints for the
public 1.6.0 catalog, recovery checkpoint, validated-save and Sales policy interfaces. It is
mounted at `/api/partner/technical`; the Sales-owned policy transport is mounted
at `/api/partner/management/technical-policy`. `createPartnerTechnicalRequestServices` composes real
request-scoped ports over the injected application `PrismaClient`, current audited
Partner authority, catalog reader, lease/CAS recovery and validated-save service.
Authentication supplies the actor and correlation identity. Every technical
surface is fail-closed to one active release-cohort membership; operational pause
keeps enrolled reads available while blocking checkpoints and validated saves.

The save composition uses the owner-side `resolveEvidence` implementation. It
supplies frozen private inventory rates, versioned calculation policy,
per-family cutting decisions and exact inquiry identities. None of those values
may come from the Partner browser, and no zero/default rate is accepted. The
central Partner creation channel and navigation remain unbound, so this transport
mount is not UI activation or production-release approval.

Transport paths reserved by this checkpoint:

- `POST /catalog/query`
- `POST /recoveries/read`
- `PUT /recoveries/checkpoint`
- `POST /recoveries/save`
- `POST /recoveries/read-saved`

Authentication runs before `servicesFor`; a thrown composition failure collapses to the canonical
integrity error and never exposes internal evidence. The factory creates no
database client and never disconnects the injected shared client.

## Verification

- Structural transport behavior: PASS; request-bound ports, five registered
  paths, public errors, support references and private/no-store headers.
- Whole backend TypeScript no-emit: PASS.
- Database-client ownership architecture check: PASS.

No runtime rebuild, SMS, activation or production action was performed for this
route checkpoint. Real browser-to-persistence,
authorization races, pricing evidence, inquiry submission, Case creation and the
cross-module Accounting/customer-output/PDF chain remain #334/#335 acceptance.
