BEGIN;
SET LOCAL lock_timeout = '5s';
-- CreateEnum
CREATE TYPE "PartnerPaymentPurpose" AS ENUM ('RETAIL', 'SABALAN');

-- CreateTable
CREATE TABLE "partner_payment_plans" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "caseRevision" INTEGER NOT NULL,
    "purpose" "PartnerPaymentPurpose" NOT NULL,
    "version" INTEGER NOT NULL,
    "predecessorId" TEXT,
    "effectiveDate" DATE NOT NULL,
    "evidence" JSONB NOT NULL,
    "integrityHash" TEXT NOT NULL,

    CONSTRAINT "partner_payment_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_payment_installments" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "dueDate" DATE NOT NULL,
    "amount" DECIMAL(30,10) NOT NULL,
    "currency" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,

    CONSTRAINT "partner_payment_installments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_retail_receipts" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "originalReceiptId" TEXT,
    "amount" DECIMAL(30,10) NOT NULL,
    "currency" TEXT NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "actorId" TEXT NOT NULL,
    "commandId" TEXT NOT NULL,
    "reason" TEXT,
    "evidence" JSONB NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_retail_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_retail_receipt_allocations" (
    "receiptId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "installmentId" TEXT NOT NULL,
    "amount" DECIMAL(30,10) NOT NULL,

    CONSTRAINT "partner_retail_receipt_allocations_pkey" PRIMARY KEY ("receiptId","installmentId")
);

-- CreateTable
CREATE TABLE "partner_case_events" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "caseRevision" INTEGER NOT NULL,
    "integrityHash" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "stateRevision" INTEGER,
    "type" TEXT NOT NULL,
    "fromState" "PartnerCaseState",
    "toState" "PartnerCaseState",
    "actorId" TEXT NOT NULL,
    "commandId" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "reason" TEXT,
    "evidence" JSONB NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_case_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_customer_output_snapshots" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "caseRevision" INTEGER NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "integrityHash" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "contractNumber" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "content" JSONB NOT NULL,
    "commandId" TEXT NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_customer_output_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_correction_opportunities" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "predecessorRevision" INTEGER NOT NULL,
    "scope" TEXT NOT NULL,
    "scopeHash" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "approvedBy" TEXT NOT NULL,
    "approvedAt" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "calendarVersion" TEXT NOT NULL,
    "workingDays" INTEGER NOT NULL DEFAULT 3,
    "successfulSavesAllowed" INTEGER NOT NULL DEFAULT 1,
    "evidence" JSONB NOT NULL,

    CONSTRAINT "partner_correction_opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_correction_saves" (
    "opportunityId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "successorRevision" INTEGER NOT NULL,
    "actorId" TEXT NOT NULL,
    "commandId" TEXT NOT NULL,
    "savedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_correction_saves_pkey" PRIMARY KEY ("opportunityId")
);

-- CreateTable
CREATE TABLE "partner_correction_gates" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "commandId" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_correction_gates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_correction_dependencies" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceVersion" TEXT NOT NULL,
    "disposition" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_correction_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_financial_adjustments" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "caseRevision" INTEGER NOT NULL,
    "correctionId" TEXT NOT NULL,
    "originalRealizationEventId" TEXT NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "delta" DECIMAL(30,10) NOT NULL,
    "currency" TEXT NOT NULL,
    "commandId" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_financial_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_outbox_messages" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "deduplicationKey" TEXT NOT NULL,
    "safePayload" JSONB NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_outbox_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_outbox_attempts" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "outcome" TEXT NOT NULL,
    "safeErrorCode" TEXT,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_outbox_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "partner_payment_plans_predecessorId_key" ON "partner_payment_plans"("predecessorId");

-- CreateIndex
CREATE UNIQUE INDEX "partner_payment_plans_caseId_purpose_version_key" ON "partner_payment_plans"("caseId", "purpose", "version");

-- CreateIndex
CREATE UNIQUE INDEX "partner_payment_plans_caseId_id_key" ON "partner_payment_plans"("caseId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "partner_payment_installments_planId_id_key" ON "partner_payment_installments"("planId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "partner_retail_receipts_commandId_key" ON "partner_retail_receipts"("commandId");

-- CreateIndex
CREATE UNIQUE INDEX "partner_retail_receipts_planId_id_key" ON "partner_retail_receipts"("planId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "partner_case_events_caseId_sequence_key" ON "partner_case_events"("caseId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "partner_case_events_caseId_stateRevision_key" ON "partner_case_events"("caseId", "stateRevision");

-- CreateIndex
CREATE UNIQUE INDEX "partner_case_events_commandId_type_caseId_key" ON "partner_case_events"("commandId", "type", "caseId");

-- CreateIndex
CREATE UNIQUE INDEX "partner_customer_output_snapshots_commandId_key" ON "partner_customer_output_snapshots"("commandId");

-- CreateIndex
CREATE UNIQUE INDEX "partner_customer_output_snapshots_caseId_caseRevision_recip_key" ON "partner_customer_output_snapshots"("caseId", "caseRevision", "recipient");

-- CreateIndex
CREATE INDEX "partner_correction_opportunities_caseId_predecessorRevision_idx" ON "partner_correction_opportunities"("caseId", "predecessorRevision");

-- CreateIndex
CREATE UNIQUE INDEX "partner_correction_saves_commandId_key" ON "partner_correction_saves"("commandId");

-- CreateIndex
CREATE UNIQUE INDEX "partner_correction_saves_caseId_successorRevision_key" ON "partner_correction_saves"("caseId", "successorRevision");

-- CreateIndex
CREATE UNIQUE INDEX "partner_correction_gates_commandId_key" ON "partner_correction_gates"("commandId");

-- CreateIndex
CREATE INDEX "partner_correction_gates_opportunityId_kind_idx" ON "partner_correction_gates"("opportunityId", "kind");

-- CreateIndex
CREATE INDEX "partner_correction_dependencies_opportunityId_domain_source_idx" ON "partner_correction_dependencies"("opportunityId", "domain", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "partner_financial_adjustments_commandId_key" ON "partner_financial_adjustments"("commandId");

-- CreateIndex
CREATE UNIQUE INDEX "partner_outbox_messages_deduplicationKey_key" ON "partner_outbox_messages"("deduplicationKey");

-- CreateIndex
CREATE UNIQUE INDEX "partner_outbox_attempts_messageId_attempt_key" ON "partner_outbox_attempts"("messageId", "attempt");

-- AddForeignKey
ALTER TABLE "partner_payment_plans" ADD CONSTRAINT "partner_payment_plans_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "partner_sale_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_payment_plans" ADD CONSTRAINT "partner_payment_plans_predecessorId_fkey" FOREIGN KEY ("predecessorId") REFERENCES "partner_payment_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_payment_installments" ADD CONSTRAINT "partner_payment_installments_planId_fkey" FOREIGN KEY ("planId") REFERENCES "partner_payment_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_retail_receipts" ADD CONSTRAINT "partner_retail_receipts_caseId_planId_fkey" FOREIGN KEY ("caseId", "planId") REFERENCES "partner_payment_plans"("caseId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_retail_receipts" ADD CONSTRAINT "partner_retail_receipts_originalReceiptId_fkey" FOREIGN KEY ("originalReceiptId") REFERENCES "partner_retail_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_retail_receipt_allocations" ADD CONSTRAINT "partner_retail_receipt_allocations_planId_receiptId_fkey" FOREIGN KEY ("planId", "receiptId") REFERENCES "partner_retail_receipts"("planId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_retail_receipt_allocations" ADD CONSTRAINT "partner_retail_receipt_allocations_planId_installmentId_fkey" FOREIGN KEY ("planId", "installmentId") REFERENCES "partner_payment_installments"("planId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_case_events" ADD CONSTRAINT "partner_case_events_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "partner_sale_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_customer_output_snapshots" ADD CONSTRAINT "partner_customer_output_snapshots_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "partner_sale_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_correction_opportunities" ADD CONSTRAINT "partner_correction_opportunities_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "partner_sale_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_correction_saves" ADD CONSTRAINT "partner_correction_saves_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "partner_correction_opportunities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_correction_gates" ADD CONSTRAINT "partner_correction_gates_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "partner_correction_opportunities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_correction_dependencies" ADD CONSTRAINT "partner_correction_dependencies_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "partner_correction_opportunities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_financial_adjustments" ADD CONSTRAINT "partner_financial_adjustments_correctionId_fkey" FOREIGN KEY ("correctionId") REFERENCES "partner_correction_opportunities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_financial_adjustments" ADD CONSTRAINT "partner_financial_adjustments_originalRealizationEventId_fkey" FOREIGN KEY ("originalRealizationEventId") REFERENCES "partner_case_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_outbox_messages" ADD CONSTRAINT "partner_outbox_messages_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "partner_case_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_outbox_attempts" ADD CONSTRAINT "partner_outbox_attempts_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "partner_outbox_messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX partner_one_realization ON partner_case_events ("caseId") WHERE type = 'CASE_COMMITTED';
ALTER TABLE partner_case_events ADD CONSTRAINT partner_event_revision FOREIGN KEY ("caseId","caseRevision")
  REFERENCES partner_case_revisions ("caseId",revision) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE partner_payment_plans ADD CONSTRAINT partner_plan_revision FOREIGN KEY ("caseId","caseRevision")
  REFERENCES partner_case_revisions ("caseId",revision) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE partner_customer_output_snapshots ADD CONSTRAINT partner_output_revision FOREIGN KEY ("caseId","caseRevision")
  REFERENCES partner_case_revisions ("caseId",revision) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE partner_correction_opportunities ADD CONSTRAINT partner_correction_predecessor FOREIGN KEY ("caseId","predecessorRevision")
  REFERENCES partner_case_revisions ("caseId",revision) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE partner_correction_saves ADD CONSTRAINT partner_correction_successor FOREIGN KEY ("caseId","successorRevision")
  REFERENCES partner_case_revisions ("caseId",revision) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE partner_financial_adjustments ADD CONSTRAINT partner_adjustment_revision FOREIGN KEY ("caseId","caseRevision")
  REFERENCES partner_case_revisions ("caseId",revision) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE partner_sale_cases ADD CONSTRAINT partner_commitment_event FOREIGN KEY ("commitmentEventId")
  REFERENCES partner_case_events (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE partner_sale_cases ADD CONSTRAINT partner_committed_revision FOREIGN KEY (id,"committedRevision")
  REFERENCES partner_case_revisions ("caseId",revision) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE partner_payment_plans ADD CONSTRAINT partner_plan_shape CHECK
  (version > 0 AND "caseRevision" > 0 AND "integrityHash" ~ '^sha256-v1:[a-f0-9]{64}$' AND id IS DISTINCT FROM "predecessorId");
ALTER TABLE partner_payment_installments ADD CONSTRAINT partner_installment_shape CHECK
  (amount >= 0 AND currency IN ('IRR','IRT') AND method IN ('CASH','BANK_TRANSFER','CHECK','CREDIT'));
ALTER TABLE partner_retail_receipts ADD CONSTRAINT partner_receipt_shape CHECK
  (amount > 0 AND currency IN ('IRR','IRT') AND ((kind = 'RECEIPT' AND "originalReceiptId" IS NULL)
    OR (kind = 'REVERSAL' AND "originalReceiptId" IS NOT NULL AND "originalReceiptId" <> id AND length(trim(reason)) > 0)));
ALTER TABLE partner_retail_receipt_allocations ADD CONSTRAINT partner_allocation_amount CHECK (amount > 0);
ALTER TABLE partner_case_events ADD CONSTRAINT partner_event_shape CHECK
  (sequence > 0 AND "integrityHash" ~ '^sha256-v1:[a-f0-9]{64}$' AND ("stateRevision" IS NULL OR "stateRevision" > 0));
ALTER TABLE partner_customer_output_snapshots ADD CONSTRAINT partner_output_shape CHECK
  ("schemaVersion" = 1 AND "expiresAt" > "recordedAt" AND length(trim(recipient)) > 0
   AND "integrityHash" ~ '^sha256-v1:[a-f0-9]{64}$' AND "contentHash" ~ '^sha256-v1:[a-f0-9]{64}$');
ALTER TABLE partner_correction_opportunities ADD CONSTRAINT partner_correction_shape CHECK
  (scope IN ('RETAIL_ONLY','SHARED','SABALAN_TERMS','VOID') AND "workingDays" = 3 AND "successfulSavesAllowed" = 1
   AND "expiresAt" > "approvedAt" AND length(trim("calendarVersion")) > 0 AND "scopeHash" ~ '^sha256-v1:[a-f0-9]{64}$');
ALTER TABLE partner_financial_adjustments ADD CONSTRAINT partner_adjustment_currency CHECK (currency IN ('IRR','IRT'));
ALTER TABLE partner_outbox_attempts ADD CONSTRAINT partner_attempt_positive CHECK (attempt > 0);

CREATE FUNCTION partner_check_payment_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p partner_payment_plans; original partner_retail_receipts;
BEGIN
  IF TG_TABLE_NAME = 'partner_payment_plans' THEN
    IF NEW."predecessorId" IS NOT NULL THEN
      SELECT * INTO p FROM partner_payment_plans WHERE id = NEW."predecessorId";
      IF NOT FOUND OR p."caseId" <> NEW."caseId" OR p.purpose <> NEW.purpose OR NEW.version <> p.version + 1
        OR NEW."effectiveDate" < p."effectiveDate" THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Payment successor must preserve Case and purpose';
      END IF;
    ELSIF NEW.version <> 1 THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'First payment plan must have version one'; END IF;
  ELSE
    SELECT * INTO p FROM partner_payment_plans WHERE id = NEW."planId";
    IF NOT FOUND OR p.purpose <> 'RETAIL' OR p."caseId" <> NEW."caseId" THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Retail collection cannot enter Sabalan payment evidence';
    END IF;
    IF NEW.kind = 'REVERSAL' THEN
      SELECT * INTO original FROM partner_retail_receipts WHERE id = NEW."originalReceiptId" FOR UPDATE;
      IF NOT FOUND OR original.kind <> 'RECEIPT' OR original."planId" <> NEW."planId" OR original.currency <> NEW.currency
        OR NEW.amount + (SELECT coalesce(sum(amount),0) FROM partner_retail_receipts WHERE "originalReceiptId" = original.id) > original.amount THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Reversal must retain its original receipt and cannot exceed it';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER partner_plan_lineage BEFORE INSERT ON partner_payment_plans FOR EACH ROW EXECUTE FUNCTION partner_check_payment_evidence();
CREATE TRIGGER partner_retail_purpose BEFORE INSERT ON partner_retail_receipts FOR EACH ROW EXECUTE FUNCTION partner_check_payment_evidence();

CREATE FUNCTION partner_check_correction_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE opportunity partner_correction_opportunities;
BEGIN
  SELECT * INTO opportunity FROM partner_correction_opportunities WHERE id = NEW."opportunityId";
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Correction opportunity is missing'; END IF;
  IF TG_TABLE_NAME = 'partner_correction_saves' THEN
    NEW."savedAt" := transaction_timestamp();
    IF NEW."caseId" <> opportunity."caseId" OR NEW."successorRevision" <> opportunity."predecessorRevision" + 1
      OR NEW."savedAt" < opportunity."approvedAt" OR NEW."savedAt" >= opportunity."expiresAt" THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Correction save is outside its approved scope or window';
    END IF;
  ELSIF NEW.kind IN ('ACCOUNTING_PROCESSING','ACCOUNTING_MANAGER') AND NEW."actorId" = opportunity."requesterId" THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Correction requester cannot process or manager-approve their chain';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER partner_correction_save BEFORE INSERT ON partner_correction_saves FOR EACH ROW EXECUTE FUNCTION partner_check_correction_evidence();
CREATE TRIGGER partner_correction_separation BEFORE INSERT ON partner_correction_gates FOR EACH ROW EXECUTE FUNCTION partner_check_correction_evidence();

CREATE FUNCTION partner_check_case_history() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c partner_sale_cases; e partner_case_events;
BEGIN
  SELECT * INTO c FROM partner_sale_cases WHERE id = NEW.id;
  SELECT * INTO e FROM partner_case_events WHERE "caseId" = c.id AND "stateRevision" = c."stateRevision";
  IF NOT FOUND OR e."caseRevision" <> c."headRevision" OR e."integrityHash" <> c."integrityHash" OR e."toState" IS DISTINCT FROM c.state THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Case head requires coherent append-only command history';
  END IF;
  IF c."commitmentEventId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM partner_case_events WHERE id = c."commitmentEventId"
    AND "caseId" = c.id AND type = 'CASE_COMMITTED' AND "caseRevision" = c."committedRevision") THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Commitment must retain its single original realization';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER partner_case_history AFTER INSERT OR UPDATE ON partner_sale_cases
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION partner_check_case_history();

CREATE FUNCTION partner_check_event_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM partner_case_revisions WHERE "caseId" = NEW."caseId" AND revision = NEW."caseRevision"
    AND "integrityHash" = NEW."integrityHash") THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Event or output must bind its canonical revision hash';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER partner_event_binding AFTER INSERT ON partner_case_events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION partner_check_event_binding();
CREATE CONSTRAINT TRIGGER partner_output_binding AFTER INSERT ON partner_customer_output_snapshots DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION partner_check_event_binding();

-- A revision is assembled in one transaction. Later inserts cannot extend its sealed graph.
CREATE FUNCTION partner_revision_assembly_only() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rev integer;
BEGIN
  rev := (to_jsonb(NEW)->>'revision')::integer;
  IF rev IS NULL THEN rev := (to_jsonb(NEW)->>'caseRevision')::integer; END IF;
  IF NOT EXISTS (SELECT 1 FROM partner_case_revisions r WHERE r."caseId" = NEW."caseId" AND r.revision = rev
    AND r.xmin::text = pg_current_xact_id()::text) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Revision-owned evidence must be assembled atomically';
  END IF;
  RETURN NEW;
END $$;
DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['partner_case_row_bindings','partner_inquiry_usages','partner_case_deliveries','partner_case_delivery_items'] LOOP
    EXECUTE format('CREATE TRIGGER partner_atomic_assembly BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION partner_revision_assembly_only()', name);
  END LOOP;
  FOREACH name IN ARRAY ARRAY['partner_payment_plans','partner_payment_installments','partner_retail_receipts','partner_retail_receipt_allocations',
    'partner_case_events','partner_customer_output_snapshots','partner_correction_opportunities','partner_correction_saves',
    'partner_correction_gates','partner_correction_dependencies','partner_financial_adjustments','partner_outbox_messages','partner_outbox_attempts'] LOOP
    EXECUTE format('CREATE TRIGGER partner_append_only BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION partner_reject_evidence_mutation()', name);
    EXECUTE format('CREATE TRIGGER partner_no_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION partner_reject_evidence_mutation()', name);
  END LOOP;
END $$;
COMMIT;
