# Allow Partner Draft preparation during Sabalan pricing

## Status

Accepted — complete workflow confirmed on 2026-09-28.

Partner Sellers need to complete sale preparation without waiting for Sabalan's response. Draft preparation therefore progresses independently of pricing; commercial commitment remains conditional on valid agreement and deliberate acceptance of the total Sabalan purchase obligation. This revises ADR-0062's prerequisite that pricing agreement precede Delivery and payment planning, while preserving separate retail and wholesale obligations and customer-action restrictions before commitment.

## Confirmed decisions

- Pending or rejected Sabalan pricing does not block the remaining creation steps or completion of Draft preparation.
- Before commercial commitment the Partner can edit or cancel the Draft, including after a Sabalan response. Technical changes refresh only affected pricing evidence; changes limited to Customer, retail prices, Delivery or customer payments do not invalidate Sabalan pricing.
- Partner rejection of a quoted rate requires an explanation and returns the same Product for a new Sabalan offer while retaining other unaffected Product decisions.
- The pricing request is sent at completion of Product selection while the Partner continues Delivery and payment preparation independently.
- If Draft preparation is already complete, acceptance of the final required price includes explicit confirmation of the total Sabalan purchase obligation and commits the Case. If pricing agreement arrives first, the last preparation step presents both totals and requires explicit confirmation to commit. Both paths require every quote to remain valid at commitment and create the linked records atomically; Contract approval, rejection and customer confirmation actions become available only afterward.
- Sabalan has no deadline to respond. Each offered price has its own 48-hour validity starting at that offer's recorded time, not at inquiry submission or completion of other responses.
- Expiry preserves the Draft, its preparation and negotiation history, and freedom to continue preparation. Only expired rows and price-dependent descendants require fresh inquiry evidence; other valid row decisions remain intact. Commercial commitment waits for valid agreement on all required rows. This preserves ADR-0101's independent expiry rule.

## Preserved boundaries

- The assigned responder sees technical Product evidence and Sabalan pricing only, even when Delivery and customer payment plans have already been prepared.
- Customer retail prices remain the Partner's independent prices. Commercial commitment freezes both commercial obligations, creates Sabalan debt only against the Partner and remains separate from ordinary customer Contract approval and signature.
- Historical committed Cases remain immutable. The asynchronous preparation rule does not reopen their pricing or change their financial obligations.
