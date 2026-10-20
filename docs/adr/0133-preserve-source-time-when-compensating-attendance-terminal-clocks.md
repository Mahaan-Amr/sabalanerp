---
status: accepted
---

# Preserve source time when compensating attendance terminal clocks

The local comparison test found the terminal approximately 35 seconds behind the ERP clock, so source-to-receipt timestamp differences do not directly establish delivery latency. The user accepted that future operational attendance and duration calculations use an estimated corrected occurrence time only when a clock measurement is within two minutes of the scan and its uncertainty is at most ±15 seconds, while retaining the immutable device timestamp, applied compensation and measurement evidence; otherwise the punch requires Guard review. Already confirmed history must not be silently rewritten after recalibration. These validity limits do not relax the separate sub-five-second display target.

Implementation status, 2026-10-17: the subsequently authorized local implementation persists raw and corrected occurrence times with clock evidence, and uses a valid corrected time for attendance reconciliation. Invalid clock evidence requires review in operational mode. Local integration and browser tests exercise this behavior with isolated synthetic fixtures; the real terminal remains in comparison mode. Production deployment and operational activation are separately authorized actions. This decision does not authorize changing the terminal clock or rewriting confirmed history.
