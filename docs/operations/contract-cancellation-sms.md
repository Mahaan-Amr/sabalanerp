# Commercial Contract cancellation SMS

Decision: [ADR-0127](../adr/0127-notify-commercial-cancellation-at-current-customer-mobile.md).

The owner supplied template ID **774074** for `SabalanContractCancellation` on 2026-10-12. The original screenshot showed «در حال بررسی»; a fresh read of the provider's template list on the same day confirmed «تایید», with category «اطلاع‌رسانی». Configuration uses this approved ID. The API parameter remains exactly `ContractNumber`. Provider acceptance of a real business submission and handset delivery must be reported separately; QA uses fake gateways and never sends unsolicited customer SMS.

In the same sms.ir «لیست قالب‌ها» page used for `SabalanContractConfirmation` and the dispatch/hiring templates, click «افزودن قالب». Use title `SabalanContractCancellation` (or «اطلاع‌رسانی لغو قرارداد سبلان»), category «اطلاع‌رسانی», and this text:

```text
مشتری گرامی، قرارداد شما به شماره #ContractNumber# لغو شد.
سنگ سبلان
```

The only parameter name is `ContractNumber` (same spelling and case), with the complete customer-facing Contract number. In template text write `#ContractNumber#`; in any separate parameter-name field enter `ContractNumber` without `#`. No OTP or cancellation reason is sent. Submit the new template for approval, then copy its own «شناسه قالب»; do not reuse `385075`, which belongs to the confirmation template.

Configure that assigned numeric ID as `SMS_IR_CONTRACT_CANCEL_TEMPLATE_ID` in the backend environment and restart/recreate the backend through its normal environment workflow so the service loads it, just like the other SMS template IDs. The cancellation method uses the same `smsService.sendTemplate`, `POST /v1/send/verify`, API key and phone formatter as the existing templates, with `parameters: [{ name: 'ContractNumber', value: '<full contract number>' }]`. The API method name Verify does not require an OTP parameter in this informational template. Zero/missing configuration produces a visible failure and retains the intent. Production configuration/deployment follows the existing zero-data-loss procedure; this document does not enable real SMS or authorize deployment.

Cancellation writes one durable intent in its business transaction. The backend scans eligible pending notices every 15 seconds and records each attempt's destination and result. Failed submissions retry with bounded exponential delays, up to five attempts before requiring a Seller request. Unknown network outcomes or interrupted sending attempts require review before manual retry because sms.ir does not provide an application idempotency key for Verify submissions. Local sandbox without an API key simulates acceptance without contacting sms.ir.

The Contract detail page displays notice status, latest attempt history and permissioned retry/recipient selection. Missing phone data waits for CRM correction. Several active mobiles without one primary require Seller selection. Every new attempt resolves current active mobile data; old accepted recipients remain unchanged as acceptance evidence. Reactivation suppresses pending notices, and only fresh digital acceptance in the new activation period qualifies for another cancellation notice. Existing cancelled Contracts do not create notices through scanning.

Successful confirmation SMS actions show «پیامک با موفقیت ارسال شد ✨» for four seconds. This indicates provider acceptance, not handset delivery.

The intent retains the original Contract identity, number and Customer reference even if the existing guarded administrative hard-delete workflow removes an ordinary Contract. Deletion does not erase attempt history or veto an already committed notification; active contact data still comes from that Customer's current CRM record.

Validation commands:

```text
npm --prefix backend run test:contract-cancellation-sms
npm --prefix backend run test:contract-cancellation-sms:db
npm run test:design-system:e2e -- ordinary-confirmation-recipient.spec.ts contract-cancellation-notice.spec.ts
```

The database suite requires the existing local Compose schema with this migration applied and `DATABASE_URL` explicitly targeting its PostgreSQL service (`127.0.0.1:55432/sabalanerp` from the host). Verify the existing project before migration or runtime QA. The suite creates and removes only its namespaced fixtures and fakes SMS submission.
