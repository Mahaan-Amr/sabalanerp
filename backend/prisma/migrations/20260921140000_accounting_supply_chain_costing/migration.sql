-- CreateEnum
CREATE TYPE "AccountingSupplyChainOutcomeKind" AS ENUM ('POSTED', 'EXCEPTION');

-- CreateEnum
CREATE TYPE "AccountingPurchaseLineKind" AS ENUM ('INVENTORY', 'FIXED_ASSET', 'SERVICE', 'EXPENSE');

-- CreateEnum
CREATE TYPE "AccountingTreasuryTransactionKind" AS ENUM ('SUPPLIER_PAYMENT', 'PURCHASE_ADVANCE', 'SUPPLIER_CREDIT', 'PAYABLE_CHECK_ISSUANCE', 'PAYABLE_CHECK_REVERSAL', 'ASSIGNED_CUSTOMER_CHECK', 'ASSIGNED_CUSTOMER_CHECK_REVERSAL');

-- CreateEnum
CREATE TYPE "AccountingSupplierCheckKind" AS ENUM ('PAYABLE', 'ASSIGNED_CUSTOMER');

-- CreateEnum
CREATE TYPE "AccountingCheckLifecycleStatus" AS ENUM ('RECEIVED', 'ISSUED', 'ENDORSED', 'DELIVERED', 'DEPOSITED', 'CLEARED', 'BOUNCED', 'RETURNED', 'REPLACED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AccountingInventoryIdentityKind" AS ENUM ('BLOCK', 'SLAB', 'PIECE', 'REMAINDER', 'CONSUMABLE', 'FINISHED_GOOD');

-- CreateEnum
CREATE TYPE "AccountingInventoryValuationMethod" AS ENUM ('SPECIFIC_IDENTIFICATION', 'MOVING_WEIGHTED_AVERAGE');

-- CreateEnum
CREATE TYPE "AccountingInventoryEventType" AS ENUM ('RECEIPT', 'MOVEMENT', 'TRANSFORMATION_INPUT', 'TRANSFORMATION_OUTPUT', 'SALE_RELIEF', 'RETURN', 'CORRECTION', 'OPENING');

-- CreateEnum
CREATE TYPE "AccountingInventoryCustodyStatus" AS ENUM ('AVAILABLE', 'RESERVED', 'CONSUMED', 'RETURNED', 'QUARANTINED');

-- CreateEnum
CREATE TYPE "AccountingInventoryReservationStatus" AS ENUM ('ACTIVE', 'RELEASED');

-- CreateEnum
CREATE TYPE "AccountingProductionCostKind" AS ENUM ('DIRECT_LABOR', 'MACHINE', 'ENERGY', 'OVERHEAD');

-- CreateEnum
CREATE TYPE "AccountingInventoryMigrationStatus" AS ENUM ('PREVIEWED', 'RECONCILED', 'COMMITTED');

-- CreateEnum
CREATE TYPE "AccountingInventoryMigrationDisposition" AS ENUM ('ACCEPTED', 'QUARANTINED', 'REJECTED');

-- CreateTable
CREATE TABLE "accounting_supply_chain_commands" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "commandHash" TEXT NOT NULL,
    "outcomeKind" "AccountingSupplyChainOutcomeKind" NOT NULL,
    "outcomePayload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_supply_chain_commands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_operational_evidence_receipts" (
    "id" TEXT NOT NULL,
    "ownerWorkspace" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceVersion" INTEGER NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "sourcePayload" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "accounting_operational_evidence_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_supply_chain_posting_rules" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "accountRole" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_supply_chain_posting_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_supply_chain_exceptions" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "messagePersian" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceVersion" INTEGER NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "sourcePayload" JSONB NOT NULL,
    "correlationId" TEXT NOT NULL,
    "voucherId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionEvidence" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_supply_chain_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_supplier_invoices" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "supplierPartyId" TEXT NOT NULL,
    "supplierInvoiceNumber" TEXT NOT NULL,
    "documentDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "grossRials" DECIMAL(20,0) NOT NULL,
    "discountRials" DECIMAL(20,0) NOT NULL,
    "attributableFreightRials" DECIMAL(20,0) NOT NULL,
    "recoverableTaxRials" DECIMAL(20,0) NOT NULL,
    "nonRecoverableTaxRials" DECIMAL(20,0) NOT NULL,
    "deductionRials" DECIMAL(20,0) NOT NULL,
    "retentionRials" DECIMAL(20,0) NOT NULL,
    "roundingRials" DECIMAL(20,0) NOT NULL,
    "netPayableRials" DECIMAL(20,0) NOT NULL,
    "inventoryValueRials" DECIMAL(20,0) NOT NULL,
    "voucherId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceVersion" INTEGER NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "sourcePayload" JSONB NOT NULL,
    "correctionOfId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_supplier_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_supplier_invoice_lines" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "sourceLineId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "kind" "AccountingPurchaseLineKind" NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(24,6) NOT NULL,
    "unit" TEXT NOT NULL,
    "unitPriceRials" DECIMAL(20,0) NOT NULL,
    "grossRials" DECIMAL(20,0) NOT NULL,
    "discountRials" DECIMAL(20,0) NOT NULL,
    "attributableFreightRials" DECIMAL(20,0) NOT NULL,
    "recoverableTaxRials" DECIMAL(20,0) NOT NULL,
    "nonRecoverableTaxRials" DECIMAL(20,0) NOT NULL,
    "deductionRials" DECIMAL(20,0) NOT NULL,
    "retentionRials" DECIMAL(20,0) NOT NULL,
    "roundingRials" DECIMAL(20,0) NOT NULL,
    "orderEvidence" JSONB,
    "receiptEvidence" JSONB,
    "acceptedServiceEvidence" JSONB,
    "nonOrderExceptionEvidence" JSONB,
    "inventoryIdentityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_supplier_invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_supplier_open_items" (
    "id" TEXT NOT NULL,
    "supplierPartyId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amountRials" DECIMAL(20,0) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_supplier_open_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_supplier_treasury_transactions" (
    "id" TEXT NOT NULL,
    "supplierPartyId" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "kind" "AccountingTreasuryTransactionKind" NOT NULL,
    "amountRials" DECIMAL(20,0) NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceVersion" INTEGER NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "sourcePayload" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_supplier_treasury_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_supplier_allocations" (
    "id" TEXT NOT NULL,
    "treasuryTransactionId" TEXT NOT NULL,
    "openItemId" TEXT NOT NULL,
    "amountRials" DECIMAL(20,0) NOT NULL,
    "reversalOfId" TEXT,
    "reason" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_supplier_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_payable_checks" (
    "id" TEXT NOT NULL,
    "sayadId" TEXT NOT NULL,
    "amountRials" DECIMAL(20,0) NOT NULL,
    "supplierPartyId" TEXT NOT NULL,
    "financialAccountId" TEXT NOT NULL,
    "treasuryTransactionId" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" "AccountingCheckLifecycleStatus" NOT NULL,
    "replacementCheckId" TEXT,
    "kind" "AccountingSupplierCheckKind" NOT NULL DEFAULT 'PAYABLE',
    "sourceCustomerPaymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_payable_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_check_custody_events" (
    "id" TEXT NOT NULL,
    "checkId" TEXT NOT NULL,
    "status" "AccountingCheckLifecycleStatus" NOT NULL,
    "reason" TEXT NOT NULL,
    "evidenceType" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "evidenceVersion" INTEGER NOT NULL,
    "evidenceHash" TEXT NOT NULL,
    "evidencePayload" JSONB NOT NULL,
    "actorId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounting_check_custody_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_inventory_identities" (
    "id" TEXT NOT NULL,
    "kind" "AccountingInventoryIdentityKind" NOT NULL,
    "originId" TEXT,
    "valuationMethod" "AccountingInventoryValuationMethod" NOT NULL,
    "governedUnit" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_inventory_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_inventory_events" (
    "id" TEXT NOT NULL,
    "identityId" TEXT NOT NULL,
    "eventType" "AccountingInventoryEventType" NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" DECIMAL(24,6) NOT NULL,
    "voucherId" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceVersion" INTEGER NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "sourcePayload" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "predecessorEventId" TEXT,
    "sourceWarehouseId" TEXT,
    "sourceLocationId" TEXT,
    "statusAfter" "AccountingInventoryCustodyStatus" NOT NULL,
    "predecessorIdentityIds" JSONB,

    CONSTRAINT "accounting_inventory_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_inventory_valuation_layers" (
    "id" TEXT NOT NULL,
    "identityId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" DECIMAL(24,6) NOT NULL,
    "valueRials" DECIMAL(20,0) NOT NULL,
    "valuationMethod" "AccountingInventoryValuationMethod" NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_inventory_valuation_layers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_inventory_layer_consumptions" (
    "id" TEXT NOT NULL,
    "identityId" TEXT NOT NULL,
    "layerId" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" DECIMAL(24,6) NOT NULL,
    "valueRials" DECIMAL(20,0) NOT NULL,
    "purpose" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_inventory_layer_consumptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_inventory_reservations" (
    "id" TEXT NOT NULL,
    "identityId" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" DECIMAL(24,6) NOT NULL,
    "purposeId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "AccountingInventoryReservationStatus" NOT NULL,
    "evidenceType" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "evidenceVersion" INTEGER NOT NULL,
    "evidenceHash" TEXT NOT NULL,
    "evidencePayload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),
    "releaseEvidenceType" TEXT,
    "releaseEvidenceId" TEXT,
    "releaseEvidenceVersion" INTEGER,
    "releaseEvidenceHash" TEXT,
    "releaseEvidencePayload" JSONB,
    "releasedBy" TEXT,

    CONSTRAINT "accounting_inventory_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_production_batches" (
    "id" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "evidenceHash" TEXT NOT NULL,
    "inputValueRials" DECIMAL(20,0) NOT NULL,
    "allocatedCostRials" DECIMAL(20,0) NOT NULL,
    "outputValueRials" DECIMAL(20,0) NOT NULL,
    "abnormalWasteExpenseRials" DECIMAL(20,0) NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounting_production_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_production_cost_pools" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "kind" "AccountingProductionCostKind" NOT NULL,
    "amountRials" DECIMAL(20,0) NOT NULL,
    "allocationBasis" TEXT NOT NULL,
    "basisQuantity" DECIMAL(24,6) NOT NULL,
    "policyVersion" INTEGER NOT NULL,

    CONSTRAINT "accounting_production_cost_pools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_production_outputs" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "identityId" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" DECIMAL(24,6) NOT NULL,
    "valueRials" DECIMAL(20,0) NOT NULL,

    CONSTRAINT "accounting_production_outputs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_inventory_migration_runs" (
    "id" TEXT NOT NULL,
    "sourcePackageHash" TEXT NOT NULL,
    "mappingVersion" INTEGER NOT NULL,
    "toolVersion" TEXT NOT NULL,
    "scope" JSONB NOT NULL,
    "inputCount" INTEGER NOT NULL,
    "acceptedCount" INTEGER NOT NULL,
    "quarantinedCount" INTEGER NOT NULL,
    "rejectedCount" INTEGER NOT NULL,
    "outputHash" TEXT NOT NULL,
    "sepidarControlRials" DECIMAL(20,0) NOT NULL,
    "acceptedTotalRials" DECIMAL(20,0) NOT NULL,
    "status" "AccountingInventoryMigrationStatus" NOT NULL,
    "voucherId" TEXT,
    "commitIdempotencyKey" TEXT,
    "committedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "successorRunId" TEXT,

    CONSTRAINT "accounting_inventory_migration_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_inventory_migration_items" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "identityId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" DECIMAL(24,6) NOT NULL,
    "valueRials" DECIMAL(20,0) NOT NULL,
    "valuationMethod" "AccountingInventoryValuationMethod" NOT NULL,
    "uncertainty" TEXT,
    "disposition" "AccountingInventoryMigrationDisposition" NOT NULL,

    CONSTRAINT "accounting_inventory_migration_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounting_supply_chain_commands_idempotencyKey_key" ON "accounting_supply_chain_commands"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_operational_evidence_receipts_source_key" ON "accounting_operational_evidence_receipts"("sourceType", "sourceId", "sourceVersion");

-- CreateIndex
CREATE INDEX "accounting_operational_evidence_receipts_owner_idx" ON "accounting_operational_evidence_receipts"("ownerWorkspace", "recordedAt");

-- CreateIndex
CREATE INDEX "accounting_supply_chain_posting_rules_bookId_accountRole_ef_idx" ON "accounting_supply_chain_posting_rules"("bookId", "accountRole", "effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_supply_chain_posting_rules_bookId_accountRole_ve_key" ON "accounting_supply_chain_posting_rules"("bookId", "accountRole", "version");

-- CreateIndex
CREATE INDEX "accounting_supply_chain_exceptions_resolvedAt_code_createdA_idx" ON "accounting_supply_chain_exceptions"("resolvedAt", "code", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_supply_chain_exceptions_sourceType_sourceId_sour_key" ON "accounting_supply_chain_exceptions"("sourceType", "sourceId", "sourceVersion", "code");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_supplier_invoices_voucherId_key" ON "accounting_supplier_invoices"("voucherId");

-- CreateIndex
CREATE INDEX "accounting_supplier_invoices_supplierPartyId_dueDate_idx" ON "accounting_supplier_invoices"("supplierPartyId", "dueDate");

-- CreateIndex
CREATE INDEX "accounting_supplier_invoices_correctionOfId_idx" ON "accounting_supplier_invoices"("correctionOfId");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_supplier_invoices_supplierPartyId_supplierInvoic_key" ON "accounting_supplier_invoices"("supplierPartyId", "supplierInvoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_supplier_invoices_bookId_sourceType_sourceId_sou_key" ON "accounting_supplier_invoices"("bookId", "sourceType", "sourceId", "sourceVersion");

-- CreateIndex
CREATE INDEX "accounting_supplier_invoice_lines_inventoryIdentityId_idx" ON "accounting_supplier_invoice_lines"("inventoryIdentityId");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_supplier_invoice_lines_invoiceId_sourceLineId_key" ON "accounting_supplier_invoice_lines"("invoiceId", "sourceLineId");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_supplier_invoice_lines_invoiceId_sequence_key" ON "accounting_supplier_invoice_lines"("invoiceId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_supplier_open_items_invoiceId_key" ON "accounting_supplier_open_items"("invoiceId");

-- CreateIndex
CREATE INDEX "accounting_supplier_open_items_supplierPartyId_dueDate_idx" ON "accounting_supplier_open_items"("supplierPartyId", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_supplier_treasury_transactions_voucherId_key" ON "accounting_supplier_treasury_transactions"("voucherId");

-- CreateIndex
CREATE INDEX "accounting_supplier_treasury_transactions_supplierPartyId_occurredAt_idx" ON "accounting_supplier_treasury_transactions"("supplierPartyId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_supplier_treasury_transactions_sourceType_sourceId_source_key" ON "accounting_supplier_treasury_transactions"("sourceType", "sourceId", "sourceVersion");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_supplier_allocations_reversalOfId_key" ON "accounting_supplier_allocations"("reversalOfId");

-- CreateIndex
CREATE INDEX "accounting_supplier_allocations_openItemId_createdAt_idx" ON "accounting_supplier_allocations"("openItemId", "createdAt");

-- CreateIndex
CREATE INDEX "accounting_supplier_allocations_treasuryTransactionId_creat_idx" ON "accounting_supplier_allocations"("treasuryTransactionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_payable_checks_sayadId_key" ON "accounting_payable_checks"("sayadId");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_payable_checks_treasuryTransactionId_key" ON "accounting_payable_checks"("treasuryTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_payable_checks_replacementCheckId_key" ON "accounting_payable_checks"("replacementCheckId");

-- CreateIndex
CREATE INDEX "accounting_payable_checks_supplierPartyId_dueDate_status_idx" ON "accounting_payable_checks"("supplierPartyId", "dueDate", "status");

-- CreateIndex
CREATE INDEX "accounting_check_custody_events_checkId_occurredAt_idx" ON "accounting_check_custody_events"("checkId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_check_custody_events_checkId_evidenceType_eviden_key" ON "accounting_check_custody_events"("checkId", "evidenceType", "evidenceId", "evidenceVersion");

-- CreateIndex
CREATE INDEX "accounting_inventory_identities_originId_kind_idx" ON "accounting_inventory_identities"("originId", "kind");

-- CreateIndex
CREATE INDEX "accounting_inventory_events_identityId_occurredAt_idx" ON "accounting_inventory_events"("identityId", "occurredAt");

-- CreateIndex
CREATE INDEX "accounting_inventory_events_warehouseId_locationId_occurred_idx" ON "accounting_inventory_events"("warehouseId", "locationId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_inventory_events_sourceType_sourceId_sourceVersi_key" ON "accounting_inventory_events"("sourceType", "sourceId", "sourceVersion", "eventType", "identityId");

-- CreateIndex
CREATE INDEX "accounting_inventory_valuation_layers_identityId_createdAt_idx" ON "accounting_inventory_valuation_layers"("identityId", "createdAt");

-- CreateIndex
CREATE INDEX "accounting_inventory_layer_consumptions_identityId_createdA_idx" ON "accounting_inventory_layer_consumptions"("identityId", "createdAt");

-- CreateIndex
CREATE INDEX "accounting_inventory_layer_consumptions_layerId_createdAt_idx" ON "accounting_inventory_layer_consumptions"("layerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_inventory_reservations_idempotencyKey_key" ON "accounting_inventory_reservations"("idempotencyKey");

-- CreateIndex
CREATE INDEX "accounting_inventory_reservations_identityId_status_idx" ON "accounting_inventory_reservations"("identityId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_production_batches_voucherId_key" ON "accounting_production_batches"("voucherId");

-- CreateIndex
CREATE INDEX "accounting_production_cost_pools_batchId_idx" ON "accounting_production_cost_pools"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_production_outputs_batchId_identityId_key" ON "accounting_production_outputs"("batchId", "identityId");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_inventory_migration_runs_voucherId_key" ON "accounting_inventory_migration_runs"("voucherId");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_inventory_migration_runs_commitIdempotencyKey_key" ON "accounting_inventory_migration_runs"("commitIdempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_inventory_migration_runs_successorRunId_key" ON "accounting_inventory_migration_runs"("successorRunId");

-- CreateIndex
CREATE INDEX "accounting_inventory_migration_runs_status_createdAt_idx" ON "accounting_inventory_migration_runs"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_inventory_migration_runs_sourcePackageHash_mappi_key" ON "accounting_inventory_migration_runs"("sourcePackageHash", "mappingVersion");

-- CreateIndex
CREATE INDEX "accounting_inventory_migration_items_runId_disposition_idx" ON "accounting_inventory_migration_items"("runId", "disposition");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_inventory_migration_items_runId_sourceId_key" ON "accounting_inventory_migration_items"("runId", "sourceId");

-- AddForeignKey
ALTER TABLE "accounting_supply_chain_posting_rules" ADD CONSTRAINT "accounting_supply_chain_posting_rules_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "accounting_books"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_supply_chain_posting_rules" ADD CONSTRAINT "accounting_supply_chain_posting_rules_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounting_ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_supply_chain_exceptions" ADD CONSTRAINT "accounting_supply_chain_exceptions_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "accounting_ledger_vouchers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_supplier_invoices" ADD CONSTRAINT "accounting_supplier_invoices_supplierPartyId_fkey" FOREIGN KEY ("supplierPartyId") REFERENCES "accounting_parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_supplier_invoices" ADD CONSTRAINT "accounting_supplier_invoices_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "accounting_ledger_vouchers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_supplier_invoices" ADD CONSTRAINT "accounting_supplier_invoices_correctionOfId_fkey" FOREIGN KEY ("correctionOfId") REFERENCES "accounting_supplier_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_supplier_invoice_lines" ADD CONSTRAINT "accounting_supplier_invoice_lines_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "accounting_supplier_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_supplier_invoice_lines" ADD CONSTRAINT "accounting_supplier_invoice_lines_inventoryIdentityId_fkey" FOREIGN KEY ("inventoryIdentityId") REFERENCES "accounting_inventory_identities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_supplier_open_items" ADD CONSTRAINT "accounting_supplier_open_items_supplierPartyId_fkey" FOREIGN KEY ("supplierPartyId") REFERENCES "accounting_parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_supplier_open_items" ADD CONSTRAINT "accounting_supplier_open_items_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "accounting_supplier_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_supplier_treasury_transactions" ADD CONSTRAINT "accounting_supplier_treasury_transactions_supplierPartyId_fkey" FOREIGN KEY ("supplierPartyId") REFERENCES "accounting_parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_supplier_treasury_transactions" ADD CONSTRAINT "accounting_supplier_treasury_transactions_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "accounting_ledger_vouchers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_supplier_allocations" ADD CONSTRAINT "accounting_supplier_allocations_treasuryTransactionId_fkey" FOREIGN KEY ("treasuryTransactionId") REFERENCES "accounting_supplier_treasury_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_supplier_allocations" ADD CONSTRAINT "accounting_supplier_allocations_openItemId_fkey" FOREIGN KEY ("openItemId") REFERENCES "accounting_supplier_open_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_supplier_allocations" ADD CONSTRAINT "accounting_supplier_allocations_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "accounting_supplier_allocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_payable_checks" ADD CONSTRAINT "accounting_payable_checks_supplierPartyId_fkey" FOREIGN KEY ("supplierPartyId") REFERENCES "accounting_parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_payable_checks" ADD CONSTRAINT "accounting_payable_checks_financialAccountId_fkey" FOREIGN KEY ("financialAccountId") REFERENCES "accounting_financial_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_payable_checks" ADD CONSTRAINT "accounting_payable_checks_treasuryTransactionId_fkey" FOREIGN KEY ("treasuryTransactionId") REFERENCES "accounting_supplier_treasury_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_payable_checks" ADD CONSTRAINT "accounting_payable_checks_replacementCheckId_fkey" FOREIGN KEY ("replacementCheckId") REFERENCES "accounting_payable_checks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_check_custody_events" ADD CONSTRAINT "accounting_check_custody_events_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "accounting_payable_checks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_inventory_events" ADD CONSTRAINT "accounting_inventory_events_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "accounting_inventory_identities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_inventory_events" ADD CONSTRAINT "accounting_inventory_events_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "accounting_ledger_vouchers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_inventory_events" ADD CONSTRAINT "accounting_inventory_events_predecessorEventId_fkey" FOREIGN KEY ("predecessorEventId") REFERENCES "accounting_inventory_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_inventory_valuation_layers" ADD CONSTRAINT "accounting_inventory_valuation_layers_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "accounting_inventory_identities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_inventory_layer_consumptions" ADD CONSTRAINT "accounting_inventory_layer_consumptions_layerId_fkey" FOREIGN KEY ("layerId") REFERENCES "accounting_inventory_valuation_layers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_inventory_reservations" ADD CONSTRAINT "accounting_inventory_reservations_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "accounting_inventory_identities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_production_batches" ADD CONSTRAINT "accounting_production_batches_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "accounting_ledger_vouchers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_production_cost_pools" ADD CONSTRAINT "accounting_production_cost_pools_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "accounting_production_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_production_outputs" ADD CONSTRAINT "accounting_production_outputs_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "accounting_production_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_inventory_migration_runs" ADD CONSTRAINT "accounting_inventory_migration_runs_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "accounting_ledger_vouchers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_inventory_migration_runs" ADD CONSTRAINT "accounting_inventory_migration_runs_successorRunId_fkey" FOREIGN KEY ("successorRunId") REFERENCES "accounting_inventory_migration_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_inventory_migration_items" ADD CONSTRAINT "accounting_inventory_migration_items_runId_fkey" FOREIGN KEY ("runId") REFERENCES "accounting_inventory_migration_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Financial and quantity facts are fixed-point and non-negative. Reversals are
-- represented by linked rows; the one negative allocation is the explicit
-- reversing allocation rather than an in-place edit.
ALTER TABLE "accounting_supplier_invoices" ADD CONSTRAINT "accounting_supplier_invoice_amounts_valid" CHECK (
  "grossRials" >= 0 AND "discountRials" >= 0 AND "attributableFreightRials" >= 0
  AND "recoverableTaxRials" >= 0 AND "nonRecoverableTaxRials" >= 0
  AND "deductionRials" >= 0 AND "retentionRials" >= 0 AND "netPayableRials" > 0
  AND "inventoryValueRials" >= 0
);
ALTER TABLE "accounting_supplier_invoice_lines" ADD CONSTRAINT "accounting_supplier_invoice_line_values_valid" CHECK (
  "quantity" > 0 AND "unitPriceRials" >= 0 AND "grossRials" >= 0
  AND "discountRials" >= 0 AND "attributableFreightRials" >= 0
  AND "recoverableTaxRials" >= 0 AND "nonRecoverableTaxRials" >= 0
  AND "deductionRials" >= 0 AND "retentionRials" >= 0
);
ALTER TABLE "accounting_supplier_open_items" ADD CONSTRAINT "accounting_supplier_open_item_amount_valid" CHECK ("amountRials" > 0);
ALTER TABLE "accounting_supplier_treasury_transactions" ADD CONSTRAINT "accounting_supplier_treasury_transaction_amount_valid" CHECK ("amountRials" > 0);
ALTER TABLE "accounting_supplier_allocations" ADD CONSTRAINT "accounting_supplier_allocation_amount_valid" CHECK ("amountRials" <> 0);
ALTER TABLE "accounting_payable_checks" ADD CONSTRAINT "accounting_payable_check_amount_valid" CHECK ("amountRials" > 0);
ALTER TABLE "accounting_inventory_events" ADD CONSTRAINT "accounting_inventory_event_quantity_valid" CHECK ("quantity" > 0);
ALTER TABLE "accounting_inventory_valuation_layers" ADD CONSTRAINT "accounting_inventory_layer_values_valid" CHECK ("quantity" > 0 AND "valueRials" >= 0);
ALTER TABLE "accounting_inventory_layer_consumptions" ADD CONSTRAINT "accounting_inventory_consumption_values_valid" CHECK ("quantity" > 0 AND "valueRials" >= 0);
ALTER TABLE "accounting_inventory_reservations" ADD CONSTRAINT "accounting_inventory_reservation_quantity_valid" CHECK ("quantity" > 0);
ALTER TABLE "accounting_production_cost_pools" ADD CONSTRAINT "accounting_production_cost_pool_values_valid" CHECK ("amountRials" >= 0 AND "basisQuantity" > 0 AND "policyVersion" > 0);
ALTER TABLE "accounting_production_outputs" ADD CONSTRAINT "accounting_production_output_values_valid" CHECK ("quantity" > 0 AND "valueRials" >= 0);
ALTER TABLE "accounting_inventory_migration_items" ADD CONSTRAINT "accounting_inventory_migration_item_values_valid" CHECK ("quantity" > 0 AND "valueRials" >= 0);

CREATE OR REPLACE FUNCTION accounting_guard_supply_chain_append_only()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Accounting supply-chain evidence is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "accounting_supplier_invoice_immutability" BEFORE UPDATE OR DELETE ON "accounting_supplier_invoices"
FOR EACH ROW EXECUTE FUNCTION accounting_guard_supply_chain_append_only();
CREATE TRIGGER "accounting_operational_evidence_receipt_immutability" BEFORE UPDATE OR DELETE ON "accounting_operational_evidence_receipts"
FOR EACH ROW EXECUTE FUNCTION accounting_guard_supply_chain_append_only();
CREATE TRIGGER "accounting_supplier_invoice_line_immutability" BEFORE UPDATE OR DELETE ON "accounting_supplier_invoice_lines"
FOR EACH ROW EXECUTE FUNCTION accounting_guard_supply_chain_append_only();
CREATE TRIGGER "accounting_supplier_open_item_immutability" BEFORE UPDATE OR DELETE ON "accounting_supplier_open_items"
FOR EACH ROW EXECUTE FUNCTION accounting_guard_supply_chain_append_only();
CREATE TRIGGER "accounting_supplier_treasury_transaction_immutability" BEFORE UPDATE OR DELETE ON "accounting_supplier_treasury_transactions"
FOR EACH ROW EXECUTE FUNCTION accounting_guard_supply_chain_append_only();
CREATE TRIGGER "accounting_supplier_allocation_immutability" BEFORE UPDATE OR DELETE ON "accounting_supplier_allocations"
FOR EACH ROW EXECUTE FUNCTION accounting_guard_supply_chain_append_only();
CREATE TRIGGER "accounting_check_event_immutability" BEFORE UPDATE OR DELETE ON "accounting_check_custody_events"
FOR EACH ROW EXECUTE FUNCTION accounting_guard_supply_chain_append_only();
CREATE TRIGGER "accounting_inventory_event_immutability" BEFORE UPDATE OR DELETE ON "accounting_inventory_events"
FOR EACH ROW EXECUTE FUNCTION accounting_guard_supply_chain_append_only();
CREATE TRIGGER "accounting_inventory_layer_immutability" BEFORE UPDATE OR DELETE ON "accounting_inventory_valuation_layers"
FOR EACH ROW EXECUTE FUNCTION accounting_guard_supply_chain_append_only();
CREATE TRIGGER "accounting_inventory_consumption_immutability" BEFORE UPDATE OR DELETE ON "accounting_inventory_layer_consumptions"
FOR EACH ROW EXECUTE FUNCTION accounting_guard_supply_chain_append_only();

CREATE OR REPLACE FUNCTION accounting_guard_inventory_reservation_release()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Accounting inventory reservation is append-only';
  END IF;
  IF OLD."status" <> 'ACTIVE' OR NEW."status" <> 'RELEASED'
     OR NEW."releasedAt" IS NULL OR NEW."releasedBy" IS NULL
     OR NEW."releaseEvidenceType" IS NULL OR NEW."releaseEvidenceId" IS NULL
     OR NEW."releaseEvidenceVersion" IS NULL OR NEW."releaseEvidenceHash" IS NULL
     OR NEW."releaseEvidencePayload" IS NULL
     OR OLD."identityId" IS DISTINCT FROM NEW."identityId"
     OR OLD."unit" IS DISTINCT FROM NEW."unit"
     OR OLD."quantity" IS DISTINCT FROM NEW."quantity"
     OR OLD."purposeId" IS DISTINCT FROM NEW."purposeId"
     OR OLD."idempotencyKey" IS DISTINCT FROM NEW."idempotencyKey"
     OR OLD."evidenceHash" IS DISTINCT FROM NEW."evidenceHash" THEN
    RAISE EXCEPTION 'Invalid accounting inventory reservation transition';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "accounting_inventory_reservation_release_guard"
BEFORE UPDATE OR DELETE ON "accounting_inventory_reservations"
FOR EACH ROW EXECUTE FUNCTION accounting_guard_inventory_reservation_release();
CREATE TRIGGER "accounting_production_batch_immutability" BEFORE UPDATE OR DELETE ON "accounting_production_batches"
FOR EACH ROW EXECUTE FUNCTION accounting_guard_supply_chain_append_only();
CREATE TRIGGER "accounting_production_cost_pool_immutability" BEFORE UPDATE OR DELETE ON "accounting_production_cost_pools"
FOR EACH ROW EXECUTE FUNCTION accounting_guard_supply_chain_append_only();
CREATE TRIGGER "accounting_production_output_immutability" BEFORE UPDATE OR DELETE ON "accounting_production_outputs"
FOR EACH ROW EXECUTE FUNCTION accounting_guard_supply_chain_append_only();
CREATE TRIGGER "accounting_inventory_migration_item_immutability" BEFORE UPDATE OR DELETE ON "accounting_inventory_migration_items"
FOR EACH ROW EXECUTE FUNCTION accounting_guard_supply_chain_append_only();

CREATE OR REPLACE FUNCTION accounting_guard_inventory_identity_meaning()
RETURNS trigger AS $$
BEGIN
  IF OLD."kind" IS DISTINCT FROM NEW."kind"
     OR OLD."originId" IS DISTINCT FROM NEW."originId"
     OR OLD."valuationMethod" IS DISTINCT FROM NEW."valuationMethod"
     OR OLD."governedUnit" IS DISTINCT FROM NEW."governedUnit" THEN
    RAISE EXCEPTION 'Used inventory identity meaning is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "accounting_inventory_identity_meaning_immutability"
BEFORE UPDATE ON "accounting_inventory_identities"
FOR EACH ROW EXECUTE FUNCTION accounting_guard_inventory_identity_meaning();
