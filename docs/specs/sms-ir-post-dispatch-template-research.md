# SMS.ir dispatch template research

Status: research note for Wayfinder issue #213  
Checked: 2026-08-07  
Sources: SMS.ir first-party documentation and SabalanERP source only

## Recommended provider setup

Create the templates manually in the SMS.ir panel under **ارسال سریع**. SMS.ir's public REST documentation says verify templates are defined and managed in the panel; it documents no endpoint or file schema for creating/importing templates. Therefore there is no verified CSV/Excel/JSON template-import format to hand to the user. If the current authenticated panel exposes a bulk-import control, its downloadable sample—not an invented schema—must be treated as authoritative.

Suggested portal values below are operational labels, not provider-documented field names:

| Purpose | Approved title | Template ID | Exact text to paste | Dynamic keys |
| --- | --- | ---: | --- | --- |
| Driver OTP confirmation | `driver OTP confirmation` | `173656` | shown below | `DISPATCHNUMBER`, `CODE` |
| First exit notice and automatic retries | `خروج سبلان` | `153829` | shown below | `DNO`, `PLATE` |
| Authorized manual exit-notice retry | `تکرار خروج` | `3429496` | shown below | `DNO`, `PLATE` |

### Template 1 — driver OTP confirmation

```text
سبلان
شماره حواله: #DISPATCHNUMBER#
کد تأیید: #CODE#
اعتبار کد: ۱۰ دقیقه
این کد را فقط در حضور مسئول حسابداری وارد کنید.
```

Use the same template for an External Driver Waybill Confirmation and an Internal Driver Biometric Fallback. The different authority path remains protected system evidence and is not disclosed through the SMS. Resend uses the same template with the replacement code.

### Template 2 — initial exit notice and automatic retries

```text
سبلان
خروج ثبت شد
حواله: #DNO#
پلاک: #PLATE#
```

### Template 3 — reason-bound manual exit-notice retry

```text
سبلان
ارسال مجدد خروج
حواله: #DNO#
پلاک: #PLATE#
```

Use Template 2 for the original exit notice and the automatic 1/5/15-minute attempts. Use Template 3 only after the authorized manual-retry action. Both exit-notice templates disclose only the approved internal dispatch-waybill number and vehicle plate. A Manual Outage Exit registration uses Template 2 for its first notification; the outage is an internal evidence classification and need not be disclosed to the recipient.

If a separate provider template for manual retry is undesirable, using Template 2 for manual retries is contract-compatible and simpler. Template 3 is recommended only because its fixed wording helps the recipient understand a possible duplicate message.

The fixed Persian term is deliberately `حواله حمل داخلی`, not `بارنامه`: the Wayfinder destination excludes issuance of a legally regulated external transport waybill unless later research and authorization add that scope.

## Exact SMS.ir syntax and API mapping

SMS.ir's official verify-send contract is `POST https://api.sms.ir/v1/send/verify`, authenticated with `X-API-KEY`. Its required JSON fields are `mobile` (string), `templateId` (integer), and `parameters` (array). In the portal text, a key is surrounded with `#`; in the API `parameters[].name`, the same key is sent **without** the surrounding `#` characters. Each replacement value is a string. A successful provider response has top-level `status: 1` and returns `data.messageId` and `data.cost`. [SMS.ir REST API — ارسال VERIFY](https://sms.ir/rest-api/)

Template 1 OTP request:

```json
{
  "mobile": "09123456789",
  "templateId": 173656,
  "parameters": [
    { "name": "DISPATCHNUMBER", "value": "DW-1405-000123" },
    { "name": "CODE", "value": "123456" }
  ]
}
```

Templates 2 and 3 send `DNO` and `PLATE`; only their approved `templateId` differs.

The parameter spelling and case should be treated as exact. The official API requires the key declared by the template, and SabalanERP already records an operational SMS.ir failure caused by unsuitable dynamic content and documents case-sensitive provider keys for existing templates ([hiring workflow](../workspaces/hr/HIRING-WORKFLOW.md), [HR regression record](../workspaces/hr/HR_Recruitment.md)). Do not translate the API names to Persian, change their case, or include `#` in JSON.

## Provider and content constraints established by primary sources

- Verify send is intended not only for OTP but also invoices, order-status notifications, and other high-priority messages with dynamic parameters. SMS.ir says it uses service lines, can reach recipients who have blocked advertising messages, and requires the template to be defined first in the panel's quick-send section. This post-dispatch transactional notice fits that documented category. [SMS.ir REST API — ارسال VERIFY](https://sms.ir/rest-api/)
- SMS.ir's public docs establish `#Key#` placeholder syntax indirectly and explicitly require the API name without the opening/closing `#`. They do **not** publish, on the public REST/help pages reviewed, a supported character set for key names, a parameter-value length limit, template-review SLA, approval criteria, or a template-import file layout. Those details must not be guessed.
- Use short ASCII identifiers for keys and keep all business prose fixed in the Persian template. This matches SabalanERP's existing convention (`Code`, `Name`, `ContractNumber`, `Details`) and reduces approval/runtime ambiguity ([SMS service](../../backend/src/services/smsService.ts)).
- Keep URLs, free-form reasons, customer names, and outage descriptions out of parameter values. SabalanERP's own SMS.ir regression record says a dynamic URL was not accepted, after which the URL was moved into fixed template text and only `Code` remained dynamic ([HR regression record](../workspaces/hr/HR_Recruitment.md)). The proposed dispatch templates need no URL at all.
- The official API reports provider acceptance with a unique message ID. Delivery is a separate query, `GET /v1/send/{messageId}`, returning nullable `deliveryState` and `deliveryDateTime`; acceptance must not be presented as delivery. [SMS.ir REST API — reports](https://sms.ir/rest-api/)

## SabalanERP integration fit

The existing backend already implements the required provider shape: it normalizes Iranian mobiles, calls `${SMS_IR_API_URL}/send/verify`, sends `{ mobile, templateId, parameters }`, supplies `x-api-key`, treats `status === 1` as provider acceptance, stores/returns `messageId`, masks numbers in logs, and reads reports from `GET /send/{messageId}` ([`smsService.ts`](../../backend/src/services/smsService.ts)). Existing template IDs are numeric environment variables in [`backend/.env.example`](../../backend/.env.example).

Implementation should therefore add explicit numeric configuration, following current naming:

```dotenv
SMS_IR_DISPATCH_CONFIRM_OTP_TEMPLATE_ID=173656
SMS_IR_DISPATCH_EXIT_TEMPLATE_ID=153829
SMS_IR_DISPATCH_EXIT_MANUAL_RETRY_TEMPLATE_ID=3429496
```

`deploy/scripts/deploy.sh` synchronizes these approved non-secret IDs into the server-local `deploy/.env.prod` after pulling the deployment branch, while production Compose retains the same values as defaults. A deliberate future template replacement must update both locations together.

Map the immutable notification snapshot to the provider as:

| SabalanERP fact | SMS.ir field |
| --- | --- |
| normalized, snapshotted driver or contract-confirmation phone | `mobile` |
| configured approved template ID | `templateId` |
| internal dispatch-waybill number snapshot | parameter `DISPATCHNUMBER` for OTP and `DNO` for exit notices |
| one-time driver confirmation code | parameter `CODE` |
| vehicle-plate snapshot | parameter `PLATE` |
| accepted SMS.ir response ID | provider message ID used for delivery polling |

The existing HR polling implementation maps SMS.ir delivery state `1` to delivered, `2`/`3` to failed, and other/null states to accepted, then treats report-call failure as unknown ([`hrHiringDeliveryPollingService.ts`](../../backend/src/services/hrHiringDeliveryPollingService.ts)). Issue #213's final state model should preserve the raw provider response/state alongside its own queued/accepted/delivered/failed/unknown projection rather than assuming undocumented numeric states.

## Portal handoff checklist

1. In SMS.ir, open **ارسال سریع** and create Templates 1 and 2 with the exact text above.
2. For Template 1 declare exactly `DISPATCHNUMBER` and `CODE`; for Templates 2 and 3 declare exactly `DNO` and `PLATE`.
3. Verify the previews render `#DISPATCHNUMBER#`, `#CODE#`, `#DNO#`, and `#PLATE#` with the exact casing shown.
4. Submit them through whatever approval workflow the current panel presents. No public official approval SLA was found.
5. Optionally create Template 3 for manual retries; otherwise configure manual retry to reuse Template 2.
6. Copy the numeric approved IDs into deployment secrets; never retain the illustrative `123456` template ID.
7. From the SMS.ir panel/API, test OTP, Persian and Latin plate formats, and dispatch-number formats against a controlled number, then retain the returned `messageId` and confirm the delivery-report mapping before production use.

## Sources

- [SMS.ir official REST API documentation](https://sms.ir/rest-api/)
- [SMS.ir official panel help](https://sms.ir/help/)
- [`backend/src/services/smsService.ts`](../../backend/src/services/smsService.ts)
- [`backend/src/services/hrHiringDeliveryPollingService.ts`](../../backend/src/services/hrHiringDeliveryPollingService.ts)
- [`backend/.env.example`](../../backend/.env.example)
- [`docs/workspaces/hr/HIRING-WORKFLOW.md`](../workspaces/hr/HIRING-WORKFLOW.md)
- [`docs/workspaces/hr/HR_Recruitment.md`](../workspaces/hr/HR_Recruitment.md)
