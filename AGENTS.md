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

### Sabalan Design System

Every interactive frontend change must use the platform-owned Sabalan Design System. Read `docs/design-system/catalog.md` before changing UI and use `frontend/src/components/erp` plus `frontend/src/styles/design-system-tokens.css`; Guard and Contract Product Selection are references, not sources of domain-specific shared concepts.

Do not add raw semantic palette classes, legacy glass styles, native form controls in feature code, clickable non-interactive elements, or local replacements for canonical buttons, fields, cards, dialogs, sheets, switches, and segmented controls. Preserve business rules, permissions, calculations, persisted meaning, recovery, and audit history while simplifying UX and removing guidance that does not prevent a likely mistake.

Before completing an interactive change run `npm run design-system:check`, the relevant behavioral tests, and the acceptance commands listed in `docs/design-system/catalog.md`. A genuine unmet interface need requires the narrow exception process in `docs/design-system/README.md`; never regenerate the baseline only to silence a violation.
