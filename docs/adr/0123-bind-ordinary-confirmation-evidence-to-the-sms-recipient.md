---
status: accepted
---

# Bind ordinary customer confirmation evidence to the SMS recipient

On 2026-10-12 the owner agreed that ordinary Sales users may correct a Customer's CRM phone and resend from the Contract to that new recipient. Sales sees the current active valid recipient before sending, with the primary mobile as the default and an explicit choice when several mobiles exist. Changing the recipient creates a fresh confirmation request and invalidates the previous pending code and link, retaining the old recipient and audit evidence. The SMS destination, public lookup and acceptance evidence refer to the same request; changing CRM data never rewrites an already recorded acceptance.

A public resend retains its request's recipient and cannot silently switch to a different CRM number. Sales performs recipient changes. A provider-rejected resend retains the last usable request and credentials; concurrent sends serialize with commercial edits and acceptance. Successful provider submission is not proof of handset delivery. Database commits and external SMS delivery cannot be made atomic; an uncertain delivery or commit still requires a fresh authorized retry. This decision applies to ordinary Contracts; Partner confirmation ownership remains separate.
