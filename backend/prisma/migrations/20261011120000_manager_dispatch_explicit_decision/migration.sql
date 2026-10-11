-- A managerial request has no payment promise until an independent decision.
ALTER TABLE "contract_dispatch_authorities"
  ALTER COLUMN "promisedDate" DROP NOT NULL,
  ADD COLUMN "decidedAt" TIMESTAMP(3);

-- Keep all historical dates and decisions. Only new pending managerial
-- requests may omit the date; approved authorities and other kinds need it.
ALTER TABLE "contract_dispatch_authorities" ADD CONSTRAINT "dispatch_authority_payment_promise_required"
  CHECK ("promisedDate" IS NOT NULL OR ("kind" = 'MANAGER' AND "status" <> 'APPROVED'));

-- A decision request has no payment-promise deadline before approval.
ALTER TABLE "hr_duties" ALTER COLUMN "dueAt" DROP NOT NULL;
ALTER TABLE "hr_duties" ADD CONSTRAINT "duty_deadline_required_for_other_sources"
  CHECK ("dueAt" IS NOT NULL OR "sourceType" = 'CONTRACT_DISPATCH');

-- Existing open duties retain their identity and adopt the optional decision
-- date field; the domain service requires it only for managerial approval.
UPDATE "hr_duty_envelopes"
SET "responseSchemaJson" = jsonb_set("responseSchemaJson", '{properties,promisedDate}', '{"type":"string"}'::jsonb)
WHERE "code" = 'CONTRACT_DISPATCH_DECISION' AND "version" = 1;
