---
status: accepted
---

# Enable special-customer credit before commercial finality

The CRM design interview on 2026-10-04 establishes a trust classification for direct Sabalan Customers only. Existing and new direct Customers initially belong to «مشتری عادی»; Manager or Admin authority may designate a «مشتری خاص». This classification is independent of legal customer type and does not extend to Partner-owned Customers or change the Partner's accounting liability.

The user agrees that early Accounting access requires all three conditions: a special Customer, an explicitly selected «اعتباری مشتری خاص» payment method for the Contract, and Sales approval for its current revision (پیش‌نویس). A یادداشت does not qualify. This is a deliberate exception to ADR-0110's financial-operation commercial-finality prerequisite, rather than a Customer receipt or Seller guarantee. Existing financial evidence and action-specific Accounting controls remain distinct from this commercial prerequisite.

Customer credit initially has no limit. The CRM Customer card will provide a credit setting accessible to Manager and Admin authority so they can change the limit. A finite limit is enforced across the Customer's unpaid credit amounts in all Contracts, with collection releasing credit. Reducing the limit below existing consumption preserves existing Contracts and blocks new credit until headroom is available. Credit is consumed when Sales approval first makes the Contract پیش‌نویس, not at initial یادداشت persistence. Insufficient available credit leaves the Contract at یادداشت and exposes the shortfall; it must not partially authorize the credit path.

Mixed payment plans are permitted: the special-customer credit amount may cover part of the Contract alongside cash or check methods. Effective Accounting collections first cover the non-credit portion, then reduce special-customer credit consumption. For a Contract of 100 million with 40 million non-credit and 60 million credit, collection of 30 million leaves 60 million consumed; collection of 60 million leaves 40 million consumed. A Sales payment plan or uncleared check is not effective collection and never releases credit.

The credit portion requires a promised-payment date. One internal reminder is sent on that date only if the credit portion remains unpaid, to the responsible Seller, Accountants currently authorized for the Contract, and authorized Managers and Admins. After the Contract becomes پیش‌نویس, a promised-date change requires a reason and Manager or Admin approval, following the existing Seller-credit date-change pattern. Reminder delivery does not itself suspend operations or settle the obligation.

For the authorized special-customer credit path, the user confirms that valid financial approval is sufficient for loading and exit even while the Contract remains پیش‌نویس. Merely saving a financial record does not qualify. The existing financial-approval evidence checks and all other loading and exit safeguards remain required. The agreed exception revises ADR-0111's commercial-finality prerequisite only for this path; ordinary non-credit and Partner paths retain their existing rules.

Downgrading a special Customer to ordinary blocks new credit use but preserves the credit path for Contracts already made پیش‌نویس under this authorization. Existing debt and financial or operational history remain intact. An increase in the authorized credit amount rechecks current special-customer eligibility and available credit.

The existing Accounting-authorized correction boundary remains required once financial evidence exists. After an approved correction, renewed Sales approval is sufficient to close the editing period and return the special-credit Contract to Accounting verification without waiting for Customer acceptance. Changes do not rewrite existing financial evidence, and renewed financial verification and other operational safeguards remain applicable.

Contract cancellation alone never erases financial debt or releases credit against a remaining valid obligation. Credit is released when no financial obligation remains; otherwise release follows effective collection or a valid Accounting reduction of the obligation. Existing evidence and history are retained.

The user confirmed the complete consolidated design on 2026-10-04. This accepted decision supersedes ADR-0110 for the special-credit financial-operation and correction-return prerequisites and ADR-0111 for the special-credit dispatch finality prerequisite; their other rules remain applicable. It records approved product policy, not implementation or rollout. The exception does not make every special Customer Contract automatically eligible and does not extend to Partner workflows.
