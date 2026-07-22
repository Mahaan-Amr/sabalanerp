# Adopt additive Security design primitives and preserve Persian calendar compatibility

## Status

Accepted

## Context

The redesigned Security dashboard established a minimal mobile-first interaction language that should now cover the complete Security workspace. Applying new visual rules through existing global components would unintentionally redesign other workspaces before the pilot is accepted. At the same time, Security and many other workflows share the existing Persian calendar, whose interaction needs redesign but whose accepted values and date rules are already operationally correct.

## Decision

New reusable ERP primitives are added beside existing components and adopted only by Security during this pilot. Shared primitives contain reusable behavior, accessibility, responsive presentation, semantic tokens, and motion without Security terminology or permission assumptions. Security-specific components compose those primitives with attendance, vehicle, shift, report, exception, mission, and personnel meaning. Existing components and other workspaces are not globally restyled until a later explicit adoption decision.

The shared Persian calendar is the single deliberate global exception. Its desktop and mobile presentation may change, and an additive date-range composition may be introduced, but its existing public API, serialized values, validation, date/time semantics, minimum and maximum years, disabled-date rules, and consumer behavior remain backward compatible. Compatibility is verified through the public calendar seam and representative existing consumers rather than by duplicating calendar logic.

## Consequences

- Security can become internally consistent without launching a platform-wide redesign.
- Shared primitives remain reusable for later page-by-page adoption.
- Security domain behavior does not leak into the generic ERP layer.
- The calendar becomes easier to use across the platform, but carries a larger regression surface and therefore requires explicit compatibility tests across its existing variants and consumers.
- Removing or replacing old global components is deferred until later adoption work proves the new primitives.
