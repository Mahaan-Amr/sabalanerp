# Partner integration status (issue 334)

Activation remains closed. This is an implementation checkpoint, not combined
acceptance or permission to deploy.

## Technical product transport

`registerPartnerTechnicalRoutes` defines five private/no-store endpoints for the
public 1.4.0 catalog, recovery checkpoint and validated-save interfaces. It is
deliberately unmounted. `createPartnerTechnicalRequestServices` composes real
request-scoped ports over the injected application `PrismaClient`, current audited
Partner authority, catalog reader, lease/CAS recovery and validated-save service.
The authenticated route owner must pass the actor and correlation identity.

The save composition still requires `resolveEvidence` from the owner side. That
resolver must supply frozen private inventory rates, versioned calculation policy,
per-family cutting decisions and exact inquiry identities. None of those values
may come from the Partner browser, and no zero/default rate is accepted. Until a
real resolver is selected and tested, the route must not be mounted in `sales.ts`
or exposed through the shell.

Transport paths reserved by this checkpoint:

- `POST /catalog/query`
- `POST /recoveries/read`
- `PUT /recoveries/checkpoint`
- `POST /recoveries/save`
- `POST /recoveries/read-saved`

The eventual mount prefix belongs to the #334 route owner. Authentication must
run before `servicesFor`; a thrown composition failure collapses to the canonical
integrity error and never exposes internal evidence. The factory creates no
database client and never disconnects the injected shared client.

## Verification

- Structural transport behavior: PASS; request-bound ports, five registered
  paths, public errors, support references and private/no-store headers.
- Whole backend TypeScript no-emit: PASS.
- Database-client ownership architecture check: PASS.

No database fixture, migration, runtime rebuild, SMS, activation or production
action was performed for this route checkpoint. Real browser-to-persistence,
authorization races, pricing evidence, inquiry submission, Case creation and the
cross-module Accounting/customer-output/PDF chain remain #334/#335 acceptance.
