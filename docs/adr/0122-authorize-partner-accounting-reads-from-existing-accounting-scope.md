---
status: accepted
---

# Authorize Partner Accounting reads from existing Accounting scope

The product owner decided that an effective Accounting contract-view permission covers both ordinary internal contracts and Partner wholesale documents within that permission's existing scope. Requiring an additional Partner-only read grant causes users with full Accounting view access to miss legitimate company contracts; the central authorization policy must therefore recognize the existing scoped view authority for Partner Accounting reads.

This decision replaces the separate-grant prerequisite for those reads while preserving case lineage, current authorization, and document audiences. Partner Accounting displays the Sabalan-to-Partner agreement; customer retail prices, margins, and collections are not added to that audience. View authority alone does not grant editing, approval, cancellation, or any other mutation. ADMIN and management rules for those actions remain governed by existing policy.
