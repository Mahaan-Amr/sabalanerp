-- CreateTable
CREATE TABLE "accounting_customer_profiles" (
    "id" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "accountingPartyId" TEXT NOT NULL,
    "partySourceKind" TEXT NOT NULL,
    "partySourceId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "openingBalanceRials" DECIMAL(20,0) NOT NULL DEFAULT 0,
    "activeFrom" TIMESTAMP(3) NOT NULL,
    "activeTo" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_customer_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_customer_relationships" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceVersion" INTEGER NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "evidenceHash" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_customer_relationships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_exception_cases" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "messagePersian" TEXT NOT NULL,
    "assignedProfile" TEXT NOT NULL,
    "assignedUserId" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceVersion" INTEGER NOT NULL,
    "evidenceHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolutionEvidence" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "accounting_exception_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_commercial_customer_invoices" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "contractVersion" INTEGER NOT NULL,
    "number" TEXT NOT NULL,
    "ledgerVoucherId" TEXT NOT NULL,
    "taxInvoiceId" TEXT,
    "controlPolicyId" TEXT NOT NULL,
    "controlPolicyVersion" INTEGER NOT NULL,
    "controlEvidenceType" TEXT NOT NULL,
    "controlEvidenceId" TEXT NOT NULL,
    "controlEvidenceVersion" INTEGER NOT NULL,
    "controlEvidenceHash" TEXT NOT NULL,
    "netRials" DECIMAL(20,0) NOT NULL,
    "taxRials" DECIMAL(20,0) NOT NULL,
    "grossRials" DECIMAL(20,0) NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'POSTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_commercial_customer_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_customer_open_items" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "originalRials" DECIMAL(20,0) NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "postedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_customer_open_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_treasury_transactions" (
    "id" TEXT NOT NULL,
    "profileId" TEXT,
    "contractId" TEXT,
    "financialAccountId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "amountRials" DECIMAL(20,0) NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceVersion" INTEGER NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "postedVoucherId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_treasury_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_settlement_allocations" (
    "id" TEXT NOT NULL,
    "treasuryTransactionId" TEXT NOT NULL,
    "reversesId" TEXT,
    "reversedById" TEXT,
    "reason" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "ledgerVoucherId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_settlement_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_settlement_allocation_lines" (
    "id" TEXT NOT NULL,
    "allocationId" TEXT NOT NULL,
    "openItemId" TEXT NOT NULL,
    "amountRials" DECIMAL(20,0) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_settlement_allocation_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_tax_rules" (
    "id" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "citation" TEXT NOT NULL,
    "invoiceType" TEXT NOT NULL,
    "invoicePattern" TEXT NOT NULL,
    "exempt" BOOLEAN NOT NULL DEFAULT false,
    "exemptionReason" TEXT,
    "components" JSONB NOT NULL,
    "allocationRule" TEXT NOT NULL,
    "roundingRule" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_tax_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_tax_invoices" (
    "id" TEXT NOT NULL,
    "commercialInvoiceId" TEXT,
    "ledgerVoucherId" TEXT,
    "internalSerial" TEXT NOT NULL,
    "externalUniqueTaxId" TEXT,
    "referenceTaxInvoiceId" TEXT,
    "documentKind" TEXT NOT NULL,
    "protocolVersion" TEXT NOT NULL,
    "netRials" DECIMAL(20,0) NOT NULL,
    "taxRials" DECIMAL(20,0) NOT NULL,
    "status" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_tax_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_tax_invoice_lines" (
    "id" TEXT NOT NULL,
    "taxInvoiceId" TEXT NOT NULL,
    "sourceLineId" TEXT NOT NULL,
    "taxRuleId" TEXT NOT NULL,
    "taxRuleVersion" INTEGER NOT NULL,
    "citation" TEXT NOT NULL,
    "rawBaseAmount" DECIMAL(30,8) NOT NULL,
    "rawTaxAmount" DECIMAL(30,8) NOT NULL,
    "roundedTaxRials" DECIMAL(20,0) NOT NULL,
    "allocationEvidence" JSONB NOT NULL,
    "exempt" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_tax_invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_tax_submission_channels" (
    "id" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "providerName" TEXT,
    "safeKeyVersion" TEXT NOT NULL,
    "secretReference" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "healthStatus" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_tax_submission_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_tax_outbox_messages" (
    "id" TEXT NOT NULL,
    "taxInvoiceId" TEXT NOT NULL,
    "channelId" TEXT,
    "payloadHash" TEXT NOT NULL,
    "protocolVersion" TEXT NOT NULL,
    "requestIdentity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "availableAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_tax_outbox_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_tax_submission_attempts" (
    "id" TEXT NOT NULL,
    "outboxMessageId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "requestHash" TEXT NOT NULL,
    "safeResponse" JSONB,
    "receiptNumber" TEXT,
    "errorCode" TEXT,
    "status" TEXT NOT NULL,
    "attemptedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "accounting_tax_submission_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_bank_statement_lines" (
    "id" TEXT NOT NULL,
    "financialAccountId" TEXT NOT NULL,
    "adapterType" TEXT NOT NULL,
    "mappingVersion" INTEGER NOT NULL,
    "sourceIdentity" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "bookedAt" TIMESTAMP(3) NOT NULL,
    "amountRials" DECIMAL(20,0) NOT NULL,
    "description" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_bank_statement_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_bank_reconciliation_matches" (
    "id" TEXT NOT NULL,
    "bankStatementLineId" TEXT NOT NULL,
    "treasuryTransactionId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "score" INTEGER,
    "confirmedBy" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "reversedBy" TEXT,
    "reversedAt" TIMESTAMP(3),
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_bank_reconciliation_matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_check_instruments" (
    "id" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "profileId" TEXT,
    "direction" TEXT NOT NULL,
    "sayadId" TEXT,
    "serialNumber" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "amountRials" DECIMAL(20,0) NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "custodianId" TEXT,
    "evidenceHash" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_check_instruments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_check_instrument_events" (
    "id" TEXT NOT NULL,
    "checkInstrumentId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "eventType" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "actorId" TEXT NOT NULL,
    "fromCustodianId" TEXT,
    "toCustodianId" TEXT,
    "postingRuleVersion" INTEGER,
    "ledgerVoucherId" TEXT,
    "evidence" JSONB NOT NULL,
    "evidenceHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_check_instrument_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_cash_counts" (
    "id" TEXT NOT NULL,
    "financialAccountId" TEXT NOT NULL,
    "custodianId" TEXT NOT NULL,
    "countedAt" TIMESTAMP(3) NOT NULL,
    "expectedRials" DECIMAL(20,0) NOT NULL,
    "countedRials" DECIMAL(20,0) NOT NULL,
    "varianceRials" DECIMAL(20,0) NOT NULL,
    "ledgerVoucherId" TEXT,
    "evidenceHash" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_cash_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_petty_cash_advances" (
    "id" TEXT NOT NULL,
    "financialAccountId" TEXT NOT NULL,
    "custodianId" TEXT NOT NULL,
    "costCenterId" TEXT NOT NULL,
    "amountRials" DECIMAL(20,0) NOT NULL,
    "limitRials" DECIMAL(20,0) NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "settlementDueAt" TIMESTAMP(3) NOT NULL,
    "settledAt" TIMESTAMP(3),
    "supportingEvidence" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_petty_cash_advances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_vat_reconciliations" (
    "id" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "fiscalYearId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "salesTaxRials" DECIMAL(20,0) NOT NULL,
    "eligiblePurchaseTaxRials" DECIMAL(20,0) NOT NULL,
    "correctionRials" DECIMAL(20,0) NOT NULL,
    "paymentRials" DECIMAL(20,0) NOT NULL,
    "carryforwardRials" DECIMAL(20,0) NOT NULL,
    "penaltyRials" DECIMAL(20,0) NOT NULL,
    "exemptRials" DECIMAL(20,0) NOT NULL,
    "nonCreditableRials" DECIMAL(20,0) NOT NULL,
    "taxpayerStateSnapshot" JSONB NOT NULL,
    "ledgerControlHash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_vat_reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "accounting_customer_profiles_accountingPartyId_activeTo_idx" ON "accounting_customer_profiles"("accountingPartyId", "activeTo");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_customer_profiles_legalEntityId_partySourceKind__key" ON "accounting_customer_profiles"("legalEntityId", "partySourceKind", "partySourceId");

-- CreateIndex
CREATE INDEX "accounting_customer_relationships_profileId_cancelledAt_idx" ON "accounting_customer_relationships"("profileId", "cancelledAt");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_customer_relationships_sourceType_sourceId_sourc_key" ON "accounting_customer_relationships"("sourceType", "sourceId", "sourceVersion");

-- CreateIndex
CREATE INDEX "accounting_exception_cases_status_assignedProfile_createdAt_idx" ON "accounting_exception_cases"("status", "assignedProfile", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_exception_cases_sourceType_sourceId_sourceVersio_key" ON "accounting_exception_cases"("sourceType", "sourceId", "sourceVersion", "code");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_commercial_customer_invoices_number_key" ON "accounting_commercial_customer_invoices"("number");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_commercial_customer_invoices_ledgerVoucherId_key" ON "accounting_commercial_customer_invoices"("ledgerVoucherId");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_commercial_customer_invoices_taxInvoiceId_key" ON "accounting_commercial_customer_invoices"("taxInvoiceId");

-- CreateIndex
CREATE INDEX "accounting_commercial_customer_invoices_profileId_dueAt_sta_idx" ON "accounting_commercial_customer_invoices"("profileId", "dueAt", "status");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_commercial_customer_invoices_contractId_contract_key" ON "accounting_commercial_customer_invoices"("contractId", "contractVersion", "controlEvidenceId", "controlEvidenceVersion");

-- CreateIndex
CREATE INDEX "accounting_customer_open_items_profileId_dueAt_idx" ON "accounting_customer_open_items"("profileId", "dueAt");

-- CreateIndex
CREATE INDEX "accounting_customer_open_items_contractId_postedAt_idx" ON "accounting_customer_open_items"("contractId", "postedAt");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_customer_open_items_invoiceId_kind_key" ON "accounting_customer_open_items"("invoiceId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_treasury_transactions_idempotencyKey_key" ON "accounting_treasury_transactions"("idempotencyKey");

-- CreateIndex
CREATE INDEX "accounting_treasury_transactions_profileId_occurredAt_idx" ON "accounting_treasury_transactions"("profileId", "occurredAt");

-- CreateIndex
CREATE INDEX "accounting_treasury_transactions_financialAccountId_occurre_idx" ON "accounting_treasury_transactions"("financialAccountId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_treasury_transactions_sourceType_sourceId_source_key" ON "accounting_treasury_transactions"("sourceType", "sourceId", "sourceVersion");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_settlement_allocations_reversesId_key" ON "accounting_settlement_allocations"("reversesId");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_settlement_allocations_reversedById_key" ON "accounting_settlement_allocations"("reversedById");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_settlement_allocations_idempotencyKey_key" ON "accounting_settlement_allocations"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_settlement_allocations_ledgerVoucherId_key" ON "accounting_settlement_allocations"("ledgerVoucherId");

-- CreateIndex
CREATE INDEX "accounting_settlement_allocations_treasuryTransactionId_cre_idx" ON "accounting_settlement_allocations"("treasuryTransactionId", "createdAt");

-- CreateIndex
CREATE INDEX "accounting_settlement_allocation_lines_openItemId_createdAt_idx" ON "accounting_settlement_allocation_lines"("openItemId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_settlement_allocation_lines_allocationId_openIte_key" ON "accounting_settlement_allocation_lines"("allocationId", "openItemId");

-- CreateIndex
CREATE INDEX "accounting_tax_rules_legalEntityId_effectiveFrom_effectiveT_idx" ON "accounting_tax_rules"("legalEntityId", "effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_tax_rules_legalEntityId_code_version_key" ON "accounting_tax_rules"("legalEntityId", "code", "version");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_tax_invoices_commercialInvoiceId_key" ON "accounting_tax_invoices"("commercialInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_tax_invoices_internalSerial_key" ON "accounting_tax_invoices"("internalSerial");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_tax_invoices_externalUniqueTaxId_key" ON "accounting_tax_invoices"("externalUniqueTaxId");

-- CreateIndex
CREATE INDEX "accounting_tax_invoices_referenceTaxInvoiceId_idx" ON "accounting_tax_invoices"("referenceTaxInvoiceId");

-- CreateIndex
CREATE INDEX "accounting_tax_invoices_status_issuedAt_idx" ON "accounting_tax_invoices"("status", "issuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_tax_invoice_lines_taxInvoiceId_sourceLineId_key" ON "accounting_tax_invoice_lines"("taxInvoiceId", "sourceLineId");

-- CreateIndex
CREATE INDEX "accounting_tax_submission_channels_legalEntityId_effectiveF_idx" ON "accounting_tax_submission_channels"("legalEntityId", "effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_tax_outbox_messages_requestIdentity_key" ON "accounting_tax_outbox_messages"("requestIdentity");

-- CreateIndex
CREATE INDEX "accounting_tax_outbox_messages_status_availableAt_idx" ON "accounting_tax_outbox_messages"("status", "availableAt");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_tax_outbox_messages_taxInvoiceId_payloadHash_key" ON "accounting_tax_outbox_messages"("taxInvoiceId", "payloadHash");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_tax_submission_attempts_outboxMessageId_attemptN_key" ON "accounting_tax_submission_attempts"("outboxMessageId", "attemptNumber");

-- CreateIndex
CREATE INDEX "accounting_bank_statement_lines_financialAccountId_bookedAt_idx" ON "accounting_bank_statement_lines"("financialAccountId", "bookedAt");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_bank_statement_lines_financialAccountId_sourceId_key" ON "accounting_bank_statement_lines"("financialAccountId", "sourceIdentity");

-- CreateIndex
CREATE INDEX "accounting_bank_reconciliation_matches_status_createdAt_idx" ON "accounting_bank_reconciliation_matches"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_bank_reconciliation_matches_bankStatementLineId__key" ON "accounting_bank_reconciliation_matches"("bankStatementLineId", "treasuryTransactionId");

-- CreateIndex
CREATE INDEX "accounting_check_instruments_profileId_dueAt_status_idx" ON "accounting_check_instruments"("profileId", "dueAt", "status");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_check_instruments_legalEntityId_sayadId_key" ON "accounting_check_instruments"("legalEntityId", "sayadId");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_check_instrument_events_checkInstrumentId_sequen_key" ON "accounting_check_instrument_events"("checkInstrumentId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_cash_counts_financialAccountId_countedAt_key" ON "accounting_cash_counts"("financialAccountId", "countedAt");

-- CreateIndex
CREATE INDEX "accounting_petty_cash_advances_custodianId_status_settlemen_idx" ON "accounting_petty_cash_advances"("custodianId", "status", "settlementDueAt");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_vat_reconciliations_legalEntityId_fiscalYearId_p_key" ON "accounting_vat_reconciliations"("legalEntityId", "fiscalYearId", "periodId");

-- AddForeignKey
ALTER TABLE "accounting_customer_relationships" ADD CONSTRAINT "accounting_customer_relationships_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "accounting_customer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_commercial_customer_invoices" ADD CONSTRAINT "accounting_commercial_customer_invoices_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "accounting_customer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_customer_open_items" ADD CONSTRAINT "accounting_customer_open_items_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "accounting_customer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_customer_open_items" ADD CONSTRAINT "accounting_customer_open_items_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "accounting_commercial_customer_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_treasury_transactions" ADD CONSTRAINT "accounting_treasury_transactions_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "accounting_customer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_settlement_allocations" ADD CONSTRAINT "accounting_settlement_allocations_treasuryTransactionId_fkey" FOREIGN KEY ("treasuryTransactionId") REFERENCES "accounting_treasury_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_settlement_allocations" ADD CONSTRAINT "accounting_settlement_allocations_reversesId_fkey" FOREIGN KEY ("reversesId") REFERENCES "accounting_settlement_allocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_settlement_allocation_lines" ADD CONSTRAINT "accounting_settlement_allocation_lines_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "accounting_settlement_allocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_settlement_allocation_lines" ADD CONSTRAINT "accounting_settlement_allocation_lines_openItemId_fkey" FOREIGN KEY ("openItemId") REFERENCES "accounting_customer_open_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_tax_invoice_lines" ADD CONSTRAINT "accounting_tax_invoice_lines_taxInvoiceId_fkey" FOREIGN KEY ("taxInvoiceId") REFERENCES "accounting_tax_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_tax_outbox_messages" ADD CONSTRAINT "accounting_tax_outbox_messages_taxInvoiceId_fkey" FOREIGN KEY ("taxInvoiceId") REFERENCES "accounting_tax_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_tax_submission_attempts" ADD CONSTRAINT "accounting_tax_submission_attempts_outboxMessageId_fkey" FOREIGN KEY ("outboxMessageId") REFERENCES "accounting_tax_outbox_messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_bank_reconciliation_matches" ADD CONSTRAINT "accounting_bank_reconciliation_matches_bankStatementLineId_fkey" FOREIGN KEY ("bankStatementLineId") REFERENCES "accounting_bank_statement_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_bank_reconciliation_matches" ADD CONSTRAINT "accounting_bank_reconciliation_matches_treasuryTransaction_fkey" FOREIGN KEY ("treasuryTransactionId") REFERENCES "accounting_treasury_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_check_instrument_events" ADD CONSTRAINT "accounting_check_instrument_events_checkInstrumentId_fkey" FOREIGN KEY ("checkInstrumentId") REFERENCES "accounting_check_instruments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "accounting_customer_profiles" ADD CONSTRAINT "accounting_customer_profiles_zero_opening_check" CHECK ("openingBalanceRials" = 0);
ALTER TABLE "accounting_commercial_customer_invoices" ADD CONSTRAINT "accounting_customer_invoice_amounts_check" CHECK ("netRials" >= 0 AND "taxRials" >= 0 AND "grossRials" = "netRials" + "taxRials");
ALTER TABLE "accounting_customer_open_items" ADD CONSTRAINT "accounting_customer_open_item_amount_check" CHECK ("originalRials" > 0);
ALTER TABLE "accounting_treasury_transactions" ADD CONSTRAINT "accounting_treasury_transaction_amount_check" CHECK ("amountRials" > 0);
ALTER TABLE "accounting_settlement_allocation_lines" ADD CONSTRAINT "accounting_settlement_allocation_amount_check" CHECK ("amountRials" > 0);
ALTER TABLE "accounting_check_instruments" ADD CONSTRAINT "accounting_check_instrument_amount_check" CHECK ("amountRials" > 0);
ALTER TABLE "accounting_petty_cash_advances" ADD CONSTRAINT "accounting_petty_cash_limit_check" CHECK ("amountRials" > 0 AND "amountRials" <= "limitRials");

CREATE OR REPLACE FUNCTION "accounting_reject_immutable_change"()
RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'ACCOUNTING_IMMUTABLE_RECORD'; END; $$ LANGUAGE plpgsql;

CREATE TRIGGER "accounting_commercial_invoice_immutable" BEFORE UPDATE OR DELETE ON "accounting_commercial_customer_invoices" FOR EACH ROW EXECUTE FUNCTION "accounting_reject_immutable_change"();
CREATE TRIGGER "accounting_customer_open_item_immutable" BEFORE UPDATE OR DELETE ON "accounting_customer_open_items" FOR EACH ROW EXECUTE FUNCTION "accounting_reject_immutable_change"();
CREATE TRIGGER "accounting_treasury_transaction_immutable" BEFORE UPDATE OR DELETE ON "accounting_treasury_transactions" FOR EACH ROW EXECUTE FUNCTION "accounting_reject_immutable_change"();
CREATE TRIGGER "accounting_settlement_allocation_line_immutable" BEFORE UPDATE OR DELETE ON "accounting_settlement_allocation_lines" FOR EACH ROW EXECUTE FUNCTION "accounting_reject_immutable_change"();
CREATE TRIGGER "accounting_tax_invoice_line_immutable" BEFORE UPDATE OR DELETE ON "accounting_tax_invoice_lines" FOR EACH ROW EXECUTE FUNCTION "accounting_reject_immutable_change"();
CREATE TRIGGER "accounting_tax_submission_attempt_immutable" BEFORE UPDATE OR DELETE ON "accounting_tax_submission_attempts" FOR EACH ROW EXECUTE FUNCTION "accounting_reject_immutable_change"();
CREATE TRIGGER "accounting_bank_statement_line_immutable" BEFORE UPDATE OR DELETE ON "accounting_bank_statement_lines" FOR EACH ROW EXECUTE FUNCTION "accounting_reject_immutable_change"();
CREATE TRIGGER "accounting_check_event_immutable" BEFORE UPDATE OR DELETE ON "accounting_check_instrument_events" FOR EACH ROW EXECUTE FUNCTION "accounting_reject_immutable_change"();
CREATE TRIGGER "accounting_cash_count_immutable" BEFORE UPDATE OR DELETE ON "accounting_cash_counts" FOR EACH ROW EXECUTE FUNCTION "accounting_reject_immutable_change"();

CREATE OR REPLACE FUNCTION "accounting_guard_allocation_update"()
RETURNS trigger AS $$
BEGIN
  IF OLD."reversedById" IS NULL AND NEW."reversedById" IS NOT NULL
     AND OLD."id" = NEW."id" AND OLD."treasuryTransactionId" = NEW."treasuryTransactionId"
     AND OLD."reversesId" IS NOT DISTINCT FROM NEW."reversesId" AND OLD."reason" IS NOT DISTINCT FROM NEW."reason"
     AND OLD."idempotencyKey" = NEW."idempotencyKey" AND OLD."ledgerVoucherId" IS NOT DISTINCT FROM NEW."ledgerVoucherId"
     AND OLD."createdBy" = NEW."createdBy" AND OLD."createdAt" = NEW."createdAt" THEN RETURN NEW;
  END IF;
  RAISE EXCEPTION 'ACCOUNTING_ALLOCATION_IMMUTABLE';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "accounting_settlement_allocation_guard" BEFORE UPDATE ON "accounting_settlement_allocations" FOR EACH ROW EXECUTE FUNCTION "accounting_guard_allocation_update"();
CREATE TRIGGER "accounting_settlement_allocation_no_delete" BEFORE DELETE ON "accounting_settlement_allocations" FOR EACH ROW EXECUTE FUNCTION "accounting_reject_immutable_change"();

CREATE OR REPLACE FUNCTION "accounting_guard_tax_invoice_update"()
RETURNS trigger AS $$
BEGIN
  IF OLD."id" = NEW."id" AND OLD."commercialInvoiceId" IS NOT DISTINCT FROM NEW."commercialInvoiceId"
     AND OLD."ledgerVoucherId" IS NOT DISTINCT FROM NEW."ledgerVoucherId" AND OLD."internalSerial" = NEW."internalSerial"
     AND OLD."referenceTaxInvoiceId" IS NOT DISTINCT FROM NEW."referenceTaxInvoiceId" AND OLD."documentKind" = NEW."documentKind"
     AND OLD."protocolVersion" = NEW."protocolVersion" AND OLD."netRials" = NEW."netRials" AND OLD."taxRials" = NEW."taxRials"
     AND OLD."issuedAt" = NEW."issuedAt" AND OLD."createdAt" = NEW."createdAt" THEN RETURN NEW;
  END IF;
  RAISE EXCEPTION 'ACCOUNTING_TAX_INVOICE_ECONOMIC_FACT_IMMUTABLE';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "accounting_tax_invoice_guard" BEFORE UPDATE ON "accounting_tax_invoices" FOR EACH ROW EXECUTE FUNCTION "accounting_guard_tax_invoice_update"();
CREATE TRIGGER "accounting_tax_invoice_no_delete" BEFORE DELETE ON "accounting_tax_invoices" FOR EACH ROW EXECUTE FUNCTION "accounting_reject_immutable_change"();
