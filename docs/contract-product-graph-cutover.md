# Contract product graph atomic cutover

The deployment is a one-way schema cutover. The application continues to read
legacy contract snapshots, but every explicit create/edit writes a canonical
product graph in the same database transaction as contract items, deliveries,
and payments.

## Before deployment

1. Run the repository test/build gates.
2. Run `npm run migration:product-graph:dry` from `backend`.
3. Resolve every unexplained financial difference and broken relationship.
4. Use `deploy/scripts/deploy.sh`; it creates and verifies a PostgreSQL custom
   backup before applying migrations and retains the full migration audit under
   `reports/deploy/`.

## Failure contingency

Set `CONTRACT_PRODUCT_GRAPH_READ_ONLY=true` and recreate the backend service.
Existing contracts, canonical projections, and PDFs remain readable while all
contract product writes return HTTP 503. Do not deploy an older application
against the migrated schema and do not use `prisma migrate reset`.

Restore is permitted only from the verified pre-deployment backup into an
isolated database, followed by an application/schema compatibility check.
