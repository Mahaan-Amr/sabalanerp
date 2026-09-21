-- CreateTable
CREATE TABLE "accounting_period_end_results" (
    "id" TEXT NOT NULL,
    "identity" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceVersion" INTEGER NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "resultKind" TEXT NOT NULL,
    "resultPayload" JSONB NOT NULL,
    "voucherId" TEXT,
    "statutoryNumber" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_period_end_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_asset_class_policies" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "classCode" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "titlePersian" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "capitalizationThresholdRials" DECIMAL(20,0) NOT NULL,
    "bookMethod" TEXT NOT NULL,
    "taxMethod" TEXT NOT NULL,
    "usefulLifeMonths" INTEGER NOT NULL,
    "residualValueBasisPoints" INTEGER NOT NULL DEFAULT 0,
    "decliningRateBasisPoints" INTEGER,
    "assetAccountId" TEXT NOT NULL,
    "cipAccountId" TEXT NOT NULL,
    "depreciationExpenseAccountId" TEXT NOT NULL,
    "accumulatedDepreciationAccountId" TEXT NOT NULL,
    "impairmentExpenseAccountId" TEXT NOT NULL,
    "impairmentAllowanceAccountId" TEXT NOT NULL,
    "disposalGainAccountId" TEXT NOT NULL,
    "disposalLossAccountId" TEXT NOT NULL,
    "changeReason" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_asset_class_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_fixed_assets" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "registerNumber" TEXT NOT NULL,
    "classPolicyId" TEXT NOT NULL,
    "titlePersian" TEXT NOT NULL,
    "serialNumber" TEXT,
    "branchId" TEXT,
    "costCenterId" TEXT,
    "location" TEXT,
    "custodianPartyId" TEXT,
    "acquisitionAt" TIMESTAMP(3) NOT NULL,
    "readyForUseAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "bookCostRials" DECIMAL(20,0) NOT NULL,
    "taxCostRials" DECIMAL(20,0) NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounting_fixed_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_asset_components" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "componentIdentity" TEXT NOT NULL,
    "titlePersian" TEXT NOT NULL,
    "serialNumber" TEXT,
    "bookCostRials" DECIMAL(20,0) NOT NULL,
    "taxCostRials" DECIMAL(20,0) NOT NULL,
    "residualValueRials" DECIMAL(20,0) NOT NULL,
    "usefulLifeMonths" INTEGER NOT NULL,
    "bookMethod" TEXT NOT NULL,
    "taxMethod" TEXT NOT NULL,
    "accumulatedBookRials" DECIMAL(20,0) NOT NULL DEFAULT 0,
    "accumulatedTaxRials" DECIMAL(20,0) NOT NULL DEFAULT 0,
    "replacedByComponentId" TEXT,
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_asset_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_asset_events" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "eventIdentity" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceVersion" INTEGER NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "voucherId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_asset_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_payroll_handoffs" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "payrollRunId" TEXT NOT NULL,
    "payrollRunVersion" INTEGER NOT NULL,
    "populationHash" TEXT NOT NULL,
    "policyHash" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "summaryPayload" JSONB NOT NULL,
    "debitTotalRials" DECIMAL(20,0) NOT NULL,
    "creditTotalRials" DECIMAL(20,0) NOT NULL,
    "voucherId" TEXT,
    "returnedReason" TEXT,
    "acceptedBy" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_payroll_handoffs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_payroll_obligations" (
    "id" TEXT NOT NULL,
    "handoffId" TEXT NOT NULL,
    "obligationIdentity" TEXT NOT NULL,
    "obligationType" TEXT NOT NULL,
    "amountRials" DECIMAL(20,0) NOT NULL,
    "settledRials" DECIMAL(20,0) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "lastAttemptIdentity" TEXT,
    "lastAttemptAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounting_payroll_obligations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_recognition_schedules" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "scheduleIdentity" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "scheduleType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "recognitionStart" TIMESTAMP(3) NOT NULL,
    "recognitionEnd" TIMESTAMP(3) NOT NULL,
    "totalRials" DECIMAL(20,0) NOT NULL,
    "recognizedRials" DECIMAL(20,0) NOT NULL DEFAULT 0,
    "estimateBasis" TEXT NOT NULL,
    "debitAccountId" TEXT NOT NULL,
    "creditAccountId" TEXT NOT NULL,
    "dimensionRules" JSONB NOT NULL,
    "roundingRuleVersion" TEXT NOT NULL,
    "postingPolicy" TEXT NOT NULL,
    "nextReviewAt" TIMESTAMP(3),
    "successorScheduleId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_recognition_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_estimate_cases" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "caseIdentity" TEXT NOT NULL,
    "classification" TEXT NOT NULL,
    "titlePersian" TEXT NOT NULL,
    "probability" TEXT NOT NULL,
    "reliablyMeasurable" BOOLEAN NOT NULL,
    "estimatedAmountRials" DECIMAL(20,0),
    "assumptions" JSONB NOT NULL,
    "evidenceHash" TEXT NOT NULL,
    "nextReviewAt" TIMESTAMP(3) NOT NULL,
    "recognizedVoucherId" TEXT,
    "disclosureSnapshotId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounting_estimate_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_financial_statement_mappings" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "titlePersian" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "contentHash" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_financial_statement_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_financial_statement_mapping_rows" (
    "id" TEXT NOT NULL,
    "mappingId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "statementType" TEXT NOT NULL,
    "sectionCode" TEXT NOT NULL,
    "signMultiplier" INTEGER NOT NULL DEFAULT 1,
    "cashFlowClass" TEXT,
    "noteCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_financial_statement_mapping_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_official_report_snapshots" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "snapshotIdentity" TEXT NOT NULL,
    "reportType" TEXT NOT NULL,
    "parameters" JSONB NOT NULL,
    "cutoffAt" TIMESTAMP(3) NOT NULL,
    "mappingVersionId" TEXT,
    "policyVersions" JSONB NOT NULL,
    "sourceIdentities" JSONB NOT NULL,
    "dataset" JSONB NOT NULL,
    "datasetHash" TEXT NOT NULL,
    "pdfHash" TEXT,
    "excelHash" TEXT,
    "generatedBy" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_official_report_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_statutory_formats" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "formatCode" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "titlePersian" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "schemaPayload" JSONB NOT NULL,
    "validationRules" JSONB NOT NULL,
    "officialSource" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_statutory_formats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_tax_obligations" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "obligationIdentity" TEXT NOT NULL,
    "taxType" TEXT NOT NULL,
    "periodIdentity" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "ownerId" TEXT NOT NULL,
    "payableRials" DECIMAL(20,0) NOT NULL DEFAULT 0,
    "paidRials" DECIMAL(20,0) NOT NULL DEFAULT 0,
    "refundableRials" DECIMAL(20,0) NOT NULL DEFAULT 0,
    "penaltyRials" DECIMAL(20,0) NOT NULL DEFAULT 0,
    "adjustmentRials" DECIMAL(20,0) NOT NULL DEFAULT 0,
    "reconciliationHash" TEXT,
    "policyVersion" TEXT NOT NULL,
    "receiptEvidence" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounting_tax_obligations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_tax_compliance_attempts" (
    "id" TEXT NOT NULL,
    "obligationId" TEXT NOT NULL,
    "attemptIdentity" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "responseCode" TEXT,
    "responsePayload" JSONB,
    "receiptNumber" TEXT,
    "attemptedBy" TEXT NOT NULL,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_tax_compliance_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_close_runs" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "fiscalYearId" TEXT NOT NULL,
    "periodId" TEXT,
    "runIdentity" TEXT NOT NULL,
    "closeType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "confirmationReason" TEXT,
    "completedBy" TEXT,
    "completedAt" TIMESTAMP(3),
    "evidenceHash" TEXT,
    "predecessorRunId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounting_close_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_close_run_steps" (
    "id" TEXT NOT NULL,
    "closeRunId" TEXT NOT NULL,
    "stepCode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "evidenceHash" TEXT,
    "blocker" TEXT,
    "invalidatedBy" JSONB,
    "checkedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounting_close_run_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_restatement_cases" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "caseIdentity" TEXT NOT NULL,
    "originalPeriodId" TEXT NOT NULL,
    "classification" TEXT NOT NULL,
    "discoveredAt" TIMESTAMP(3) NOT NULL,
    "amountRials" DECIMAL(20,0) NOT NULL,
    "materialityPolicyId" TEXT NOT NULL,
    "decisionReason" TEXT NOT NULL,
    "originalSnapshotIds" JSONB NOT NULL,
    "restatedSnapshotIds" JSONB NOT NULL,
    "correctingVoucherIds" JSONB NOT NULL,
    "comparativeEffects" JSONB NOT NULL,
    "taxEffects" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "decidedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounting_restatement_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_archive_evidence" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "evidenceIdentity" TEXT NOT NULL,
    "evidenceType" TEXT NOT NULL,
    "sourceEntityType" TEXT NOT NULL,
    "sourceEntityId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "malwareScanStatus" TEXT NOT NULL,
    "malwareScanAt" TIMESTAMP(3),
    "retentionPolicyId" TEXT NOT NULL,
    "retainUntil" TIMESTAMP(3),
    "legalHold" BOOLEAN NOT NULL DEFAULT false,
    "supersedesId" TEXT,
    "uploadedBy" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_archive_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounting_period_end_results_identity_key" ON "accounting_period_end_results"("identity");

-- CreateIndex
CREATE INDEX "accounting_period_end_results_bookId_resultKind_createdAt_idx" ON "accounting_period_end_results"("bookId", "resultKind", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_period_end_results_bookId_sourceType_sourceId_so_key" ON "accounting_period_end_results"("bookId", "sourceType", "sourceId", "sourceVersion");

-- CreateIndex
CREATE INDEX "accounting_asset_class_policies_bookId_effectiveFrom_effect_idx" ON "accounting_asset_class_policies"("bookId", "effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_asset_class_policies_bookId_classCode_version_key" ON "accounting_asset_class_policies"("bookId", "classCode", "version");

-- CreateIndex
CREATE INDEX "accounting_fixed_assets_bookId_status_readyForUseAt_idx" ON "accounting_fixed_assets"("bookId", "status", "readyForUseAt");

-- CreateIndex
CREATE INDEX "accounting_fixed_assets_serialNumber_idx" ON "accounting_fixed_assets"("serialNumber");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_fixed_assets_bookId_registerNumber_key" ON "accounting_fixed_assets"("bookId", "registerNumber");

-- CreateIndex
CREATE INDEX "accounting_asset_components_assetId_retiredAt_idx" ON "accounting_asset_components"("assetId", "retiredAt");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_asset_components_assetId_componentIdentity_key" ON "accounting_asset_components"("assetId", "componentIdentity");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_asset_events_eventIdentity_key" ON "accounting_asset_events"("eventIdentity");

-- CreateIndex
CREATE INDEX "accounting_asset_events_assetId_occurredAt_idx" ON "accounting_asset_events"("assetId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_asset_events_sourceType_sourceId_sourceVersion_key" ON "accounting_asset_events"("sourceType", "sourceId", "sourceVersion");

-- CreateIndex
CREATE INDEX "accounting_payroll_handoffs_bookId_status_createdAt_idx" ON "accounting_payroll_handoffs"("bookId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_payroll_handoffs_bookId_payrollRunId_payrollRunV_key" ON "accounting_payroll_handoffs"("bookId", "payrollRunId", "payrollRunVersion");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_payroll_obligations_obligationIdentity_key" ON "accounting_payroll_obligations"("obligationIdentity");

-- CreateIndex
CREATE INDEX "accounting_payroll_obligations_handoffId_status_idx" ON "accounting_payroll_obligations"("handoffId", "status");

-- CreateIndex
CREATE INDEX "accounting_recognition_schedules_bookId_status_nextReviewAt_idx" ON "accounting_recognition_schedules"("bookId", "status", "nextReviewAt");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_recognition_schedules_bookId_scheduleIdentity_ve_key" ON "accounting_recognition_schedules"("bookId", "scheduleIdentity", "version");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_estimate_cases_caseIdentity_key" ON "accounting_estimate_cases"("caseIdentity");

-- CreateIndex
CREATE INDEX "accounting_estimate_cases_bookId_classification_nextReviewA_idx" ON "accounting_estimate_cases"("bookId", "classification", "nextReviewAt");

-- CreateIndex
CREATE INDEX "accounting_financial_statement_mappings_bookId_effectiveFro_idx" ON "accounting_financial_statement_mappings"("bookId", "effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_financial_statement_mappings_bookId_version_key" ON "accounting_financial_statement_mappings"("bookId", "version");

-- CreateIndex
CREATE INDEX "accounting_financial_statement_mapping_rows_mappingId_state_idx" ON "accounting_financial_statement_mapping_rows"("mappingId", "statementType", "sectionCode");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_financial_statement_mapping_rows_mappingId_accou_key" ON "accounting_financial_statement_mapping_rows"("mappingId", "accountId", "statementType", "sectionCode");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_official_report_snapshots_snapshotIdentity_key" ON "accounting_official_report_snapshots"("snapshotIdentity");

-- CreateIndex
CREATE INDEX "accounting_official_report_snapshots_bookId_reportType_gene_idx" ON "accounting_official_report_snapshots"("bookId", "reportType", "generatedAt");

-- CreateIndex
CREATE INDEX "accounting_statutory_formats_bookId_effectiveFrom_effective_idx" ON "accounting_statutory_formats"("bookId", "effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_statutory_formats_bookId_formatCode_version_key" ON "accounting_statutory_formats"("bookId", "formatCode", "version");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_tax_obligations_obligationIdentity_key" ON "accounting_tax_obligations"("obligationIdentity");

-- CreateIndex
CREATE INDEX "accounting_tax_obligations_bookId_status_dueAt_idx" ON "accounting_tax_obligations"("bookId", "status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_tax_obligations_bookId_taxType_periodIdentity_key" ON "accounting_tax_obligations"("bookId", "taxType", "periodIdentity");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_tax_compliance_attempts_attemptIdentity_key" ON "accounting_tax_compliance_attempts"("attemptIdentity");

-- CreateIndex
CREATE INDEX "accounting_tax_compliance_attempts_obligationId_attemptedAt_idx" ON "accounting_tax_compliance_attempts"("obligationId", "attemptedAt");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_close_runs_runIdentity_key" ON "accounting_close_runs"("runIdentity");

-- CreateIndex
CREATE INDEX "accounting_close_runs_bookId_fiscalYearId_status_idx" ON "accounting_close_runs"("bookId", "fiscalYearId", "status");

-- CreateIndex
CREATE INDEX "accounting_close_runs_periodId_status_idx" ON "accounting_close_runs"("periodId", "status");

-- CreateIndex
CREATE INDEX "accounting_close_run_steps_closeRunId_status_idx" ON "accounting_close_run_steps"("closeRunId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_close_run_steps_closeRunId_stepCode_key" ON "accounting_close_run_steps"("closeRunId", "stepCode");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_restatement_cases_caseIdentity_key" ON "accounting_restatement_cases"("caseIdentity");

-- CreateIndex
CREATE INDEX "accounting_restatement_cases_bookId_originalPeriodId_status_idx" ON "accounting_restatement_cases"("bookId", "originalPeriodId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_archive_evidence_evidenceIdentity_key" ON "accounting_archive_evidence"("evidenceIdentity");

-- CreateIndex
CREATE INDEX "accounting_archive_evidence_bookId_evidenceType_uploadedAt_idx" ON "accounting_archive_evidence"("bookId", "evidenceType", "uploadedAt");

-- CreateIndex
CREATE INDEX "accounting_archive_evidence_sourceEntityType_sourceEntityId_idx" ON "accounting_archive_evidence"("sourceEntityType", "sourceEntityId");

-- CreateIndex
CREATE INDEX "accounting_archive_evidence_retainUntil_legalHold_idx" ON "accounting_archive_evidence"("retainUntil", "legalHold");

-- AddForeignKey
ALTER TABLE "accounting_asset_components" ADD CONSTRAINT "accounting_asset_components_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "accounting_fixed_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_asset_events" ADD CONSTRAINT "accounting_asset_events_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "accounting_fixed_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_payroll_obligations" ADD CONSTRAINT "accounting_payroll_obligations_handoffId_fkey" FOREIGN KEY ("handoffId") REFERENCES "accounting_payroll_handoffs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_financial_statement_mapping_rows" ADD CONSTRAINT "accounting_financial_statement_mapping_rows_mappingId_fkey" FOREIGN KEY ("mappingId") REFERENCES "accounting_financial_statement_mappings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_tax_compliance_attempts" ADD CONSTRAINT "accounting_tax_compliance_attempts_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "accounting_tax_obligations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_close_run_steps" ADD CONSTRAINT "accounting_close_run_steps_closeRunId_fkey" FOREIGN KEY ("closeRunId") REFERENCES "accounting_close_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
