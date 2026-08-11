## Agent skills

### Issue tracker

Specs, implementation tickets, and PRDs are tracked as GitHub Issues using the `gh` CLI for `Mahaan-Amr/sabalanerp`. See `docs/agents/issue-tracker.md`.

### Triage labels

The repository uses the standard five-role triage vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repository using root `CONTEXT.md` and `docs/adr/`. See `docs/agents/domain.md`.

### Local Docker environment

Use the existing Docker Compose project named `sabalanerp-local` for all local runtime, migration, integration, and visual QA work. Its source configuration is `docker-compose.local.yml`, and the normal commands are the root `docker:local:*` and `docker:verify` scripts.

Do not create or start a second Compose project, disposable PostgreSQL container, parallel test stack, or ad-hoc replacement service when `sabalanerp-local` is available. Run migrations and tests against the existing local services with isolated test data or transactions where needed, without creating another Docker stack. Before any Docker action, verify the target with `docker compose -f docker-compose.local.yml ps` or `npm run docker:local:ps`.

### Database connection ownership

The long-running backend owns exactly one application `PrismaClient`, exported by `backend/src/lib/prisma.ts`. Routes, middleware, services, utilities, and background workers must reuse that client or accept it through dependency injection; they must never construct their own client or disconnect the shared client.

Additional clients are permitted only in standalone scripts or when System Recovery deliberately connects to an alternate database. Every permitted temporary client must close in `finally`. Production and local Compose configuration must keep explicit `connection_limit` and `pool_timeout` values. Run `npm run architecture:check` before completing any backend database change; never weaken its allowlist merely to silence a violation.

Integration and concurrency tests may own isolated clients only for their temporary test database or transaction harness. Those clients must never be imported by runtime code, and the harness remains responsible for disconnecting clients and deleting its isolated data.

### Production deployment safety

Production deployment and rollback must follow `docs/operations/zero-data-loss-deployment.md` and ADR-0039. Never add a force, bypass, partial-promotion, mutable-image rollback, unverified-backup, or public-write path inside the maintenance boundary. A change to deployment, migration, backup, restore, retention, storage cleanup, image identity, or release health gates must preserve the documented lease, checkpoint, remote verification, fail-closed rollback, and recovery-drill invariants.

### Sabalan Design System

Every interactive frontend change must use the platform-owned Sabalan Design System. Read `docs/design-system/catalog.md` before changing UI and use `frontend/src/components/erp` plus `frontend/src/styles/design-system-tokens.css`; Guard and Contract Product Selection are references, not sources of domain-specific shared concepts.

Do not add raw semantic palette classes, legacy glass styles, native form controls in feature code, clickable non-interactive elements, or local replacements for canonical buttons, fields, cards, dialogs, sheets, switches, and segmented controls. Preserve business rules, permissions, calculations, persisted meaning, recovery, and audit history while simplifying UX and removing guidance that does not prevent a likely mistake.

Before completing an interactive change run `npm run design-system:check`, the relevant behavioral tests, and the acceptance commands listed in `docs/design-system/catalog.md`. A genuine unmet interface need requires the narrow exception process in `docs/design-system/README.md`; never regenerate the baseline only to silence a violation.
