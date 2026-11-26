# Reconcile Sepidar invoices per loading

Accounting records one or more external Sepidar invoice numbers with their amounts in rials against a finalized Logistics loading. All drivers on that loading share the list. The accountant can see the source contracts and can enter an invoice without selecting a contract.

Registration and corrections validate the invoice sum in the same transaction as persistence. The basis is the net approved amount of the current finalized allocations across the loading, converted to rials. Reconciliation compares the loading total and the invoice total after rounding each aggregate once to three decimal places, with halfway values rounded up. Accounting sees the difference update as invoice amounts change. The original approved loading total and recorded invoice amounts retain their full precision. Superseded allocations contribute no amount. When any current allocation has incomplete or conflicting pricing evidence, Accounting cannot save a reconciled invoice set. Corrections preserve before and after values with the actor, reason, and time.

Existing Sepidar numbers carry forward without an inferred amount. Accounting can open those entries and supply the actual amounts while retaining earlier audit history. The Sepidar references document external invoices. The Sabalan sales dispatch invoice, waybills, and dispatch permissions retain their own lifecycles.

Accounting’s dispatch case table shows one row for the loading with its drivers and waybills. The waybill issuance queue keeps its allocation-level rows so each driver’s dispatch commands remain available at the correct level.
