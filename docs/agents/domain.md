# Domain docs

This repository uses a single-context domain model.

## Before exploring or changing

- Read root `CONTEXT.md`.
- Read ADRs under `docs/adr/` that concern the area being changed.
- Proceed silently if either resource does not exist.

## Vocabulary

Use the canonical terms defined in `CONTEXT.md` in specs, tickets, tests, and implementation. Do not introduce synonyms that the glossary explicitly avoids.

## Decisions

Surface any conflict with an existing ADR instead of silently overriding it.

## Layout

```text
/
├── CONTEXT.md
├── docs/
│   └── adr/
├── backend/
└── frontend/
```
