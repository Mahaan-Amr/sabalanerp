---
status: accepted
---

# Consume operational evidence without moving workflow ownership into Accounting

Accounting posting rules consume authoritative, versioned evidence from the workspace that owns each business operation, but Accounting does not take ownership of or redesign Sales, Logistics, Guard, HR, Inventory, or other operational queues merely to produce a journal entry. Complete evidence may authorize posting under the governed rule; missing, ambiguous, mutable, or unlinked evidence creates an Accounting exception and fails closed without fabricating completion or mutating the source workflow. This keeps the full accounting replacement in scope while preventing accounting implementation from silently expanding into unrelated operational control.
